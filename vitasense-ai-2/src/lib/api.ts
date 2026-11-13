export type WellnessTrend = 'below_baseline' | 'near_baseline' | 'above_baseline' | 'unknown';
export type AlertSeverity = 'low' | 'medium' | 'high';

export interface WellnessMetric {
  label: string;
  value: number | null;
  baseline: number | null;
  unit: string;
  trend: WellnessTrend;
  change_percent?: number | null;
}

export interface WellnessForecast {
  user_id: number;
  date: string;
  analysis_window_days?: number;
  headline: string;
  summary: string;
  readiness_score: number;
  energy: {
    score: number;
    state: string;
    trend: WellnessTrend;
  };
  recovery: {
    score: number;
    state: string;
    trend: WellnessTrend;
  };
  hero_prediction?: {
    statement: string;
    confidence: string;
    horizon: string;
    readiness_score: number;
    primary_risks: string[];
  };
  reasoning_timeline?: Array<{
    title: string;
    detail: string;
    evidence: string;
    severity: AlertSeverity;
    source_table: string;
    days_observed: number;
  }>;
  future_forecast?: Array<{
    horizon: string;
    title: string;
    probability: number;
    severity: AlertSeverity;
    signals: string[];
    best_window: string;
    recovery_window: string;
  }>;
  body_systems?: Array<{
    key: string;
    label: string;
    score: number;
    trend: WellnessTrend;
    explanation: string;
    monthly_comparison: string;
  }>;
  behavioral_detections?: Array<{
    title: string;
    detail: string;
    confidence: string;
    evidence: string;
  }>;
  health_strategist?: Array<{
    title: string;
    detail: string;
    priority: AlertSeverity;
    horizon: string;
  }>;
  live_risk_intelligence?: {
    local_alerts: Array<{
      type: string;
      severity: AlertSeverity;
      title: string;
      detail: string;
    }>;
    service_placeholders: Array<{
      name: string;
      status: string;
      purpose: string;
    }>;
    current_environment: {
      aqi: number | null;
      temperature_c: number | null;
      pollen_level: string | null;
      heatwave_alert: boolean;
    };
  };
  engine_scores?: Record<string, number>;
  patterns: Array<{
    title: string;
    detail: string;
  }>;
  suggested_actions: Array<{
    title: string;
    detail: string;
  }>;
  environmental_alerts: Array<{
    type: string;
    severity: AlertSeverity;
    title: string;
    detail: string;
  }>;
  metrics: Record<string, WellnessMetric>;
  source_tables: string[];
}

export type LocalityLayerId = 'disease' | 'symptoms' | 'hazards' | 'food' | 'predictive';

export interface LocalityHotspot {
  id: string;
  layer: LocalityLayerId;
  title: string;
  detail: string;
  severity: AlertSeverity;
  confidence: string;
  affected_radius_km: number;
  risk_probability: number;
  x: number;
  y: number;
  probable_symptoms: string[];
  source: string;
  why_this_is_happening: string;
  future_probability: number;
  suggested_precautions: string[];
  trend: string;
}

export interface LocalityRiskCard {
  title: string;
  risk_level: AlertSeverity;
  confidence: string;
  affected_radius_km: number;
  probable_symptoms: string[];
  why_this_is_happening: string;
  future_probability: number;
  suggested_precautions: string[];
  source: string;
}

