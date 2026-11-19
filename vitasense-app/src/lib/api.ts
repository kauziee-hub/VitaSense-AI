import { forgetServer, serverUrl } from './server';

export type Trend = 'below_baseline' | 'near_baseline' | 'above_baseline' | 'unknown';
export type Severity = 'low' | 'medium' | 'high';

export interface AppUser {
  id: number;
  name: string;
  user_code?: string | null;
}

export interface Metric {
  label: string;
  value: number | null;
  baseline: number | null;
  unit: string;
  trend: Trend;
  change_percent?: number | null;
}

export interface Forecast {
  user_id: number;
  date: string;
  headline: string;
  summary: string;
  readiness_score: number;
  data_mode?: 'live' | 'demo';
  energy: { score: number; state: string; trend: Trend };
  recovery: { score: number; state: string; trend: Trend };
  hero_prediction?: { statement: string; confidence: string; horizon: string; primary_risks: string[] };
  reasoning_timeline?: {
    title: string;
    detail: string;
    evidence: string;
    severity: Severity;
    source_table: string;
    days_observed: number;
  }[];
  future_forecast?: {
    horizon: string;
    title: string;
    probability: number;
    severity: Severity;
    signals: string[];
    best_window: string;
    recovery_window: string;
  }[];
  body_systems?: { key: string; label: string; score: number; trend: Trend; explanation: string; monthly_comparison: string }[];
  behavioral_detections?: { title: string; detail: string; confidence: string; evidence: string }[];
  health_strategist?: { title: string; detail: string; priority: Severity; horizon: string }[];
  live_risk_intelligence?: {
    local_alerts: { type: string; severity: Severity; title: string; detail: string }[];
    current_environment?: { aqi: number | null; temperature_c: number | null; pollen_level: string | null; heatwave_alert: boolean };
  };
  engine_scores?: Record<string, number>;
  suggested_actions: { title: string; detail: string }[];
  environmental_alerts: { type: string; severity: Severity; title: string; detail: string }[];
  metrics: Record<string, Metric>;
}

export interface LocalityIntel {
  city: string;
  locality: string;
  scan_status: { overall_level?: string; overall_probability?: number; summary?: string };
  hotspots: { id: string; layer: string; title: string; detail: string; severity: Severity; probability?: number }[];
  community_symptom_clusters: { symptom: string; reports_48h: number; trend?: string }[];
}

