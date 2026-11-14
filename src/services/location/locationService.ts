import * as Location from 'expo-location';
import type { LocationObject, LocationSubscription } from 'expo-location';
import { LOCATION_TASK } from '../../core/config';
import { handleLocation } from './locationEngine';

export type LocationMode = 'off' | 'foreground' | 'background';
export type LocationStartResult = LocationMode | 'permission_denied' | 'services_disabled';

let foregroundSubscription: LocationSubscription | null = null;

function submitLocation(location: LocationObject): void {
  void handleLocation({
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    recordedAt: Math.round(location.timestamp),
  }).catch(() => {
    // Do not expose coordinates in application logs.
  });
}

async function startForegroundWatch(): Promise<void> {
  if (foregroundSubscription) return;
  foregroundSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 75,
      timeInterval: 300_000,
    },
    submitLocation,
  );
  // Seed the dashboard after authorization, without waiting for a movement event.
  void (async () => {
    try {
      const cached = await Location.getLastKnownPositionAsync({
        maxAge: 300_000,
        requiredAccuracy: 150,
      });
      submitLocation(
        cached ??
          (await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          })),
      );
    } catch {
      // A later foreground watcher update may still arrive.
    }
  })();
}

async function startBackgroundWatch(): Promise<void> {
  if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 75,
      deferredUpdatesInterval: 300_000,
      deferredUpdatesDistance: 75,
      pausesUpdatesAutomatically: true,
      showsBackgroundLocationIndicator: true,
    });
  }
  if (foregroundSubscription) {
    foregroundSubscription.remove();
    foregroundSubscription = null;
  }
  // Also seed the encrypted dashboard when tracking is first activated.
  void Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  })
    .then(submitLocation)
    .catch(() => {});
}

export async function getLocationMode(): Promise<LocationMode> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) return 'background';
  return foregroundSubscription ? 'foreground' : 'off';
}

export async function locationIsRunning(): Promise<boolean> {
  return (await getLocationMode()) !== 'off';
}

/** Called after a deliberate user action, without any overlapping native alerts. */
export async function enableLocation(): Promise<LocationStartResult> {
  if (!(await Location.hasServicesEnabledAsync())) return 'services_disabled';
  const existing = await Location.getForegroundPermissionsAsync();
  const foreground = existing.granted ? existing : await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return 'permission_denied';
  const background = await Location.getBackgroundPermissionsAsync();
  if (background.granted) {
    try {
      await startBackgroundWatch();
      return 'background';
    } catch {
      // Never reject foreground collection just because background setup failed.
    }
  }
  await startForegroundWatch();
  return 'foreground';
}

/** Explicit upgrade only; no repeated automatic 'Always' permission prompts. */
export async function requestBackgroundAccess(): Promise<LocationMode | 'permission_denied'> {
  if (!(await Location.hasServicesEnabledAsync())) return 'permission_denied';
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) return 'permission_denied';
  const existing = await Location.getBackgroundPermissionsAsync();
  const granted = existing.granted ? existing : await Location.requestBackgroundPermissionsAsync();
  if (granted.granted) {
    try {
      await startBackgroundWatch();
      return 'background';
    } catch {
      // Keep foreground collection available if iOS prevents background updates.
    }
  }
  await startForegroundWatch();
  return 'foreground';
}

/** Reconnect authorized collection on app launch, without asking for permissions. */
export async function restoreLocationIfPermitted(): Promise<LocationMode> {
  if (!(await Location.hasServicesEnabledAsync())) return 'off';
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) return 'off';
  const background = await Location.getBackgroundPermissionsAsync();
  if (background.granted) {
    try {
      await startBackgroundWatch();
      return 'background';
    } catch {
      // Fall back to foreground on an unsupported or unavailable background task.
    }
  }
  await startForegroundWatch();
  return 'foreground';
}

export async function disableLocation(): Promise<void> {
  if (foregroundSubscription) {
    foregroundSubscription.remove();
    foregroundSubscription = null;
  }
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}
