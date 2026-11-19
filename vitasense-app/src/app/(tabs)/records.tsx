import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import {
  Activity,
  BellRing,
  Camera,
  Check,
  ClipboardList,
  FileHeart,
  FileText,
  FlaskConical,
  HeartPulse,
  Pill,
  ShieldPlus,
  Stethoscope,
  Trash2,
  Upload,
  X,
} from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Dose, type DoseStatus, type HealthRecord, type LabResult } from '@/lib/api';
import { pickFromFiles, type PickedFile, takePhoto, toFormData } from '@/lib/pickDocument';
import { remindersSupported } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { listField, useProfile } from '@/lib/useProfile';
import { useRecords } from '@/lib/useRecords';
import { breakpoint, color, font, radius, shadow } from '@/theme/tokens';
import { Badge, Button, Card, IconButton, Text, type PressState } from '@/ui/primitives';

type UploadState =
  | { phase: 'idle' }
  | { phase: 'reading'; name: string }
  | { phase: 'done'; record: HealthRecord; started: boolean }
  | { phase: 'error'; message: string };

const DOC_LABEL: Record<HealthRecord['document_type'], string> = {
  lab_report: 'Lab report',
  prescription: 'Prescription',
  discharge_summary: 'Discharge summary',
  imaging_report: 'Scan report',
  vaccination: 'Vaccination',
  other: 'Document',
};

const DOC_ICON: Record<HealthRecord['document_type'], LucideIcon> = {
  lab_report: FlaskConical,
  prescription: Pill,
  discharge_summary: FileHeart,
  imaging_report: Activity,
  vaccination: ShieldPlus,
  other: FileText,
};

const FOOD: Record<string, string> = {
  before_food: 'Before food',
  after_food: 'After food',
  with_food: 'With food',
  empty_stomach: 'Empty stomach',
};

