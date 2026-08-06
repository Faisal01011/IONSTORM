-- IONSTORM account storage
-- Run this file once in the Supabase SQL Editor.
-- The browser uses only the publishable/anon key. RLS is the security boundary.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  callsign text not null default 'PILOT',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pilot_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_run_id text not null,
  score integer not null default 0 check (score >= 0),
  wave integer not null default 1 check (wave >= 1),
  kills integer not null default 0 check (kills >= 0),
  max_combo integer not null default 0 check (max_combo >= 0),
  mode text not null default 'standard' check (mode in ('standard', 'daily')),
  challenge_date date,
  ship text not null default 'vanguard',
  accuracy smallint not null default 0 check (accuracy between 0 and 100),
  damage integer not null default 0 check (damage >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, client_run_id)
);

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.pilot_saves to authenticated;
grant select, insert, update, delete on public.runs to authenticated;

alter table public.profiles enable row level security;
alter table public.pilot_saves enable row level security;
alter table public.runs enable row level security;

drop policy if exists "pilots can read their profile" on public.profiles;
create policy "pilots can read their profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "pilots can create their profile" on public.profiles;
create policy "pilots can create their profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "pilots can update their profile" on public.profiles;
create policy "pilots can update their profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "pilots can delete their profile" on public.profiles;
create policy "pilots can delete their profile"
  on public.profiles for delete to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "pilots can read their save" on public.pilot_saves;
create policy "pilots can read their save"
  on public.pilot_saves for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "pilots can create their save" on public.pilot_saves;
create policy "pilots can create their save"
  on public.pilot_saves for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "pilots can update their save" on public.pilot_saves;
create policy "pilots can update their save"
  on public.pilot_saves for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "pilots can delete their save" on public.pilot_saves;
create policy "pilots can delete their save"
  on public.pilot_saves for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "pilots can read their runs" on public.runs;
create policy "pilots can read their runs"
  on public.runs for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "pilots can create their runs" on public.runs;
create policy "pilots can create their runs"
  on public.runs for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "pilots can update their runs" on public.runs;
create policy "pilots can update their runs"
  on public.runs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "pilots can delete their runs" on public.runs;
create policy "pilots can delete their runs"
  on public.runs for delete to authenticated
  using ((select auth.uid()) = user_id);
