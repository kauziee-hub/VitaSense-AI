import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  Platform,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text as RNText,
  type TextProps,
  type TextStyle,
  View,
  type ViewProps,
  type ViewStyle,
  type StyleProp,
} from 'react-native';

import { color, font, radius, shadow, space, tone as toneMap, type Tone } from '@/theme/tokens';

/** Pressable state; `hovered` is supplied on web. */
export type PressState = { pressed: boolean; hovered?: boolean };

/* ---------- Typography ---------- */

type TextVariant = 'hero' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'small' | 'label' | 'metric' | 'metricSm';

const textVariants: Record<TextVariant, TextStyle> = {
  hero: { fontFamily: font.displayHeavy, fontSize: 34, lineHeight: 40, letterSpacing: -1.1, color: color.ink },
  title: { fontFamily: font.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.5, color: color.ink },
  heading: { fontFamily: font.semibold, fontSize: 15, lineHeight: 20, color: color.ink },
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: color.inkSoft },
  bodyStrong: { fontFamily: font.medium, fontSize: 14, lineHeight: 20, color: color.ink },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 16, color: color.inkMuted },
  label: { fontFamily: font.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 0.8, color: color.inkMuted },
  metric: { fontFamily: font.bold, fontSize: 36, lineHeight: 40, letterSpacing: -1.2, color: color.ink },
  metricSm: { fontFamily: font.bold, fontSize: 22, lineHeight: 26, letterSpacing: -0.6, color: color.ink },
};

export function Text({ variant = 'body', style, ...props }: TextProps & { variant?: TextVariant }) {
  return <RNText {...props} style={[textVariants[variant], style]} />;
}

/* ---------- Surfaces ---------- */

export function Card({
  children,
  style,
  padded = true,
  ...props
}: ViewProps & { padded?: boolean }) {
  return (
    <View {...props} style={[styles.card, padded && styles.cardPadded, style]}>
      {children}
    </View>
  );
}

/** Frosted panel: real blur on iOS and web, translucent fill on Android. */
export function Glass({
  children,
  style,
  dark = false,
  intensity = 40,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  dark?: boolean;
  intensity?: number;
}) {
  const fill = dark ? color.glassDark : color.glass;
  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={intensity} tint={dark ? 'dark' : 'light'} style={[styles.glass, style]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: dark ? 'rgba(17,17,17,0.5)' : 'rgba(255,255,255,0.4)' }]} />
        {children}
      </BlurView>
    );
  }
  const webBlur = Platform.OS === 'web' ? ({ backdropFilter: `blur(${Math.round(intensity / 2)}px) saturate(140%)` } as ViewStyle) : null;
  return <View style={[styles.glass, { backgroundColor: fill }, webBlur, style]}>{children}</View>;
}

/* ---------- Controls ---------- */

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'soft';

export function Button({
  label,
  kind = 'primary',
  icon,
  style,
  compact = false,
  ...props
}: PressableProps & { label: string; kind?: ButtonKind; icon?: ReactNode; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  const palette = {
    primary: { bg: color.ink, fg: '#FFFFFF', border: color.ink },
    secondary: { bg: color.surface, fg: color.ink, border: color.lineStrong },
    ghost: { bg: 'transparent', fg: color.inkSoft, border: 'transparent' },
    soft: { bg: color.surfaceSunken, fg: color.ink, border: color.surfaceSunken },
  }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      {...props}
      style={({ pressed, hovered }: PressState) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: palette.bg, borderColor: palette.border },
        hovered && kind === 'primary' && { backgroundColor: '#2A2A2A' },
        hovered && (kind === 'secondary' || kind === 'soft') && { backgroundColor: color.canvasDeep },
        hovered && kind === 'ghost' && { backgroundColor: color.surfaceSunken },
        pressed && { transform: [{ scale: 0.97 }] },
        props.disabled && { opacity: 0.45 },
        style,
      ]}>
      {icon}
      <RNText style={[styles.buttonLabel, compact && { fontSize: 13 }, { color: palette.fg }]}>{label}</RNText>
    </Pressable>
  );
}

export function IconButton({
  children,
  onPress,
  label,
  active = false,
  size = 40,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  label: string;
  active?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed, hovered }: PressState) => [
        styles.iconButton,
        { width: size, height: size, borderRadius: size / 2 },
        active ? { backgroundColor: color.ink, borderColor: color.ink } : null,
        hovered && !active && { backgroundColor: color.surfaceSunken },
        pressed && { transform: [{ scale: 0.95 }] },
        style,
      ]}>
      {children}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && { backgroundColor: color.ink, borderColor: color.ink },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}>
      {icon}
      <RNText style={[styles.chipLabel, selected && { color: '#FFFFFF' }]}>{label}</RNText>
    </Pressable>
  );
}

