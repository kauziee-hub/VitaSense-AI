import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import {
  Bug,
  CalendarDays,
  ClipboardCheck,
  CloudSun,
  FlaskConical,
  HeartPulse,
  LogOut,
  Mail,
  MapPin,
  Pill,
  Plane,
  RefreshCw,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  ThermometerSun,
  UtensilsCrossed,
  Wind,
} from 'lucide-react-native';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { calendarPermission, calendarSupported } from '@/collect/calendar';
import { forgetGmailToken, GmailSignInButton, gmailConfigured } from '@/collect/gmail';
import { connectHealth, healthAvailable, healthSupported, openHealthSettings } from '@/collect/health';
import { type AllPrefs, loadPrefs, setSourceEnabled, type SourceId, syncGmailNow, syncSources } from '@/collect/sync';
import { api, type CollectedItem, type CollectStatus, type SourceKey } from '@/lib/api';
import { useSession } from '@/lib/session';
import { textField, useProfile } from '@/lib/useProfile';
import { breakpoint, color, font, radius } from '@/theme/tokens';
import { Badge, Button, Card, Text } from '@/ui/primitives';

/** Where the demo profiles live; their forecast and outbreak data are for this area. */
const DEMO_AREA = { lat: 12.9352, lng: 77.6245 };

const HEALTH_CONNECT_PACKAGE = 'com.google.android.apps.healthdata';

function openHealthConnectInStore() {
  Linking.openURL(`market://details?id=${HEALTH_CONNECT_PACKAGE}`).catch(() =>
    Linking.openURL(`https://play.google.com/store/apps/details?id=${HEALTH_CONNECT_PACKAGE}`),
  );
}

const SERVER_SOURCE: Record<SourceId, SourceKey> = {
  location: 'location',
  health: 'health_connect',
  calendar: 'calendar',
  gmail: 'gmail',
};

