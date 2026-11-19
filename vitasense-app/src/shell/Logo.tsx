import { Text as RNText, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { color, font } from '@/theme/tokens';

/**
 * The VitaSense mark: two leaves, sky and mint, that meet in a "V" (vitality, growth), with a white
 * "sense" dot above them, on a near-black tile. Same geometry as the app icons
 * (scripts/generate-icons.py), on a 64-unit grid.
 */
export const LEAF_LEFT = 'M12.5 20.5 C12 34 21 44.5 32 49.5 C32.5 36 24 24.5 12.5 20.5 Z';
export const LEAF_RIGHT = 'M51.5 20.5 C52 34 43 44.5 32 49.5 C31.5 36 40 24.5 51.5 20.5 Z';
export const MARK = { sky: '#B7DFEC', mint: '#C9EBC6', tile: '#111111' } as const;

export function LogoMark({ size = 34, tile = true, mono }: { size?: number; tile?: boolean; mono?: string }) {
  const left = mono ?? MARK.sky;
  const right = mono ?? MARK.mint;
  const dot = mono ?? (tile ? '#FFFFFF' : color.ink);
  // Without the tile the glyph is cropped to its own bounds so it sits on text baselines nicely.
  return (
    <Svg width={size} height={size} viewBox={tile ? '0 0 64 64' : '10 15 44 37'}>
      {tile && <Rect width="64" height="64" rx="18" fill={MARK.tile} />}
      <Path d={LEAF_LEFT} fill={left} stroke={left} strokeWidth={1.1} strokeLinejoin="round" />
      <Path d={LEAF_RIGHT} fill={right} stroke={right} strokeWidth={1.1} strokeLinejoin="round" />
      <Circle cx="32" cy="22" r="4.6" fill={dot} />
    </Svg>
  );
}

/** Mark + wordmark. Ink on light backgrounds, white on dark ones. */
export function Logo({ size = 34, light = false }: { size?: number; light?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.28 }} accessibilityRole="header" accessibilityLabel="VitaSense">
      <LogoMark size={size} />
      {/* Plain RN Text: the design-system Text would give the nested span the body font size. */}
      <RNText style={{ fontFamily: font.bold, fontSize: size * 0.58, letterSpacing: -0.6, color: light ? '#FFFFFF' : color.ink }}>
        Vita
        <RNText style={{ fontFamily: font.medium, color: light ? 'rgba(255,255,255,0.72)' : color.inkSoft }}>Sense</RNText>
      </RNText>
    </View>
  );
}