export function Badge({ label, tone = 'neutral', dot = false }: { label: string; tone?: Tone; dot?: boolean }) {
  const t = toneMap[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {dot && <View style={[styles.badgeDot, { backgroundColor: t.fg }]} />}
      <RNText style={[styles.badgeLabel, { color: t.fg }]}>{label}</RNText>
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}>
            <RNText style={[styles.segmentLabel, active && { color: color.ink }]}>{option.label}</RNText>
            {option.count !== undefined && (
              <View style={[styles.segmentCount, active && { backgroundColor: color.ink }]}>
                <RNText style={[styles.segmentCountLabel, active && { color: '#FFFFFF' }]}>{option.count}</RNText>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------- Data display ---------- */

/**
 * Gradient range bar with a marker, as used for lab and lifestyle markers.
 * `zones` run left→right; the optimal band is drawn greener.
 */
export function RangeBar({
  value,
  min,
  max,
  optimal,
  invert = false,
}: {
  value: number | null;
  min: number;
  max: number;
  optimal: [number, number];
  invert?: boolean; // true when lower is better (e.g. AQI)
}) {
  const span = max - min || 1;
  const clamp = (n: number) => Math.min(1, Math.max(0, (n - min) / span));
  const lo = clamp(optimal[0]);
  const hi = clamp(optimal[1]);
  const pos = value === null ? null : clamp(value);
  const good = '#8FD08A';
  const watch = '#F1D267';
  const risk = '#F19A7D';
  const colors = invert ? ([good, good, watch, risk] as const) : ([risk, watch, good, good, watch] as const);
  const locations = invert ? ([0, hi, Math.min(1, hi + 0.25), 1] as const) : ([0, Math.max(0, lo - 0.18), lo, hi, 1] as const);
  return (
    <View style={styles.rangeWrap}>
      <LinearGradient colors={colors} locations={locations} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.rangeTrack} />
      {pos !== null && (
        <View style={[styles.rangeMarker, { left: `${pos * 100}%` }]}>
          <View style={styles.rangeMarkerLine} />
        </View>
      )}
      <View style={styles.rangeTicks}>
        <RNText style={styles.rangeTick}>{formatTick(min)}</RNText>
        <RNText style={styles.rangeTick}>{formatTick(max)}</RNText>
      </View>
    </View>
  );
}

function formatTick(n: number) {
  return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
}

export function ProgressLine({ value, tone = 'risk', track }: { value: number; tone?: Tone; track?: string }) {
  return (
    <View style={[styles.progressTrack, track ? { backgroundColor: track } : null]}>
      <View style={[styles.progressFill, { width: `${Math.max(2, Math.min(100, value))}%`, backgroundColor: toneMap[tone].fg }]} />
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: color.line }, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    boxShadow: shadow.card,
  },
  cardPadded: { padding: space.xl },
  glass: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  buttonCompact: { height: 36, paddingHorizontal: space.lg },
  buttonLabel: { fontFamily: font.semibold, fontSize: 14 },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: 'transparent',
    boxShadow: '0px 1px 3px rgba(17,17,17,0.06)',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
  },
  chipLabel: { fontFamily: font.medium, fontSize: 13, color: color.ink },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    height: 24,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeLabel: { fontFamily: font.semibold, fontSize: 11 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: color.surfaceSunken,
    borderRadius: radius.pill,
    padding: 3,
    gap: 2,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: radius.pill,
  },
  segmentActive: { backgroundColor: color.surface, boxShadow: '0px 1px 3px rgba(17,17,17,0.12)' },
  segmentLabel: { fontFamily: font.medium, fontSize: 13, color: color.inkMuted },
  segmentCount: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.lineStrong,
  },
  segmentCountLabel: { fontFamily: font.semibold, fontSize: 10, color: color.inkSoft },
  rangeWrap: { paddingTop: 10 },
  rangeTrack: { height: 8, borderRadius: 4 },
  rangeMarker: { position: 'absolute', top: 4, width: 0, alignItems: 'center' },
  rangeMarkerLine: {
    width: 4,
    height: 20,
    borderRadius: 2,
    backgroundColor: color.ink,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  rangeTicks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  rangeTick: { fontFamily: font.medium, fontSize: 10, color: color.inkMuted },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: color.surfaceSunken, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
});
