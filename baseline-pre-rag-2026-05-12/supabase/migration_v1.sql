-- =========================================================
-- Chalk Talk — Supabase migration v1
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Idempotent: safe to re-run; uses IF NOT EXISTS / drop-and-recreate.
-- =========================================================

-- 1) profiles (extends auth.users; all fields except id/email optional)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  role text check (role in ('student','resident','fellow','attending','other')),
  specialty text,                     -- ABIM specialty (managed in app dropdown)
  training_year int check (training_year >= 0 and training_year <= 15),
  institution text,
  primary_use text check (primary_use in ('teaching','boards','personal','other')),
  subscription_tier text not null default 'free' check (subscription_tier in ('free','pro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'User profile extending auth.users — all fields except id/email are optional';

-- 2) talks (saved chalk talks; jsonb stores full talk object)
create table if not exists public.talks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  topic text not null,
  refine_context text,
  style text not null check (style in ('lecture','boards')),
  depth text check (depth in ('concise','detailed')),
  talk_json jsonb not null,           -- the full talk object
  references_json jsonb,              -- references array (if any)
  files_meta jsonb,                   -- {name, size, type} for uploaded refs
  is_public boolean not null default false,
  share_token uuid default gen_random_uuid() unique,
  view_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists talks_user_idx on public.talks(user_id, created_at desc);
create index if not exists talks_share_idx on public.talks(share_token);

-- 3) favorites (sample slugs the user has starred)
create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  sample_slug text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, sample_slug)
);

-- =========================================================
-- Triggers
-- =========================================================

-- Auto-create profile when a new auth.users row is inserted
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auto-update updated_at on profiles & talks
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists talks_updated_at on public.talks;
create trigger talks_updated_at before update on public.talks
  for each row execute function public.set_updated_at();

-- =========================================================
-- Row-Level Security
-- =========================================================

alter table public.profiles enable row level security;
alter table public.talks enable row level security;
alter table public.favorites enable row level security;

-- Profiles: each user sees and edits only their own row
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

-- Talks: full CRUD on own; SELECT on public talks (for share links)
drop policy if exists "talks_select_own" on public.talks;
create policy "talks_select_own" on public.talks
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "talks_select_public" on public.talks;
create policy "talks_select_public" on public.talks
  for select to anon, authenticated using (is_public = true);

drop policy if exists "talks_insert_own" on public.talks;
create policy "talks_insert_own" on public.talks
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "talks_update_own" on public.talks;
create policy "talks_update_own" on public.talks
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "talks_delete_own" on public.talks;
create policy "talks_delete_own" on public.talks
  for delete to authenticated using (auth.uid() = user_id);

-- Favorites: own only
drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own" on public.favorites
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own" on public.favorites
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own" on public.favorites
  for delete to authenticated using (auth.uid() = user_id);

-- =========================================================
-- Sanity check (read-only — won't fail if empty)
-- =========================================================

select 'Tables created:' as msg;
select tablename from pg_tables where schemaname = 'public' and tablename in ('profiles','talks','favorites');

select 'RLS enabled:' as msg;
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('profiles','talks','favorites');

select 'Policies:' as msg;
select tablename, policyname from pg_policies where schemaname = 'public' order by tablename, policyname;
