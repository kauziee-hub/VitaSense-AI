import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import {
  Activity,
  ArrowLeft,
  ClipboardList,
  FlaskConical,
  HelpCircle,
  History,
  MapPin,
  Pill,
  Printer,
  ShieldAlert,
  Sparkles,
  Stethoscope,
} from 'lucide-react-native';
import { type ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type DoctorReport } from '@/lib/api';
import { useSession } from '@/lib/session';
import { QUICK_SPECIALTIES } from '@/lib/specialty';
import { printReport, reportDate } from '@/report/reportHtml';
import { breakpoint, color, font, radius } from '@/theme/tokens';
import { Badge, Button, Card, Chip, IconButton, Text } from '@/ui/primitives';

type ChatMessage = { role: 'user' | 'assistant'; text: string; pending?: boolean; failed?: boolean };

/** The user's recent chat, so the report knows what they described and when. */
async function recentConversation(userId: number) {
  try {
    const raw = await AsyncStorage.getItem(`vitasense.chat.${userId}`);
    if (!raw) return [];
    const saved = JSON.parse(raw) as { messages: ChatMessage[] };
    return saved.messages
      .filter((m) => !m.pending && !m.failed && m.text)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.text }));
  } catch {
    return [];
  }
}

async function buildReport(user: { id: number; name: string }, specialty: string, concern: string) {
  const conversation = await recentConversation(user.id);
  return api.doctorReport(user.id, { user_name: user.name, specialty, concern: concern.trim(), conversation });
}

export default function ReportScreen() {
  const params = useLocalSearchParams<{ specialty?: string; concern?: string; auto?: string }>();
  // New parameters (e.g. a different chat answer) start a fresh report.
  const key = `${params.specialty ?? ''}|${params.concern ?? ''}|${params.auto ?? ''}`;
  return (
    <ReportBody
      key={key}
      initialSpecialty={params.specialty?.trim() || 'General physician'}
      initialConcern={params.concern ?? ''}
      auto={!!params.auto}
    />
  );
}

function ReportBody({ initialSpecialty, initialConcern, auto }: { initialSpecialty: string; initialConcern: string; auto: boolean }) {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.wide;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useSession();
  const [specialty, setSpecialty] = useState(initialSpecialty);
  const [concern, setConcern] = useState(initialConcern);
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [busy, setBusy] = useState(auto);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await buildReport(user, specialty, concern));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare the report.');
    } finally {
      setBusy(false);
    }
  };

  // Opened from a chat answer ("Prepare doctor report"): build it straight away.
  useEffect(() => {
    if (!auto || !user) return;
    let alive = true;
    buildReport(user, initialSpecialty, initialConcern)
      .then((next) => alive && setReport(next))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Could not prepare the report.'))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [auto, user, initialSpecialty, initialConcern]);

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: wide ? 24 : insets.top + 16, paddingBottom: wide ? 32 : 120 }}>
      <View style={{ width: '100%', maxWidth: 980, alignSelf: 'center', gap: 16 }}>
        <View style={styles.titleRow}>
          <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/records'))}>
            <ArrowLeft size={18} color={color.ink} />
          </IconButton>
          <View style={{ flex: 1 }}>
            <Text variant="hero" style={{ fontSize: wide ? 30 : 24, lineHeight: wide ? 36 : 30 }}>
              Doctor visit report
            </Text>
            <Text variant="body">Show it on your phone or print it. Your doctor sees your story in a minute.</Text>
          </View>
        </View>

        {!report && (
          <Card style={{ gap: 14 }}>
            <Text variant="heading">Which doctor are you seeing?</Text>
            <View style={styles.chips}>
              {[...new Set([specialty, ...QUICK_SPECIALTIES])].map((s) => (
                <Chip key={s} label={s} selected={s === specialty} onPress={() => setSpecialty(s)} />
              ))}
            </View>
            <Text variant="heading" style={{ marginTop: 4 }}>
              What’s the problem? <Text variant="small">(optional: your recent chat is used too)</Text>
            </Text>
            <TextInput
              value={concern}
              onChangeText={setConcern}
              placeholder="e.g. burning in the chest after meals for 5 days"
              placeholderTextColor={color.inkFaint}
              multiline
              style={styles.input}
            />
            {error && (
              <Text variant="body" style={{ color: color.risk }}>
                {error}
              </Text>
            )}
            {busy ? (
              <View style={styles.busy}>
                <ActivityIndicator color={color.navy} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">Putting your report together…</Text>
                  <Text variant="small">Reading 30 days of your data, your records and what you told VitaSense. About 10–20 seconds.</Text>
                </View>
              </View>
            ) : (
              <Button label="Prepare report" icon={<Sparkles size={15} color="#FFFFFF" />} onPress={() => void generate()} style={{ alignSelf: 'flex-start' }} />
            )}
          </Card>
        )}

        {report && <ReportView report={report} wide={wide} onEdit={() => setReport(null)} onFind={() => router.navigate({ pathname: '/doctors', params: { specialty: report.specialty } })} />}
      </View>
    </ScrollView>
  );
}