export default function RecordsScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.wide;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useSession();
  const { tables } = useProfile();
  const { loading, records, summary, today, error, reload, setToday } = useRecords();
  const [upload, setUpload] = useState<UploadState>({ phase: 'idle' });

  const send = async (picked: PickedFile | null | 'denied') => {
    if (!user || picked === null) return;
    if (picked === 'denied') {
      setUpload({ phase: 'error', message: 'Camera access is off. Allow it in Settings, or upload a photo instead.' });
      return;
    }
    setUpload({ phase: 'reading', name: picked.name });
    try {
      const record = await api.uploadRecord(user.id, toFormData(picked));
      setUpload({ phase: 'done', record, started: false });
      reload();
    } catch (e) {
      setUpload({ phase: 'error', message: e instanceof Error ? e.message : 'Could not read that document.' });
    }
  };

  const startReminders = async (record: HealthRecord) => {
    if (!user) return;
    await api.startMedications(user.id, record.id);
    setUpload((u) => (u.phase === 'done' ? { ...u, started: true } : u));
    reload();
  };

  const remove = (record: HealthRecord) => {
    if (!user) return;
    const go = async () => {
      await api.deleteRecord(user.id, record.id);
      reload();
    };
    const message = `Delete “${record.title ?? record.file_name}”? Medicines from it are removed too. This can’t be undone.`;
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.(message)) void go();
    } else {
      Alert.alert('Delete record', message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void go() },
      ]);
    }
  };

  const markDose = async (dose: Dose, status: DoseStatus | 'pending') => {
    if (!user || !today) return;
    setToday({
      ...today,
      doses: today.doses.map((d) =>
        d.medication_id === dose.medication_id && d.time === dose.time ? { ...d, status: status === 'pending' ? 'due' : status } : d,
      ),
    });
    try {
      setToday(await api.logDose(user.id, dose.medication_id, { date: dose.date, time: dose.time, status }));
    } catch {
      reload();
    }
  };

  const conditions = merge(summary?.conditions, listField(tables, 'user_medical_identity', 'chronic_conditions'));
  const allergies = merge(summary?.allergies, listField(tables, 'user_medical_identity', 'allergy_conditions'));
  const history = merge(summary?.procedures, listField(tables, 'user_medical_identity', 'major_medical_history'));
  const patterns = listField(tables, 'user_medical_identity', 'recurring_health_patterns');

  const addCard = <AddRecordCard upload={upload} onCamera={() => void takePhoto().then(send)} onFile={() => void pickFromFiles().then(send)} onStart={startReminders} onDismiss={() => setUpload({ phase: 'idle' })} />;
  const medsCard = <MedicinesCard loading={loading} today={today} onMark={markDose} />;
  const labsCard = <LabsCard labs={summary?.latest_labs ?? []} loading={loading} />;
  const identityCard = (
    <Card style={{ gap: 4 }}>
      <View style={styles.cardHead}>
        <ClipboardList size={18} color={color.navy} />
        <Text variant="heading" style={{ flex: 1 }}>
          Medical identity
        </Text>
      </View>
      <TagSection icon={HeartPulse} title="Conditions" items={conditions} empty="None recorded" />
      <TagSection icon={ShieldPlus} title="Allergies" items={allergies} empty="None recorded" tone="risk" />
      <TagSection icon={Stethoscope} title="Past illness & surgery" items={history} empty="None recorded" />
      <TagSection icon={Activity} title="Patterns VitaSense has seen" items={patterns} empty="Still learning" />
    </Card>
  );
  const docsCard = <DocumentsCard records={records} loading={loading} onDelete={remove} />;
  const reportCard = (
    <LinearGradient colors={[color.navy, color.navyDeep]} style={styles.reportCard}>
      <Text variant="label" style={{ color: color.sky }}>
        DOCTOR VISIT REPORT
      </Text>
      <Text style={styles.reportTitle}>One page your doctor can read in a minute</Text>
      <Text style={styles.reportBody}>
        Your complaint and timeline, 30 days of sleep, food and stress, allergies, history, current medicines and recent labs.
      </Text>
      <Button label="Prepare report" kind="soft" compact style={{ alignSelf: 'flex-start', marginTop: 6 }} onPress={() => router.navigate('/report')} />
    </LinearGradient>
  );

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: wide ? 24 : insets.top + 16, paddingBottom: wide ? 32 : 120 }}>
      <View style={{ width: '100%', maxWidth: 1180, alignSelf: 'center', gap: 16 }}>
        <View style={{ gap: 4 }}>
          <Text variant="hero">Health records</Text>
          <Text variant="body">Everything a new doctor would ask you, in one place, for {user?.name}.</Text>
        </View>
        {error && (
          <Card>
            <Text variant="body">Couldn’t load your records: {error}</Text>
          </Card>
        )}
        {wide ? (
          <View style={styles.grid}>
            <View style={{ flex: 1.45, gap: 16 }}>
              {addCard}
              {labsCard}
              {docsCard}
            </View>
            <View style={{ flex: 1, gap: 16 }}>
              {medsCard}
              {identityCard}
              {reportCard}
            </View>
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            {addCard}
            {medsCard}
            {labsCard}
            {identityCard}
            {docsCard}
            {reportCard}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function merge(...lists: (string[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list ?? []) {
      const key = item.trim().toLowerCase();
      if (key && !seen.has(key) && !key.startsWith('no major history')) {
        seen.add(key);
        out.push(item.trim());
      }
    }
  }
  return out;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ---------- Add a record ---------- */

function AddRecordCard({
  upload,
  onCamera,
  onFile,
  onStart,
  onDismiss,
}: {
  upload: UploadState;
  onCamera: () => void;
  onFile: () => void;
  onStart: (record: HealthRecord) => Promise<void>;
  onDismiss: () => void;
}) {
  const [starting, setStarting] = useState(false);
  return (
    <Card style={{ gap: 14 }}>
      <View style={styles.cardHead}>
        <FileText size={18} color={color.navy} />
        <Text variant="heading" style={{ flex: 1 }}>
          Add a past record
        </Text>
        <Badge label="No typing" tone="info" />
      </View>
      <Text variant="body">
        Photograph or upload a lab report, prescription or discharge summary. VitaSense reads the values, conditions, allergies and
        medicines for you.
      </Text>

      {upload.phase === 'reading' ? (
        <View style={styles.reading}>
          <ActivityIndicator color={color.navy} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">Reading {upload.name}…</Text>
            <Text variant="small">Usually 10–30 seconds. You can keep using the app.</Text>
          </View>
        </View>
      ) : (
        <View style={styles.addRow}>
          <UploadTile icon={Camera} title="Scan with camera" detail="Best for paper reports" onPress={onCamera} primary />
          <UploadTile icon={Upload} title="Upload PDF or photo" detail="From files or gallery" onPress={onFile} />
        </View>
      )}

      {upload.phase === 'error' && (
        <View style={[styles.banner, { backgroundColor: color.riskSoft }]}>
          <Text variant="body" style={{ flex: 1, color: color.ink }}>
            {upload.message}
          </Text>
          <IconButton label="Dismiss" onPress={onDismiss} size={30} style={{ backgroundColor: 'transparent', borderColor: 'transparent' }}>
            <X size={14} color={color.inkSoft} />
          </IconButton>
        </View>
      )}

      {upload.phase === 'done' && (
        <View style={[styles.banner, { backgroundColor: color.goodSoft, alignItems: 'flex-start' }]}>
          <View style={[styles.bannerIcon, { backgroundColor: color.good }]}>
            <Check size={14} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text variant="bodyStrong">
              {upload.record.duplicate ? 'Already in your records: ' : 'Added: '}
              {upload.record.title}
            </Text>
            {!!upload.record.summary && <Text variant="body">{upload.record.summary}</Text>}
            <Text variant="small">
              {[
                upload.record.extracted.lab_results.length && `${upload.record.extracted.lab_results.length} test results`,
                upload.record.extracted.medications.length && `${upload.record.extracted.medications.length} medicines`,
                upload.record.extracted.conditions.length && `${upload.record.extracted.conditions.length} conditions`,
                upload.record.extracted.allergies.length && `allergy: ${upload.record.extracted.allergies.join(', ')}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {upload.record.extracted.medications.length > 0 &&
              (upload.started ? (
                <Badge label={remindersSupported ? 'Reminders set' : 'Added to today’s medicines'} tone="good" dot />
              ) : (
                <Button
                  label={`Remind me to take ${upload.record.extracted.medications.length === 1 ? 'it' : `these ${upload.record.extracted.medications.length}`}`}
                  icon={<BellRing size={15} color="#FFFFFF" />}
                  compact
                  disabled={starting}
                  style={{ alignSelf: 'flex-start', marginTop: 4 }}
                  onPress={() => {
                    setStarting(true);
                    void onStart(upload.record).finally(() => setStarting(false));
                  }}
                />
              ))}
          </View>
          <IconButton label="Dismiss" onPress={onDismiss} size={30} style={{ backgroundColor: 'transparent', borderColor: 'transparent' }}>
            <X size={14} color={color.inkSoft} />
          </IconButton>
        </View>
      )}
    </Card>
  );
}

function UploadTile({
  icon: Icon,
  title,
  detail,
  onPress,
  primary,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed, hovered }: PressState) => [
        styles.tile,
        primary && { backgroundColor: color.navy, borderColor: color.navy },
        hovered && !primary && { backgroundColor: color.skySoft, borderColor: color.sky },
        hovered && primary && { opacity: 0.94 },
        pressed && { transform: [{ scale: 0.98 }] },
      ]}>
      <View style={[styles.tileIcon, primary && { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
        <Icon size={20} color={primary ? '#FFFFFF' : color.navy} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: primary ? '#FFFFFF' : color.ink }}>{title}</Text>
        <Text variant="small" style={primary ? { color: 'rgba(255,255,255,0.7)' } : undefined}>
          {detail}
        </Text>
      </View>
    </Pressable>
  );
}

/* ---------- Medicines today ---------- */

const STATUS: Record<DoseStatus, { label: string; tone: 'good' | 'watch' | 'risk' | 'info' | 'neutral' }> = {
  taken: { label: 'Taken', tone: 'good' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  missed: { label: 'Missed', tone: 'risk' },
  due: { label: 'Due now', tone: 'watch' },
  upcoming: { label: 'Later', tone: 'info' },
  unlogged: { label: 'Not logged', tone: 'neutral' },
};

function MedicinesCard({
  loading,
  today,
  onMark,
}: {
  loading: boolean;
  today: ReturnType<typeof useRecords>['today'];
  onMark: (dose: Dose, status: DoseStatus | 'pending') => void;
}) {
  const doses = today?.doses ?? [];
  const asNeeded = today?.as_needed ?? [];
  const taken = doses.filter((d) => d.status === 'taken').length;
  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.cardHead}>
        <Pill size={18} color={color.navy} />
        <Text variant="heading" style={{ flex: 1 }}>
          Today’s medicines
        </Text>
        {doses.length > 0 && <Badge label={`${taken}/${doses.length} taken`} tone={taken === doses.length ? 'good' : 'info'} />}
      </View>
      {loading ? (
        <ActivityIndicator color={color.navy} style={{ paddingVertical: 16 }} />
      ) : doses.length === 0 && asNeeded.length === 0 ? (
        <Text variant="body">
          No medicines yet. Scan your prescription after a doctor visit and VitaSense reminds you on time. It never changes what your
          doctor prescribed.
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {doses.map((dose) => (
            <DoseRow key={`${dose.medication_id}-${dose.time}`} dose={dose} onMark={onMark} />
          ))}
          {asNeeded.length > 0 && (
            <Text variant="small" style={{ marginTop: 4 }}>
              Only when needed: {asNeeded.map((m) => [m.name, m.strength].filter(Boolean).join(' ')).join(', ')}
            </Text>
          )}
        </View>
      )}
      {today && (doses.length > 0 || asNeeded.length > 0) && (
        <View style={styles.medFooter}>
          <BellRing size={14} color={color.inkMuted} />
          <Text variant="small" style={{ flex: 1 }}>
            {remindersSupported ? 'Reminders ring on this phone at each time.' : 'Reminders ring on the phone app; this page shows the schedule.'}
            {today.adherence_7d != null ? `  Last 7 days: ${Math.round(today.adherence_7d * 100)}% taken.` : ''}
          </Text>
        </View>
      )}
    </Card>
  );
}

function DoseRow({ dose, onMark }: { dose: Dose; onMark: (dose: Dose, status: DoseStatus | 'pending') => void }) {
  const status = STATUS[dose.status];
  const done = dose.status === 'taken' || dose.status === 'skipped';
  const detail = [dose.dose, FOOD[dose.food_timing ?? '']].filter(Boolean).join(' · ');
  return (
    <View style={[styles.dose, dose.status === 'due' && { borderColor: '#F3D199', backgroundColor: color.watchSoft }]}>
      <Text style={styles.doseTime}>{dose.time}</Text>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text variant="bodyStrong" style={{ fontSize: 13.5 }} numberOfLines={1}>
          {[dose.name, dose.strength].filter(Boolean).join(' ')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {dose.status !== 'upcoming' && !done && <Badge label={status.label} tone={status.tone} />}
          {!!detail && (
            <Text variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
              {detail}
            </Text>
          )}
        </View>
      </View>
      {done ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Undo" onPress={() => onMark(dose, 'pending')}>
          <Badge label={status.label} tone={status.tone} dot />
        </Pressable>
      ) : (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <IconButton label={`Mark ${dose.name} taken`} size={36} onPress={() => onMark(dose, 'taken')} active>
            <Check size={16} color="#FFFFFF" />
          </IconButton>
          <IconButton label={`Skip ${dose.name}`} size={36} onPress={() => onMark(dose, 'skipped')}>
            <X size={15} color={color.inkSoft} />
          </IconButton>
        </View>
      )}
    </View>
  );
}

/* ---------- Labs ---------- */

const FLAG: Record<LabResult['flag'], { label: string; tone: 'good' | 'watch' | 'risk' | 'neutral' }> = {
  high: { label: 'High', tone: 'risk' },
  low: { label: 'Low', tone: 'watch' },
  abnormal: { label: 'Abnormal', tone: 'risk' },
  normal: { label: 'Normal', tone: 'good' },
  unknown: { label: '—', tone: 'neutral' },
};

function LabsCard({ labs, loading }: { labs: (LabResult & { date: string })[]; loading: boolean }) {
  const sorted = [...labs].sort((a, b) => Number(['normal', 'unknown'].includes(a.flag)) - Number(['normal', 'unknown'].includes(b.flag)));
  const flagged = labs.filter((l) => !['normal', 'unknown'].includes(l.flag)).length;
  return (
    <Card style={{ gap: 10 }}>
      <View style={styles.cardHead}>
        <FlaskConical size={18} color={color.navy} />
        <Text variant="heading" style={{ flex: 1 }}>
          Lab results
        </Text>
        {labs.length > 0 && <Badge label={flagged ? `${flagged} outside range` : 'All in range'} tone={flagged ? 'risk' : 'good'} />}
      </View>
      {loading ? (
        <ActivityIndicator color={color.navy} style={{ paddingVertical: 16 }} />
      ) : labs.length === 0 ? (
        <Text variant="body">Your latest value for every test (HbA1c, cholesterol, thyroid, vitamin D…) appears here once you add a report.</Text>
      ) : (
        <View>
          {sorted.map((lab) => (
            <LabRow key={`${lab.name}-${lab.date}`} lab={lab} />
          ))}
        </View>
      )}
    </Card>
  );
}

function LabRow({ lab }: { lab: LabResult & { date: string } }) {
  const narrow = useWindowDimensions().width < 520;
  const flag = FLAG[lab.flag];
  const value = lab.value != null ? `${lab.value}` : (lab.value_text ?? '—');
  const range =
    lab.ref_text ?? (lab.ref_low != null && lab.ref_high != null ? `${lab.ref_low}–${lab.ref_high}` : lab.ref_high != null ? `< ${lab.ref_high}` : null);
  const position =
    lab.value != null && lab.ref_low != null && lab.ref_high != null && lab.ref_high > lab.ref_low
      ? Math.min(1, Math.max(0, (lab.value - lab.ref_low) / (lab.ref_high - lab.ref_low)))
      : null;
  return (
    <View style={styles.labRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" style={{ fontSize: 13.5 }}>
          {lab.name}
        </Text>
        <Text variant="small">
          {range ? `Range ${range}` : 'No range printed'} · {formatDate(lab.date)}
        </Text>
      </View>
      {position !== null && !narrow && (
        <View style={styles.labTrack}>
          <View style={[styles.labBand]} />
          <View style={[styles.labDot, { left: `${10 + position * 80}%`, backgroundColor: flag.tone === 'good' ? color.good : color.risk }]} />
        </View>
      )}
      <View style={{ alignItems: 'flex-end', minWidth: 92, gap: 3 }}>
        <Text style={{ fontFamily: font.display, fontSize: 16, color: color.ink }}>
          {value}
          <Text variant="small"> {lab.unit ?? ''}</Text>
        </Text>
        <Badge label={flag.label} tone={flag.tone} />
      </View>
    </View>
  );
}

/* ---------- Identity tags ---------- */

function TagSection({
  icon: Icon,
  title,
  items,
  empty,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  items: string[];
  empty: string;
  tone?: 'risk';
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionIcon}>
        <Icon size={16} color={color.navy} />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text variant="bodyStrong">{title}</Text>
        {items.length ? (
          <View style={styles.tags}>
            {items.map((item) => (
              <View key={item} style={[styles.tag, tone === 'risk' && { backgroundColor: color.riskSoft }]}>
                <Text variant="small" style={{ color: tone === 'risk' ? color.risk : color.ink }}>
                  {item}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text variant="small">{empty}</Text>
        )}
      </View>
    </View>
  );
}

/* ---------- Documents ---------- */

function DocumentsCard({ records, loading, onDelete }: { records: HealthRecord[]; loading: boolean; onDelete: (r: HealthRecord) => void }) {
  return (
    <Card style={{ gap: 6 }}>
      <View style={styles.cardHead}>
        <FileHeart size={18} color={color.navy} />
        <Text variant="heading" style={{ flex: 1 }}>
          Your documents
        </Text>
        {records.length > 0 && <Text variant="small">{records.length}</Text>}
      </View>
      {loading ? (
        <ActivityIndicator color={color.navy} style={{ paddingVertical: 16 }} />
      ) : records.length === 0 ? (
        <Text variant="body">Nothing added yet. Old reports matter: a test from last year shows your doctor the trend.</Text>
      ) : (
        records.map((record) => {
          const Icon = DOC_ICON[record.document_type];
          const counts = [
            record.extracted.lab_results.length && `${record.extracted.lab_results.length} tests`,
            record.extracted.medications.length && `${record.extracted.medications.length} medicines`,
          ].filter(Boolean);
          return (
            <View key={record.id} style={styles.doc}>
              <View style={styles.docIcon}>
                <Icon size={17} color={color.navy} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text variant="bodyStrong" style={{ fontSize: 13.5 }}>
                    {record.title ?? record.file_name}
                  </Text>
                  <Badge label={DOC_LABEL[record.document_type]} tone="neutral" />
                </View>
                <Text variant="small">
                  {[formatDate(record.document_date ?? record.created_at), record.facility, record.doctor, ...counts].filter(Boolean).join(' · ')}
                </Text>
                {!!record.summary && (
                  <Text variant="body" style={{ fontSize: 13, marginTop: 2 }}>
                    {record.summary}
                  </Text>
                )}
              </View>
              <IconButton label="Delete record" size={32} onPress={() => onDelete(record)} style={{ backgroundColor: 'transparent', borderColor: 'transparent' }}>
                <Trash2 size={15} color={color.inkMuted} />
              </IconButton>
            </View>
          );
        })
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  tile: {
    flexGrow: 1,
    flexBasis: 220,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surfaceSoft,
  },
  tileIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: color.skySoft, alignItems: 'center', justifyContent: 'center' },
  reading: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: radius.md, backgroundColor: color.skySoft },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md },
  bannerIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  dose: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    paddingLeft: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  doseTime: { fontFamily: font.display, fontSize: 15, color: color.navy, width: 46 },
  medFooter: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 10, borderTopWidth: 1, borderTopColor: color.line },
  labRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: color.line },
  labTrack: { width: 70, height: 14, justifyContent: 'center' },
  labBand: { position: 'absolute', left: '10%', right: '10%', height: 4, borderRadius: 2, backgroundColor: color.goodSoft },
  labDot: { position: 'absolute', width: 10, height: 10, marginLeft: -5, borderRadius: 5, boxShadow: shadow.card },
  section: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: color.line },
  sectionIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: color.skySoft, alignItems: 'center', justifyContent: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: color.surfaceSunken },
  doc: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: color.line, alignItems: 'flex-start' },
  docIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: color.skySoft, alignItems: 'center', justifyContent: 'center' },
  reportCard: { borderRadius: radius.lg, padding: 20, gap: 8, boxShadow: shadow.raised },
  reportTitle: { fontFamily: font.semibold, fontSize: 16, color: '#FFFFFF' },
  reportBody: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.72)' },
});
