import { useRouter } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Clock3,
  Eye,
  Leaf,
  Maximize2,
  Minus,
  Plus,
  Sparkles,
  Stethoscope,
  Target,
  X,
} from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import type { Forecast } from '@/lib/api';
import { useSession } from '@/lib/session';
import { buildSystemView, formatValue, markerStatus, markerValue, type MarkerDef, type SystemView } from '@/lib/systems';
import { color, font, radius, space, tone as toneMap, toneForProbability, toneForScore, type Tone } from '@/theme/tokens';
import { Button, Card, Glass, IconButton, RangeBar, Segmented, Text } from '@/ui/primitives';

/* ---------- Readiness ring ---------- */

export function ReadinessRing({
  score,
  size = 76,
  label = 'Readiness',
  dark = false,
}: {
  score: number | null;
  size?: number;
  label?: string;
  dark?: boolean;
}) {
  const stroke = Math.max(6, size * 0.09);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const t = score === null ? 'neutral' : toneForScore(score);
  const ring = dark ? { good: '#9FE3B0', watch: '#F4D77A', risk: '#F5A58A', info: '#9FD3E8', neutral: '#888' }[t] : toneMap[t].fg;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={dark ? 'rgba(255,255,255,0.14)' : color.surfaceSunken} strokeWidth={stroke} fill="none" />
        {score !== null && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={ring}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${(c * score) / 100} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
      <Text style={{ fontFamily: font.bold, fontSize: size * 0.3, letterSpacing: -0.8, color: dark ? '#FFFFFF' : color.ink, lineHeight: size * 0.34 }}>
        {score ?? '–'}
      </Text>
      <Text
        variant="label"
        numberOfLines={1}
        style={{ fontSize: Math.max(7, Math.min(9, size * 0.105)), letterSpacing: 0.4, color: dark ? 'rgba(255,255,255,0.55)' : color.inkMuted }}>
        {(label === 'Readiness' && size < 76 ? 'Ready' : label).toUpperCase()}
      </Text>
    </View>
  );
}

/* ---------- Stage overlays ---------- */

