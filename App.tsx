import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Battery from 'expo-battery';
import { DEFAULT_SETTINGS } from './src/core/config';
import { countPending, database, getLastLocation } from './src/core/database';
import { getSettings, saveSettings } from './src/core/settings';
import type { LocationSnapshot, TelemetrySettings, PhoneStatus } from './src/core/types';
import {
  disableLocation,
  enableLocation,
  getLocationMode,
  locationIsRunning,
  requestBackgroundAccess,
  restoreLocationIfPermitted,
} from './src/services/location/locationService';
import type { LocationMode } from './src/services/location/locationService';
import {
  getPhoneDetails,
  requestPhoneVerification,
  verifyPhoneCode,
} from './src/services/telephony/PhoneNumberService';
import { flushOutbox, syncConfigured } from './src/services/sync/syncService';
import {
  familyConfigured,
  familyContacts,
  hasFamilySession,
  syncFamilyNow,
} from './src/services/family/familyApi';
import type { FamilyContact } from './src/services/family/familyApi';
import { getUsageCapability } from './src/services/usage/UsageTelemetry';
import Dashboard from './src/ui/Dashboard';
import Settings from './src/ui/Settings';
import Family from './src/ui/Family';
import { C } from './src/ui/theme';

export default function App() {
  const [page, setPage] = useState<'dashboard' | 'settings' | 'family'>('dashboard');
  const [settings, setSettings] = useState<TelemetrySettings>(DEFAULT_SETTINGS);
  const [running, setRunning] = useState(false);
  const [locationMode, setLocationMode] = useState<LocationMode>('off');
  const [location, setLocation] = useState<LocationSnapshot | null>(null);
  const [phone, setPhone] = useState<{ masked: string; status: PhoneStatus }>({
    masked: 'Not added',
    status: 'not_provided',
  });
  const [battery, setBattery] = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const [familyLocations, setFamilyLocations] = useState<FamilyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshFamily = useCallback(async () => {
    if (!familyConfigured() || !(await hasFamilySession())) {
      setFamilyLocations([]);
      return;
    }
    try {
      setFamilyLocations(await familyContacts());
    } catch {
      // Keep last known positions on temporary network errors.
    }
  }, []);

  const refresh = useCallback(async () => {
    const [fix, count, phoneDetails, level, mode] = await Promise.all([
      getLastLocation(),
      countPending(),
      getPhoneDetails(),
      Battery.getBatteryLevelAsync(),
      getLocationMode(),
    ]);
    setLocation(fix);
    setPending(count);
    setPhone(phoneDetails);
    setBattery(level >= 0 ? Math.round(level * 100) : null);
    setLocationMode(mode);
    setRunning(mode !== 'off');
    void refreshFamily();
  }, [refreshFamily]);

  useEffect(() => {
    let mounted = true;
    const startup = async () => {
      try {
        await database();
        const preferences = await getSettings();
        if (mounted) setSettings(preferences);
        if (!preferences.locationEnabled && (await locationIsRunning())) await disableLocation();
        if (preferences.locationEnabled) await restoreLocationIfPermitted();
        await refresh();
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Unable to initialize secure storage');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void startup();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh().catch(() => {});
    });
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void refresh().catch(() => {});
    }, 60_000);
    return () => {
      mounted = false;
      listener.remove();
      clearInterval(interval);
    };
  }, [refresh]);

  const onToggle = async (key: keyof TelemetrySettings, value: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (key === 'appTelemetryEnabled' && value && !getUsageCapability().available) {
        Alert.alert('Unavailable', 'App usage collection is not enabled in this build.');
        return;
      }
      if (key === 'locationEnabled') {
        if (value) {
          // Persist user intent before seeding the first location fix.
          const next = { ...settings, locationEnabled: true };
          await saveSettings(next);
          let result: Awaited<ReturnType<typeof enableLocation>>;
          try {
            result = await enableLocation();
          } catch (e) {
            await saveSettings(settings);
            throw e;
          }
          if (result === 'permission_denied' || result === 'services_disabled') {
            await saveSettings(settings);
            Alert.alert(
              result === 'services_disabled' ? 'Location Services are off' : 'Location permission needed',
              result === 'services_disabled'
                ? 'Turn on Location Services in iPhone Settings, then try again.'
                : 'Allow Telemetry to access your location in iPhone Settings, then try again.',
              [
                { text: 'Not now', style: 'cancel' },
                { text: 'Open Settings', onPress: () => void Linking.openSettings() },
              ],
            );
            return;
          }
          setSettings(next);
          await refresh();
          return;
        }
        await disableLocation();
      }
      const next = { ...settings, [key]: value };
      await saveSettings(next);
      setSettings(next);
      await refresh();
    } catch (e) {
      Alert.alert('Unable to update', e instanceof Error ? e.message : 'Please try again');
    } finally {
      setBusy(false);
    }
  };

  const onRequestBackground = async () => {
    setBusy(true);
    try {
      const mode = await requestBackgroundAccess();
      await refresh();
      if (mode !== 'background') {
        Alert.alert(
          'Background access not enabled',
          'Location works while Telemetry is open. To allow background tracking, choose Always for Telemetry in iPhone Settings, if available.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ],
        );
      }
    } catch (e) {
      Alert.alert('Background location unavailable', e instanceof Error ? e.message : 'Please try again');
    } finally {
      setBusy(false);
    }
  };

  const onSync = async () => {
    setSyncing(true);
    try {
      if (familyConfigured()) {
        const result = await syncFamilyNow();
        setFamilyLocations(result.contacts);
        if (result.ownFix) setLocation(result.ownFix);
        Alert.alert('Family location refresh', result.message);
      } else if (syncConfigured()) {
        const result = await flushOutbox();
        Alert.alert('Enterprise event sync', result.reason ?? `${result.sent} event(s) acknowledged.`);
      } else {
        Alert.alert('Family sign-in needed', 'Open Family safety to sign in before refreshing shared locations.');
      }
      await refresh();
    } catch (e) {
      Alert.alert('Sync status', e instanceof Error ? e.message : 'Unable to refresh family locations');
    } finally {
      setSyncing(false);
    }
  };

  const onPhoneRequest = async (number: string) => {
    setBusy(true);
    try {
      await requestPhoneVerification(number);
      await refresh();
      Alert.alert('Code requested', 'Enter the code delivered to your number.');
    } catch (e) {
      Alert.alert('Cannot verify phone', e instanceof Error ? e.message : 'Unable to start verification');
    } finally {
      setBusy(false);
    }
  };
  const onPhoneVerify = async (code: string) => {
    setBusy(true);
    try {
      await verifyPhoneCode(code);
      await refresh();
      Alert.alert('Phone verified', 'Your number is linked to this managed device.');
    } catch (e) {
      Alert.alert('Verification failed', e instanceof Error ? e.message : 'Incorrect code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.blue} size="large" />
          <Text style={styles.wait}>Preparing encrypted device storage…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Secure storage unavailable</Text>
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.error}>Use a native development or release build, not Expo Go.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {page === 'dashboard' ? (
            <Dashboard
              settings={settings}
              running={running}
              locationMode={locationMode}
              battery={battery}
              location={location}
              phone={phone}
              pending={pending}
              familyLocations={familyLocations}
              familyConnected={familyConfigured()}
              enterpriseSyncAvailable={syncConfigured()}
              syncing={syncing}
              onSync={() => void onSync()}
              onSettings={() => setPage('settings')}
              onFamily={() => setPage('family')}
            />
          ) : page === 'settings' ? (
            <Settings
              settings={settings}
              phone={phone}
              locationMode={locationMode}
              busy={busy}
              onRequestBackground={onRequestBackground}
              onBack={() => setPage('dashboard')}
              onToggle={onToggle}
              onPhoneRequest={onPhoneRequest}
              onPhoneVerify={onPhoneVerify}
            />
          ) : (
            <Family onBack={() => setPage('dashboard')} />
          )}
        </ScrollView>
      )}
      <View style={styles.footer}>
        <Text style={styles.footerText}>TELEMETRY · INTERNAL PILOT · {Platform.OS.toUpperCase()}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 30 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  wait: { color: C.muted, fontSize: 13 },
  errorTitle: { color: C.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  error: { color: C.red, fontSize: 13, textAlign: 'center' },
  footer: {
    borderTopColor: C.line,
    borderTopWidth: 1,
    padding: 9,
    alignItems: 'center',
    backgroundColor: C.surface,
  },
  footerText: { color: C.muted, fontSize: 10, letterSpacing: 1, fontWeight: '700' },
});
