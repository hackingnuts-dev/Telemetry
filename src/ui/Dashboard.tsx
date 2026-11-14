import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LocationSnapshot, TelemetrySettings, PhoneStatus } from '../core/types';
import type { LocationMode } from '../services/location/locationService';
import { C } from './theme';

type Props = {
  settings: TelemetrySettings;
  running: boolean;
  locationMode: LocationMode;
  battery: number | null;
  location: LocationSnapshot | null;
  phone: { masked: string; status: PhoneStatus };
  pending: number;
  syncing: boolean;
  onSync: () => void;
  onSettings: () => void;
  onFamily: () => void;
};

function Tile({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: string;
}) {
  return (
    <View style={s.tile}>
      <Text style={s.tileIcon}>{icon}</Text>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
      <Text style={s.muted}>{detail}</Text>
    </View>
  );
}

export default function Dashboard({
  settings,
  running,
  locationMode,
  battery,
  location,
  phone,
  pending,
  syncing,
  onSync,
  onSettings,
  onFamily,
}: Props) {
  const active = settings.locationEnabled && running;
  const locationLabel = location
    ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
    : 'Not recorded';
  const updated = location
    ? new Date(location.recordedAt).toLocaleString()
    : 'Only after permission is granted';
  return (
    <View style={s.root}>
      <View style={s.header}>
        <View>
          <Text style={s.eyebrow}>EMPLOYEE UTILITY</Text>
          <Text style={s.title}>Device overview</Text>
        </View>
        <Pressable style={s.settingsButton} accessibilityRole="button" onPress={onSettings}>
          <Text style={s.settingsButtonText}>Settings</Text>
        </Pressable>
      </View>
      <View style={[s.hero, { backgroundColor: active ? '#174A79' : '#24324B' }]}>
        <View style={s.heroTop}>
          <Text style={s.heroCaption}>LOCATION MONITORING</Text>
          <View style={[s.pill, { backgroundColor: active ? '#2C805F' : '#4B5566' }]}>
            <Text style={s.pillText}>{active ? 'ACTIVE' : 'INACTIVE'}</Text>
          </View>
        </View>
        <Text style={s.heroTitle}>
          {active
            ? locationMode === 'background'
              ? 'Background tracking active'
              : 'Tracking while app is open'
            : 'Tracking is off'}
        </Text>
        <Text style={s.heroText}>
          {active
            ? locationMode === 'background'
              ? 'Background updates are enabled. iOS controls delivery timing.'
              : 'Location can update while Telemetry is open. Enable Background Access in Settings for ongoing tracking.'
            : 'Location tracking is off until you enable it in Settings.'}
        </Text>
      </View>
      <View style={s.twoColumns}>
        <Tile
          icon="▰"
          label="BATTERY LEVEL"
          value={battery === null ? 'Unavailable' : `${battery}%`}
          detail="Tracker power impact not measured"
        />
        <Tile
          icon="↗"
          label="SYNC QUEUE"
          value={`${pending} events`}
          detail={settings.syncEnabled ? 'Ready when signed in and online' : 'Sync currently disabled'}
        />
      </View>
      <View style={s.card}>
        <View style={s.cardHeader}>
          <Text style={s.cardTitle}>Last known location</Text>
          <Text style={s.cardGlyph}>⌖</Text>
        </View>
        <Text style={s.coordinate}>{locationLabel}</Text>
        <Text style={s.muted}>{updated}</Text>
        <Text style={s.footerNote}>
          Raw coordinates remain encrypted on this phone. Only eligible zone and dwell events are queued for
          upload.
        </Text>
      </View>
      <View style={s.card}>
        <View style={s.cardHeader}>
          <Text style={s.cardTitle}>Phone number</Text>
          <Text style={s.cardGlyph}>☎</Text>
        </View>
        <Text style={s.coordinate}>{phone.masked}</Text>
        <View
          style={[s.status, { backgroundColor: phone.status === 'verified' ? C.paleGreen : C.paleAmber }]}
        >
          <Text
            style={{
              color: phone.status === 'verified' ? C.green : C.amber,
              fontSize: 12,
              fontWeight: '700',
            }}
          >
            {phone.status === 'verified'
              ? 'Verified'
              : phone.status === 'pending_verification'
                ? 'Verification pending'
                : 'Not connected'}
          </Text>
        </View>
        <Text style={s.footerNote}>
          Optional account attribute. A separate installation ID identifies this device.
        </Text>
      </View>
      <Pressable style={s.familyButton} onPress={onFamily} accessibilityRole="button">
        <Text style={s.familyText}>Family & friends · Connected contacts</Text>
      </Pressable>
      <Pressable
        style={[s.primary, (!settings.syncEnabled || syncing) && s.disabled]}
        onPress={onSync}
        disabled={!settings.syncEnabled || syncing}
        accessibilityRole="button"
      >
        {syncing ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>Sync now</Text>}
      </Pressable>
      <Text style={s.bottomText}>You can pause collection or syncing at any time in Settings.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 14, paddingBottom: 36 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  eyebrow: { fontSize: 10, letterSpacing: 2, fontWeight: '800', color: C.blue },
  title: { fontSize: 26, fontWeight: '800', color: C.text, marginTop: 5 },
  settingsButton: {
    borderColor: C.line,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: C.surface,
    borderRadius: 10,
  },
  settingsButtonText: { color: C.text, fontWeight: '700', fontSize: 13 },
  hero: { borderRadius: 18, padding: 22, gap: 12 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroCaption: { fontSize: 10, letterSpacing: 1.5, color: '#C8DCF8', fontWeight: '800' },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  pillText: { color: '#fff', fontWeight: '800', fontSize: 10, letterSpacing: 1 },
  heroTitle: { fontSize: 23, fontWeight: '800', color: '#FFFFFF', marginTop: 8 },
  heroText: { fontSize: 13, color: '#D9E6F5', lineHeight: 21 },
  twoColumns: { flexDirection: 'row', gap: 12 },
  tile: {
    flex: 1,
    padding: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 15,
    minHeight: 142,
  },
  tileIcon: { color: C.blue, fontSize: 18, marginBottom: 8 },
  label: { color: C.muted, fontSize: 10, letterSpacing: 0.8, fontWeight: '800' },
  value: { color: C.text, fontSize: 21, fontWeight: '800', marginTop: 7 },
  muted: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  card: { padding: 18, backgroundColor: C.surface, borderRadius: 15, borderWidth: 1, borderColor: C.line },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: C.text },
  cardGlyph: { color: C.blue, fontSize: 22 },
  coordinate: { fontSize: 19, fontWeight: '700', color: C.text, marginTop: 8 },
  footerNote: { color: C.muted, fontSize: 11, lineHeight: 17, marginTop: 14 },
  status: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 9,
  },
  familyButton: { backgroundColor: C.paleBlue, padding: 14, borderRadius: 12, alignItems: 'center' },
  familyText: { color: C.blue, fontSize: 14, fontWeight: '800' },
  primary: {
    backgroundColor: C.blue,
    borderRadius: 12,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.47 },
  bottomText: { textAlign: 'center', color: C.muted, fontSize: 12 },
});
