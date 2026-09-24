-- Gym Log schema: tables logs (one row per day), plans (one row per user), health_days (one row per day) and
-- health_sync_keys (one per phone that syncs Health Connect in the background).
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

-- Health Connect data, written by the Android app (or restored from a backup) and read by every copy of the app: one row per day.
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

-- Background sync from the Android app. With the app closed there's no sign-in session to use, so each phone
-- gets a random key (only its SHA-256 is stored here) and sends its Health Connect days with it. The key can only
-- write health_days for its owner, through sync_health_days(); it can't read anything.
create table if not exists public.health_sync_keys (
  key_hash     text        primary key,
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  device       text        not null default '',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- Row-level security: you see your phones' keys and can delete them (turning background sync off); keys are only
-- made by create_health_sync_key().
alter table public.health_sync_keys enable row level security;

drop policy if exists "own sync keys: select" on public.health_sync_keys;
drop policy if exists "own sync keys: delete" on public.health_sync_keys;

create policy "own sync keys: select" on public.health_sync_keys for select to authenticated using (user_id = (select auth.uid()));
create policy "own sync keys: delete" on public.health_sync_keys for delete to authenticated using (user_id = (select auth.uid()));

-- A new key for this phone (replacing its old one), returned once. Needs a signed-in user.
create or replace function public.create_health_sync_key(device_name text default '')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  k   text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  delete from public.health_sync_keys where user_id = uid and device = coalesce(device_name, '');
  insert into public.health_sync_keys (key_hash, user_id, device)
  values (encode(extensions.digest(k, 'sha256'), 'hex'), uid, coalesce(device_name, ''));
  return k;
end $$;

revoke all on function public.create_health_sync_key(text) from public, anon;
grant execute on function public.create_health_sync_key(text) to authenticated;

-- Saves days sent with a phone's key: [{ "day": "2026-09-23", "data": { ... } }, ...], at most 40, each within the
-- last 400 days. Rows that didn't change are left alone. Returns how many changed.
create or replace function public.sync_health_days(sync_key text, days jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  kh  text := encode(extensions.digest(coalesce(sync_key, ''), 'sha256'), 'hex');
  uid uuid;
  d   jsonb;
  dd  date;
  n   integer := 0;
begin
  select user_id into uid from public.health_sync_keys where key_hash = kh;
  if uid is null then
    raise exception 'unknown sync key' using errcode = '28000';
  end if;
  if jsonb_typeof(days) is distinct from 'array' or jsonb_array_length(days) > 40 then
    raise exception 'days must be an array of at most 40' using errcode = '22023';
  end if;
  for d in select value from jsonb_array_elements(days) loop
    dd := (d ->> 'day')::date;
    if dd is null or dd < current_date - 400 or dd > current_date + 2
       or jsonb_typeof(d -> 'data') is distinct from 'object' or length((d -> 'data')::text) > 20000 then
      raise exception 'bad day in days' using errcode = '22023';
    end if;
    insert into public.health_days (user_id, day, data)
    values (uid, dd, d -> 'data')
    on conflict (user_id, day) do update set data = excluded.data
      where public.health_days.data is distinct from excluded.data;
    if found then
      n := n + 1;
    end if;
  end loop;
  update public.health_sync_keys set last_used_at = now() where key_hash = kh;
  return n;
end $$;

revoke all on function public.sync_health_days(text, jsonb) from public, authenticated;
-- Only the phone's background sync calls it, with no session (the anon role); signed-in use goes through RLS.
grant execute on function public.sync_health_days(text, jsonb) to anon;
