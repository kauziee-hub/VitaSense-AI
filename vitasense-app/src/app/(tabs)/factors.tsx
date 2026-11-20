import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CloudRain,
  ExternalLink,
  RefreshCw,
  Snowflake,
  Sun,
  SunDim,
  Thermometer,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text as RNText, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type ArtKey, ORGAN_ART } from '@/body/art';
import { enabledFactorSources } from '@/collect/sync';
import { api, type EnvironmentRisk, type FactorStatus, type HealthFactor, type HealthFactors } from '@/lib/api';
import { APK_URL } from '@/lib/links';
import { useSession } from '@/lib/session';
import { breakpoint, color, font, pastel, radius } from '@/theme/tokens';
import { Badge, Button, Card, IconButton, type PressState, Segmented, Text } from '@/ui/primitives';

const STATUS: Record<FactorStatus, { label: string; dot: string; fill: string }> = {
  live: { label: 'Tracked automatically', dot: '#3E9B5F', fill: pastel.mint },
  recorded: { label: 'From your records & answers', dot: '#2A7D99', fill: pastel.sky },
  waiting: { label: 'Connected, waiting for data', dot: '#C99A12', fill: pastel.butter },
  connect: { label: 'One tap to connect', dot: '#E07F5E', fill: pastel.peach },
  on_phone: { label: 'Automatic in the Android app', dot: '#8E80E0', fill: pastel.lilac },
  manual: { label: 'Only you can tell us', dot: '#9C9EA5', fill: '#ECECE8' },
  not_tracked: { label: 'Not tracked', dot: '#C4C6CB', fill: '#F2F2EF' },
};
const ORDER: FactorStatus[] = ['live', 'recorded', 'waiting', 'connect', 'on_phone', 'manual', 'not_tracked'];

const RISK_ART: Partial<Record<string, ArtKey>> = {
  air_pollution: 'lungs',
  allergens: 'lungs',
  respiratory: 'lungs',
  aedes: 'mosquito',
  anopheles: 'mosquito',
  culex: 'mosquito',
  water: 'gut',
  food_spoilage: 'gut',
};
const RISK_ICON: Partial<Record<string, LucideIcon>> = { heat: Thermometer, cold: Snowflake, uv: Sun, daylight: SunDim, water: CloudRain };
const LEVEL = {
  high: { label: 'High', fill: pastel.peach, ink: '#B5482E' },
  moderate: { label: 'Moderate', fill: pastel.butter, ink: '#8A6406' },
  low: { label: 'Low', fill: pastel.mint, ink: '#2F7A49' },
} as const;

type Filter = 'all' | 'tracked' | 'connect' | 'manual';