export function ZoomControls({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  return (
    <Glass style={styles.zoom} intensity={50}>
      <IconButton label="Zoom in" size={34} style={styles.zoomBtn} onPress={() => setZoom(Math.min(1.6, +(zoom + 0.15).toFixed(2)))}>
        <Plus size={16} color={color.ink} />
      </IconButton>
      <IconButton label="Zoom out" size={34} style={styles.zoomBtn} onPress={() => setZoom(Math.max(0.8, +(zoom - 0.15).toFixed(2)))}>
        <Minus size={16} color={color.ink} />
      </IconButton>
      <IconButton label="Reset zoom" size={34} style={styles.zoomBtn} onPress={() => setZoom(1)}>
        <Maximize2 size={14} color={color.ink} />
      </IconButton>
    </Glass>
  );
}

export function InsightsCard({ forecast, onAsk }: { forecast: Forecast | null; onAsk: (q: string) => void }) {
  const [hidden, setHidden] = useState(false);
  const insights = forecast?.reasoning_timeline ?? [];
  if (hidden || !forecast || insights.length === 0) return null;
  const top = insights[0];
  return (
    <Glass style={styles.insights} intensity={50}>
      <View style={styles.insightsHead}>
        <View style={styles.insightsIcon}>
          <Sparkles size={16} color={color.ink} />
        </View>
        <Text style={styles.insightsCount}>{insights.length}</Text>
        <Text style={styles.insightsTitle}>new insights</Text>
        <Pressable accessibilityLabel="Dismiss insights" onPress={() => setHidden(true)} style={styles.insightsClose}>
          <X size={14} color={color.inkSoft} />
        </Pressable>
      </View>
      <Text style={styles.insightsBody} numberOfLines={3}>
        {top.title}. {top.detail}
      </Text>
      <Button
        label="Ask why"
        compact
        icon={<ArrowRight size={14} color="#FFFFFF" />}
        onPress={() => onAsk(`${top.title}. What does this mean for me and what should I do?`)}
        style={{ alignSelf: 'stretch', marginTop: 4 }}
      />
    </Glass>
  );
}

/* ---------- System panel ---------- */

export function ComparisonCard({ forecast, view }: { forecast: Forecast | null; view: SystemView }) {
  const marker = view.def.primary;
  const { value, baseline } = markerValue(forecast, marker);
  const delta = value !== null && baseline ? ((value - baseline) / baseline) * 100 : null;
  const better = delta === null ? null : marker.invert ? delta < 0 : delta > 0;
  const DeltaIcon = delta !== null && delta < 0 ? ArrowDownRight : ArrowUpRight;
  const t: Tone = delta === null || Math.abs(delta) < 4 ? 'neutral' : better ? 'good' : 'risk';
  return (
    <Card style={styles.compare}>
      <View style={styles.compareScore}>
        <ReadinessRing score={view.score} size={70} label="Score" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="small">{marker.label} today</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          <Text variant="metric">{formatValue(value, marker)}</Text>
          <Text variant="small">{marker.unit}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text variant="small">
            Your usual {formatValue(baseline, marker)}
            {marker.unit}
          </Text>
          {delta !== null && Math.abs(delta) >= 1 && (
            <View style={[styles.deltaChip, { backgroundColor: toneMap[t].bg }]}>
              <DeltaIcon size={12} color={toneMap[t].fg} />
              <Text style={{ fontFamily: font.semibold, fontSize: 11, color: toneMap[t].fg }}>{Math.abs(delta).toFixed(0)}%</Text>
            </View>
          )}
        </View>
      </View>
    </Card>
  );
}

export function NarrativeCard({ view, onAsk }: { view: SystemView; onAsk: (q: string) => void }) {
  return (
    <Card style={styles.narrative}>
      <Text variant="bodyStrong" numberOfLines={2}>
        {view.comparison ?? 'Learning your baseline'}
      </Text>
      <Text variant="body" numberOfLines={3} style={{ fontSize: 13 }}>
        {view.narrative ?? 'VitaSense needs a few more days of signals to explain this system.'}
      </Text>
      <Button
        label="Ask about this"
        compact
        icon={<ArrowRight size={14} color="#FFFFFF" />}
        style={{ alignSelf: 'flex-start', marginTop: 'auto' }}
        onPress={() => onAsk(`Explain my ${view.def.label.toLowerCase()} right now: what is driving it and what should I change?`)}
      />
    </Card>
  );
}

function MarkerTile({ forecast, marker }: { forecast: Forecast | null; marker: MarkerDef }) {
  const { value } = markerValue(forecast, marker);
  const status = markerStatus(value, marker);
  const statusTone: Tone =
    status === 'Optimal' ? 'good' : status === 'No data' ? 'neutral' : marker.invert && status === 'Low' ? 'good' : 'watch';
  const label = marker.invert && status === 'Low' ? 'Optimal' : status;
  return (
    <View style={styles.markerTile}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="heading" style={{ fontSize: 13 }}>
          {marker.label}
        </Text>
        <ArrowRight size={14} color={color.inkMuted} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
          <Text variant="metricSm">{formatValue(value, marker)}</Text>
          <Text variant="small">{marker.unit}</Text>
        </View>
        <Text style={{ fontFamily: font.medium, fontSize: 12, color: toneMap[statusTone].fg }}>{label}</Text>
      </View>
      <RangeBar value={value} min={marker.min} max={marker.max} optimal={marker.optimal} invert={marker.invert} />
    </View>
  );
}

export function MarkersCard({ forecast, view, columns }: { forecast: Forecast | null; view: SystemView; columns: number }) {
  const router = useRouter();
  return (
    <Card>
      <View style={styles.cardHead}>
        <Text variant="heading">Key markers</Text>
        <IconButton label="Open records" size={32} onPress={() => router.navigate('/records')}>
          <ArrowUpRight size={15} color={color.ink} />
        </IconButton>
      </View>
      <View style={[styles.markerGrid]}>
        {view.def.markers.map((m) => (
          <View key={m.metric} style={{ width: columns === 1 ? '100%' : `${100 / columns - 1.5}%` as `${number}%`, flexGrow: 1 }}>
            <MarkerTile forecast={forecast} marker={m} />
          </View>
        ))}
      </View>
      <Text variant="small" style={{ marginTop: 10 }}>
        Lab markers (HbA1c, cholesterol, vitamin D…) appear here once you add a report in Records.
      </Text>
    </Card>
  );
}

type PlanTab = 'actions' | 'lifestyle' | 'watch';

export function CarePlanCard({ view, columns }: { view: SystemView; columns: number }) {
  const [tab, setTab] = useState<PlanTab>('actions');
  const items =
    tab === 'actions'
      ? view.actions.map((a) => ({ title: a.title, detail: a.detail, meta: a.horizon, tone: (a.priority === 'high' ? 'risk' : a.priority === 'medium' ? 'watch' : 'good') as Tone, icon: Target }))
      : tab === 'lifestyle'
        ? view.lifestyle.map((a) => ({ title: a.title, detail: a.detail, meta: undefined, tone: 'good' as Tone, icon: Leaf }))
        : view.watch.map((w) => ({
            title: w.title,
            detail: w.detail,
            meta: w.probability !== undefined ? `${w.probability}%` : undefined,
            tone: (w.probability !== undefined ? toneForProbability(w.probability) : 'info') as Tone,
            icon: Eye,
          }));
  return (
    <Card>
      <View style={[styles.cardHead, { flexWrap: 'wrap', gap: 10 }]}>
        <Text variant="heading">Your care plan</Text>
        <Segmented<PlanTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'actions', label: 'Action plan', count: view.actions.length },
            { value: 'lifestyle', label: 'Lifestyle' },
            { value: 'watch', label: 'Watch for', count: view.watch.length },
          ]}
        />
      </View>
      <View style={styles.planGrid}>
        {items.length === 0 && <Text variant="body">Nothing here right now.</Text>}
        {items.map((item) => (
          <PlanItem key={item.title} {...item} width={columns === 1 ? '100%' : '48.8%'} />
        ))}
      </View>
      <View style={styles.doctorRow}>
        <Stethoscope size={16} color={color.ink} />
        <Text variant="small" style={{ flex: 1, color: color.inkSoft }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.ink }}>If it doesn’t improve: </Text>
          {view.def.specialist}. VitaSense never prescribes medicines.
        </Text>
      </View>
    </Card>
  );
}

