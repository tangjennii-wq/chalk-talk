-- Public shareable profile handles (#u/<handle>). Applied to the live DB 2026-07-09; captured here
-- for reproducibility (a fresh rebuild without this would break get_public_profile/is_handle_available).
-- ONE TRANSACTION (added 2026-07-29). psql autocommits each statement unless told otherwise, and
-- `-v ON_ERROR_STOP=1` stops on error WITHOUT undoing what already committed. Unwrapped, a failure
-- partway through this file leaves the database in the half-migrated state — for a file containing
-- DROP or ALTER, that can mean a dropped object that never got recreated. Verified on a live database:
-- a DROP followed by a failure inside a transaction rolls back and the original object survives; the
-- same DROP unwrapped commits on its own and the object is gone.
begin;

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

-- Server-side reserved-handle enforcement (the frontend list is bypassable via a direct update).
create or replace function public.reject_reserved_handle()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.handle is not null and lower(new.handle) = any(array[
    'u','showcase','admin','api','app','www','profile','profiles','share','shared','chalk','chalktalk',
    'about','help','settings','login','signup','signin','signout','auth','me','new','edit','talk','talks',
    'lib','library','null','undefined','anon','user','users','home','index','root','support','terms','privacy'
  ]) then
    raise exception 'handle "%" is reserved', new.handle using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists profiles_reserved_handle on public.profiles;
create trigger profiles_reserved_handle
  before insert or update of handle on public.profiles
  for each row execute function public.reject_reserved_handle();

commit;