export default function FactorsScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.wide;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useSession();
  const [data, setData] = useState<HealthFactors | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [requested, setRequested] = useState(0);
  const [received, setReceived] = useState(-1);
  const loading = received !== requested;
  const load = useCallback(() => setRequested((v) => v + 1), []);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const platform = Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web';
    enabledFactorSources(user.id)
      .then((connected) => api.factors(user.id, { platform, connected, sex: user.biological_sex }))
      .then((next) => {
        if (!alive) return;
        setData(next);
        setError(null);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load your health factors');
      })
      .finally(() => {
        if (alive) setReceived(requested);
      });
    return () => {
      alive = false;
    };
  }, [user, requested]);

  const visible = useMemo(() => {
    if (!data) return [];
    const keep = (f: HealthFactor) =>
      filter === 'all'
        ? true
        : filter === 'tracked'
          ? f.status === 'live' || f.status === 'recorded'
          : filter === 'connect'
            ? f.status === 'connect' || f.status === 'waiting' || f.status === 'on_phone'
            : f.status === 'manual' || f.status === 'not_tracked';
    return data.categories.map((c) => ({ ...c, factors: c.factors.filter(keep) })).filter((c) => c.factors.length);
  }, [data, filter]);

  const toConnect = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    for (const c of data.categories) for (const f of c.factors) if (f.connect_with) counts.set(f.connect_with, (counts.get(f.connect_with) ?? 0) + 1);
    return data.sources
      .filter((s) => counts.has(s.id))
      .map((s) => ({ ...s, unlocks: counts.get(s.id) ?? 0 }))
      .sort((a, b) => b.unlocks - a.unlocks);
  }, [data]);

  const elevated = data?.risks.filter((r) => r.level !== 'low') ?? [];
  const calm = data?.risks.filter((r) => r.level === 'low') ?? [];
  const counts = data?.counts;
  const automatic = counts ? counts.live : 0;

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: wide ? 24 : insets.top + 12, paddingBottom: wide ? 32 : 130 }}>
      <View style={{ width: '100%', maxWidth: 1120, alignSelf: 'center', gap: 16 }}>
        <View style={styles.header}>
          <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))}>
            <ArrowLeft size={18} color={color.ink} />
          </IconButton>
          <View style={{ flex: 1 }}>
            <Text variant="title">What affects your health</Text>
            <Text variant="small">
              {counts
                ? `${counts.total} factors · ${automatic} tracked automatically · ${counts.connect} more with one tap`
                : 'Body, food, habits, air, water, infections, routine and history'}
            </Text>
          </View>
          <IconButton label="Refresh" onPress={load}>
            {loading ? <ActivityIndicator size="small" color={color.ink} /> : <RefreshCw size={16} color={color.ink} />}
          </IconButton>
        </View>

        {error && (
          <Card style={{ gap: 8 }}>
            <Text variant="heading">Couldn’t load your factors</Text>
            <Text variant="body">{error}</Text>
            <Button label="Try again" onPress={load} style={{ alignSelf: 'flex-start' }} />
          </Card>
        )}
        {!data && !error && (
          <Card style={{ alignItems: 'center', paddingVertical: 40 }}>
            <ActivityIndicator color={color.ink} />
          </Card>
        )}

        {data && counts && (
          <>
            <Card style={{ gap: 12 }}>
              <View style={styles.coverage}>
                {ORDER.filter((s) => counts[s] > 0).map((s) => (
                  <View key={s} style={{ flex: counts[s], backgroundColor: STATUS[s].dot, height: 10 }} />
                ))}
              </View>
              <View style={styles.legend}>
                {ORDER.filter((s) => counts[s] > 0).map((s) => (
                  <View key={s} style={styles.legendItem}>
                    <View style={[styles.dot, { backgroundColor: STATUS[s].dot }]} />
                    <Text variant="small">
                      <Text style={styles.legendCount}>{counts[s]}</Text> {STATUS[s].label.toLowerCase()}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>

            {toConnect.length > 0 && (
              <Card style={{ gap: 10 }}>
                <Text variant="heading">Track more without typing</Text>
                <View style={styles.connectRow}>
                  {toConnect.map((s) => (
                    <Pressable
                      key={s.id}
                      onPress={() => router.navigate(s.id === 'band' ? '/band' : '/profile')}
                      style={({ hovered }: PressState) => [styles.connectChip, hovered && { opacity: 0.85 }]}>
                      <Text variant="bodyStrong" style={{ fontSize: 13 }}>
                        {s.label}
                      </Text>
                      <Text variant="small">
                        +{s.unlocks} factor{s.unlocks === 1 ? '' : 's'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </Card>
            )}

            <View style={{ gap: 4 }}>
              <Text variant="heading" style={{ fontSize: 17 }}>
                Around you{data.place ? ` · ${data.place}` : ''}
              </Text>
              <Text variant="small">
                Measured = today’s readings. Estimate = how much weather, season and region favour it; not an outbreak report.
              </Text>
            </View>
            {data.risks.length === 0 ? (
              <Card style={{ gap: 8 }}>
                <Text variant="body">Connect location to see air, water, heat and infection risks where you are.</Text>
                <Button label="Connect location" compact onPress={() => router.navigate('/profile')} style={{ alignSelf: 'flex-start' }} />
              </Card>
            ) : (
              <>
                <View style={styles.riskGrid}>
                  {elevated.map((risk, i) => (
                    <RiskCard key={risk.id} risk={risk} index={i} width={wide ? '49%' : '100%'} />
                  ))}
                </View>
                {calm.length > 0 && (
                  <Card style={{ gap: 8 }}>
                    <Text variant="bodyStrong" style={{ fontSize: 13 }}>
                      Also checked, low right now
                    </Text>
                    <View style={styles.calmRow}>
                      {calm.map((r) => (
                        <CalmChip key={r.id} risk={r} />
                      ))}
                    </View>
                  </Card>
                )}
              </>
            )}

            <Card style={{ gap: 8 }}>
              <Text variant="heading">Official outbreak notices</Text>
              {data.outbreaks.length === 0 ? (
                <Text variant="small">
                  {data.place ? 'No WHO Disease Outbreak News for your country in the last 6 months.' : 'Shown once location is connected.'}
                </Text>
              ) : (
                data.outbreaks.map((n) => (
                  <Pressable key={n.url} onPress={() => void Linking.openURL(n.url)} style={styles.notice}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong" style={{ fontSize: 13 }}>
                        {n.title}
                      </Text>
                      <Text variant="small">
                        {n.source} · {n.date}
                      </Text>
                    </View>
                    <ExternalLink size={15} color={color.inkMuted} />
                  </Pressable>
                ))
              )}
            </Card>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Text variant="heading" style={{ fontSize: 17, flex: 1 }}>
                Every factor
              </Text>
              <Segmented<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All', count: counts.total },
                  { value: 'tracked', label: 'Known', count: counts.live + counts.recorded },
                  { value: 'connect', label: 'Connect', count: counts.connect + counts.waiting + counts.on_phone },
                  { value: 'manual', label: 'You tell us', count: counts.manual + counts.not_tracked },
                ]}
              />
            </View>
            <View style={[styles.catGrid, !wide && { flexDirection: 'column' }]}>
              {visible.map((category) => (
                <Card key={category.id} style={[styles.catCard, wide && { width: '49%' }]}>
                  <Text variant="heading">{category.label}</Text>
                  {category.factors.map((factor) => (
                    <FactorRow
                      key={factor.id}
                      factor={factor}
                      onAction={() => router.navigate(factor.connect_with === 'band' ? '/band' : factor.status === 'manual' ? '/checkin' : '/profile')}
                    />
                  ))}
                </Card>
              ))}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function RiskCard({ risk, index, width }: { risk: EnvironmentRisk; index: number; width: `${number}%` }) {
  const [open, setOpen] = useState(index === 0);
  const art = RISK_ART[risk.id];
  const Icon = RISK_ICON[risk.id];
  const level = LEVEL[risk.level];
  return (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(400)} style={[styles.riskCard, { width, backgroundColor: level.fill }]}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <View style={[styles.levelPill, { backgroundColor: '#FFFFFF' }]}>
              <RNText style={[styles.levelText, { color: level.ink }]}>{level.label}</RNText>
            </View>
            <View style={styles.kindPill}>
              <RNText style={styles.kindText}>{risk.kind === 'measured' ? 'Measured' : 'Estimate'}</RNText>
            </View>
          </View>
          <Text variant="heading" style={{ fontSize: 16 }}>
            {risk.title}
          </Text>
          {risk.why.slice(0, 3).map((line) => (
            <Text key={line} variant="small" style={{ color: color.ink }}>
              {line}
            </Text>
          ))}
        </View>
        {art ? (
          <Image source={ORGAN_ART[art]} style={styles.riskArt} contentFit="contain" />
        ) : Icon ? (
          <View style={styles.riskIcon}>
            <Icon size={26} color={color.ink} />
          </View>
        ) : null}
      </View>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.expand} accessibilityRole="button">
        <Text variant="bodyStrong" style={{ fontSize: 13 }}>
          {open ? 'Less' : 'What it can cause & what to do'}
        </Text>
        {open ? <ChevronUp size={16} color={color.ink} /> : <ChevronDown size={16} color={color.ink} />}
      </Pressable>
      {open && (
        <View style={styles.riskBody}>
          <Section title="Can cause" items={risk.causes} />
          <Section title="Watch for" items={risk.watch_for} />
          <Section title="Protect yourself" items={risk.protect} />
          <View style={{ gap: 2 }}>
            <Text variant="label">WHEN TO SEE A DOCTOR</Text>
            <Text variant="small" style={{ color: color.ink }}>
              {risk.see_doctor}
            </Text>
          </View>
          <Text variant="small">Source: {risk.source}</Text>
        </View>
      )}
    </Animated.View>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={{ gap: 3 }}>
      <Text variant="label">{title.toUpperCase()}</Text>
      {items.map((item) => (
        <View key={item} style={{ flexDirection: 'row', gap: 6 }}>
          <Text variant="small" style={{ color: color.ink }}>
            •
          </Text>
          <Text variant="small" style={{ flex: 1, color: color.ink }}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

function CalmChip({ risk }: { risk: EnvironmentRisk }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={[styles.calmChip, open && { width: '100%', alignItems: 'flex-start' }]}>
      <Text variant="small" style={{ color: color.ink }}>
        {risk.title}
      </Text>
      {open && (
        <Text variant="small" style={{ marginTop: 2 }}>
          {risk.why.slice(0, 2).join(' · ')}
        </Text>
      )}
    </Pressable>
  );
}

function FactorRow({ factor, onAction }: { factor: HealthFactor; onAction: () => void }) {
  const status = STATUS[factor.status];
  const via = factor.source && factor.source !== 'demo' ? factor.sources.find((s) => s.id === factor.source)?.label : null;
  const connectLabel = factor.connect_with ? factor.sources.find((s) => s.id === factor.connect_with)?.label : null;
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: status.dot, marginTop: 6 }]} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="bodyStrong" style={{ fontSize: 13.5 }}>
          {factor.label}
        </Text>
        <Text variant="small" numberOfLines={2}>
          {factor.affects}
        </Text>
        {factor.note && (
          <Text variant="small" style={{ color: color.inkSoft }}>
            {factor.note}
          </Text>
        )}
      </View>
      <View style={{ alignItems: 'flex-end', maxWidth: '48%', gap: 3 }}>
        {factor.value ? (
          <>
            <Text variant="bodyStrong" style={{ fontSize: 13, textAlign: 'right' }} numberOfLines={2}>
              {factor.value}
            </Text>
            {factor.source === 'demo' ? (
              <Badge label="Sample data" tone="watch" />
            ) : via ? (
              <Text variant="small">via {via}</Text>
            ) : null}
          </>
        ) : factor.status === 'connect' && connectLabel ? (
          <Pressable onPress={onAction} style={[styles.actionPill, { backgroundColor: pastel.peach }]}>
            <RNText style={styles.actionText}>Connect {connectLabel}</RNText>
          </Pressable>
        ) : factor.status === 'on_phone' ? (
          <Pressable onPress={() => void Linking.openURL(APK_URL)} style={[styles.actionPill, { backgroundColor: pastel.lilac }]}>
            <RNText style={styles.actionText}>Android app</RNText>
          </Pressable>
        ) : factor.status === 'waiting' ? (
          <Text variant="small">Waiting for data</Text>
        ) : factor.status === 'manual' ? (
          <Pressable onPress={onAction} style={[styles.actionPill, { backgroundColor: '#ECECE8' }]}>
            <RNText style={styles.actionText}>Tell us</RNText>
          </Pressable>
        ) : (
          <Text variant="small">Not tracked</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coverage: { flexDirection: 'row', borderRadius: 6, overflow: 'hidden', gap: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendCount: { fontFamily: font.bold, color: color.ink, fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  connectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  connectChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, backgroundColor: pastel.peach, gap: 1 },
  riskGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start' },
  riskCard: { borderRadius: radius.xl, padding: 16, gap: 10 },
  riskArt: { width: 88, height: 88 },
  riskIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' },
  levelPill: { paddingHorizontal: 10, height: 24, borderRadius: 12, justifyContent: 'center' },
  levelText: { fontFamily: font.bold, fontSize: 11.5 },
  kindPill: { paddingHorizontal: 10, height: 24, borderRadius: 12, justifyContent: 'center', backgroundColor: 'rgba(17,17,17,0.07)' },
  kindText: { fontFamily: font.semibold, fontSize: 11.5, color: color.inkSoft },
  expand: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  riskBody: { gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.65)' },
  calmRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  calmChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: pastel.mint },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: color.line },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start' },
  catCard: { gap: 4 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: color.line, alignItems: 'flex-start' },
  actionPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  actionText: { fontFamily: font.semibold, fontSize: 12, color: color.ink },
});
