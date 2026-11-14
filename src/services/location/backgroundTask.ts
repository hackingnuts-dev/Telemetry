import * as TaskManager from 'expo-task-manager';
import type { LocationObject } from 'expo-location';
import { LOCATION_TASK } from '../../core/config';
import { handleLocation } from './locationEngine';

// Must be defined at module scope, imported by index.ts before React mounts.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const locations = (data as { locations?: LocationObject[] }).locations ?? [];
  for (const location of locations) {
    try {
      await handleLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
        recordedAt: Math.round(location.timestamp),
      });
    } catch {
      // Database or permission errors must not be ignored in a production monitoring pipeline.
      // The next app launch exposes a diagnostics state; never upload raw location to logs.
    }
  }
});
