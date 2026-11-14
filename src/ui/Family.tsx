import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { C } from './theme';
import {
  familyConfigured,
  familyContacts,
  familyInvites,
  familyViewers,
  revokeFamilyViewer,
  familyHistory,
  familyMe,
  familyPause,
  familySignOut,
  inviteFamily,
  acceptFamilyInvite,
  declineFamilyInvite,
  startFamilyLogin,
  verifyFamilyLogin,
  hasFamilySession,
} from '../services/family/familyApi';
import type { FamilyUser, FamilyContact, FamilyInvite, FamilyViewer } from '../services/family/familyApi';

type Props = { onBack: () => void };
export default function Family({ onBack }: Props) {
  const [user, setUser] = useState<FamilyUser | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeRequested, setCodeRequested] = useState(false);
  const [invitePhone, setInvitePhone] = useState('');
  const [contacts, setContacts] = useState<FamilyContact[]>([]);
  const [invitations, setInvitations] = useState<FamilyInvite[]>([]);
  const [viewers, setViewers] = useState<FamilyViewer[]>([]);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const me = await familyMe();
    const [list, inbox, access] = await Promise.all([familyContacts(), familyInvites(), familyViewers()]);
    setUser(me);
    setContacts(list);
    setInvitations(inbox);
    setViewers(access);
  }, []);
  useEffect(() => {
    void (async () => {
      if (await hasFamilySession()) await refresh().catch(() => setUser(null));
    })();
    const poll = setInterval(() => {
      void hasFamilySession().then((active) => active && refresh().catch(() => {}));
    }, 30000);
    return () => clearInterval(poll);
  }, [refresh]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      Alert.alert('Family network', e instanceof Error ? e.message : 'Please try again');
    } finally {
      setBusy(false);
    }
  };
  const input = (value: string, onChangeText: (v: string) => void, placeholder: string, isPhone = false) => (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#93A0B4"
      keyboardType={isPhone ? 'phone-pad' : 'default'}
      autoCapitalize="none"
      style={s.input}
    />
  );
  const button = (label: string, press: () => void, secondary = false) => (
    <Pressable
      disabled={busy}
      onPress={press}
      style={[s.button, secondary && s.secondary, busy && s.disabled]}
    >
      <Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={s.root}>
      <Pressable onPress={onBack}>
        <Text style={s.link}>‹ Dashboard</Text>
      </Pressable>
      <Text style={s.title}>Family safety</Text>
      <Text style={s.sub}>
        Share locations only with people who have accepted an invitation. Everyone controls their own privacy.
      </Text>
      {!familyConfigured() ? (
        <View style={s.card}>
          <Text style={s.heading}>Family server not connected</Text>
          <Text style={s.sub}>
            The app needs a deployed HTTPS family API. Set EXPO_PUBLIC_FAMILY_API_URL in GitHub Actions, then
            install the new build. No tracking information is shared until you sign in and accept sharing.
          </Text>
        </View>
      ) : !user ? (
        <View style={s.card}>
          <Text style={s.heading}>Sign in with your phone</Text>
          {input(phone, setPhone, '+12025550123', true)}
          {input(name, setName, 'Your name (optional)')}
          {button(
            'Send SMS code',
            () =>
              void run(async () => {
                await startFamilyLogin(phone.trim());
                setCodeRequested(true);
              }),
          )}
          {codeRequested ? (
            <>
              {input(code, setCode, 'Verification code')}
              {button(
                'Verify and connect',
                () =>
                  void run(async () => {
                    await verifyFamilyLogin(phone.trim(), code.trim(), name.trim());
                    await refresh();
                  }),
              )}
            </>
          ) : null}
          <Text style={s.sub}>
            Your number is verified by a one-time code. It is never used as your password.
          </Text>
        </View>
      ) : (
        <>
          <View style={s.card}>
            <Text style={s.heading}>My privacy</Text>
            <Text style={s.sub}>
              {user.name} · {user.phone}
            </Text>
            <View style={s.line}>
              <View style={s.flex}>
                <Text style={s.label}>Share my location</Text>
                <Text style={s.sub}>
                  Turning this off immediately hides your location and history from other contacts.
                </Text>
              </View>
              <Switch
                value={user.sharingEnabled}
                onValueChange={(v) =>
                  void run(async () => {
                    const updated = await familyPause(v);
                    setUser(updated);
                  })
                }
                disabled={busy}
              />
            </View>
            {button(
              'Sign out of family network',
              () =>
                void run(async () => {
                  await familySignOut();
                  setUser(null);
                  setContacts([]);
                  setInvitations([]);
                }),
              true,
            )}
          </View>
          <View style={s.card}>
            <Text style={s.heading}>Who can see me?</Text>
            {viewers.length === 0 ? (
              <Text style={s.sub}>No one is authorized to view your location.</Text>
            ) : null}
            {viewers.map((v) => (
              <View key={v.id} style={s.item}>
                <Text style={s.label}>{v.name}</Text>
                <Text style={s.sub}>{v.phone}</Text>
                {button(
                  'Revoke access',
                  () =>
                    void run(async () => {
                      await revokeFamilyViewer(v.id);
                      await refresh();
                    }),
                  true,
                )}
              </View>
            ))}
          </View>
          <View style={s.card}>
            <Text style={s.heading}>Invite a family member or friend</Text>
            <Text style={s.sub}>
              They receive an SMS. You cannot see their location unless they sign in and agree.
            </Text>
            {input(invitePhone, setInvitePhone, '+12025550123', true)}
            {button(
              'Send invitation',
              () =>
                void run(async () => {
                  await inviteFamily(invitePhone.trim());
                  setInvitePhone('');
                  Alert.alert(
                    'Invitation sent',
                    'Your contact can accept or decline in the Family safety screen.',
                  );
                }),
            )}
          </View>
          <View style={s.card}>
            <Text style={s.heading}>Incoming invitations</Text>
            {invitations.length === 0 ? <Text style={s.sub}>No pending invitations</Text> : null}
            {invitations.map((i) => (
              <View key={i.id} style={s.item}>
                <Text style={s.label}>{i.from_name} wants to view your location</Text>
                <Text style={s.sub}>Accept to begin sharing; pause at any time.</Text>
                {button(
                  'Accept and share',
                  () =>
                    void run(async () => {
                      await acceptFamilyInvite(i.id);
                      await refresh();
                    }),
                )}
                {button(
                  'Decline',
                  () =>
                    void run(async () => {
                      await declineFamilyInvite(i.id);
                      await refresh();
                    }),
                  true,
                )}
              </View>
            ))}
          </View>
          <View style={s.card}>
            <Text style={s.heading}>Connected contacts</Text>
            {contacts.length === 0 ? <Text style={s.sub}>No accepted contacts yet</Text> : null}
            {contacts.map((c) => (
              <View key={c.id} style={s.item}>
                <Text style={s.label}>{c.name}</Text>
                <Text style={s.sub}>
                  {c.sharing ? (c.online ? 'Online' : 'Last seen earlier') : 'Sharing paused'} · Battery{' '}
                  {c.sharing ? (c.battery ?? '—') : 'Hidden'}%
                </Text>
                <Text style={s.sub}>
                  {c.sharing && c.updatedAt
                    ? new Date(c.updatedAt).toLocaleString()
                    : 'Location not available'}
                </Text>
                {c.sharing && c.latitude != null && c.longitude != null
                  ? button('Show location', () => {
                      void Linking.openURL('https://maps.apple.com/?ll=' + c.latitude + ',' + c.longitude);
                    })
                  : null}
                {c.sharing
                  ? button(
                      '24-hour history',
                      () =>
                        void run(async () => {
                          const count = await familyHistory(c.id);
                          setDetail(
                            c.name +
                              ' shared ' +
                              count +
                              ' points in the last 24 hours. Open the Family web dashboard for the route map.',
                          );
                        }),
                      true,
                    )
                  : null}
              </View>
            ))}
          </View>
          {button('Refresh contacts', () => void run(refresh), true)}
          {detail ? <Text style={s.sub}>{detail}</Text> : null}
        </>
      )}
      {busy ? <ActivityIndicator color={C.blue} /> : null}
      <Text style={s.sub}>
        No contact is monitored through their phone number alone. Contacts must consent, and iOS controls
        background update timing.
      </Text>
    </View>
  );
}
const s = StyleSheet.create({
  root: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 35, gap: 13 },
  link: { color: C.blue, fontSize: 15, fontWeight: '700' },
  title: { color: C.text, fontSize: 29, fontWeight: '800' },
  heading: { color: C.text, fontSize: 17, fontWeight: '800' },
  label: { color: C.text, fontSize: 15, fontWeight: '700' },
  sub: { color: C.muted, fontSize: 12, lineHeight: 20 },
  card: {
    backgroundColor: C.surface,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 17,
    gap: 11,
  },
  input: { borderColor: C.line, borderWidth: 1, borderRadius: 9, padding: 12, fontSize: 15, color: C.text },
  button: {
    backgroundColor: C.blue,
    padding: 13,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  secondary: { backgroundColor: C.paleBlue },
  secondaryText: { color: C.blue },
  disabled: { opacity: 0.6 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1, marginRight: 16 },
  item: { borderTopColor: C.line, borderTopWidth: 1, paddingTop: 10, gap: 7 },
});
