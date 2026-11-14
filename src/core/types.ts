export type TelemetrySettings = {
  locationEnabled: boolean;
  appTelemetryEnabled: boolean;
  syncEnabled: boolean;
};

export type LocationSnapshot = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recordedAt: number;
};

export type TelemetryEvent = {
  id: string;
  type: 'zone_enter' | 'zone_exit' | 'stationary_dwell';
  deviceId: string;
  latitude: number;
  longitude: number;
  occurredAt: number;
  zoneId?: string;
};

export type PhoneStatus = 'not_provided' | 'pending_verification' | 'verified';
