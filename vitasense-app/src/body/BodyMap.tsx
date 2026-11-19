import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import { SYSTEMS, type SystemKey } from '@/lib/systems';
import { color, font, tone as toneMap, toneForScore } from '@/theme/tokens';

import { BODY_ART, BODY_ASPECT, SYSTEM_LOOK } from './art';

type Scores = Partial<Record<SystemKey, number | null>>;

/**
 * The porcelain body with the selected system glowing, tappable hotspots on each organ and a
 * callout chip. Animations: the body fades in, the selected organ breathes, its hotspot ripples,
 * and zoom eases toward the selected organ. All loops stop when the OS asks for reduced motion.
 */
export function BodyMap({
  height,
  selected,
  onSelect,
  scores = {},
  zoom = 1,
  callout = true,
}: {
  height: number;
  selected: SystemKey;
  onSelect?: (key: SystemKey) => void;
  scores?: Scores;
  zoom?: number;
  callout?: boolean;
}) {
  const width = Math.round(height * BODY_ASPECT);
  const look = SYSTEM_LOOK[selected];
  const reduce = useReducedMotion();
  const [uid] = useState(() => Math.random().toString(36).slice(2, 8));

  const breath = useSharedValue(0);
  const ripple = useSharedValue(0);
  const scale = useSharedValue(zoom);

  useEffect(() => {
    if (reduce) return;
    breath.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true);
    ripple.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.cubic) }), -1, false);
    return () => {
      cancelAnimation(breath);
      cancelAnimation(ripple);
    };
  }, [breath, ripple, reduce]);

  useEffect(() => {
    scale.value = withTiming(zoom, { duration: 450, easing: Easing.out(Easing.cubic) });
  }, [scale, zoom]);

  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.72 + breath.value * 0.28,
    transform: [{ scale: 0.96 + breath.value * 0.08 }],
  }));
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - ripple.value),
    transform: [{ scale: 1 + ripple.value * 1.6 }],
  }));

  const g = look.glow;
  const glowBox = { w: g.rx * 2 * width * 1.25, h: g.ry * 2 * width * 1.25 };
  const anchor = look.spot ?? { x: g.x, y: g.y };
  const score = scores[selected] ?? null;
  const def = SYSTEMS.find((s) => s.key === selected)!;

  return (
    <View style={{ width, height }}>
      <Animated.View
        entering={FadeIn.duration(700)}
        style={[{ width, height, transformOrigin: `${g.x * 100}% ${g.y * 100}%` }, zoomStyle]}>
        {/* Soft floor shadow under the feet. */}
        <Svg width={width * 1.1} height={height * 0.06} style={{ position: 'absolute', left: -width * 0.05, top: height * 0.955 }}>
          <Defs>
            <RadialGradient id={`floor-${uid}`} cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#3B3226" stopOpacity="0.22" />
              <Stop offset="1" stopColor="#3B3226" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Ellipse cx={width * 0.55} cy={height * 0.03} rx={width * 0.42} ry={height * 0.022} fill={`url(#floor-${uid})`} />
        </Svg>

        <Image source={BODY_ART} style={{ width, height }} contentFit="contain" accessibilityIgnoresInvertColors />

        {/* Organ glow, tinted with the system's accent and breathing slowly. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            { left: g.x * width - glowBox.w / 2, top: g.y * height - glowBox.h / 2, width: glowBox.w, height: glowBox.h },
            glowStyle,
          ]}>
          <Svg width={glowBox.w} height={glowBox.h}>
            <Defs>
              <RadialGradient id={`glow-${uid}`} cx="0.5" cy="0.5" r="0.5">
                <Stop offset="0" stopColor={look.accent} stopOpacity="0.62" />
                <Stop offset="0.5" stopColor={look.accent} stopOpacity="0.3" />
                <Stop offset="1" stopColor={look.accent} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Ellipse cx={glowBox.w / 2} cy={glowBox.h / 2} rx={glowBox.w / 2} ry={glowBox.h / 2} fill={`url(#glow-${uid})`} />
          </Svg>
        </Animated.View>

        {/* Hotspots. */}
        {SYSTEMS.map((s) => {
          const spot = SYSTEM_LOOK[s.key].spot;
          if (!spot) return null;
          const active = s.key === selected;
          const sc = scores[s.key] ?? null;
          const dot = sc === null ? color.inkFaint : toneMap[toneForScore(sc)].fg;
          return (
            <Pressable
              key={s.key}
              accessibilityRole="button"
              accessibilityLabel={`${s.label}${sc === null ? '' : `, score ${sc}`}`}
              accessibilityState={{ selected: active }}
              hitSlop={10}
              onPress={() => onSelect?.(s.key)}
              style={[styles.spot, { left: spot.x * width - 13, top: spot.y * height - 13 }]}>
              {active && <Animated.View pointerEvents="none" style={[styles.ripple, { borderColor: SYSTEM_LOOK[s.key].accent }, rippleStyle]} />}
              <View style={[styles.spotRing, active && { backgroundColor: '#FFFFFF', transform: [{ scale: 1.12 }] }]}>
                <View style={[styles.spotDot, { backgroundColor: active ? SYSTEM_LOOK[s.key].accent : dot }]} />
              </View>
            </Pressable>
          );
        })}
      </Animated.View>

      {/* Callout: a thin leader line from the organ to a floating chip. Re-mounts (and fades in) per system. */}
      {callout && (
        <Animated.View
          key={selected}
          entering={FadeIn.duration(350)}
          pointerEvents="none"
          style={[styles.callout, { left: anchor.x * width + 14, top: anchor.y * height - 17 }]}>
          <View style={[styles.leader, { width: Math.max(10, width * 0.84 - anchor.x * width), backgroundColor: look.accent }]} />
          <View style={styles.chip}>
            <View style={[styles.chipDot, { backgroundColor: look.accent }]} />
            <RNText style={styles.chipLabel} numberOfLines={1}>
              {def.short}
            </RNText>
            {score !== null && <RNText style={styles.chipScore}>{score}</RNText>}
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', mixBlendMode: 'multiply' },
  spot: { position: 'absolute', width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  ripple: { position: 'absolute', width: 26, height: 26, borderRadius: 13, borderWidth: 2 },
  spotRing: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 2px 8px rgba(17,17,17,0.18)',
  },
  spotDot: { width: 8, height: 8, borderRadius: 4 },
  callout: { position: 'absolute', flexDirection: 'row', alignItems: 'center' },
  leader: { height: 1.5, borderRadius: 1, opacity: 0.7 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 34,
    paddingLeft: 10,
    paddingRight: 12,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    boxShadow: '0px 6px 20px rgba(17,17,17,0.12)',
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipLabel: { fontFamily: font.semibold, fontSize: 13, color: color.ink },
  chipScore: { fontFamily: font.bold, fontSize: 13, color: color.ink, opacity: 0.55 },
});
