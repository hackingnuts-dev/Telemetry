import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY = 'telemetry.install_id.v1';
const ACCESS_TOKEN_KEY = 'telemetry.enterprise_token.v1';

/** Random per-install identifier, NOT an authentication secret or phone number. */
export async function getInstallationId(): Promise<string> {
  let value = await SecureStore.getItemAsync(KEY);
  if (!value) {
    value = Crypto.randomUUID();
    await SecureStore.setItemAsync(KEY, value);
  }
  return value;
}

/** Provisioned after authenticating with enterprise OIDC/MDM. Never hardcode a token. */
export async function getEnterpriseToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function setEnterpriseTokenFromTrustedLogin(token: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token);
}
