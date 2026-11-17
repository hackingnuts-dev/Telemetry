import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { C } from './theme';
import {
  familyConfigured,
  familyMe,
  familySignOut,
  hasFamilySession,
  signInWithCloudflareAccess,
  familyStatus,
  familyContacts,
  familyInvitations,
  familyViewers,
  inviteFamily,
  decideInvitation,
  setFamilySharing,
  revokeFamilyViewer,
  getFamilyHistory,
  shareMyLocationWithContact,
  syncFamilyNow,
} from '../services/family/familyApi';
import type { FamilyContact, FamilyInvitation, FamilyUser, FamilyViewer } from '../services/family/familyApi';

type Props = { onBack: () => void };
export default function Family({ onBack }: Props) {
  const [user, setUser] = useState<FamilyUser | null>(null);
  const [active, setActive] = useState(false);
  const [contacts, setContacts] = useState<FamilyContact[]>([]);
  const [invitations, setInvitations] = useState<FamilyInvitation[]>([]);
  const [viewers, setViewers] = useState<FamilyViewer[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const me = await familyMe();
    const [status, list, pending, access] = await Promise.all([
      familyStatus(),
      familyContacts(),
      familyInvitations(),
      familyViewers(),
    ]);
    setUser(me);
    setActive(status.sharingEnabled);
    setContacts(list);
    setInvitations(pending);
    setViewers(access);
  };
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        if ((await hasFamilySession()) && mounted) await refresh();
      } catch {
        // Expired sessions require fresh Cloudflare Access sign-in.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refresh().catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [user?.id]);

  const perform = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Family Safety', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const button = (label: string, fn: () => Promise<void>, secondary = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      style={[s.button, secondary && s.secondary, busy && s.disabled]}
      onPress={() => void perform(fn)}
    >
      <Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text>
    </Pressable>
  );
  return (
    <ScrollView contentContainerStyle={s.root} keyboardShouldPersistTaps="handled">
      <Pressable accessibilityRole="button" onPress={onBack}>
        <Text style={s.link}>‹ Dashboard</Text>
      </Pressable>
      <Text style={s.title}>Family safety</Text>
      <Text style={s.sub}>
        Only people you approve can view your location. Sharing is always under your control.
      </Text>
      {!familyConfigured() ? (
        <View style={s.card}>
          <Text style={s.heading}>Family server not connected</Text>
          <Text style={s.sub}>
            Set the Family API and authentication Worker URLs in GitHub Actions and reinstall the new iPhone
            build.
          </Text>
        </View>
      ) : !user ? (
        <View style={s.card}>
          <Text style={s.heading}>Sign in with Cloudflare Access</Text>
          <Text style={s.sub}>
            Use your approved email and One-time PIN. This does not activate location sharing.
          </Text>
          {button('Continue with Cloudflare Access', async () => {
            await signInWithCloudflareAccess();
            await refresh();
          })}
        </View>
      ) : (
        <>
          <View style={s.card}>
            <Text style={s.heading}>My privacy</Text>
            <Text style={s.label}>{user.email}</Text>
            <View style={s.horizontal}>
              <View style={s.flex}>
                <Text style={s.label}>Share my location</Text>
                <Text style={s.sub}>
                  Only people you expressly authorize can see your location. Pause at any time.
                </Text>
              </View>
              <Switch
                value={active}
                disabled={busy}
                onValueChange={(enabled) =>
                  void perform(async () => {
                    await setFamilySharing(enabled);
                    await refresh();
                  })
                }
              />
            </View>
            <Text style={s.sub}>
              {viewers.length} contact(s) authorized to see your location when sharing is on.
            </Text>
            {button(
              'Sign out',
              async () => {
                await familySignOut();
                setUser(null);
                setActive(false);
                setContacts([]);
                setInivitationsEmpty();
              },
              true,
            )}
          </View>
          <View style={s.card}>
            <Text style={s.heading}>Invite family or friends</Text>
            <Text style={s.sub}>
              Enter their email. They will see your invitation after signing in to Telemetry. No email
              invitation is sent yet.
            </Text>
            <TextInput
              value={inviteEmail}
              onChangeText={setInviteEmail}
              style={s.input}
              placeholder="family@example.com"
              placeholderTextColor="#94A3B8"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Family member email"
            />
            {button('Create invitation', async () => {
              await inviteFamily(inviteEmail);
              setInviteEmail('');
              Alert.alert('Invitation created', 'Your contact can sign in to Telemetry and accept it.');
              await refresh();
            })}
          </View>
          <View style={s.card}>
            <Text style={s.heading}>Incoming invitations</Text>
            {invitations.length === 0 ? <Text style={s.sub}>No pending invitations</Text> : null}
            {invitations.map((invite) => (
              <View key={invite.id} style={s.item}>
                <Text style={s.label}>
                  {invite.from_name} ({invite.from_email})
                </Text>
                <Text style={s.sub}>
                  Accepting authorizes this person to view you only after you enable sharing above.
                </Text>
                {button('Accept invitation', async () => {
                  await decideInvitation(invite.id, 'accept');
                  await refresh();
                })}
                {button(
                  'Decline',
                  async () => {
                    await decideInvitation(invite.id, 'decline');
                    await refresh();
                  },
                  true,
                )}
              </View>
            ))}
          </View>
          <View style={s.card}>
            <Text style={s.heading}>Connected contacts</Text>
            {contacts.length === 0 ? <Text style={s.sub}>No accepted contacts yet</Text> : null}
            {contacts.map((contact) => (
              <View key={contact.id} style={s.item}>
                <Text style={s.label}>
                  {contact.name} · {contact.email}
                </Text>
                <Text style={s.sub}>
                  {contact.sharing
                    ? contact.online
                      ? 'Recently updated'
                      : 'No recent update'
                    : 'Sharing paused'}
                </Text>
                {!viewers.some((viewer) => viewer.id === contact.id) ? (
                  <>
                    <Text style={s.sub}>
                      You can see this contact, but they cannot see you until you allow it.
                    </Text>
                    {button(
                      'Allow them to see my location',
                      async () => {
                        Alert.alert(
                          'Allow reciprocal sharing?',
                          'This contact can view your location only while your Share my location switch is on.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Allow',
                              onPress: () =>
                                void perform(async () => {
                                  await shareMyLocationWithContact(contact.id);
                                  await refresh();
                                }),
                            },
                          ],
                        );
                      },
                      true,
                    )}
                  </>
                ) : (
                  <Text style={s.sub}>
                    Two-way access approved. Both people still control their own sharing.
                  </Text>
                )}
                {contact.sharing && contact.latitude != null && contact.longitude != null ? (
                  <>
                    <Text style={s.sub}>
                      Battery: {contact.battery ?? '—'}% · Last update:{' '}
                      {contact.updatedAt ? new Date(contact.updatedAt).toLocaleString() : 'Unknown'}
                    </Text>
                    <Text style={s.coordinate}>
                      {contact.latitude.toFixed(6)}, {contact.longitude.toFixed(6)}
                    </Text>
                    <Text style={s.sub}>Last reported position, refreshed when Telemetry is open.</Text>
                    {button('Open Apple Maps', async () => {
                      await Linking.openURL(
                        'https://maps.apple.com/?ll=' + contact.latitude + ',' + contact.longitude,
                      );
                    })}
                    {button(
                      'Open Google Maps',
                      async () => {
                        await Linking.openURL(
                          'https://www.google.com/maps/search/?api=1&query=' +
                            encodeURIComponent(contact.latitude + ',' + contact.longitude),
                        );
                      },
                      true,
                    )}
                    {button(
                      '24-hour history',
                      async () => {
                        const count = await getFamilyHistory(contact.id);
                        Alert.alert('Location history', count + ' shared points in the last 24 hours.');
                      },
                      true,
                    )}
                  </>
                ) : null}
              </View>
            ))}
          </View>
          <View style={s.card}>
            <Text style={s.heading}>Who can see me?</Text>
            {viewers.length === 0 ? <Text style={s.sub}>No contacts have access yet.</Text> : null}
            {viewers.map((viewer) => (
              <View key={viewer.id} style={s.item}>
                <Text style={s.label}>
                  {viewer.name} · {viewer.email}
                </Text>
                {button(
                  'Revoke access',
                  async () => {
                    await revokeFamilyViewer(viewer.id);
                    await refresh();
                  },
                  true,
                )}
              </View>
            ))}
          </View>
          {button(
            'Refresh shared locations',
            async () => {
              const result = await syncFamilyNow();
              setContacts(result.contacts);
              await refresh();
              Alert.alert('Family sync', result.message);
            },
            true,
          )}
        </>
      )}
      {busy ? <ActivityIndicator color={C.blue} /> : null}
      <Text style={s.sub}>
        Signed-in members control their own sharing. iOS background updates depend on location permissions and
        system scheduling.
      </Text>
    </ScrollView>
  );

  function setInivitationsEmpty() {
    setInvitations([]);
    setViewers([]);
  }
}
const s = StyleSheet.create({
  root: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 35, gap: 13 },
  link: { color: C.blue, fontSize: 15, fontWeight: '700' },
  title: { color: C.text, fontSize: 29, fontWeight: '800' },
  heading: { color: C.text, fontSize: 18, fontWeight: '800' },
  label: { color: C.text, fontSize: 15, fontWeight: '700' },
  sub: { color: C.muted, fontSize: 12, lineHeight: 19 },
  coordinate: { color: C.text, fontSize: 17, fontWeight: '700' },
  card: {
    backgroundColor: C.surface,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  item: { borderTopColor: C.line, borderTopWidth: 1, gap: 8, paddingTop: 12 },
  input: { borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 12, color: C.text, fontSize: 16 },
  button: { backgroundColor: C.blue, padding: 14, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  secondary: { backgroundColor: C.paleBlue },
  secondaryText: { color: C.blue },
  disabled: { opacity: 0.6 },
  horizontal: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
});
