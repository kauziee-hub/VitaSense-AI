-- Additive emotional wellness fields used by the setup-context refinement.
-- Safe to run multiple times; does not alter existing data.

alter table public.user_emotional_wellness
  add column if not exists loneliness_level text,
  add column if not exists depression_signals text[] not null default '{}',
  add column if not exists anxiety_triggers text[] not null default '{}',
  add column if not exists burnout_risk text,
  add column if not exists emotional_support_system text,
  add column if not exists coping_mechanisms text[] not null default '{}',
  add column if not exists emotional_stability_score integer,
  add column if not exists social_interaction_frequency text,
  add column if not exists self_isolation_pattern text,
  add column if not exists emotional_notes text;
