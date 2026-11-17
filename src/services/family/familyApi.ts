import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
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
export async function revokeFamilyViewer(id: string): Promise<void> {
  await authenticated('/v1/family/viewers/' + encodeURIComponent(id), 'DELETE');
}
export async function getFamilyHistory(id: string): Promise<number> {
  return (
    await authenticated<{ history: unknown[] }>('/v1/family/contacts/' + encodeURIComponent(id) + '/history')
  ).history.length;
}

/** Send only an owner-approved location observation to consented contacts. */
export async function publishFamilyFix(fix: LocationSnapshot): Promise<void> {
  if (!familyConfigured() || !(await hasFamilySession())) return;
  const settings = await import('../../core/settings').then((m) => m.getSettings());
  if (!settings.locationEnabled || (await SecureStore.getItemAsync(SHARING_KEY)) !== 'true') return;
  const now = Date.now();
  if (now - lastUpload < 120000) return;
  lastUpload = now;
  try {
    const status = await familyStatus();
    if (!status.sharingEnabled || status.authorizedViewers < 1) {
      await SecureStore.setItemAsync(SHARING_KEY, 'false');
      return;
    }
    const Battery = await import('expo-battery');
    const battery = await Battery.getBatteryLevelAsync().catch(() => -1);
    await authenticated('/v1/location', 'POST', {
      lat: fix.latitude,
      lng: fix.longitude,
      accuracy: fix.accuracy,
      ...(battery >= 0 ? { battery: Math.round(battery * 100) } : {}),
    });
  } catch {
    lastUpload = 0;
    // No coordinates, login tokens, or account data written to logs.
  }
}
