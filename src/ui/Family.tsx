import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { C } from './theme';
import {
  familyConfigured,
  familyMe,
  familySignOut,
  hasFamilySession,
  signInWithCloudflareAccess,
} from '../services/family/familyApi';
import type { FamilyUser } from '../services/family/familyApi';

type Props = { onBack: () => void };

export default function Family({ onBack }: Props) {
  const [user, setUser] = useState<FamilyUser | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (await hasFamilySession()) {
          const me = await familyMe();
          if (active) setUser(me);
        }
      } catch {
        // Expired sessions require fresh Cloudflare Access login.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const perform = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      Alert.alert('Family Safety', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <Pressable accessibilityRole="button" onPress={onBack}>
        <Text style={s.link}>‹ Dashboard</Text>
      </Pressable>
      <Text style={s.title}>Family safety</Text>
      <Text style={s.sub}>
        Private sign-in with Cloudflare Access. Location sharing requires separate consent.
      </Text>
      {!familyConfigured() ? (
        <View style={s.card}>
          <Text style={s.heading}>Family server not connected</Text>
          <Text style={s.sub}>
            Configure EXPO_PUBLIC_FAMILY_API_URL in the GitHub Actions repository variables and install a
            fresh iPhone build.
          </Text>
        </View>
      ) : !user ? (
        <View style={s.card}>
          <Text style={s.heading}>Sign in securely</Text>
          <Text style={s.sub}>
            Cloudflare will email a One-time PIN to an approved email address. No domain or paid email
            provider is required.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={s.button}
            disabled={busy}
            onPress={() => void perform(async () => setUser(await signInWithCloudflareAccess()))}
          >
            <Text style={s.buttonText}>Continue with Cloudflare Access</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.heading}>Signed in</Text>
          <Text style={s.label}>{user.name}</Text>
          <Text style={s.sub}>{user.email}</Text>
          <Text style={s.notice}>
            Family location sharing is not enabled yet. Contacts, invitations and location history remain
            disabled until server-side sharing permissions are implemented.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={s.secondary}
            disabled={busy}
            onPress={() =>
              void perform(async () => {
                await familySignOut();
                setUser(null);
              })
            }
          >
            <Text style={s.secondaryText}>Sign out</Text>
          </Pressable>
        </View>
      )}
      {busy ? <ActivityIndicator color={C.blue} /> : null}
      <Text style={s.sub}>Signing in does not authorize others to see your location.</Text>
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
  button: { backgroundColor: C.blue, padding: 14, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  secondary: { backgroundColor: C.paleBlue, padding: 14, borderRadius: 10, alignItems: 'center' },
  secondaryText: { color: C.blue, fontWeight: '700', fontSize: 14 },
});
