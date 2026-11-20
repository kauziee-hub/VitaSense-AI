import {
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  type Permission,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';

import type { HealthDayPayload } from '@/lib/api';

/**
 * Health Connect (Android): everything a watch, band, ring, smart scale, BP cuff, glucometer or
 * health app already syncs there — sleep, steps, distance, floors, exercise, calories, heart rate,
 * resting heart rate, HRV, SpO2, breathing rate, body temperature, blood pressure, blood sugar,
 * weight, body fat, VO2 max, food energy, water and (for women) the menstrual cycle.
 * Needs a development or release build (not Expo Go) and Health Connect on the phone.
 */

export const healthSupported = true;
export const healthSourceKey = 'health_connect' as const;

const RECORDS = [
  'SleepSession',
  'Steps',
  'Distance',
  'ExerciseSession',
  'ActiveCaloriesBurned',
  'HeartRate',
  'RestingHeartRate',
  'HeartRateVariabilityRmssd',
  'OxygenSaturation',
  'RespiratoryRate',
  'Weight',
  'Hydration',
  'BodyTemperature',
  'BloodPressure',
  'BloodGlucose',
  'BodyFat',
  'Vo2Max',
  'Nutrition',
  'FloorsClimbed',
  'MenstruationFlow',
  'MenstruationPeriod',
] as const;

const PERMISSIONS: Permission[] = RECORDS.map((recordType) => ({ accessType: 'read', recordType }));
// Lets the hourly background sync read without the app being open (Android 14+ where offered).
const BACKGROUND: Permission = { accessType: 'read', recordType: 'BackgroundAccessPermission' } as unknown as Permission;

let ready = false;
async function ensureInit(): Promise<boolean> {
  if (!ready) ready = await initialize();
  return ready;
}

export async function healthAvailable(): Promise<'available' | 'needs_install' | 'unsupported'> {
  try {
    const status = await getSdkStatus();
    if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'needs_install';
    return 'unsupported';
  } catch {
    return 'unsupported';
  }
}

export async function connectHealth(): Promise<boolean> {
  if (!(await ensureInit())) return false;
  const granted = await requestPermission(PERMISSIONS);
  try {
    await requestPermission([BACKGROUND]);
  } catch {
    // Not offered on this phone; foreground syncing still works.
  }
  return granted.length > 0;
}

export async function healthConnected(): Promise<boolean> {
  try {
    if (!(await ensureInit())) return false;
    return (await getGrantedPermissions()).length > 0;
  } catch {
    return false;
  }
}

export function openHealthSettings(): void {
  openHealthConnectSettings();
}

function dayKey(iso: string | Date): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function read(recordType: (typeof RECORDS)[number], start: Date, end: Date): Promise<Record<string, unknown>[]> {
  try {
    const result = await readRecords(recordType, {
      timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() },
      pageSize: 5000,
    });
    return result.records as unknown as Record<string, unknown>[];
  } catch {
    return []; // permission for this type not granted, or no data
  }
}

const num = (value: unknown, key?: string): number | undefined => {
  const raw = key && value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : value;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
};

