-- Optional future-ready locality intelligence persistence.
-- This migration is additive only and is not required for demo mode.

create table if not exists public.locality_health_signals (
  id bigserial primary key,
  user_id integer references public.users(id) on delete cascade,
  city text not null,
  locality text not null,
  geo_radius_km numeric not null default 3,
  layer text not null,
  title text not null,
  severity text not null,
  trend text,
  risk_probability numeric,
  source text,
  confidence text,
  correlated_symptoms text[] not null default '{}',
  recommended_actions text[] not null default '{}',
  generated_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.disease_outbreaks (
  id bigserial primary key,
  city text not null,
  locality text not null,
  disease_name text not null,
  severity text not null,
  trend text,
  affected_radius_km numeric,
  risk_probability numeric,
  source text,
  confidence text,
  correlated_symptoms text[] not null default '{}',
  generated_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.community_symptom_clusters (
  id bigserial primary key,
  city text not null,
  locality text not null,
  symptom text not null,
  report_count integer not null default 0,
  window_hours integer not null default 48,
  weekly_change_percent numeric,
  severity text,
  confidence text,
  geo_radius_km numeric,
  generated_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.food_safety_alerts (
  id bigserial primary key,
  city text not null,
  locality text not null,
  alert_title text not null,
  severity text not null,
  vendor_zone text,
  risk_probability numeric,
  source text,
  confidence text,
  correlated_symptoms text[] not null default '{}',
  recommended_actions text[] not null default '{}',
  generated_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.environmental_hazard_reports (
  id bigserial primary key,
  city text not null,
  locality text not null,
  hazard_type text not null,
  severity text not null,
  trend text,
  affected_radius_km numeric,
  risk_probability numeric,
  source text,
  confidence text,
  correlated_symptoms text[] not null default '{}',
  recommended_actions text[] not null default '{}',
  generated_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_locality_risk_analysis (
  id bigserial primary key,
  user_id integer references public.users(id) on delete cascade,
  city text not null,
  locality text not null,
  geo_radius_km numeric not null default 3,
  overall_severity text not null,
  overall_probability numeric,
  confidence text,
  correlation_explanation text,
  risk_payload jsonb not null default '{}'::jsonb,
  generated_on date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists idx_locality_health_signals_area_created
  on public.locality_health_signals(city, locality, created_at desc);

create index if not exists idx_disease_outbreaks_area_created
  on public.disease_outbreaks(city, locality, created_at desc);

create index if not exists idx_community_symptom_clusters_area_created
  on public.community_symptom_clusters(city, locality, created_at desc);

create index if not exists idx_food_safety_alerts_area_created
  on public.food_safety_alerts(city, locality, created_at desc);

create index if not exists idx_environmental_hazard_reports_area_created
  on public.environmental_hazard_reports(city, locality, created_at desc);

create index if not exists idx_ai_locality_risk_analysis_user_created
  on public.ai_locality_risk_analysis(user_id, created_at desc);
