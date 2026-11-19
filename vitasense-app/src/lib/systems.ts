import type { LucideIcon } from 'lucide-react-native';
import { Brain, Droplets, HeartPulse, Moon, ShieldPlus, Utensils, Wind } from 'lucide-react-native';

import type { Forecast, Metric, Severity } from './api';

export type SystemKey = 'heart' | 'lungs' | 'gut' | 'mind' | 'immune' | 'sleep' | 'hydration';
export type Organ = 'brain' | 'throat' | 'lungs' | 'heart' | 'liver' | 'stomach' | 'intestines' | 'kidneys' | 'vessels';

export interface MarkerDef {
  metric: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  optimal: [number, number];
  invert?: boolean;
  decimals?: number;
  scale?: number; // multiply raw value (e.g. ml → L)
}

interface SystemDef {
  key: SystemKey;
  label: string;
  short: string;
  icon: LucideIcon;
  organs: Organ[];
  keywords: string[];
  bodySystemKeys: string[];
  specialist: string;
  primary: MarkerDef;
  markers: MarkerDef[];
  score: (f: Forecast) => number | null;
}

const M = {
  hrv: { metric: 'hrv', label: 'HRV', unit: 'ms', min: 10, max: 90, optimal: [45, 90] },
  steps: { metric: 'steps', label: 'Daily steps', unit: '', min: 0, max: 14000, optimal: [7500, 14000] },
  aqi: { metric: 'aqi', label: 'Air quality (AQI)', unit: '', min: 0, max: 300, optimal: [0, 50], invert: true },
  sleep: { metric: 'sleep', label: 'Sleep', unit: 'h', min: 3, max: 11, optimal: [7, 9], decimals: 1 },
  water: { metric: 'hydration', label: 'Water', unit: 'L', min: 0, max: 4, optimal: [2.3, 3.5], decimals: 1, scale: 0.001 },
  screen: { metric: 'screen_time', label: 'Screen time', unit: 'h', min: 0, max: 12, optimal: [0, 4], invert: true, decimals: 1 },
} satisfies Record<string, MarkerDef>;

const engine = (key: string) => (f: Forecast) => f.engine_scores?.[key] ?? null;
const bodySystem = (key: string) => (f: Forecast) => f.body_systems?.find((s) => s.key === key)?.score ?? null;

export const SYSTEMS: SystemDef[] = [
  {
    key: 'heart',
    label: 'Heart & circulation',
    short: 'Heart',
    icon: HeartPulse,
    organs: ['heart', 'vessels'],
    keywords: ['energy', 'recovery', 'heart', 'cardio', 'hrv'],
    bodySystemKeys: ['nervous_system', 'recovery'],
    specialist: 'General physician first; cardiologist if they refer you',
    primary: M.hrv,
    markers: [M.hrv, M.steps, M.sleep],
    score: engine('recovery'),
  },
  {
    key: 'lungs',
    label: 'Lungs & airways',
    short: 'Lungs',
    icon: Wind,
    organs: ['lungs', 'throat'],
    keywords: ['throat', 'aqi', 'air', 'allergy', 'pollen', 'cold', 'breath', 'respir'],
    bodySystemKeys: ['environmental_stress'],
    specialist: 'General physician; pulmonologist or ENT for persistent symptoms',
    primary: M.aqi,
    markers: [M.aqi, M.sleep],
    score: engine('environment'),
  },
  {
    key: 'gut',
    label: 'Digestion',
    short: 'Gut',
    icon: Utensils,
    organs: ['stomach', 'intestines', 'liver'],
    keywords: ['digest', 'food', 'stomach', 'meal', 'gut', 'eat'],
    bodySystemKeys: [],
    specialist: 'General physician; gastroenterologist for recurring issues',
    primary: M.water,
    markers: [M.water, M.sleep],
    score: engine('lifestyle'),
  },
  {
    key: 'mind',
    label: 'Brain & mood',
    short: 'Mind',
    icon: Brain,
    organs: ['brain'],
    keywords: ['cognitive', 'emotional', 'stress', 'mood', 'focus', 'social', 'load', 'irritab'],
    bodySystemKeys: ['cognitive_clarity', 'emotional_resilience'],
    specialist: 'General physician; psychologist or psychiatrist if low mood persists',
    primary: M.screen,
    markers: [M.screen, M.sleep, M.hrv],
    score: (f) => {
      const a = f.engine_scores?.emotional;
      const b = f.engine_scores?.cognitive;
      return a === undefined || b === undefined ? null : Math.round((a + b) / 2);
    },
  },
  {
    key: 'immune',
    label: 'Immunity',
    short: 'Immune',
    icon: ShieldPlus,
    organs: ['throat', 'lungs', 'intestines'],
    keywords: ['immune', 'throat', 'cold', 'fever', 'infect', 'sensitiv'],
    bodySystemKeys: ['immune_stress'],
    specialist: 'General physician',
    primary: M.sleep,
    markers: [M.sleep, M.water, M.aqi],
    score: engine('immunity'),
  },
  {
    key: 'sleep',
    label: 'Sleep & recovery',
    short: 'Sleep',
    icon: Moon,
    organs: ['brain', 'heart'],
    keywords: ['sleep', 'recovery', 'rest', 'energy'],
    bodySystemKeys: ['sleep_pressure', 'recovery'],
    specialist: 'General physician; sleep specialist for long-term insomnia',
    primary: M.sleep,
    markers: [M.sleep, M.hrv, M.screen],
    score: bodySystem('sleep_pressure'),
  },
  {
    key: 'hydration',
    label: 'Hydration & kidneys',
    short: 'Water',
    icon: Droplets,
    organs: ['kidneys'],
    keywords: ['hydrat', 'water', 'fluid', 'heat'],
    bodySystemKeys: ['hydration'],
    specialist: 'General physician; nephrologist only on referral',
    primary: M.water,
    markers: [M.water, M.steps],
    score: bodySystem('hydration'),
  },
];

