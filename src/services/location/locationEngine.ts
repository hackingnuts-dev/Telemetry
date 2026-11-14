import * as Crypto from 'expo-crypto';
import { getInstallationId } from '../../core/identity';
import { getLastLocation, getState, putState, queueEvent, saveObservation } from '../../core/database';
import { STATIONARY_MS, STATIONARY_RADIUS_M } from '../../core/config';
import { hasStationaryDwell, isUsableLocation, shouldProcessLocation } from './locationPolicy';
import { getSettings } from '../../core/settings';
import { publishFamilyFix } from '../family/familyApi';
import type { LocationSnapshot, TelemetryEvent } from '../../core/types';
import { getZones, metersBetween, resolveZone } from './zones';

type State = {
  anchor: { latitude: number; longitude: number } | null;
  stationarySince: number | null;
  dwellReported: boolean;
  zone: string | null;
  lastProcessedAt: number;
};

const EMPTY: State = {
  anchor: null,
  stationarySince: null,
  dwellReported: false,
  zone: null,
  lastProcessedAt: 0,
};
let processing: Promise<void> = Promise.resolve();

export function handleLocation(fix: LocationSnapshot): Promise<void> {
  // Serialize events arriving in quick succession so the state machine cannot double-enqueue.
  processing = processing.catch(() => {}).then(() => processFix(fix));
  return processing;
}

async function processFix(fix: LocationSnapshot): Promise<void> {
  const settings = await getSettings();
  if (!settings.locationEnabled) return;
  if (!isUsableLocation(fix, Date.now())) return;
  const state: State = JSON.parse((await getState('location_engine')) ?? JSON.stringify(EMPTY));
  if (!shouldProcessLocation(fix.recordedAt, state.lastProcessedAt)) return;
  state.lastProcessedAt = fix.recordedAt;
  await saveObservation(fix);
  const id = await getInstallationId();
  const emit = async (type: TelemetryEvent['type'], zoneId?: string) => {
    await queueEvent({
      id: Crypto.randomUUID(),
      type,
      deviceId: id,
      latitude: fix.latitude,
      longitude: fix.longitude,
      occurredAt: fix.recordedAt,
      ...(zoneId ? { zoneId } : {}),
    });
  };

  const zones = await getZones();
  const zone = resolveZone(fix, zones, state.zone);
  if (zone !== state.zone && state.anchor) {
    if (state.zone) await emit('zone_exit', state.zone);
    if (zone) await emit('zone_enter', zone);
  }
  state.zone = zone;

  const moved =
    !state.anchor ||
    metersBetween(fix, state.anchor) > Math.max(STATIONARY_RADIUS_M, 2 * (fix.accuracy ?? 0));
  if (moved) {
    state.anchor = { latitude: fix.latitude, longitude: fix.longitude };
    state.stationarySince = fix.recordedAt;
    state.dwellReported = false;
  } else if (hasStationaryDwell(state.stationarySince, fix.recordedAt, state.dwellReported, STATIONARY_MS)) {
    await emit('stationary_dwell', zone ?? undefined);
    state.dwellReported = true;
  }
  await putState('location_engine', JSON.stringify(state));
  // Only publish when this user has opted in to family sharing and verified their login.
  await publishFamilyFix(fix);
}

export { getLastLocation };
