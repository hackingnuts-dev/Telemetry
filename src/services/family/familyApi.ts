import * as SecureStore from 'expo-secure-store';
import * as Battery from 'expo-battery';
import type { LocationSnapshot } from '../../core/types';
import { getSettings } from '../../core/settings';

const FAMILY_URL = (process.env.EXPO_PUBLIC_FAMILY_API_URL || '').replace(/\/$/, '');
const SESSION_KEY = 'telemetry.family.session.v1';
const SHARING_KEY = 'telemetry.family.sharing.v1';
const CHALLENGE_KEY = 'telemetry.family.email_challenge.v1';
let lastFamilyUpload = 0;

export type FamilyUser = { id: string; email: string; name: string; sharingEnabled: boolean; familyReady: boolean };
export type FamilyContact = {
  id: string;
  name: string;
  phone: string;
  sharing: boolean;
  latitude: number | null;
  longitude: number | null;
  battery: number | null;
  updatedAt: string | null;
  online: boolean;
};
export type FamilyInvite = { id: string; from_name: string; from_phone: string };
export const familyConfigured = () =>
  FAMILY_URL.startsWith('https://') && !FAMILY_URL.includes('example.com');

async function request<T>(path: string, method = 'GET', body?: object, loggedIn = true): Promise<T> {
  if (!familyConfigured())
    throw new Error('Set EXPO_PUBLIC_FAMILY_API_URL to the deployed HTTPS family server and rebuild.');
  const token = loggedIn ? await SecureStore.getItemAsync(SESSION_KEY) : null;
  if (loggedIn && !token) throw new Error('Sign in to your family account');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(FAMILY_URL + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(data.error || 'Family service error (' + res.status + ')');
    return data;
  } finally {
    clearTimeout(timer);
  }
}
export async function startFamilyLogin(email: string): Promise<void> {
  const result = await request<{ challengeId: string }>(
    '/v1/auth/email/start', 'POST', { email: email.trim().toLowerCase() }, false,
  );
  await SecureStore.setItemAsync(CHALLENGE_KEY, result.challengeId);
}
export async function verifyFamilyLogin(email: string, code: string, name: string): Promise<FamilyUser> {
  const challengeId = await SecureStore.getItemAsync(CHALLENGE_KEY);
  if (!challengeId) throw new Error('Request a new email code first');
  const result = await request<{ token: string; user: FamilyUser }>(
    '/v1/auth/email/verify',
    'POST',
    { email: email.trim().toLowerCase(), code: code.trim(), challengeId, name },
    false,
  );
  await SecureStore.setItemAsync(SESSION_KEY, result.token);
  await SecureStore.deleteItemAsync(CHALLENGE_KEY);
  // Email authentication does not authorize family location sharing.
  await SecureStore.setItemAsync(SHARING_KEY, 'false');
  return result.user;
}
export async function familyMe(): Promise<FamilyUser> {
  const response = await request<{ user: FamilyUser }>('/v1/me');
  await SecureStore.setItemAsync(SHARING_KEY, response.user.familyReady && response.user.sharingEnabled ? 'true' : 'false');
  return response.user;
}
export const familyContacts = async () =>
  (await request<{ contacts: FamilyContact[] }>('/v1/family/contacts')).contacts;
export const familyInvites = async () =>
  (await request<{ invitations: FamilyInvite[] }>('/v1/invites')).invitations;
export type FamilyViewer = { id: string; name: string; phone: string };
export async function familyViewers(): Promise<FamilyViewer[]> {
  const result = await request<{ viewers: FamilyViewer[] }>('/v1/family/viewers');
  return result.viewers;
}
export async function revokeFamilyViewer(id: string): Promise<void> {
  await request('/v1/family/shares/' + encodeURIComponent(id), 'DELETE');
}
export async function inviteFamily(phone: string): Promise<void> {
  await request('/v1/invites', 'POST', { phone });
}
export async function acceptFamilyInvite(id: string): Promise<void> {
  await request('/v1/invites/' + encodeURIComponent(id) + '/accept', 'POST', {});
  await SecureStore.setItemAsync(SHARING_KEY, 'true');
}
export async function declineFamilyInvite(id: string): Promise<void> {
  await request('/v1/invites/' + encodeURIComponent(id) + '/decline', 'POST', {});
}
export async function familyPause(enabled: boolean): Promise<FamilyUser> {
  const r = await request<{ user: FamilyUser }>('/v1/family/sharing', 'POST', { enabled });
  await SecureStore.setItemAsync(SHARING_KEY, r.user.sharingEnabled ? 'true' : 'false');
  return r.user;
}
export async function familyHistory(id: string): Promise<number> {
  const x = await request<{ history: unknown[] }>(
    '/v1/family/contacts/' + encodeURIComponent(id) + '/history',
  );
  return x.history.length;
}
export async function familySignOut(): Promise<void> {
  try {
    await request('/v1/auth/logout', 'POST', {});
  } finally {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    await SecureStore.setItemAsync(SHARING_KEY, 'false');
    await SecureStore.deleteItemAsync(CHALLENGE_KEY);
  }
}
export async function hasFamilySession(): Promise<boolean> {
  return !!(await SecureStore.getItemAsync(SESSION_KEY));
}
/** Best-effort send of consented location observations, not hidden logging. Backend re-checks ACL. */
export async function publishFamilyFix(fix: LocationSnapshot): Promise<void> {
  if (!familyConfigured() || !(await hasFamilySession())) return;
  const settings = await getSettings();
  if (!settings.locationEnabled || (await SecureStore.getItemAsync(SHARING_KEY)) !== 'true') return;
  const now = Date.now();
  if (now - lastFamilyUpload < 120000) return;
  lastFamilyUpload = now;
  try {
    // A different signed-in device may have paused sharing. Check server policy
    // before sending coordinates, so paused users don't even transmit a fix.
    const me = await familyMe();
    if (!me.sharingEnabled) return;
    const level = await Battery.getBatteryLevelAsync().catch(() => -1);
    await request('/v1/location', 'POST', {
      lat: fix.latitude,
      lng: fix.longitude,
      accuracy: fix.accuracy,
      ...(level >= 0 ? { battery: Math.round(level * 100) } : {}),
    });
  } catch {
    lastFamilyUpload = 0;
    // No coordinates or credentials are written to logs. Next OS callback can retry.
  }
}
