import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { C } from './theme';
import {
  familyConfigured,
  familyMe,
  familySignOut,
  hasFamilySession,
  startFamilyLogin,
  verifyFamilyLogin,
} from '../services/family/familyApi';
import type { FamilyUser } from '../services/family/familyApi';

type Props = { onBack: () => void };

export default function Family({ onBack }: Props) {
  const [user, setUser] = useState<FamilyUser | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeRequested, setCodeRequested] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        if (await hasFamilySession()) {
          const me = await familyMe();
          if (mounted) setUser(me);
        }
      } catch {
        // The user may sign in again if their old session is invalid or expired.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } catch (error) {
      Alert.alert('Family Safety', error instanceof Error ? error.message : 'Please try again');
    } finally {
      setBusy(false);
    }
  };

  const button = (label: string, task: () => Promise<void>, secondary = false) => (
    <Pressable
      style={[s.button, secondary && s.secondary, busy && s.disabled]}
      disabled={busy}
      accessibilityRole="button"
      onPress={() => void run(task)}
    >
      <Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={s.root}>
      <Pressable onPress={onBack} accessibilityRole="button">
        <Text style={s.link}>‹ Dashboard</Text>
      </Pressable>
      <Text style={s.title}>Family safety</Text>
      <Text style={s.sub}>
        Your family account is private. Sharing requires a separate, explicit invitation and permission.
      </Text>
      {!familyConfigured() ? (
        <View style={s.card}>
          <Text style={s.heading}>Family server not connected</Text>
          <Text style={s.sub}>
            Deploy the email-auth Worker, then configure EXPO_PUBLIC_FAMILY_API_URL in GitHub Actions and
            reinstall the iPhone app.
          </Text>
        </View>
      ) : !user ? (
        <View style={s.card}>
          <Text style={s.heading}>Sign in with email</Text>
          <Text style={s.sub}>We'll email a six-digit code. No phone number or password is required.</Text>
          <TextInput
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setCodeRequested(false);
            }}
            keyboardType="email-address"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Your email address"
            placeholder="you@example.com"
            placeholderTextColor="#94A3B8"
            style={s.input}
          />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name (optional)"
            placeholderTextColor="#94A3B8"
            style={s.input}
          />
          {button('Email me a sign-in code', async () => {
            await startFamilyLogin(email);
            setCodeRequested(true);
            Alert.alert(
              'Check your inbox',
              'Enter the six-digit code sent to your email. It expires in 10 minutes.',
            );
          })}
          {codeRequested ? (
            <>
              <TextInput
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                accessibilityLabel="Six-digit email verification code"
                placeholder="6-digit code"
                maxLength={6}
                placeholderTextColor="#94A3B8"
                style={s.input}
              />
              {button('Verify email', async () => {
                const verified = await verifyFamilyLogin(email, code, name);
                setUser(verified);
              })}
            </>
          ) : null}
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.heading}>Email verified</Text>
          <Text style={s.label}>{user.name}</Text>
          <Text style={s.sub}>{user.email}</Text>
          <Text style={s.notice}>
            Family location sharing is not activated yet. The Cloudflare backend still needs invitation,
            per-contact authorization, and history endpoints. No family location data is uploaded.
          </Text>
          {button(
            'Sign out',
            async () => {
              await familySignOut();
              setUser(null);
              setCode('');
              setCodeRequested(false);
            },
            true,
          )}
        </View>
      )}
      {busy ? <ActivityIndicator color={C.blue} /> : null}
      <Text style={s.sub}>
        Email sign-in does not authorize location tracking. Every contact will control who can see their
        location when sharing is enabled.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 35, gap: 13 },
  link: { color: C.blue, fontSize: 15, fontWeight: '700' },
  title: { color: C.text, fontSize: 29, fontWeight: '800' },
  heading: { color: C.text, fontSize: 18, fontWeight: '800' },
  label: { color: C.text, fontSize: 15, fontWeight: '700' },
  sub: { color: C.muted, fontSize: 12, lineHeight: 19 },
  notice: {
    color: C.text,
    fontSize: 13,
    lineHeight: 21,
    backgroundColor: C.paleBlue,
    padding: 12,
    borderRadius: 10,
  },
  card: {
    backgroundColor: C.surface,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  input: { borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 12, color: C.text, fontSize: 16 },
  button: { backgroundColor: C.blue, padding: 14, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  secondary: { backgroundColor: C.paleBlue },
  secondaryText: { color: C.blue },
  disabled: { opacity: 0.6 },
});
