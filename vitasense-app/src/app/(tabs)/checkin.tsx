import type { LucideIcon } from 'lucide-react-native';
import {
  Briefcase,
  CalendarDays,
  Check,
  Cigarette,
  FaceGrinning,
  FaceNeutral,
  FaceSlightlyFrowning,
  FaceSlightlySmiling,
  Footprints,
  HeartPulse,
  Moon,
  Pizza,
  Plane,
  Stethoscope,
  Thermometer,
  Users,
  Utensils,
  UtensilsCrossed,
  Watch,
  Wind,
  Wine,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadPrefs, type AllPrefs, type SourceId } from '@/collect/sync';
import { api, type CollectStatus, type DailyLogPayload, type SourceKey } from '@/lib/api';
import { useSession } from '@/lib/session';
import { breakpoint, color, font, radius, tone as toneMap, type Tone } from '@/theme/tokens';
import { Badge, Button, Card, Chip, Text } from '@/ui/primitives';

type Feeling = 'great' | 'good' | 'okay' | 'low' | 'unwell';

const FEELINGS: { key: Feeling; label: string; icon: LucideIcon; tone: Tone }[] = [
  { key: 'great', label: 'Great', icon: FaceGrinning, tone: 'good' },
  { key: 'good', label: 'Good', icon: FaceSlightlySmiling, tone: 'good' },
  { key: 'okay', label: 'Okay', icon: FaceNeutral, tone: 'info' },
  { key: 'low', label: 'Low', icon: FaceSlightlyFrowning, tone: 'watch' },
  { key: 'unwell', label: 'Unwell', icon: Thermometer, tone: 'risk' },
];

const FEELING_MAP: Record<Feeling, { energy: DailyLogPayload['manual']['energy_level']; mood: string }> = {
  great: { energy: 'High', mood: 'Very Happy' },
  good: { energy: 'Good', mood: 'Happy' },
  okay: { energy: 'Moderate', mood: 'Neutral' },
  low: { energy: 'Low', mood: 'Exhausted' },
  unwell: { energy: 'Very Low', mood: 'Exhausted' },
};

const SYMPTOMS = ['Headache', 'Tiredness', 'Sore throat', 'Cough', 'Fever', 'Acidity', 'Stomach upset', 'Nausea', 'Body ache', 'Stress', 'Low mood', 'Allergy'];

type DayTag = 'outside' | 'junk' | 'alcohol' | 'smoked' | 'workload' | 'travel' | 'crowd' | 'doctor';
const DAY_TAGS: { key: DayTag; label: string; icon: LucideIcon }[] = [
  { key: 'outside', label: 'Ate outside', icon: Utensils },
  { key: 'junk', label: 'Junk / processed', icon: Pizza },
  { key: 'alcohol', label: 'Alcohol', icon: Wine },
  { key: 'smoked', label: 'Smoked', icon: Cigarette },
  { key: 'workload', label: 'Heavy workload', icon: Briefcase },
  { key: 'travel', label: 'Travelled', icon: Plane },
  { key: 'crowd', label: 'Crowded places', icon: Users },
  { key: 'doctor', label: 'Saw a doctor', icon: Stethoscope },
];

const AUTO_SOURCES: { icon: LucideIcon; label: string; source: string; key: SourceId | null }[] = [
  { icon: Moon, label: 'Sleep', source: 'Health Connect on your phone', key: 'health' },
  { icon: Footprints, label: 'Steps & workouts', source: 'Health Connect on your phone', key: 'health' },
  { icon: HeartPulse, label: 'Heart rate & HRV', source: 'Your watch or band, via Health Connect', key: 'health' },
  { icon: Wind, label: 'Air, heat & mosquitoes', source: 'Your location', key: 'location' },
  { icon: CalendarDays, label: 'Workload & travel', source: 'Your calendar', key: 'calendar' },
  { icon: UtensilsCrossed, label: 'Food & medicine orders', source: 'Gmail order emails', key: 'gmail' },
  { icon: Watch, label: 'Screen time', source: 'Android usage access', key: null },
];

