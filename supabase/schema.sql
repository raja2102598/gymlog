-- Gym Log schema: tables logs (one row per day), plans (one row per user) and health_days (one row per day).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.

create table if not exists public.logs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  day        date        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- keep updated_at current on every change
create or replace function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists logs_touch on public.logs;
create trigger logs_touch before update on public.logs
  for each row execute function public.touch_updated_at();

-- Row-level security: each signed-in user sees and edits only their own days.
alter table public.logs enable row level security;

drop policy if exists "own rows: select" on public.logs;
drop policy if exists "own rows: insert" on public.logs;
drop policy if exists "own rows: update" on public.logs;
drop policy if exists "own rows: delete" on public.logs;

create policy "own rows: select" on public.logs for select to authenticated using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.logs for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.logs for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows: delete" on public.logs for delete to authenticated using (user_id = (select auth.uid()));

-- Per-user workout plan edited in the app. plan.json in the repo is the default until a user edits theirs.
create table if not exists public.plans (
  user_id    uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  plan       jsonb       not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists plans_touch on public.plans;
create trigger plans_touch before update on public.plans
  for each row execute function public.touch_updated_at();

-- Row-level security: each signed-in user sees and edits only their own plan.
alter table public.plans enable row level security;

drop policy if exists "own plan: select" on public.plans;
drop policy if exists "own plan: insert" on public.plans;
drop policy if exists "own plan: update" on public.plans;
drop policy if exists "own plan: delete" on public.plans;

create policy "own plan: select" on public.plans for select to authenticated using (user_id = (select auth.uid()));
create policy "own plan: insert" on public.plans for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own plan: update" on public.plans for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own plan: delete" on public.plans for delete to authenticated using (user_id = (select auth.uid()));

-- Health Connect data, written by the Android app and read by every copy of the app: one row per day.
create table if not exists public.health_days (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  day        date        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

drop trigger if exists health_days_touch on public.health_days;
create trigger health_days_touch before update on public.health_days
  for each row execute function public.touch_updated_at();

-- Row-level security: each signed-in user sees and edits only their own health days.
alter table public.health_days enable row level security;

drop policy if exists "own health: select" on public.health_days;
drop policy if exists "own health: insert" on public.health_days;
drop policy if exists "own health: update" on public.health_days;
drop policy if exists "own health: delete" on public.health_days;

create policy "own health: select" on public.health_days for select to authenticated using (user_id = (select auth.uid()));
create policy "own health: insert" on public.health_days for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own health: update" on public.health_days for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own health: delete" on public.health_days for delete to authenticated using (user_id = (select auth.uid()));