export default function ProfileScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.wide;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut, health, forecast, refreshForecast } = useSession();
  const { tables } = useProfile();
  const [prefs, setPrefs] = useState<AllPrefs | null>(null);
  const [status, setStatus] = useState<CollectStatus | null>(null);
  const [busy, setBusy] = useState<SourceId | 'all' | null>(null);
  const [healthState, setHealthState] = useState<'available' | 'needs_install' | 'unsupported'>('unsupported');
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    Promise.all([loadPrefs(user.id), api.collectStatus(user.id).catch(() => null), healthAvailable()]).then(([p, s, h]) => {
      if (!alive) return;
      setPrefs(p);
      setStatus(s);
      setHealthState(h);
    });
    return () => {
      alive = false;
    };
  }, [user, version]);

  // Coming back from the Play Store or system settings: permissions or Health Connect may have changed.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') reload();
    });
    return () => subscription.remove();
  }, [reload]);

  const isDemo = forecast?.data_mode === 'demo';

  const afterSync = async () => {
    reload();
    await refreshForecast();
  };

  const turnOn = async (source: SourceId) => {
    if (!user) return;
    setBusy(source);
    try {
      if (source === 'location') {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          if (isDemo) {
            // Demo profiles can still show live data for their home area.
            await api.collectEnvironment(user.id, DEMO_AREA.lat, DEMO_AREA.lng);
          } else {
            notify('Location is off', 'Allow location for VitaSense in your settings, then try again.');
          }
          return;
        }
      }
      if (source === 'calendar' && !(await calendarPermission(true))) {
        notify('Calendar access is off', 'Allow calendar access for VitaSense in your settings, then try again.');
        return;
      }
      if (source === 'health' && !(await connectHealth())) {
        // After two refusals Android stops showing the dialog; access can still be given in Health Connect.
        Alert.alert('Health Connect', 'VitaSense needs at least one Health Connect permission to read your data.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Health Connect', onPress: openHealthSettings },
        ]);
        return;
      }
      await setSourceEnabled(user.id, source, true);
      await syncSources(user.id, { force: true, only: source });
    } finally {
      setBusy(null);
      await afterSync();
    }
  };

  const turnOff = (source: SourceId, label: string) => {
    if (!user) return;
    const go = async () => {
      setBusy(source);
      try {
        await setSourceEnabled(user.id, source, false);
        if (source === 'gmail') await forgetGmailToken(user.id);
        await api.disconnectSource(user.id, SERVER_SOURCE[source]).catch(() => undefined);
      } finally {
        setBusy(null);
        await afterSync();
      }
    };
    const message = `Stop collecting from ${label} and delete everything VitaSense collected from it?`;
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.(message)) void go();
    } else {
      Alert.alert('Turn off and delete', message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn off', style: 'destructive', onPress: () => void go() },
      ]);
    }
  };

  const syncNow = async (source?: SourceId) => {
    if (!user) return;
    setBusy(source ?? 'all');
    try {
      await syncSources(user.id, { force: true, only: source });
    } finally {
      setBusy(null);
      await afterSync();
    }
  };

  const onGmailToken = useCallback(
    async (token: string) => {
      if (!user) return;
      setBusy('gmail');
      try {
        await syncGmailNow(user.id, token);
      } finally {
        setBusy(null);
        reload();
        void refreshForecast();
      }
    },
    [user, reload, refreshForecast],
  );

  const leave = async () => {
    await signOut();
    router.replace('/welcome');
  };

  const facts = [
    ['Life phase', textField(tables, 'user_life_context', 'life_phase')],
    ['Routine', textField(tables, 'user_life_context', 'life_structure_type')],
    ['Lifestyle', textField(tables, 'user_life_context', 'lifestyle_identity')],
    ['Eating', textField(tables, 'user_food_body_relationship', 'eating_behavior')],
    ['Stress shows up in', textField(tables, 'user_emotional_wellness', 'stress_response_pattern')],
    ['Recovers best with', textField(tables, 'user_emotional_wellness', 'recovery_preference')],
  ].filter((f): f is [string, string] => !!f[1]);

  const connected = status?.connections ?? {};
  // Connected here, or syncing from another device (the phone app, seen on the website).
  const enabledCount = prefs
    ? (Object.keys(prefs) as SourceId[]).filter((k) => prefs[k].enabled || !!connected[SERVER_SOURCE[k]]?.last_sync_at).length
    : 0;
  const initials = (user?.name ?? '?').trim().slice(0, 2).toUpperCase();

  const sources: SourceDef[] = [
    {
      id: 'location',
      icon: MapPin,
      title: 'Location',
      detail: 'Air quality, heat, rain and mosquito conditions where you are. Only the area name is kept.',
      available: true,
    },
    {
      id: 'health',
      icon: HeartPulse,
      title: Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect',
      detail: 'Sleep, steps, heart rate, HRV, SpO₂ and workouts from your watch, ring or phone.',
      available: healthSupported && healthState !== 'unsupported',
      unavailableNote:
        Platform.OS === 'web'
          ? 'Connect from the VitaSense phone app.'
          : Platform.OS === 'ios'
            ? 'Apple Health support is coming next.'
            : healthState === 'needs_install'
              ? 'Install or update Health Connect from the Play Store.'
              : 'Health Connect is not available on this phone.',
      fix:
        Platform.OS === 'android' && healthState === 'needs_install'
          ? { label: 'Get Health Connect', onPress: openHealthConnectInStore }
          : undefined,
    },
    {
      id: 'calendar',
      icon: CalendarDays,
      title: 'Calendar',
      detail: 'How busy each day is, late meetings, travel and exam weeks. Event titles never leave your phone.',
      available: calendarSupported,
      unavailableNote: 'Connect from the VitaSense phone app.',
    },
    {
      id: 'gmail',
      icon: Mail,
      title: 'Gmail orders',
      detail: 'Food, grocery and pharmacy orders, lab reports and tickets. Only mail from those senders is read.',
      available: gmailConfigured,
      unavailableNote: 'Needs a Google sign-in client ID on this build (see README).',
    },
  ];

  const sourcesCard = (
    <Card style={{ gap: 4 }}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading">Connected data</Text>
          <Text variant="small">One tap each. After that VitaSense collects on its own, so you never type it.</Text>
        </View>
        {prefs && (Object.keys(prefs) as SourceId[]).some((k) => prefs[k].enabled) && (
          <Button
            label={busy === 'all' ? 'Syncing…' : 'Sync now'}
            kind="secondary"
            compact
            disabled={busy !== null}
            icon={<RefreshCw size={14} color={color.ink} />}
            onPress={() => void syncNow()}
          />
        )}
      </View>
      {prefs === null ? (
        <ActivityIndicator color={color.navy} style={{ paddingVertical: 24 }} />
      ) : (
        sources.map((source) => (
          <SourceRow
            key={source.id}
            source={source}
            prefs={prefs[source.id]}
            server={connected[SERVER_SOURCE[source.id]]}
            busy={busy === source.id}
            disabled={busy !== null}
            onOn={() => void turnOn(source.id)}
            onOff={() => turnOff(source.id, source.title)}
            onSync={() => void syncNow(source.id)}
            gmailButton={
              source.id === 'gmail' && gmailConfigured && user ? (
                <GmailSignInButton
                  userId={user.id}
                  label={prefs.gmail.enabled ? 'Sign in & sync' : 'Connect Gmail'}
                  disabled={busy !== null}
                  onToken={(token) => void onGmailToken(token)}
                />
              ) : null
            }
          />
        ))
      )}
      <View style={[styles.sourceRow, { borderBottomWidth: 0 }]}>
        <View style={[styles.sourceIcon, { backgroundColor: color.mintSoft }]}>
          <ClipboardCheck size={18} color={color.mint} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Daily check-in</Text>
          <Text variant="small">Mood, energy and symptoms in three taps. Everything else is collected for you.</Text>
        </View>
        <Button label="Check in" kind="soft" compact onPress={() => router.navigate('/checkin')} />
      </View>
    </Card>
  );

  const pickedUpCard = <PickedUpCard status={status} />;

  const identity = (
    <Card style={styles.identity}>
      <View style={styles.avatar}>
        <Text style={{ fontFamily: font.displayHeavy, fontSize: 22, color: '#FFFFFF' }}>{initials}</Text>
      </View>
      <View style={{ flex: 1, gap: 6, minWidth: 180 }}>
        <Text variant="title">{user?.name}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {isDemo && <Badge label="Demo profile" tone="watch" dot />}
          <Badge label={`${enabledCount} source${enabledCount === 1 ? '' : 's'} connected`} tone={enabledCount ? 'good' : 'neutral'} dot />
          {status && status.days_collected_30d > 0 && <Badge label={`${status.days_collected_30d} days collected`} tone="info" />}
          {health && !health.ai && <Badge label="AI offline" tone="risk" dot />}
        </View>
      </View>
      <Button label="Switch profile" kind="secondary" compact icon={<LogOut size={14} color={color.ink} />} onPress={() => void leave()} />
    </Card>
  );

  const baseline = (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Sparkles size={16} color={color.navy} />
        <Text variant="heading">Your baseline</Text>
      </View>
      {facts.length === 0 && <Text variant="small">VitaSense learns this from your first week of data.</Text>}
      {facts.map(([label, value]) => (
        <View key={label} style={styles.fact}>
          <Text variant="small" style={{ flex: 1 }}>
            {label}
          </Text>
          <Text variant="bodyStrong" style={{ fontSize: 13 }}>
            {value}
          </Text>
        </View>
      ))}
    </Card>
  );

  const privacy = (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={16} color={color.good} />
        <Text variant="heading">Your data, your control</Text>
      </View>
      {[
        'Nothing is collected until you switch a source on.',
        'Turning a source off deletes everything collected from it.',
        'Your data is used only to explain your health to you and your doctor. It is never sold or shared.',
        'VitaSense never prescribes. Medicines shown come from your doctors’ prescriptions.',
      ].map((line) => (
        <View key={line} style={{ flexDirection: 'row', gap: 8 }}>
          <Text variant="small" style={{ color: color.good }}>
            ✓
          </Text>
          <Text variant="small" style={{ flex: 1, color: color.inkSoft }}>
            {line}
          </Text>
        </View>
      ))}
    </Card>
  );

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: wide ? 24 : insets.top + 16, paddingBottom: wide ? 32 : 120 }}>
      <View style={{ width: '100%', maxWidth: 1180, alignSelf: 'center', gap: 16 }}>
        {identity}
        {wide ? (
          <View style={styles.grid}>
            <View style={{ flex: 1.35, gap: 16 }}>
              {sourcesCard}
              {privacy}
            </View>
            <View style={{ flex: 1, gap: 16 }}>
              {pickedUpCard}
              {baseline}
            </View>
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            {sourcesCard}
            {pickedUpCard}
            {baseline}
            {privacy}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function notify(title: string, message: string) {
  if (Platform.OS === 'web') globalThis.alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

interface SourceDef {
  id: SourceId;
  icon: LucideIcon;
  title: string;
  detail: string;
  available: boolean;
  unavailableNote?: string;
  /** What the user can do when the source is not available yet, e.g. install Health Connect. */
  fix?: { label: string; onPress: () => void };
}

function ago(timestamp: number | string | null | undefined): string {
  if (!timestamp) return '';
  const then = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function SourceRow({
  source,
  prefs,
  server,
  busy,
  disabled,
  onOn,
  onOff,
  onSync,
  gmailButton,
}: {
  source: SourceDef;
  prefs: AllPrefs[SourceId];
  server?: { last_sync_at: string | null };
  busy: boolean;
  disabled: boolean;
  onOn: () => void;
  onOff: () => void;
  onSync: () => void;
  gmailButton: ReactNode;
}) {
  const Icon = source.icon;
  const on = prefs.enabled;
  // Data synced from another device (e.g. the phone, seen on the website) still counts as connected.
  const remote = !on && !!server?.last_sync_at;
  let statusLine: string;
  let tone: 'good' | 'risk' | 'neutral' | 'info' = 'neutral';
  if (on && prefs.lastError) {
    statusLine = prefs.lastError;
    tone = 'risk';
  } else if (on) {
    statusLine = [prefs.summary, prefs.lastSync ? `synced ${ago(prefs.lastSync)}` : 'syncing…'].filter(Boolean).join(' · ');
    tone = 'good';
  } else if (remote) {
    statusLine = `Synced from another device ${ago(server?.last_sync_at)}`;
    tone = 'info';
  } else if (!source.available) {
    statusLine = source.unavailableNote ?? 'Not available here';
  } else {
    statusLine = 'Off';
  }

  return (
    <View style={styles.sourceRow}>
      <View style={[styles.sourceIcon, on && { backgroundColor: color.navy }]}>
        <Icon size={18} color={on ? '#FFFFFF' : color.navy} />
      </View>
      <View style={{ flex: 1, gap: 3, minWidth: 160 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text variant="bodyStrong">{source.title}</Text>
          {(on || remote) && <View style={[styles.liveDot, { backgroundColor: tone === 'risk' ? color.risk : color.good }]} />}
        </View>
        <Text variant="small">{source.detail}</Text>
        <Text
          variant="small"
          style={{
            color: tone === 'good' ? color.good : tone === 'risk' ? color.risk : tone === 'info' ? color.info : color.inkMuted,
            fontFamily: font.medium,
          }}>
          {statusLine}
        </Text>
      </View>
      <View style={styles.sourceActions}>
        {busy ? (
          <ActivityIndicator color={color.navy} />
        ) : source.id === 'gmail' && source.available ? (
          <>
            {gmailButton}
            {on && <Button label="Turn off" kind="ghost" compact disabled={disabled} onPress={onOff} />}
          </>
        ) : on ? (
          <>
            <Button label="Sync" kind="secondary" compact disabled={disabled} onPress={onSync} />
            <Button label="Turn off" kind="ghost" compact disabled={disabled} onPress={onOff} />
          </>
        ) : source.available ? (
          <Button label="Turn on" compact disabled={disabled} onPress={onOn} />
        ) : source.fix ? (
          <Button label={source.fix.label} kind="secondary" compact disabled={disabled} onPress={source.fix.onPress} />
        ) : null}
      </View>
    </View>
  );
}

const KIND_ICON: Record<CollectedItem['kind'], LucideIcon> = {
  food_order: UtensilsCrossed,
  grocery_order: ShoppingBasket,
  pharmacy_order: Pill,
  lab_booking: FlaskConical,
  lab_report: FlaskConical,
  fitness_booking: HeartPulse,
  travel: Plane,
};

function PickedUpCard({ status }: { status: CollectStatus | null }) {
  const env = status?.environment;
  const items = status?.recent_items ?? [];
  const healthDay = status?.latest_health;
  const sleep = typeof healthDay?.sleep_hours === 'number' ? healthDay.sleep_hours : null;
  const steps = typeof healthDay?.steps === 'number' ? healthDay.steps : null;
  const empty = !env && !items.length && !healthDay;

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Text variant="heading">Picked up automatically</Text>
        <Text variant="small">What VitaSense knows without you typing it. Used in every answer and your doctor report.</Text>
      </View>
      {status === null ? (
        <ActivityIndicator color={color.navy} style={{ paddingVertical: 16 }} />
      ) : empty ? (
        <View style={styles.emptyBox}>
          <Text variant="body" style={{ textAlign: 'center' }}>
            Switch on a source and the first things VitaSense learns show up here.
          </Text>
        </View>
      ) : null}

      {env && (
        <View style={styles.envCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <CloudSun size={16} color={color.sky} />
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: '#FFFFFF', flex: 1 }} numberOfLines={1}>
              {env.location ?? 'Around you'} · today
            </Text>
          </View>
          <View style={styles.envStats}>
            <EnvStat icon={Wind} label="Air" value={env.aqi != null ? `${env.aqi}` : '—'} hint={env.aqi != null ? aqiLabel(env.aqi) : ''} />
            <EnvStat icon={ThermometerSun} label="High" value={env.temperature_c != null ? `${Math.round(env.temperature_c)}°` : '—'} hint={env.humidity_percent != null ? `${env.humidity_percent}% humid` : ''} />
            <EnvStat
              icon={Bug}
              label="Mosquitoes"
              value={env.mosquito_breeding_conditions ? capitalise(env.mosquito_breeding_conditions) : '—'}
              hint={env.rain_14d_mm != null ? `${Math.round(env.rain_14d_mm)} mm rain / 2 wk` : ''}
            />
          </View>
          {env.alerts.map((alert) => (
            <Text key={alert.type} style={styles.envAlert}>
              • {alert.title}
            </Text>
          ))}
        </View>
      )}

      {(sleep !== null || steps !== null) && (
        <View style={styles.itemRow}>
          <View style={styles.itemIcon}>
            <HeartPulse size={15} color={color.navy} />
          </View>
          <Text variant="body" style={{ flex: 1, fontSize: 13, color: color.ink }}>
            {[sleep !== null ? `${sleep.toFixed(1)} h sleep` : null, steps !== null ? `${steps.toLocaleString()} steps` : null].filter(Boolean).join(' · ')}
          </Text>
          <Text variant="small">{healthDay?.date ? whenLabel(`${healthDay.date}T08:00`, false) : ''}</Text>
        </View>
      )}

      {items.map((item) => {
        const Icon = KIND_ICON[item.kind] ?? Sparkles;
        const flags = item.details.flags ?? [];
        return (
          <View key={`${item.source}-${item.item_id}`} style={styles.itemRow}>
            <View style={[styles.itemIcon, flags.length > 0 && { backgroundColor: color.watchSoft }]}>
              <Icon size={15} color={flags.length > 0 ? color.watch : color.navy} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="body" style={{ fontSize: 13, color: color.ink }} numberOfLines={2}>
                {item.summary}
              </Text>
              {flags.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {flags.map((flag) => (
                    <View key={flag} style={styles.flag}>
                      <Text style={styles.flagText}>{flag}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
            <Text variant="small">{item.happened_at ? whenLabel(item.happened_at) : ''}</Text>
          </View>
        );
      })}
    </Card>
  );
}

function EnvStat({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint: string }) {
  return (
    <View style={styles.envStat}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Icon size={12} color="rgba(255,255,255,0.6)" />
        <Text style={{ fontFamily: font.medium, fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{label}</Text>
      </View>
      <Text style={{ fontFamily: font.display, fontSize: 20, color: '#FFFFFF' }}>{value}</Text>
      {!!hint && <Text style={{ fontFamily: font.regular, fontSize: 10.5, color: 'rgba(255,255,255,0.6)' }}>{hint}</Text>}
    </View>
  );
}

function aqiLabel(aqi: number) {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Sensitive groups';
  if (aqi <= 200) return 'Unhealthy';
  return 'Very unhealthy';
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function whenLabel(stamp: string, withTime = true) {
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const day =
    d.toDateString() === today.toDateString()
      ? 'Today'
      : d.toDateString() === yesterday.toDateString()
        ? 'Yesterday'
        : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  if (!withTime) return day;
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return day === 'Today' ? time : `${day} ${time}`;
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  avatar: { width: 60, height: 60, borderRadius: 20, backgroundColor: color.navy, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    flexWrap: 'wrap',
  },
  sourceIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: color.skySoft, alignItems: 'center', justifyContent: 'center' },
  sourceActions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, borderTopWidth: 1, borderTopColor: color.line },
  emptyBox: { padding: 18, borderRadius: radius.md, backgroundColor: color.surfaceSoft },
  envCard: { backgroundColor: color.navy, borderRadius: radius.md, padding: 14, gap: 10 },
  envStats: { flexDirection: 'row', gap: 8 },
  envStat: { flex: 1, gap: 2, padding: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)' },
  envAlert: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: 'rgba(255,255,255,0.82)' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: color.line },
  itemIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: color.skySoft, alignItems: 'center', justifyContent: 'center' },
  flag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: color.watchSoft },
  flagText: { fontFamily: font.medium, fontSize: 10.5, color: '#9A6200' },
});
