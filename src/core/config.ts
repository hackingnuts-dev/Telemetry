import type { TelemetrySettings } from './types';

export const DEFAULT_SETTINGS: TelemetrySettings = {
  locationEnabled: false,
  appTelemetryEnabled: false,
  syncEnabled: false,
};

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

export const LOCATION_TASK = 'TELEMETRY_AUTHORIZED_LOCATION';
export const MAX_LOCATION_ACCURACY_M = 150;
export const MIN_FIX_INTERVAL_MS = 300_000;
export const STATIONARY_MS = 30 * 60_000;
export const STATIONARY_RADIUS_M = 75;
