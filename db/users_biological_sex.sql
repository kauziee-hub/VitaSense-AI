-- Lets each profile choose the male or female body render (and gives the AI that context).
-- Run once in the Supabase SQL editor. Safe to re-run.
alter table public.users add column if not exists biological_sex text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_biological_sex_check') then
    alter table public.users add constraint users_biological_sex_check check (biological_sex in ('male', 'female'));
  end if;
end $$;
