import { Image } from 'expo-image';
import { ScrollView, StyleSheet, View, Pressable, Text as RNText } from 'react-native';
import Animated, { FadeInDown, FadeInRight } from 'react-native-reanimated';

import { ORGAN_ART, SYSTEM_LOOK, type ArtKey } from '@/body/art';
import type { Forecast } from '@/lib/api';
import { SYSTEMS, type SystemKey, type SystemView } from '@/lib/systems';
import { color, font, radius, tone as toneMap, toneForProbability, toneForScore, type Tone } from '@/theme/tokens';
import { ProgressLine, Text, type PressState } from '@/ui/primitives';

export function statusWord(score: number | null): string {
  if (score === null) return 'Learning';
  if (score >= 70) return 'Steady';
  if (score >= 45) return 'Needs care';
  return 'Under strain';
}

function scoreTone(score: number | null): Tone {
  return score === null ? 'neutral' : toneForScore(score);
}

/** Porcelain organ render on a soft pastel disc. */
export function OrganArt({ art, size, fill, disc = true }: { art: ArtKey; size: number; fill?: string; disc?: boolean }) {
  return (
    <View
      style={[
        { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
        disc && { borderRadius: size / 2, backgroundColor: fill ?? color.surfaceSunken },
      ]}>
      <Image source={ORGAN_ART[art]} style={{ width: size * (disc ? 0.74 : 1), height: size * (disc ? 0.74 : 1) }} contentFit="contain" />
    </View>
  );
}

export function systemScores(forecast: Forecast | null): Partial<Record<SystemKey, number | null>> {
  const out: Partial<Record<SystemKey, number | null>> = {};
  for (const s of SYSTEMS) out[s.key] = forecast ? s.score(forecast) : null;
  return out;
}

/* ---------- Desktop: list of systems ---------- */

export function SystemList({
  forecast,
  selected,
  onSelect,
}: {
  forecast: Forecast | null;
  selected: SystemKey;
  onSelect: (k: SystemKey) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      {SYSTEMS.map((s, i) => {
        const look = SYSTEM_LOOK[s.key];
        const active = s.key === selected;
        const score = forecast ? s.score(forecast) : null;
        const t = scoreTone(score);
        return (
          <Animated.View key={s.key} entering={FadeInRight.delay(60 * i).duration(380)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${s.label}, ${statusWord(score)}`}
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(s.key)}
              style={({ hovered, pressed }: PressState) => [
                styles.row,
                active && { backgroundColor: look.fill, boxShadow: 'none' },
                hovered && !active && { backgroundColor: color.surfaceSoft },
                pressed && { transform: [{ scale: 0.985 }] },
              ]}>
              <OrganArt art={look.art} size={46} fill={active ? 'rgba(255,255,255,0.65)' : look.fill} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {s.short === 'Water' ? 'Hydration' : s.short}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={[styles.dot, { backgroundColor: toneMap[t].fg }]} />
                  <Text variant="small" style={{ color: active ? color.inkSoft : color.inkMuted }}>
                    {statusWord(score)}
                  </Text>
                </View>
              </View>
              <RNText style={styles.rowScore}>{score ?? '–'}</RNText>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

/* ---------- Phone: swipeable system tiles ---------- */

export function SystemCarousel({
  forecast,
  selected,
  onSelect,
}: {
  forecast: Forecast | null;
  selected: SystemKey;
  onSelect: (k: SystemKey) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }}>
      {SYSTEMS.map((s) => {
        const look = SYSTEM_LOOK[s.key];
        const active = s.key === selected;
        const score = forecast ? s.score(forecast) : null;
        return (
          <Pressable
            key={s.key}
            accessibilityRole="button"
            accessibilityLabel={`${s.label}, ${statusWord(score)}`}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(s.key)}
            style={({ pressed }) => [
              styles.tile,
              { backgroundColor: active ? look.fill : color.surface },
              active && { borderColor: color.ink },
              pressed && { transform: [{ scale: 0.97 }] },
            ]}>
            <OrganArt art={look.art} size={52} fill={active ? 'rgba(255,255,255,0.6)' : look.fill} />
            <RNText style={styles.tileLabel} numberOfLines={1}>
              {s.short === 'Water' ? 'Hydration' : s.short}
            </RNText>
            <RNText style={styles.tileScore}>{score ?? '–'}</RNText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ---------- Selected system hero ---------- */

export function SystemHero({ view, compact = false }: { view: SystemView; compact?: boolean }) {
  const look = SYSTEM_LOOK[view.def.key];
  const t = scoreTone(view.score);
  const riskTone = view.risk ? toneForProbability(view.risk.probability) : 'good';
  const artSize = compact ? 108 : 168;
  return (
    <Animated.View key={view.def.key} entering={FadeInDown.duration(420)} style={[styles.hero, { backgroundColor: look.fill }]}>
      <View style={{ flex: 1, gap: 10, minWidth: 0 }}>
        <Text variant="label" style={{ color: color.inkSoft }}>
          BODY SYSTEM
        </Text>
        <Text variant="title" style={{ fontSize: compact ? 22 : 26, lineHeight: compact ? 28 : 32 }}>
          {view.def.label}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
          <RNText style={[styles.heroScore, compact && { fontSize: 44, lineHeight: 46 }]}>{view.score ?? '–'}</RNText>
          <RNText style={styles.heroOutOf}>/100</RNText>
          <View style={[styles.heroStatus, { backgroundColor: 'rgba(255,255,255,0.7)' }]}>
            <View style={[styles.dot, { backgroundColor: toneMap[t].fg }]} />
            <RNText style={styles.heroStatusLabel}>{statusWord(view.score)}</RNText>
          </View>
        </View>
        <View style={{ gap: 6, maxWidth: 320 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="small" style={{ color: color.inkSoft }}>
              Risk, next {view.risk?.horizon ?? '72h'}
            </Text>
            <Text variant="small" style={{ color: color.ink, fontFamily: font.semibold }}>
              {view.risk ? `${view.risk.probability}%` : 'Low'}
            </Text>
          </View>
          <ProgressLine value={view.risk?.probability ?? 6} tone={riskTone} track="rgba(255,255,255,0.65)" />
          {view.risk && (
            <Text variant="small" numberOfLines={2} style={{ color: color.inkSoft }}>
              {view.risk.title}
            </Text>
          )}
        </View>
      </View>
      <View style={{ width: artSize, height: artSize, alignItems: 'center', justifyContent: 'center' }}>
        <View style={[styles.heroHalo, { width: artSize * 0.92, height: artSize * 0.92, borderRadius: artSize }]} />
        <OrganArt art={look.art} size={artSize} disc={false} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    paddingRight: 16,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    boxShadow: '0px 1px 2px rgba(17,17,17,0.03)',
  },
  rowScore: { fontFamily: font.bold, fontSize: 18, color: color.ink, letterSpacing: -0.4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  tile: {
    width: 104,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: 'transparent',
    boxShadow: '0px 1px 2px rgba(17,17,17,0.04)',
  },
  tileLabel: { fontFamily: font.semibold, fontSize: 13, color: color.ink },
  tileScore: { fontFamily: font.bold, fontSize: 16, color: color.ink, letterSpacing: -0.3, marginTop: -2 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 22,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  heroScore: { fontFamily: font.bold, fontSize: 56, lineHeight: 58, letterSpacing: -2, color: color.ink },
  heroOutOf: { fontFamily: font.medium, fontSize: 15, color: color.inkSoft, marginBottom: 8 },
  heroStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    marginLeft: 6,
    marginBottom: 8,
  },
  heroStatusLabel: { fontFamily: font.semibold, fontSize: 12, color: color.ink },
  heroHalo: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.55)' },
});