export async function readHealthDays(days = 14): Promise<HealthDayPayload[]> {
  if (!(await healthConnected())) return [];
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);

  const [
    sleep, steps, distance, exercise, calories, heart, resting, hrv, spo2, respiration, weight, hydration,
    temperature, pressure, glucose, bodyFat, vo2, nutrition, floors, flow, period,
  ] = await Promise.all(RECORDS.map((type) => read(type, start, end)));

  type Bucket = HealthDayPayload & { _hr: number[]; _rhr: number[]; _hrv: number[]; _spo2: number[]; _rr: number[]; _temp: number[]; _sys: number[]; _dia: number[]; _glu: number[] };
  const daysOut = new Map<string, Bucket>();
  const bucket = (key: string) => {
    let b = daysOut.get(key);
    if (!b) {
      b = { date: key, _hr: [], _rhr: [], _hrv: [], _spo2: [], _rr: [], _temp: [], _sys: [], _dia: [], _glu: [] };
      daysOut.set(key, b);
    }
    return b;
  };
  const add = (b: HealthDayPayload, field: keyof HealthDayPayload, value: number | undefined) => {
    if (value === undefined) return;
    (b as unknown as Record<string, unknown>)[field] = ((b[field] as number | undefined) ?? 0) + value;
  };

  // Sleep belongs to the day you wake up.
  for (const s of sleep) {
    const b = bucket(dayKey(s.endTime as string));
    const minutes = (new Date(s.endTime as string).getTime() - new Date(s.startTime as string).getTime()) / 60000;
    if (!b.sleep_minutes || minutes > b.sleep_minutes) {
      b.sleep_minutes = Math.round(minutes);
      b.sleep_start = clock(s.startTime as string);
      b.sleep_end = clock(s.endTime as string);
      const stages = (s.stages as { stage: number }[] | undefined) ?? [];
      b.sleep_awakenings = stages.filter((stage) => stage.stage === 1).length || undefined;
    }
  }
  for (const r of steps) add(bucket(dayKey(r.startTime as string)), 'steps', num(r.count));
  for (const r of distance) add(bucket(dayKey(r.startTime as string)), 'distance_m', num(r.distance, 'inMeters'));
  for (const r of calories) add(bucket(dayKey(r.startTime as string)), 'active_calories', num(r.energy, 'inKilocalories'));
  for (const r of hydration) add(bucket(dayKey(r.startTime as string)), 'hydration_ml', num(r.volume, 'inMilliliters'));
  for (const r of exercise) {
    const b = bucket(dayKey(r.startTime as string));
    add(b, 'exercise_minutes', (new Date(r.endTime as string).getTime() - new Date(r.startTime as string).getTime()) / 60000);
    b.workout_types = [...new Set([...(b.workout_types ?? []), (r.title as string) || 'Workout'])].slice(0, 5);
  }
  for (const r of heart) {
    const b = bucket(dayKey(r.startTime as string));
    for (const sample of (r.samples as { beatsPerMinute: number }[] | undefined) ?? []) b._hr.push(sample.beatsPerMinute);
  }
  for (const r of resting) bucket(dayKey(r.time as string))._rhr.push(num(r.beatsPerMinute) ?? NaN);
  for (const r of hrv) bucket(dayKey(r.time as string))._hrv.push(num(r.heartRateVariabilityMillis) ?? NaN);
  for (const r of spo2) bucket(dayKey(r.time as string))._spo2.push(num(r.percentage) ?? NaN);
  for (const r of respiration) bucket(dayKey(r.time as string))._rr.push(num(r.rate) ?? NaN);
  for (const r of weight) bucket(dayKey(r.time as string)).weight_kg = num(r.weight, 'inKilograms');
  for (const r of temperature) bucket(dayKey(r.time as string))._temp.push(num(r.temperature, 'inCelsius') ?? NaN);
  for (const r of pressure) {
    const b = bucket(dayKey(r.time as string));
    b._sys.push(num(r.systolic, 'inMillimetersOfMercury') ?? NaN);
    b._dia.push(num(r.diastolic, 'inMillimetersOfMercury') ?? NaN);
  }
  for (const r of glucose) bucket(dayKey(r.time as string))._glu.push(num(r.level, 'inMilligramsPerDeciliter') ?? NaN);
  for (const r of bodyFat) bucket(dayKey(r.time as string)).body_fat_percent = num(r.percentage) ?? num(r.percentage, 'value');
  for (const r of vo2) bucket(dayKey(r.time as string)).vo2_max = num(r.vo2MillilitersPerMinuteKilogram);
  for (const r of nutrition) add(bucket(dayKey(r.startTime as string)), 'nutrition_kcal', num(r.energy, 'inKilocalories'));
  for (const r of floors) add(bucket(dayKey(r.startTime as string)), 'floors_climbed', num(r.floors));
  const FLOW = { 1: 'light', 2: 'medium', 3: 'heavy' } as const;
  for (const r of flow) {
    const b = bucket(dayKey(r.time as string));
    b.period_day = true;
    const level = FLOW[(num(r.flow) ?? 0) as keyof typeof FLOW];
    if (level) b.menstrual_flow = level;
  }
  for (const r of period) bucket(dayKey((r.startTime ?? r.time) as string)).period_day = true;

  const mean = (values: number[]) => {
    const clean = values.filter((v) => Number.isFinite(v));
    return clean.length ? Math.round((clean.reduce((a, b) => a + b, 0) / clean.length) * 10) / 10 : undefined;
  };
  return [...daysOut.values()]
    .map(({ _hr, _rhr, _hrv, _spo2, _rr, _temp, _sys, _dia, _glu, ...day }) => ({
      ...day,
      body_temperature_c: mean(_temp),
      systolic_mmhg: mean(_sys),
      diastolic_mmhg: mean(_dia),
      blood_glucose_mg_dl: mean(_glu),
      steps: day.steps !== undefined ? Math.round(day.steps) : undefined,
      exercise_minutes: day.exercise_minutes !== undefined ? Math.round(day.exercise_minutes) : undefined,
      heart_rate_avg: mean(_hr),
      resting_heart_rate: mean(_rhr),
      hrv_ms: mean(_hrv),
      spo2_percent: mean(_spo2),
      respiratory_rate: mean(_rr),
    }))
    .filter((day) => day.date <= dayKey(end))
    .sort((a, b) => a.date.localeCompare(b.date));
}