const SERVER_KEY: Record<SourceId, SourceKey> = { location: 'location', health: 'health_connect', calendar: 'calendar', gmail: 'gmail' };

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CheckInScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.wide;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const sources = useSourceStatus();
  const { user, refreshForecast } = useSession();
  const [feeling, setFeeling] = useState<Feeling | null>(null);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [tags, setTags] = useState<DayTag[]>([]);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const taps = (feeling ? 1 : 0) + (symptoms.length ? 1 : 0) + (tags.length ? 1 : 0);

  const payload = useMemo<DailyLogPayload | null>(() => {
    if (!feeling) return null;
    const base = FEELING_MAP[feeling];
    const mood = symptoms.includes('Stress') ? 'Stressed' : symptoms.includes('Low mood') ? 'Sad' : base.mood;
    const has = (t: DayTag) => tags.includes(t);
    const physical = symptoms.filter((s) => s !== 'Stress' && s !== 'Low mood');
    return {
      log_date: todayIso(),
      manual: {
        energy_level: base.energy,
        mood_today: mood,
        overall_mental_feeling: mood,
        chatbot_symptoms_reported: symptoms,
        physical_discomfort_notes: physical.length ? physical.join(', ') : null,
        ate_from_outside: has('outside'),
        processed_food_consumed: has('junk'),
        workload_intensity: has('workload') ? 'High' : null,
        travel_today: has('travel'),
        crowded_place_exposure: has('crowd'),
        doctor_consulted_today: has('doctor'),
        daily_events: [...(has('alcohol') ? ['alcohol'] : []), ...(has('smoked') ? ['smoked'] : [])],
        emotional_event_notes: note.trim() || null,
      },
    };
  }, [feeling, symptoms, tags, note]);

  const save = async () => {
    if (!user || !payload) return;
    setState('saving');
    setError(null);
    try {
      await api.saveDailyLog(user.id, payload);
      setState('saved');
      void refreshForecast();
    } catch (e) {
      setState('error');
      setError(
        e instanceof Error && e.message.includes('reach')
          ? 'Can’t reach the VitaSense server.'
          : 'The database is offline, so today’s check-in couldn’t be stored. Nothing was lost on your side; try again once it’s back.',
      );
    }
  };

  const steps = (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 14 }}>
        <StepHead n={1} title="How do you feel today?" done={!!feeling} />
        <View style={styles.feelings}>
          {FEELINGS.map(({ key, label, icon: Icon, tone }) => {
            const on = feeling === key;
            return (
              <Pressable
                key={key}
                onPress={() => setFeeling(key)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={[styles.feeling, on && { borderColor: toneMap[tone].fg, backgroundColor: toneMap[tone].bg }]}>
                <Icon size={28} color={on ? toneMap[tone].fg : color.inkMuted} />
                <Text style={[styles.feelingLabel, on && { color: color.ink }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={{ gap: 14 }}>
        <StepHead n={2} title="Anything bothering you?" hint="Tap all that apply" done={symptoms.length > 0} />
        <View style={styles.chips}>
          {SYMPTOMS.map((s) => (
            <Chip key={s} label={s} selected={symptoms.includes(s)} onPress={() => setSymptoms((l) => toggle(l, s))} />
          ))}
        </View>
      </Card>

      <Card style={{ gap: 14 }}>
        <StepHead n={3} title="Today included…" hint="Things sensors can’t see" done={tags.length > 0} />
        <View style={styles.chips}>
          {DAY_TAGS.map(({ key, label, icon: Icon }) => (
            <Chip
              key={key}
              label={label}
              selected={tags.includes(key)}
              onPress={() => setTags((l) => toggle(l, key))}
              icon={<Icon size={15} color={tags.includes(key) ? '#FFFFFF' : color.inkSoft} />}
            />
          ))}
        </View>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Anything else? (optional)"
          placeholderTextColor={color.inkFaint}
          style={styles.note}
        />
      </Card>

      <View style={styles.saveRow}>
        <Text variant="small" style={{ flex: 1 }}>
          {taps}/3 answered · about 10 seconds
        </Text>
        <Button
          label={state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save check-in'}
          icon={state === 'saved' ? <Check size={16} color="#FFFFFF" /> : undefined}
          disabled={!feeling || state === 'saving'}
          onPress={() => void save()}
        />
      </View>
      {state === 'error' && error && (
        <Card style={{ backgroundColor: color.riskSoft, borderColor: '#F6B9BB' }}>
          <Text variant="body" style={{ color: color.ink }}>
            {error}
          </Text>
        </Card>
      )}
    </View>
  );

  const auto = (
    <Card style={{ gap: 12 }}>
      <Text variant="heading">Filled in automatically</Text>
      <Text variant="small">You never type these. They arrive from your phone, watch, location and orders once you switch them on.</Text>
      {AUTO_SOURCES.map(({ icon: Icon, label, source, key }) => {
        const on = key !== null && (!!sources?.prefs[key].enabled || !!sources?.status?.connections[SERVER_KEY[key]]?.last_sync_at);
        return (
          <View key={label} style={styles.autoRow}>
            <View style={[styles.autoIcon, on && { backgroundColor: color.navy }]}>
              <Icon size={16} color={on ? '#FFFFFF' : color.navy} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" style={{ fontSize: 13 }}>
                {label}
              </Text>
              <Text variant="small">{source}</Text>
            </View>
            {key === null ? (
              <Badge label="Coming soon" tone="neutral" />
            ) : on ? (
              <Badge label="Collecting" tone="good" dot />
            ) : (
              <Pressable accessibilityRole="button" onPress={() => router.navigate('/profile')}>
                <Badge label="Turn on" tone="info" />
              </Pressable>
            )}
          </View>
        );
      })}
    </Card>
  );

  return (
    <ScrollView contentContainerStyle={[styles.root, { paddingTop: wide ? 24 : insets.top + 16, paddingBottom: wide ? 32 : 120 }]}>
      <View style={styles.inner}>
        <View style={{ gap: 4, marginBottom: 16 }}>
          <Text variant="small">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
          <Text variant="hero">Daily check-in</Text>
          <Text variant="body">Three taps. Everything else is collected for you.</Text>
        </View>
        {wide ? (
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
            <View style={{ flex: 1.6 }}>{steps}</View>
            <View style={{ flex: 1 }}>{auto}</View>
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            {steps}
            {auto}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function StepHead({ n, title, hint, done }: { n: number; title: string; hint?: string; done: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={[styles.stepNum, done && { backgroundColor: color.good }]}>
        {done ? <Check size={13} color="#FFFFFF" /> : <Text style={styles.stepNumLabel}>{n}</Text>}
      </View>
      <Text variant="heading" style={{ flex: 1 }}>
        {title}
      </Text>
      {hint && <Text variant="small">{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 16 },
  inner: { width: '100%', maxWidth: 1080, alignSelf: 'center' },
  feelings: { flexDirection: 'row', gap: 8 },
  feeling: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  feelingLabel: { fontFamily: font.medium, fontSize: 12, color: color.inkMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: {
    height: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: 16,
    fontFamily: font.regular,
    fontSize: 14,
    color: color.ink,
    backgroundColor: color.surfaceSoft,
  },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: color.navy, alignItems: 'center', justifyContent: 'center' },
  stepNumLabel: { fontFamily: font.bold, fontSize: 12, color: '#FFFFFF' },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  autoIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: color.skySoft, alignItems: 'center', justifyContent: 'center' },
});

/** Which automatic sources are on (here, or syncing from another device). */
function useSourceStatus() {
  const { user } = useSession();
  const [state, setState] = useState<{ userId: number; prefs: AllPrefs; status: CollectStatus | null } | null>(null);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    Promise.all([loadPrefs(user.id), api.collectStatus(user.id).catch(() => null)]).then(([prefs, status]) => {
      if (alive) setState({ userId: user.id, prefs, status });
    });
    return () => {
      alive = false;
    };
  }, [user]);
  return state && user && state.userId === user.id ? state : null;
}