export interface LocalityHealthIntelligence {
  user_id: number;
  generated_on: string;
  city: string;
  locality: string;
  radius_km: number;
  scan_status: {
    overall_level: string;
    overall_probability: number;
    confidence: string;
    refreshed_minutes_ago: number;
    summary: string;
  };
  layers: Array<{
    id: LocalityLayerId;
    label: string;
    signal_count: number;
    severity: AlertSeverity;
    probability: number;
  }>;
  hotspots: LocalityHotspot[];
  community_symptom_clusters: Array<{
    id: string;
    symptom: string;
    reports_48h: number;
    weekly_change_percent: number;
    radius_km: number;
    zone: string;
    severity: AlertSeverity;
  }>;
  risk_cards: LocalityRiskCard[];
  predictive_lifestyle_risks: Array<{
    title: string;
    probability: number;
    horizon: string;
    reason: string;
    personalized_message: string;
  }>;
  source_architecture: Array<{
    service: string;
    source: string;
    status: string;
  }>;
  mock_intelligence_feeds: Array<{
    name: string;
    status: string;
    signals: number;
  }>;
  correlation_explanation: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8888';

export type DailyEnergyLevel = 'Very Low' | 'Low' | 'Moderate' | 'Good' | 'High';
export type DailyMood =
  | 'Very Sad'
  | 'Sad'
  | 'Neutral'
  | 'Happy'
  | 'Very Happy'
  | 'Anxious'
  | 'Stressed'
  | 'Exhausted';
export type DailyOverallHealth = 'Very Poor' | 'Poor' | 'Average' | 'Good' | 'Excellent';
export type DailyWorkload = 'Very Low' | 'Low' | 'Moderate' | 'High' | 'Extreme';
export type DailySymptomSeverity = 'Mild' | 'Moderate' | 'Severe' | 'Critical';
export type DailyRiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type DailyRecoveryStatus = 'Recovering' | 'Recovered' | 'Not Improved' | 'Worsening';

export interface DailyLogPayload {
  log_date: string;
  manual: {
    breakfast_log: string | null;
    lunch_log: string | null;
    dinner_log: string | null;
    snacks_beverages_log: string | null;
    ate_from_outside: boolean | null;
    processed_food_consumed: boolean | null;
    unusual_food_exposure: boolean | null;
    unusual_exposure_notes: string | null;
    energy_level: DailyEnergyLevel | null;
    mood_today: DailyMood | null;
    overall_mental_feeling: DailyMood | null;
    emotional_physical_impact: boolean | null;
    physical_discomfort_notes: string | null;
    unusual_body_observation: string | null;
    daily_events: string[];
    workload_intensity: DailyWorkload | null;
    crowded_place_exposure: boolean | null;
    travel_today: boolean | null;
    emotional_event_notes: string | null;
    chatbot_symptoms_reported: string[];
    doctor_consulted_today: boolean | null;
    medical_visit_reason: string | null;
  };
}

export interface DailyLogResponse {
  user_id: number;
  log_date: string;
  saved_tables: string[];
  tables: Record<string, Record<string, unknown>>;
}

export interface AppUser {
  id: number;
  user_code: string | null;
  name: string;
}

export interface SetupContextPayload {
  life_phase: string | null;
  social_environment: string | null;
  life_structure_type: string | null;
  lifestyle_identity: string | null;
  preferred_environment: string | null;
  perceived_health_triggers: string[];
  chronic_conditions: string[];
  recurring_health_patterns: string[];
  allergy_conditions: string[];
  major_medical_history: string[];
  personal_health_note: string | null;
  eating_behavior: string | null;
  unhealthy_eating_triggers: string[];
  body_awareness_level: string | null;
  emotional_health_impact: boolean | null;
  emotional_tracking_enabled: boolean;
  emotional_pressure_sources: string[];
  stress_response_pattern: string | null;
  recovery_preference: string | null;
  loneliness_level: string | null;
  depression_signals: string[];
  anxiety_triggers: string[];
  burnout_risk: string | null;
  emotional_support_system: string | null;
  coping_mechanisms: string[];
  emotional_stability_score: number | null;
  social_interaction_frequency: string | null;
  self_isolation_pattern: string | null;
  emotional_notes: string | null;
}

export interface SetupContextResponse {
  user_id: number;
  tables: Record<string, Record<string, unknown>>;
}

export interface ChatHistoryRow {
  id?: number;
  user_id: number;
  session_id: string;
  message_role: 'system' | 'user' | 'assistant' | 'tool';
  message_content: string;
  created_at?: string;
}

export async function fetchUsers(signal?: AbortSignal): Promise<AppUser[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Users request failed with status ${response.status}`);
  }

  const body = await response.json() as { users: AppUser[] };
  return body.users;
}

export async function createUser(name: string): Promise<AppUser> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    throw new Error(`User create failed with status ${response.status}`);
  }

  return response.json() as Promise<AppUser>;
}

export async function fetchSetupContext(userId: number, signal?: AbortSignal): Promise<SetupContextResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/user/${userId}/setup-context`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Setup context request failed with status ${response.status}`);
  }

  return response.json() as Promise<SetupContextResponse>;
}

export async function fetchChatHistory(userId: number, limit = 30, signal?: AbortSignal): Promise<ChatHistoryRow[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/user/${userId}/history?limit=${limit}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Chat history request failed with status ${response.status}`);
  }

  const body = await response.json() as { history: ChatHistoryRow[] };
  return body.history;
}

export async function fetchWellnessForecast(userId: number, signal?: AbortSignal): Promise<WellnessForecast> {
  const response = await fetch(`${API_BASE_URL}/api/v1/user/${userId}/wellness-forecast`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Wellness forecast request failed with status ${response.status}`);
  }

  return response.json() as Promise<WellnessForecast>;
}

export async function fetchLocalityHealthIntelligence(
  userId: number,
  options: { city?: string; locality?: string; radiusKm?: number } = {},
  signal?: AbortSignal,
): Promise<LocalityHealthIntelligence> {
  const params = new URLSearchParams({
    city: options.city ?? 'Bengaluru',
    locality: options.locality ?? 'Koramangala',
    radius_km: String(options.radiusKm ?? 3),
  });
  const response = await fetch(`${API_BASE_URL}/api/v1/user/${userId}/locality-health-intelligence?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Locality intelligence request failed with status ${response.status}`);
  }

  return response.json() as Promise<LocalityHealthIntelligence>;
}

export async function fetchDailyLog(userId: number, logDate: string, signal?: AbortSignal): Promise<DailyLogResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/user/${userId}/daily-log?log_date=${logDate}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Daily log request failed with status ${response.status}`);
  }

  return response.json() as Promise<DailyLogResponse>;
}

export async function saveDailyLog(userId: number, payload: DailyLogPayload): Promise<DailyLogResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/user/${userId}/daily-log`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Daily log save failed with status ${response.status}`);
  }

  return response.json() as Promise<DailyLogResponse>;
}

export async function saveSetupContext(userId: number, payload: SetupContextPayload): Promise<{ user_id: number; saved_tables: string[] }> {
  const response = await fetch(`${API_BASE_URL}/api/v1/user/${userId}/setup-context`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Setup context save failed with status ${response.status}`);
  }

  return response.json() as Promise<{ user_id: number; saved_tables: string[] }>;
}
