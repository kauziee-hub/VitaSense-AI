-- VitaSense hosted storage: records, medicines, dose logs and automatically collected data.
-- Used when the API runs with VITASENSE_STORAGE=supabase (for example on Vercel, where the
-- local SQLite file would be wiped). Run once in the Supabase SQL editor. Safe to re-run.
--
-- The API reaches these tables with the service role key, which bypasses row level security.
-- RLS is switched on with no policies so the public (anon) key can never read them.

create table if not exists public.vs_health_records (
    id text primary key,
    user_id bigint not null,
    created_at timestamptz not null default now(),
    file_name text not null,
    mime_type text not null,
    file_path text,
    document_type text not null,
    document_date text,
    title text,
    facility text,
    doctor text,
    summary text,
    extracted jsonb not null default '{}'::jsonb,
    file_hash text
);
create index if not exists vs_health_records_user on public.vs_health_records (user_id, created_at);
create index if not exists vs_health_records_hash on public.vs_health_records (user_id, file_hash);

create table if not exists public.vs_medications (
    id text primary key,
    user_id bigint not null,
    record_id text references public.vs_health_records (id) on delete cascade,
    name text not null,
    strength text,
    form text,
    dose text,
    times jsonb not null default '[]'::jsonb,
    as_needed boolean not null default false,
    food_timing text,
    instructions text,
    start_date text not null,
    end_date text,
    active boolean not null default true,
    created_at timestamptz not null default now()
);
create index if not exists vs_medications_user on public.vs_medications (user_id, active);

create table if not exists public.vs_dose_logs (
    medication_id text not null references public.vs_medications (id) on delete cascade,
    user_id bigint not null,
    dose_date text not null,
    dose_time text not null,
    status text not null,
    logged_at timestamptz not null default now(),
    primary key (medication_id, dose_date, dose_time)
);
create index if not exists vs_dose_logs_user on public.vs_dose_logs (user_id, dose_date);

create table if not exists public.vs_collected_daily (
    user_id bigint not null,
    table_name text not null,
    log_date text not null,
    field text not null,
    value jsonb,
    source text not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, table_name, log_date, field)
);
create index if not exists vs_collected_daily_user_date on public.vs_collected_daily (user_id, log_date);

create table if not exists public.vs_collected_items (
    user_id bigint not null,
    source text not null,
    item_id text not null,
    happened_at text,
    kind text not null,
    summary text not null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    primary key (user_id, source, item_id)
);

create table if not exists public.vs_connections (
    user_id bigint not null,
    source text not null,
    connected_at timestamptz not null default now(),
    last_sync_at timestamptz,
    last_result jsonb,
    primary key (user_id, source)
);

alter table public.vs_health_records enable row level security;
alter table public.vs_medications enable row level security;
alter table public.vs_dose_logs enable row level security;
alter table public.vs_collected_daily enable row level security;
alter table public.vs_collected_items enable row level security;
alter table public.vs_connections enable row level security;

-- Private bucket for the original uploaded reports and prescriptions.
insert into storage.buckets (id, name, public)
values ('health-records', 'health-records', false)
on conflict (id) do nothing;
