import * as SecureStore from 'expo-secure-store';
import { DEFAULT_SETTINGS } from './config';
import type { TelemetrySettings } from './types';

const KEY = 'telemetry.settings.v1';
export async function getSettings(): Promise<TelemetrySettings> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const data = JSON.parse(raw) as Partial<TelemetrySettings>;
    return {
      locationEnabled: data.locationEnabled === true,
      appTelemetryEnabled: data.appTelemetryEnabled === true,
      syncEnabled: data.syncEnabled === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export async function saveSettings(value: TelemetrySettings): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(value));
}
