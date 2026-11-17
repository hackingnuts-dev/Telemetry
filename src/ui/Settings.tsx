import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { TelemetrySettings, PhoneStatus } from '../core/types';
import type { LocationMode } from '../services/location/locationService';
import { getUsageCapability } from '../services/usage/UsageTelemetry';
import { syncConfigured } from '../services/sync/syncService';
import { C } from './theme';

type Props = {
  settings: TelemetrySettings;
  phone: { masked: string; status: PhoneStatus };
  locationMode: LocationMode;
  busy: boolean;
  onRequestBackground: () => Promise<void>;
  onBack: () => void;
  onToggle: (key: keyof TelemetrySettings, value: boolean) => Promise<void>;
  onPhoneRequest: (value: string) => Promise<void>;
  onPhoneVerify: (code: string) => Promise<void>;
};

function ToggleRow({
  title,
  detail,
  value,
  disabled,
  onChange,
}: {
  title: string;
  detail: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={s.toggleRow}>
      <View style={{ flex: 1, paddingRight: 16 }}>
        <Text style={s.toggleTitle}>{title}</Text>
        <Text style={s.detail}>{detail}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: '#CBD5E1', true: '#8DB8FF' }}
        thumbColor={value ? C.blue : '#fff'}
      />
    </View>
  );
}

export default function Settings({
  settings,
  phone,
  locationMode,
  busy,
  onRequestBackground,
  onBack,
  onToggle,
  onPhoneRequest,
  onPhoneVerify,
}: Props) {
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const usage = getUsageCapability();
  const enterpriseAvailable = syncConfigured();
  return (
    <View style={s.root}>
      <Pressable accessibilityRole="button" onPress={onBack}>
        <Text style={s.back}>‹ Dashboard</Text>
      </Pressable>
      <Text style={s.title}>Settings</Text>
      <Text style={s.subtitle}>Choose what this device shares with your organization.</Text>
      <View style={s.card}>
        <ToggleRow
          title="Enable Location"
          detail="Allow approved zone and 30-minute stationary events. Background access is requested only after activation."
          value={settings.locationEnabled}
          disabled={busy}
          onChange={(value) => void onToggle('locationEnabled', value)}
        />
        <View style={s.separator} />
        <ToggleRow
          title="Enable App Telemetry"
          detail={usage.available ? 'Collect usage metadata without screenshots.' : usage.explanation}
          value={settings.appTelemetryEnabled}
          disabled={busy || !usage.available}
          onChange={(value) => void onToggle('appTelemetryEnabled', value)}
        />
        <View style={s.separator} />
        <ToggleRow
          title="Sync Data"
          detail={
            enterpriseAvailable
              ? 'Optional corporate device-event sync. This is separate from Family Safety location sharing.'
              : 'Corporate event server not configured. Family Safety still refreshes through Cloudflare.'
          }
          value={settings.syncEnabled}
          disabled={busy || !enterpriseAvailable}
          onChange={(value) => void onToggle('syncEnabled', value)}
        />
      </View>
      {settings.locationEnabled && locationMode === 'foreground' ? (
        <View style={s.card}>
          <Text style={s.toggleTitle}>Location enabled while app is open</Text>
          <Text style={s.detail}>
            Your current permission allows in-app updates. Background collection is not enabled yet.
          </Text>
          <Pressable
            style={[s.button, busy && s.disabled]}
            disabled={busy}
            onPress={() => void onRequestBackground()}
          >
            <Text style={s.buttonText}>Enable Background Access</Text>
          </Pressable>
        </View>
      ) : null}
      {settings.locationEnabled && locationMode === 'background' ? (
        <Text style={s.detail}>Background location is enabled. iOS decides when updates arrive.</Text>
      ) : null}
      <Text style={s.sectionTitle}>Phone number (optional)</Text>
      <View style={s.card}>
        <Text style={s.detail}>
          Phone on file: {phone.masked} · {phone.status.replace('_', ' ')}
        </Text>
        <Text style={s.detail}>
          iOS cannot reliably reveal your phone number. A phone number cannot locate another iPhone. Family
          tracking uses email sign-in, the consent of the other person, and their Telemetry installation.
        </Text>
        {!enterpriseAvailable ? (
          <Text style={s.detail}>
            Phone verification is not available in this free email-based Family Safety setup. No SMS or phone
            lookup is performed.
          </Text>
        ) : (
          <>
            <TextInput
              style={s.input}
              value={number}
              onChangeText={setNumber}
              keyboardType="phone-pad"
              autoComplete="tel"
              placeholder="+12025550123"
              placeholderTextColor="#94A3B8"
              accessibilityLabel="Phone number in international format"
            />
            <Pressable
              style={[s.button, busy && s.disabled]}
              disabled={busy}
              onPress={() => void onPhoneRequest(number)}
            >
              <Text style={s.buttonText}>Send verification code</Text>
            </Pressable>
            {phone.status === 'pending_verification' ? (
              <View style={{ marginTop: 14, gap: 10 }}>
                <TextInput
                  style={s.input}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  placeholder="Verification code"
                  placeholderTextColor="#94A3B8"
                  accessibilityLabel="Verification code"
                />
                <Pressable
                  style={[s.button, busy && s.disabled]}
                  disabled={busy}
                  onPress={() => void onPhoneVerify(code)}
                >
                  <Text style={s.buttonText}>Verify number</Text>
                </Pressable>
              </View>
            ) : null}
          </>
        )}
      </View>
      {busy ? <ActivityIndicator color={C.blue} /> : null}
      <Text style={s.disclosure}>
        No screen recordings are collected. Family sharing requires explicit authorization, not a phone
        number.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 14, paddingBottom: 38 },
  back: { color: C.blue, fontWeight: '700', fontSize: 14, marginTop: 8 },
  title: { color: C.text, fontWeight: '800', fontSize: 29, marginTop: 7 },
  subtitle: { fontSize: 13, color: C.muted, lineHeight: 20, marginBottom: 10 },
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 18,
    borderColor: C.line,
    borderWidth: 1,
    gap: 10,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  toggleTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  detail: { fontSize: 12, color: C.muted, lineHeight: 19, marginTop: 5 },
  separator: { backgroundColor: C.line, height: 1 },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: '800', marginTop: 12 },
  input: {
    marginTop: 8,
    borderColor: C.line,
    borderWidth: 1,
    backgroundColor: '#FBFCFE',
    paddingHorizontal: 14,
    minHeight: 48,
    borderRadius: 10,
    color: C.text,
    fontSize: 16,
  },
  button: {
    minHeight: 45,
    paddingHorizontal: 12,
    backgroundColor: C.blue,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  disclosure: { color: C.muted, fontSize: 12, lineHeight: 18 },
});
