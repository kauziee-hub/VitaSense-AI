import type { ImageSource } from 'expo-image';

import type { SystemKey } from '@/lib/systems';
import { pastel } from '@/theme/tokens';

/**
 * Porcelain 3D art (generated with Higgsfield, processed by scripts/build-art.py) and where each
 * body system lives on the body render. Coordinates are fractions of the render's width and height.
 */

export const BODY_ART: ImageSource = require('../../assets/art/body.webp');
/** width / height of assets/art/body.webp */
export const BODY_ASPECT = 408 / 1006;

export type ArtKey = 'heart' | 'lungs' | 'brain' | 'gut' | 'kidneys' | 'immune' | 'sleep';

export const ORGAN_ART: Record<ArtKey, ImageSource> = {
  heart: require('../../assets/art/heart.webp'),
  lungs: require('../../assets/art/lungs.webp'),
  brain: require('../../assets/art/brain.webp'),
  gut: require('../../assets/art/gut.webp'),
  kidneys: require('../../assets/art/kidneys.webp'),
  immune: require('../../assets/art/immune.webp'),
  sleep: require('../../assets/art/sleep.webp'),
};

export interface SystemLook {
  art: ArtKey;
  /** Card fill. */
  fill: string;
  /** Stronger tint for glows, rings and chart accents. */
  accent: string;
  /** Tap target on the body; null when the system has no single place (shown in lists only). */
  spot: { x: number; y: number } | null;
  /** Glow drawn over the organ when the system is selected (centre and radii, fractions of width). */
  glow: { x: number; y: number; rx: number; ry: number };
}

export const SYSTEM_LOOK: Record<SystemKey, SystemLook> = {
  heart: { art: 'heart', fill: pastel.peach, accent: '#EF7B5C', spot: { x: 0.54, y: 0.262 }, glow: { x: 0.535, y: 0.262, rx: 0.13, ry: 0.12 } },
  lungs: { art: 'lungs', fill: pastel.aqua, accent: '#4FB6A2', spot: { x: 0.385, y: 0.245 }, glow: { x: 0.5, y: 0.25, rx: 0.27, ry: 0.2 } },
  gut: { art: 'gut', fill: pastel.butter, accent: '#D9A92A', spot: { x: 0.5, y: 0.415 }, glow: { x: 0.5, y: 0.385, rx: 0.22, ry: 0.24 } },
  mind: { art: 'brain', fill: pastel.rose, accent: '#DD7EA3', spot: { x: 0.5, y: 0.04 }, glow: { x: 0.5, y: 0.045, rx: 0.2, ry: 0.13 } },
  immune: { art: 'immune', fill: pastel.mint, accent: '#5DB570', spot: { x: 0.5, y: 0.155 }, glow: { x: 0.5, y: 0.165, rx: 0.14, ry: 0.1 } },
  sleep: { art: 'sleep', fill: pastel.lilac, accent: '#8E80E0', spot: null, glow: { x: 0.5, y: 0.07, rx: 0.22, ry: 0.2 } },
  hydration: { art: 'kidneys', fill: pastel.sky, accent: '#4AA3C4', spot: { x: 0.625, y: 0.372 }, glow: { x: 0.5, y: 0.374, rx: 0.24, ry: 0.09 } },
};
