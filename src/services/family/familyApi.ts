import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import type { LocationSnapshot } from '../../core/types';

const BASE = (process.env.EXPO_PUBLIC_FAMILY_API_URL || '').replace(/\/$/, '');
const AUTH_BASE = (process.env.EXPO_PUBLIC_FAMILY_AUTH_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'telemetry.family.session.v1';

export type FamilyUser = {
  id: string;
  email: string;
  name: string;
  sharingEnabled: boolean;
  familyReady: boolean;
};

export function familyConfigured(): boolean {
  return BASE.startsWith('https://') && !BASE.includes('example.com') &&
    AUTH_BASE.startsWith('https://') && !AUTH_BASE.includes('example.com');
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
  }
}

export async function hasFamilySession(): Promise<boolean> {
  return !!(await SecureStore.getItemAsync(TOKEN_KEY));
}

/** Family location uploads remain disabled until per-contact sharing ACLs exist on Cloudflare. */
export async function publishFamilyFix(_fix: LocationSnapshot): Promise<void> {
  return;
}