export function systemByKey(key: SystemKey): SystemDef {
  return SYSTEMS.find((s) => s.key === key) ?? SYSTEMS[0];
}

export function markerValue(forecast: Forecast | null, marker: MarkerDef): { value: number | null; baseline: number | null; metric?: Metric } {
  const metric = forecast?.metrics?.[marker.metric];
  const scale = marker.scale ?? 1;
  return {
    value: metric?.value == null ? null : metric.value * scale,
    baseline: metric?.baseline == null ? null : metric.baseline * scale,
    metric,
  };
}

export function formatValue(value: number | null, marker: MarkerDef): string {
  if (value === null) return '—';
  const decimals = marker.decimals ?? 0;
  const rounded = decimals ? value.toFixed(decimals) : Math.round(value).toLocaleString('en-IN');
  return rounded;
}

export type MarkerStatus = 'Optimal' | 'Low' | 'High' | 'No data';

export function markerStatus(value: number | null, marker: MarkerDef): MarkerStatus {
  if (value === null) return 'No data';
  if (value < marker.optimal[0]) return 'Low';
  if (value > marker.optimal[1]) return 'High';
  return 'Optimal';
}

function matches(text: string, keywords: string[]) {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

export interface SystemView {
  def: SystemDef;
  score: number | null;
  risk: { title: string; probability: number; horizon: string } | null;
  narrative: string | null;
  comparison: string | null;
  actions: { title: string; detail: string; priority?: Severity; horizon?: string }[];
  lifestyle: { title: string; detail: string }[];
  watch: { title: string; detail: string; probability?: number }[];
}

export function buildSystemView(forecast: Forecast | null, key: SystemKey): SystemView {
  const def = systemByKey(key);
  if (!forecast) {
    return { def, score: null, risk: null, narrative: null, comparison: null, actions: [], lifestyle: [], watch: [] };
  }
  const future = (forecast.future_forecast ?? []).filter((f) => matches(`${f.title} ${f.signals.join(' ')}`, def.keywords));
  const top = [...future].sort((a, b) => b.probability - a.probability)[0];
  const body = (forecast.body_systems ?? []).find((s) => def.bodySystemKeys.includes(s.key));
  const timeline = (forecast.reasoning_timeline ?? []).find((t) => matches(`${t.title} ${t.detail}`, def.keywords));

  const strategist = forecast.health_strategist ?? [];
  const matchedActions = strategist.filter((a) => matches(`${a.title} ${a.detail}`, def.keywords));
  const lifestyle = forecast.suggested_actions.filter((a) => matches(`${a.title} ${a.detail}`, def.keywords));
  const alerts = (forecast.live_risk_intelligence?.local_alerts ?? forecast.environmental_alerts).filter((a) =>
    matches(`${a.title} ${a.detail} ${a.type}`, def.keywords),
  );

  return {
    def,
    score: def.score(forecast),
    risk: top ? { title: top.title, probability: top.probability, horizon: top.horizon } : null,
    narrative: timeline?.detail ?? body?.explanation ?? null,
    comparison: timeline?.title ?? body?.monthly_comparison ?? null,
    actions: (matchedActions.length ? matchedActions : strategist).slice(0, 4),
    lifestyle: (lifestyle.length ? lifestyle : forecast.suggested_actions).slice(0, 4),
    watch: [
      ...future.map((f) => ({
        title: f.title,
        detail: f.best_window ? `Best window: ${f.best_window}` : f.signals.join(', '),
        probability: f.probability,
      })),
      ...alerts.map((a) => ({ title: a.title, detail: a.detail })),
    ].slice(0, 4),
  };
}

/** Systems sorted so the one needing the most attention comes first. */
export function mostConcerning(forecast: Forecast | null): SystemKey {
  if (!forecast) return 'heart';
  const scored = SYSTEMS.map((s) => ({ key: s.key, score: s.score(forecast) ?? 100 }));
  scored.sort((a, b) => a.score - b.score);
  return scored[0].key;
}