export interface Health {
  status: string;
  ai: boolean;
  ai_provider: string | null;
  database: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number; multipart?: boolean }): Promise<T> {
  const { timeoutMs, multipart, ...fetchInit } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? 20000);
  try {
    const base = await serverUrl();
    const response = await fetch(`${base}${path}`, {
      ...fetchInit,
      signal: init?.signal ?? controller.signal,
      // Multipart bodies set their own Content-Type with the boundary.
      headers: multipart ? { ...(init?.headers ?? {}) } : { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        detail = ((await response.json()) as { detail?: string }).detail ?? detail;
      } catch {
        // body was not JSON
      }
      throw new ApiError(detail, response.status);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    forgetServer();
    throw new ApiError('Cannot reach the VitaSense server', 0);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: () => request<Health>('/health', { timeoutMs: 8000 }),
  users: () => request<{ users: AppUser[] }>('/api/v1/users').then((r) => r.users),
  createUser: (name: string) => request<AppUser>('/api/v1/users', { method: 'POST', body: JSON.stringify({ name }) }),
  forecast: (userId: number) => request<Forecast>(`/api/v1/user/${userId}/wellness-forecast`),
  locality: (userId: number) => request<LocalityIntel>(`/api/v1/user/${userId}/locality-health-intelligence`),
  setupContext: (userId: number) =>
    request<{ user_id: number; tables: Record<string, Record<string, unknown>> }>(`/api/v1/user/${userId}/setup-context`),
  saveDailyLog: (userId: number, payload: DailyLogPayload) =>
    request<{ saved_tables: string[] }>(`/api/v1/user/${userId}/daily-log`, { method: 'PUT', body: JSON.stringify(payload) }),

  records: (userId: number) => request<{ records: HealthRecord[]; summary: RecordsSummary }>(`/api/v1/user/${userId}/records`),
  uploadRecord: (userId: number, form: FormData) =>
    request<HealthRecord>(`/api/v1/user/${userId}/records`, { method: 'POST', body: form, timeoutMs: 150000, multipart: true }),
  deleteRecord: (userId: number, recordId: string) =>
    request<{ deleted: boolean }>(`/api/v1/user/${userId}/records/${recordId}`, { method: 'DELETE' }),
  startMedications: (userId: number, recordId: string, indices?: number[]) =>
    request<{ created: Medication[] }>(`/api/v1/user/${userId}/records/${recordId}/medications`, {
      method: 'POST',
      body: JSON.stringify({ indices: indices ?? null }),
    }),
  medicationsToday: (userId: number) => request<TodaySchedule>(`/api/v1/user/${userId}/medications/today`),
  logDose: (userId: number, medId: string, dose: { date: string; time: string; status: DoseStatus | 'pending' }) =>
    request<Omit<TodaySchedule, 'medications'>>(`/api/v1/user/${userId}/medications/${medId}/doses`, {
      method: 'PUT',
      body: JSON.stringify(dose),
    }),
  updateMedication: (userId: number, medId: string, changes: { active?: boolean; times?: string[] }) =>
    request<Medication>(`/api/v1/user/${userId}/medications/${medId}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  doctorReport: (userId: number, body: DoctorReportRequest) =>
    request<DoctorReport>(`/api/v1/user/${userId}/doctor-report`, { method: 'POST', body: JSON.stringify(body), timeoutMs: 90000 }),
  collectEnvironment: (userId: number, lat: number, lng: number) =>
    request<EnvironmentResult>(`/api/v1/user/${userId}/collect/environment`, {
      method: 'POST',
      body: JSON.stringify({ lat, lng }),
      timeoutMs: 30000,
    }),
  collectDevice: (userId: number, payload: DevicePayload) =>
    request<{ days: number; fields: number }>(`/api/v1/user/${userId}/collect/device`, {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 30000,
    }),
  collectGmail: (userId: number, accessToken: string, days = 30) =>
    request<GmailResult>(`/api/v1/user/${userId}/collect/gmail`, {
      method: 'POST',
      body: JSON.stringify({ access_token: accessToken, days, utc_offset_minutes: -new Date().getTimezoneOffset() }),
      timeoutMs: 150000,
    }),
  collectStatus: (userId: number) => request<CollectStatus>(`/api/v1/user/${userId}/collect/status`),
  disconnectSource: (userId: number, source: SourceKey) =>
    request<{ disconnected: string }>(`/api/v1/user/${userId}/collect/${source}`, { method: 'DELETE' }),
  nearbyDoctors: (lat: number, lng: number, specialty: string) =>
    request<NearbyDoctors>(
      `/api/v1/doctors/nearby?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&specialty=${encodeURIComponent(specialty)}`,
      { timeoutMs: 30000 },
    ),
};

/* ---------- Records, medicines, doctor report, nearby doctors ---------- */

export type LabFlag = 'low' | 'normal' | 'high' | 'abnormal' | 'unknown';

export interface LabResult {
  name: string;
  key: string | null;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  ref_low: number | null;
  ref_high: number | null;
  ref_text: string | null;
  flag: LabFlag;
  date?: string;
}

export interface ExtractedMedication {
  name: string;
  strength: string | null;
  form: string | null;
  dose: string | null;
  times: string[];
  as_needed: boolean;
  food_timing: FoodTiming;
  duration_days: number | null;
  start_date: string;
  end_date: string | null;
  instructions: string | null;
}

export type FoodTiming = 'before_food' | 'after_food' | 'with_food' | 'empty_stomach' | 'any';

export interface HealthRecord {
  id: string;
  /** Set on upload: true when this exact file was already in the user's records. */
  duplicate?: boolean;
  created_at: string;
  file_name: string;
  mime_type: string;
  document_type: 'lab_report' | 'prescription' | 'discharge_summary' | 'imaging_report' | 'vaccination' | 'other';
  document_date: string | null;
  title: string | null;
  facility: string | null;
  doctor: string | null;
  summary: string | null;
  extracted: {
    lab_results: LabResult[];
    conditions: string[];
    allergies: string[];
    procedures: string[];
    medications: ExtractedMedication[];
    doctor_advice: string[];
    follow_up: string | null;
  };
}

export interface Medication {
  id: string;
  record_id: string | null;
  name: string;
  strength: string | null;
  form: string | null;
  dose: string | null;
  times: string[];
  as_needed: boolean;
  food_timing: FoodTiming | null;
  instructions: string | null;
  start_date: string;
  end_date: string | null;
  active: boolean;
}

export interface RecordsSummary {
  record_count: number;
  last_record_date: string | null;
  latest_labs: (LabResult & { date: string; record_id: string })[];
  flagged_labs: (LabResult & { date: string; record_id: string })[];
  conditions: string[];
  allergies: string[];
  procedures: string[];
  doctor_advice: string[];
  medications: Medication[];
}

/** `unlogged`: due before VitaSense started following this medicine, so not counted as missed. */
export type DoseStatus = 'taken' | 'skipped' | 'missed' | 'due' | 'upcoming' | 'unlogged';

export interface Dose {
  medication_id: string;
  name: string;
  strength: string | null;
  dose: string | null;
  food_timing: FoodTiming | null;
  time: string;
  date: string;
  status: DoseStatus;
}

export interface TodaySchedule {
  date: string;
  doses: Dose[];
  as_needed: Medication[];
  adherence_7d: number | null;
  medications: Medication[];
}

export interface DoctorReportRequest {
  user_name: string;
  specialty: string | null;
  concern: string;
  conversation?: { role: 'user' | 'assistant'; content: string }[];
}

export interface DoctorReport {
  generated_at: string;
  specialty: string;
  concern: string;
  ai_written: boolean;
  reason_for_visit: string;
  symptom_timeline: { when: string; detail: string }[];
  relevant_context: string[];
  questions_for_doctor: string[];
  patient: { name: string; life_phase?: string | null; lifestyle?: string | null; eating?: string | null };
  lifestyle_30d: { label: string; latest: string | null; average_30d: string | null; trend: Trend }[];
  patterns_30d: { title: string; evidence: string }[];
  history: { conditions: string[]; allergies: string[]; past_history: string[]; recurring_patterns: string[] };
  medications: { name: string; strength: string | null; dose: string | null; schedule: string; since: string | null }[];
  labs: { name: string; value: number | string | null; unit: string | null; range: string | null; flag: LabFlag; date: string | null }[];
  local_alerts: { title: string; detail: string }[];
  disclaimer: string;
}

export interface NearbyPlace {
  id: string;
  name: string;
  kind: string;
  speciality?: string | null;
  match: 'specialty' | 'hospital' | 'general' | 'other';
  address: string | null;
  phone: string | null;
  website?: string | null;
  opening_hours?: string | null;
  emergency?: boolean;
  rating: number | null;
  rating_count: number | null;
  open_now: boolean | null;
  lat: number;
  lng: number;
  distance_km: number;
  maps_url: string;
  directions_url: string;
}

export interface NearbyDoctors {
  specialty: string;
  source: 'google' | 'openstreetmap';
  radius_km: number;
  maps_search_url: string;
  results: NearbyPlace[];
}

export interface DailyLogPayload {
  log_date: string;
  manual: {
    energy_level?: 'Very Low' | 'Low' | 'Moderate' | 'Good' | 'High' | null;
    mood_today?: string | null;
    overall_mental_feeling?: string | null;
    physical_discomfort_notes?: string | null;
    chatbot_symptoms_reported?: string[];
    daily_events?: string[];
    ate_from_outside?: boolean | null;
    processed_food_consumed?: boolean | null;
    workload_intensity?: 'Very Low' | 'Low' | 'Moderate' | 'High' | 'Extreme' | null;
    crowded_place_exposure?: boolean | null;
    travel_today?: boolean | null;
    doctor_consulted_today?: boolean | null;
    emotional_event_notes?: string | null;
  };
}

/** Built-in demo profiles, used when the database is offline so the app still demos. */
export const DEMO_USERS: AppUser[] = [
  { id: 1, name: 'Kausik', user_code: 'kausik' },
  { id: 2, name: 'Rithik', user_code: 'rithik' },
  { id: 3, name: 'Abhishek', user_code: 'abhishek' },
];

/* ---------- Automatic collection ---------- */

export type SourceKey = 'location' | 'health_connect' | 'apple_health' | 'calendar' | 'screen_time' | 'gmail' | 'check_in';

export interface EnvironmentAlert {
  type: 'air_quality' | 'heat' | 'mosquito';
  severity: Severity;
  title: string;
  detail: string;
}

export interface EnvironmentDay {
  location?: string;
  temperature_c?: number;
  humidity_percent?: number;
  rain_mm?: number;
  rain_14d_mm?: number;
  uv_index?: number;
  aqi?: number;
  aqi_scale?: string;
  pm2_5?: number;
  heat_level?: 'none' | 'heat_stress' | 'heatwave';
  mosquito_breeding_conditions?: 'low' | 'moderate' | 'high';
}

export interface EnvironmentResult {
  place: { locality: string | null; city: string | null; label: string };
  today: EnvironmentDay;
  alerts: EnvironmentAlert[];
  days_saved: number;
}

export interface HealthDayPayload {
  date: string;
  sleep_minutes?: number;
  sleep_start?: string;
  sleep_end?: string;
  sleep_awakenings?: number;
  steps?: number;
  distance_m?: number;
  active_calories?: number;
  exercise_minutes?: number;
  workout_types?: string[];
  heart_rate_avg?: number;
  resting_heart_rate?: number;
  hrv_ms?: number;
  spo2_percent?: number;
  respiratory_rate?: number;
  weight_kg?: number;
  hydration_ml?: number;
}

export interface CalendarDayPayload {
  date: string;
  event_count: number;
  busy_minutes: number;
  late_events: number;
  early_events: number;
  travel: boolean;
  exam: boolean;
}

export interface DevicePayload {
  source: 'health_connect' | 'apple_health' | 'calendar' | 'screen_time';
  health?: HealthDayPayload[];
  calendar?: CalendarDayPayload[];
}

export interface CollectedItem {
  source: SourceKey;
  item_id: string;
  happened_at: string | null;
  kind: 'food_order' | 'grocery_order' | 'pharmacy_order' | 'lab_booking' | 'lab_report' | 'fitness_booking' | 'travel';
  summary: string;
  details: { flags?: string[]; items?: string[]; merchant?: string; late_night?: boolean };
}

export interface GmailResult {
  emails_read: number;
  orders_found: number;
  new_items: number;
  reports_added: number;
  items: Pick<CollectedItem, 'happened_at' | 'kind' | 'summary'>[];
}

export interface CollectStatus {
  connections: Partial<Record<SourceKey, { connected_at: string; last_sync_at: string | null; last_result: Record<string, unknown> }>>;
  recent_items: CollectedItem[];
  environment: (EnvironmentDay & { date: string; alerts: EnvironmentAlert[] }) | null;
  latest_health: ({ date: string } & Record<string, unknown>) | null;
  latest_calendar: ({ date: string } & Record<string, unknown>) | null;
  days_collected_30d: number;
}
