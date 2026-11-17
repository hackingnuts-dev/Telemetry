import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { getSettings } from '../../core/settings';
import type { LocationSnapshot } from '../../core/types';

const BASE = (process.env.EXPO_PUBLIC_FAMILY_API_URL || '').replace(/\/$/, '');
const AUTH_BASE = (process.env.EXPO_PUBLIC_FAMILY_AUTH_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'telemetry.family.session.v1';
const SHARING_KEY = 'telemetry.family.explicit_sharing.v2';
let lastUpload = 0;

export type FamilyUser = {
  id: string;
  email: string;
  name: string;
  sharingEnabled: boolean;
  familyReady: boolean;
};

export function familyConfigured(): boolean {
  return (
    BASE.startsWith('https://') &&
    !BASE.includes('example.com') &&
    AUTH_BASE.startsWith('https://') &&
    !AUTH_BASE.includes('example.com')
  );
}

async function api<T>(path: string, method = 'GET', body?: object, token?: string): Promise<T> {
  if (!familyConfigured()) throw new Error('The Telemetry Family server has not been connected.');
  const result = await fetch(BASE + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = result.headers.get('content-type') || '';
  if (!contentType.includes('application/json'))
    throw new Error('Cloudflare Access sign-in configuration needs attention.');
  const data = (await result.json()) as T & { error?: string };
  if (!result.ok) throw new Error(data.error || 'Family authentication failed.');
  return data;
}

function randomHex(length: number): string {
  return Array.from(Crypto.getRandomBytes(length), (n) => n.toString(16).padStart(2, '0')).join('');
}

/** System browser handles Access OTP. PKCE-style code exchange avoids sending a session in a deep link. */
export async function signInWithCloudflareAccess(): Promise<FamilyUser> {
  if (!familyConfigured()) throw new Error('Family server is not connected.');
  const state = randomHex(16);
  const verifier = randomHex(32);
  const challenge = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier);
  const redirectUri = 'telemetry://family-auth';
  const loginUrl = AUTH_BASE + '/auth/access/complete?state=' + state + '&challenge=' + challenge;
  const result = await WebBrowser.openAuthSessionAsync(loginUrl, redirectUri);
  if (result.type !== 'success') throw new Error('Sign-in was cancelled.');
  const callback = new URL(result.url);
  if (callback.protocol !== 'telemetry:' || callback.hostname !== 'family-auth')
    throw new Error('Unexpected sign-in callback.');
  const receivedState = callback.searchParams.get('state');
  const code = callback.searchParams.get('code');
  if (receivedState !== state || !code || !/^[a-f0-9]{64}$/.test(code))
    throw new Error('Invalid or outdated login. Please try again.');
  const data = await api<{ token: string; user: FamilyUser }>('/v1/auth/access/exchange', 'POST', {
    code,
    state,
    verifier,
  });
  await SecureStore.setItemAsync(TOKEN_KEY, data.token);
  const stateOfSharing = await familyStatus();
  await SecureStore.setItemAsync(SHARING_KEY, stateOfSharing.sharingEnabled ? 'true' : 'false');
  return data.user;
}

export async function familyMe(): Promise<FamilyUser> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) throw new Error('Please sign in.');
  return (await api<{ user: FamilyUser }>('/v1/me', 'GET', undefined, token)).user;
}

export async function familySignOut(): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  try {
    if (token && familyConfigured()) await api('/v1/auth/logout', 'POST', {}, token);
  } finally {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.setItemAsync(SHARING_KEY, 'false');
  }
}

export async function hasFamilySession(): Promise<boolean> {
  return !!(await SecureStore.getItemAsync(TOKEN_KEY));
}

