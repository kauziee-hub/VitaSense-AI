import type { ImageSource } from 'expo-image';

import type { SystemKey } from '@/lib/systems';
import { pastel } from '@/theme/tokens';

/**
 * Porcelain 3D art (generated with Higgsfield, processed by scripts/build-art.py) and where each
 * body system lives on the body renders. Coordinates are fractions of the render's width and height.
 */

export type BodySex = 'male' | 'female';

export type ArtKey = 'heart' | 'lungs' | 'brain' | 'gut' | 'kidneys' | 'immune' | 'sleep' | 'mosquito' | 'band';

export const ORGAN_ART: Record<ArtKey, ImageSource> = {
  heart: require('../../assets/art/heart.webp'),
  lungs: require('../../assets/art/lungs.webp'),
  brain: require('../../assets/art/brain.webp'),
  gut: require('../../assets/art/gut.webp'),
  kidneys: require('../../assets/art/kidneys.webp'),
  immune: require('../../assets/art/immune.webp'),
  sleep: require('../../assets/art/sleep.webp'),
  mosquito: require('../../assets/art/mosquito.webp'),
  band: require('../../assets/art/band.webp'),
};

type Point = { x: number; y: number };
type Glow = { x: number; y: number; rx: number; ry: number };

export interface SystemPlacement {
  /** Tap target on the body; null when the system has no single place (shown in lists only). */
  spot: Point | null;
  /** Glow drawn over the organ when the system is selected (centre and radii, fractions of width). */
  glow: Glow;
}

export interface BodyArt {
  source: ImageSource;
  /** width / height of the render */
  aspect: number;
  place: Record<SystemKey, SystemPlacement>;
}

/** Measured on each render with a 5% grid (scripts/build-art.py output). */
export const BODY: Record<BodySex, BodyArt> = {
  female: {
    source: require('../../assets/art/body-female.webp'),
    aspect: 408 / 1006,
    place: {
      heart: { spot: { x: 0.54, y: 0.262 }, glow: { x: 0.535, y: 0.262, rx: 0.13, ry: 0.12 } },
      lungs: { spot: { x: 0.385, y: 0.245 }, glow: { x: 0.5, y: 0.25, rx: 0.27, ry: 0.2 } },
      gut: { spot: { x: 0.5, y: 0.415 }, glow: { x: 0.5, y: 0.385, rx: 0.22, ry: 0.24 } },
      mind: { spot: { x: 0.5, y: 0.04 }, glow: { x: 0.5, y: 0.045, rx: 0.2, ry: 0.13 } },
      immune: { spot: { x: 0.5, y: 0.155 }, glow: { x: 0.5, y: 0.165, rx: 0.14, ry: 0.1 } },
      sleep: { spot: null, glow: { x: 0.5, y: 0.07, rx: 0.22, ry: 0.2 } },
      hydration: { spot: { x: 0.625, y: 0.372 }, glow: { x: 0.5, y: 0.374, rx: 0.24, ry: 0.09 } },
    },
  },
  male: {
    source: require('../../assets/art/body-male.webp'),
    aspect: 423 / 1008,
    place: {
      heart: { spot: { x: 0.555, y: 0.265 }, glow: { x: 0.553, y: 0.265, rx: 0.12, ry: 0.11 } },
      lungs: { spot: { x: 0.4, y: 0.245 }, glow: { x: 0.5, y: 0.255, rx: 0.26, ry: 0.2 } },
      gut: { spot: { x: 0.5, y: 0.425 }, glow: { x: 0.5, y: 0.392, rx: 0.21, ry: 0.24 } },
      mind: { spot: { x: 0.5, y: 0.04 }, glow: { x: 0.5, y: 0.045, rx: 0.2, ry: 0.13 } },
      immune: { spot: { x: 0.5, y: 0.155 }, glow: { x: 0.5, y: 0.165, rx: 0.14, ry: 0.1 } },
      sleep: { spot: null, glow: { x: 0.5, y: 0.07, rx: 0.22, ry: 0.2 } },
      hydration: { spot: { x: 0.625, y: 0.375 }, glow: { x: 0.5, y: 0.376, rx: 0.23, ry: 0.09 } },
    },
  },
};

export interface SystemLook {
  art: ArtKey;
  /** Card fill. */
  fill: string;
  /** Stronger tint for glows, rings and chart accents. */
  accent: string;
}

export const SYSTEM_LOOK: Record<SystemKey, SystemLook> = {
  heart: { art: 'heart', fill: pastel.peach, accent: '#EF7B5C' },
  lungs: { art: 'lungs', fill: pastel.aqua, accent: '#4FB6A2' },
  gut: { art: 'gut', fill: pastel.butter, accent: '#D9A92A' },
  mind: { art: 'brain', fill: pastel.rose, accent: '#DD7EA3' },
  immune: { art: 'immune', fill: pastel.mint, accent: '#5DB570' },
  sleep: { art: 'sleep', fill: pastel.lilac, accent: '#8E80E0' },
  hydration: { art: 'kidneys', fill: pastel.sky, accent: '#4AA3C4' },
};
