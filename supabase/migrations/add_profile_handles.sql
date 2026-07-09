-- Public shareable profile handles (#u/<handle>). Applied to the live DB 2026-07-09; captured here
-- for reproducibility (a fresh rebuild without this would break get_public_profile/is_handle_available).
alter table public.profiles add column if not exists handle text;

-- Handle format: 3-30 chars, lowercase letters/digits/underscore. Existing rows are NULL → valid.
alter table public.profiles drop constraint if exists profiles_handle_format;
alter table public.profiles add constraint profiles_handle_format
  check (handle is null or handle ~ '^[a-z0-9_]{3,30}$');

-- Case-insensitive uniqueness among non-null handles.
create unique index if not exists profiles_handle_lower_uidx
  on public.profiles (lower(handle)) where handle is not null;

-- Public profile lookup by handle. SECURITY DEFINER exposes ONLY safe fields (name, role, specialty) —
-- never email/institution. Callable anonymously.
create or replace function public.get_public_profile(p_handle text)
returns table(user_id uuid, handle text, display_name text, role text, specialty text)
language sql stable security definer set search_path = public as $$
  select id, handle, name, role, specialty
  from public.profiles
  where lower(handle) = lower(p_handle)
  limit 1;
$$;
grant execute on function public.get_public_profile(text) to anon, authenticated;

-- Availability check for the handle picker. Returns true if the handle is free.
create or replace function public.is_handle_available(p_handle text)
returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where lower(handle) = lower(p_handle));
$$;
grant execute on function public.is_handle_available(text) to authenticated;
