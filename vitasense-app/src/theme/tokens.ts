/**
 * VitaSense design tokens. One source of truth for colour, type, radius and depth,
 * shared by Android, iOS and web.
 *
 * Look: warm off-white canvas, white cards with big radii, near-black type and primary
 * actions, and soft pastel feature cards (sky, mint, butter, peach) carrying porcelain
 * 3D organ art. Older token names are kept so every screen picks up the new look.
 */

export const pastel = {
  sky: '#C4E5EF',
  skyDeep: '#8FCADC',
  mint: '#D2ECC6',
  mintDeep: '#9ED48A',
  butter: '#F6E48A',
  butterDeep: '#E9CB45',
  peach: '#F7C7B2',
  peachDeep: '#EE9C7C',
  lilac: '#DDD8F6',
  lilacDeep: '#B4AAEB',
  rose: '#F5D5E1',
  roseDeep: '#E99BB8',
  aqua: '#CDEAE3',
  aquaDeep: '#86CDBE',
} as const;

export const color = {
  // Canvas and surfaces
  backdrop: '#E7E2DF', // around the app frame on wide web
  backdropGlow: '#F4EFEC',
  canvas: '#F2F2EF',
  canvasDeep: '#E9E9E5',
  surface: '#FFFFFF',
  surfaceSoft: '#F7F7F5',
  surfaceSunken: '#EFEFEB',
  glass: 'rgba(255,255,255,0.82)',
  glassDark: 'rgba(17,17,17,0.86)',

  // Ink
  ink: '#111111',
  inkSoft: '#55575C',
  inkMuted: '#8E9096',
  inkFaint: '#BDBFC4',
  line: '#ECECE8',
  lineStrong: '#DEDED9',

  // Brand: black primary, pastel accents
  navy: '#111111',
  navyDeep: '#000000',
  navySoft: '#EAEAE6',
  sky: pastel.sky,
  skySoft: '#E6F4F8',
  mint: '#4FAF73',
  mintSoft: pastel.mint,
  mintBright: '#9FE3C1',
  brand: '#111111',

  // Status (readable ink on pastel fills)
  good: '#2F8A52',
  goodSoft: pastel.mint,
  watch: '#A97A06',
  watchSoft: '#F8EDB8',
  risk: '#D25A3E',
  riskSoft: '#F9D9CC',
  info: '#2A7D99',
  infoSoft: '#D6EEF5',

  // Body visual
  bodyGlass: '#E4ECF4',
  bodyEdge: '#B9C6D6',
  organWarm: '#F2785A',
  organHot: '#E2553B',
  vessel: '#E3655B',
  vein: '#6F8FC9',
} as const;

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  display: 'Inter_600SemiBold',
  displayHeavy: 'Inter_700Bold',
} as const;

export const radius = {
  xs: 10,
  sm: 14,
  md: 20,
  lg: 26,
  xl: 30,
  frame: 40,
  pill: 999,
} as const;

export const space = {
  xxs: 4,
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const shadow = {
  card: '0px 1px 2px rgba(17, 17, 17, 0.03), 0px 10px 30px rgba(17, 17, 17, 0.05)',
  raised: '0px 2px 8px rgba(17, 17, 17, 0.06), 0px 20px 44px rgba(17, 17, 17, 0.10)',
  frame: '0px 40px 100px rgba(60, 40, 30, 0.18)',
  glow: '0px 0px 24px rgba(242, 120, 90, 0.55)',
} as const;

/** Layout breakpoints (logical px). */
export const breakpoint = {
  wide: 1100, // multi-column desktop dashboard
  framed: 1320, // app floats in a frame on a soft backdrop
} as const;

export type Tone = 'good' | 'watch' | 'risk' | 'info' | 'neutral';

export const tone: Record<Tone, { fg: string; bg: string }> = {
  good: { fg: color.good, bg: color.goodSoft },
  watch: { fg: color.watch, bg: color.watchSoft },
  risk: { fg: color.risk, bg: color.riskSoft },
  info: { fg: color.info, bg: color.infoSoft },
  neutral: { fg: color.inkSoft, bg: color.surfaceSunken },
};

/** Pastel card fill per tone, for feature cards. */
export const toneCard: Record<Tone, string> = {
  good: pastel.mint,
  watch: pastel.butter,
  risk: pastel.peach,
  info: pastel.sky,
  neutral: color.surfaceSunken,
};

export function toneForScore(score: number): Tone {
  if (score >= 70) return 'good';
  if (score >= 45) return 'watch';
  return 'risk';
}

export function toneForProbability(probability: number): Tone {
  if (probability >= 65) return 'risk';
  if (probability >= 40) return 'watch';
  return 'good';
}