function PlanItem({
  title,
  detail,
  meta,
  tone,
  icon: Icon,
  width,
}: {
  title: string;
  detail: string;
  meta?: string;
  tone: Tone;
  icon: LucideIcon;
  width: `${number}%`;
}) {
  return (
    <View style={[styles.planItem, { width }]}>
      <View style={[styles.planIcon, { backgroundColor: toneMap[tone].bg }]}>
        <Icon size={18} color={toneMap[tone].fg} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="heading" style={{ fontSize: 13, flex: 1 }} numberOfLines={1}>
            {title}
          </Text>
          {meta && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Clock3 size={11} color={color.inkMuted} />
              <Text variant="small" style={{ fontSize: 11 }}>
                {meta}
              </Text>
            </View>
          )}
        </View>
        <Text variant="small" numberOfLines={2} style={{ color: color.inkSoft }}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

/* ---------- Hook: shared dashboard state ---------- */

export function useAskNavigator() {
  const router = useRouter();
  const { setPendingQuestion } = useSession();
  return (question: string) => {
    setPendingQuestion(question);
    router.navigate('/ask');
  };
}

export { buildSystemView };

const styles = StyleSheet.create({
  zoom: { padding: 5, gap: 5, borderRadius: 24, boxShadow: '0px 6px 20px rgba(17,17,17,0.08)' },
  zoomBtn: { backgroundColor: '#FFFFFF', boxShadow: 'none' },
  insights: { padding: 16, gap: 8, borderRadius: 24, boxShadow: '0px 1px 2px rgba(17,17,17,0.03)' },
  insightsHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  insightsIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: '#F6E48A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightsCount: { fontFamily: font.bold, fontSize: 24, color: color.ink, lineHeight: 28, letterSpacing: -0.6 },
  insightsTitle: { fontFamily: font.medium, fontSize: 14, color: color.ink, flex: 1 },
  insightsClose: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceSunken,
  },
  insightsBody: { fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkSoft },
  compare: { flexDirection: 'row', alignItems: 'center', gap: 16, flex: 1, minWidth: 260 },
  compareScore: { padding: 4, borderRadius: 40, backgroundColor: color.surfaceSoft },
  deltaChip: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, height: 20, borderRadius: 10 },
  narrative: { flex: 1, minWidth: 240, gap: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  markerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  markerTile: {
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: color.surfaceSoft,
  },
  planGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  planItem: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: color.surfaceSoft,
    alignItems: 'flex-start',
  },
  planIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  doctorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: color.canvas,
  },
});