export type FamilyContact = {
  id: string;
  name: string;
  email: string;
  sharing: boolean;
  latitude: number | null;
  longitude: number | null;
  battery: number | null;
  updatedAt: number | null;
  online: boolean;
};
export type FamilyInvitation = { id: string; from_name: string; from_email: string; created_at: number };
export type FamilyViewer = { id: string; name: string; email: string };
async function authenticated<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) throw new Error('Sign in to your family account');
  return api<T>(path, method, body, token);
}
export async function familyStatus(): Promise<{ sharingEnabled: boolean; authorizedViewers: number }> {
  return authenticated('/v1/family/status');
}
export async function familyContacts(): Promise<FamilyContact[]> {
  return (await authenticated<{ contacts: FamilyContact[] }>('/v1/family/contacts')).contacts;
}
export async function familyInvitations(): Promise<FamilyInvitation[]> {
  return (await authenticated<{ invitations: FamilyInvitation[] }>('/v1/invites')).invitations;
}
export async function familyViewers(): Promise<FamilyViewer[]> {
  return (await authenticated<{ viewers: FamilyViewer[] }>('/v1/family/viewers')).viewers;
}
export async function inviteFamily(email: string): Promise<void> {
  await authenticated('/v1/invites', 'POST', { email });
}
export async function decideInvitation(id: string, decision: 'accept' | 'decline'): Promise<void> {
  await authenticated('/v1/invites/' + encodeURIComponent(id) + '/' + decision, 'POST', {});
}
export async function setFamilySharing(enabled: boolean): Promise<void> {
  const result = await authenticated<{ sharingEnabled: boolean }>('/v1/family/sharing', 'POST', { enabled });
  await SecureStore.setItemAsync(SHARING_KEY, result.sharingEnabled ? 'true' : 'false');
}
/** Your own explicit authorization makes a connection reciprocal; it never turns on location sharing. */
export async function shareMyLocationWithContact(id: string): Promise<void> {
  await authenticated('/v1/family/contacts/' + encodeURIComponent(id) + '/share-back', 'POST', {});
}
export async function revokeFamilyViewer(id: string): Promise<void> {
  await authenticated('/v1/family/viewers/' + encodeURIComponent(id), 'DELETE');
}
export async function getFamilyHistory(id: string): Promise<number> {
  return (
    await authenticated<{ history: unknown[] }>('/v1/family/contacts/' + encodeURIComponent(id) + '/history')
  ).history.length;
}

/** Upload only a fix the owner opted to share with at least one authorized contact. */
export async function publishFamilyFix(
  fix: LocationSnapshot,
  options: { force?: boolean } = {},
): Promise<boolean> {
  if (!familyConfigured() || !(await hasFamilySession())) return false;
  const settings = await getSettings();
  if (!settings.locationEnabled || (await SecureStore.getItemAsync(SHARING_KEY)) !== 'true')
    return false;
  const now = Date.now();
  if (!options.force && now - lastUpload < 120000) return false;
  try {
    const status = await familyStatus();
    if (!status.sharingEnabled || status.authorizedViewers < 1) {
      if (!status.sharingEnabled) await SecureStore.setItemAsync(SHARING_KEY, 'false');
      return false;
    }
    const level = await Battery.getBatteryLevelAsync().catch(() => -1);
    await authenticated('/v1/location', 'POST', {
      lat: fix.latitude,
      lng: fix.longitude,
      accuracy: fix.accuracy,
      ...(level >= 0 ? { battery: Math.round(level * 100) } : {}),
    });
    lastUpload = Date.now();
    return true;
  } catch {
    // Background tasks retry next time. Never log coordinates or tokens.
    return false;
  }
}

export type FamilySyncResult = {
  contacts: FamilyContact[];
  uploaded: boolean;
  message: string;
};

/** User-initiated family refresh, separate from the legacy enterprise event outbox. */
export async function syncFamilyNow(): Promise<FamilySyncResult> {
  if (!familyConfigured() || !(await hasFamilySession())) {
    throw new Error('Sign in to Family Safety first to refresh shared locations.');
  }
  const status = await familyStatus();
  const settings = await getSettings();
  let uploaded = false;
  let message = 'Family contact locations refreshed. Your location is not being shared.';

  if (status.sharingEnabled && status.authorizedViewers > 0 && settings.locationEnabled) {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.granted) {
      try {
        const fresh = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        uploaded = await publishFamilyFix(
          {
            latitude: fresh.coords.latitude,
            longitude: fresh.coords.longitude,
            accuracy: fresh.coords.accuracy,
            recordedAt: Math.round(fresh.timestamp),
          },
          { force: true },
        );
        message = uploaded
          ? 'Your newest location was shared with approved contacts.'
          : 'Family locations refreshed, but your latest location could not be uploaded.';
      } catch {
        message = 'Family locations refreshed. A fresh GPS fix was unavailable.';
      }
    } else {
      message = 'Family locations refreshed. Enable Location permission to share yours.';
    }
  } else if (status.sharingEnabled && status.authorizedViewers === 0) {
    message = 'Family locations refreshed. No contacts are currently authorized to view yours.';
  } else if (status.sharingEnabled && !settings.locationEnabled) {
    message = 'Family locations refreshed. Enable Location in Settings to share yours.';
  }
  const contacts = await familyContacts();
  return { contacts, uploaded, message };
}