function ReportView({ report: r, wide, onEdit, onFind }: { report: DoctorReport; wide: boolean; onEdit: () => void; onFind: () => void }) {
  const [printing, setPrinting] = useState(false);
  const flagged = r.labs.filter((l) => ['high', 'low', 'abnormal'].includes(l.flag));
  const otherLabs = r.labs.filter((l) => !['high', 'low', 'abnormal'].includes(l.flag));

  const left = (
    <View style={{ flex: 1, gap: 18 }}>
      <Section icon={Activity} title="Symptom timeline">
        {r.symptom_timeline.length ? (
          r.symptom_timeline.map((t, i) => (
            <View key={i} style={styles.timelineRow}>
              <View style={styles.timelineDot} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" style={{ fontSize: 13 }}>
                  {t.when}
                </Text>
                <Text variant="body" style={{ fontSize: 13 }}>
                  {t.detail}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <Text variant="small">Nothing reported yet. Describe your symptoms in Ask first for a fuller report.</Text>
        )}
      </Section>
      <Section icon={Sparkles} title="Relevant from tracked data">
        <Bullets items={r.relevant_context} empty="Nothing notable" />
      </Section>
      <Section icon={ShieldAlert} title="Allergies">
        {r.history.allergies.length ? (
          <View style={styles.tags}>
            {r.history.allergies.map((a) => (
              <View key={a} style={[styles.tag, { backgroundColor: color.riskSoft }]}>
                <Text variant="small" style={{ color: color.risk, fontFamily: font.semibold }}>
                  {a}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text variant="small">None recorded</Text>
        )}
      </Section>
      <Section icon={History} title="Conditions & history">
        <Bullets items={[...r.history.conditions, ...r.history.past_history]} empty="None recorded" />
        {r.history.recurring_patterns.length > 0 && (
          <Text variant="small" style={{ marginTop: 6 }}>
            Recurring: {r.history.recurring_patterns.join(' · ')}
          </Text>
        )}
      </Section>
    </View>
  );

  const right = (
    <View style={{ flex: 1, gap: 18 }}>
      <Section icon={ClipboardList} title="Lifestyle, last 30 days">
        <View style={styles.table}>
          <View style={[styles.tr, { borderTopWidth: 0 }]}>
            <Text variant="label" style={{ flex: 1.3 }}>
              MEASURE
            </Text>
            <Text variant="label" style={{ flex: 1 }}>
              LATEST
            </Text>
            <Text variant="label" style={{ flex: 1 }}>
              30-DAY AVG
            </Text>
          </View>
          {r.lifestyle_30d.map((m) => (
            <View key={m.label} style={styles.tr}>
              <Text variant="body" style={{ flex: 1.3, fontSize: 13 }}>
                {m.label}
              </Text>
              <Text variant="bodyStrong" style={{ flex: 1, fontSize: 13 }}>
                {m.latest}
              </Text>
              <Text variant="body" style={{ flex: 1, fontSize: 13 }}>
                {m.average_30d}
              </Text>
            </View>
          ))}
        </View>
      </Section>
      <Section icon={Pill} title="Current medicines (prescribed)">
        {r.medications.length ? (
          r.medications.map((m) => (
            <View key={m.name} style={styles.tr}>
              <Text variant="bodyStrong" style={{ flex: 1.4, fontSize: 13 }}>
                {[m.name, m.strength].filter(Boolean).join(' ')}
              </Text>
              <Text variant="body" style={{ flex: 1, fontSize: 13 }}>
                {m.schedule}
              </Text>
            </View>
          ))
        ) : (
          <Text variant="small">None</Text>
        )}
      </Section>
      <Section icon={FlaskConical} title="Recent lab results">
        {r.labs.length ? (
          [...flagged, ...otherLabs].map((l) => (
            <View key={`${l.name}-${l.date}`} style={styles.tr}>
              <Text variant="body" style={{ flex: 1.4, fontSize: 13 }}>
                {l.name}
              </Text>
              <Text variant="bodyStrong" style={{ flex: 1, fontSize: 13 }}>
                {l.value} {l.unit ?? ''}
              </Text>
              {['high', 'low', 'abnormal'].includes(l.flag) ? <Badge label={l.flag} tone={l.flag === 'low' ? 'watch' : 'risk'} /> : <View style={{ width: 40 }} />}
            </View>
          ))
        ) : (
          <Text variant="small">No reports added yet</Text>
        )}
      </Section>
      {r.local_alerts.length > 0 && (
        <Section icon={MapPin} title="Going around nearby">
          <Bullets items={r.local_alerts.map((a) => `${a.title}: ${a.detail}`)} />
        </Section>
      )}
    </View>
  );

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.actions}>
        <Button
          label={Platform.OS === 'web' ? 'Print or save PDF' : 'Share PDF'}
          icon={<Printer size={15} color="#FFFFFF" />}
          disabled={printing}
          onPress={() => {
            setPrinting(true);
            void printReport(r).finally(() => setPrinting(false));
          }}
        />
        <Button label={`Find a ${r.specialty.toLowerCase()} nearby`} kind="secondary" icon={<Stethoscope size={15} color={color.ink} />} onPress={onFind} />
        <Button label="Change" kind="ghost" onPress={onEdit} />
      </View>

      <Card style={styles.paper}>
        <View style={styles.paperHead}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" style={{ color: color.navy }}>
              PATIENT SUMMARY · {r.specialty.toUpperCase()} VISIT
            </Text>
            <Text variant="title">{r.patient.name}</Text>
            <Text variant="small">{[r.patient.life_phase, r.patient.lifestyle, r.patient.eating && `Eating: ${r.patient.eating}`].filter(Boolean).join(' · ')}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text variant="small">{reportDate(r.generated_at)}</Text>
            {!r.ai_written && <Badge label="Facts only" tone="neutral" />}
          </View>
        </View>

        <View style={styles.reason}>
          <Text variant="label" style={{ color: color.navy }}>
            REASON FOR VISIT
          </Text>
          <Text style={{ fontFamily: font.medium, fontSize: 15, lineHeight: 22, color: color.ink }}>{r.reason_for_visit}</Text>
        </View>

        <View style={[{ gap: 18 }, wide && { flexDirection: 'row', gap: 28 }]}>
          {left}
          {right}
        </View>

        <Section icon={HelpCircle} title="Questions to ask">
          <Bullets items={r.questions_for_doctor} />
        </Section>
        <Text variant="small" style={styles.disclaimer}>
          {r.disclaimer}
        </Text>
      </Card>
    </View>
  );
}

function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon size={15} color={color.navy} />
        <Text variant="label" style={{ color: color.navy }}>
          {title.toUpperCase()}
        </Text>
      </View>
      {children}
    </View>
  );
}

function Bullets({ items, empty = 'None' }: { items: string[]; empty?: string }) {
  if (!items.length) return <Text variant="small">{empty}</Text>;
  return (
    <View style={{ gap: 5 }}>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <Text variant="body" style={{ color: color.navy }}>
            •
          </Text>
          <Text variant="body" style={{ flex: 1, fontSize: 13, color: color.ink }}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    minHeight: 70,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surfaceSoft,
    fontFamily: font.regular,
    fontSize: 14,
    color: color.ink,
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: radius.md, backgroundColor: color.skySoft },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paper: { gap: 20, padding: 24 },
  paperHead: { flexDirection: 'row', gap: 12, paddingBottom: 14, borderBottomWidth: 2, borderBottomColor: color.navy },
  reason: { gap: 6, padding: 14, borderRadius: radius.md, backgroundColor: color.skySoft, borderLeftWidth: 3, borderLeftColor: color.navy },
  timelineRow: { flexDirection: 'row', gap: 10 },
  timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.navy, marginTop: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  table: {},
  tr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: color.line },
  disclaimer: { paddingTop: 12, borderTopWidth: 1, borderTopColor: color.line },
});
