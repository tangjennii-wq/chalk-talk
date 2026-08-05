-- THE FOUR BILLING FUNCTIONS, CAPTURED IN VERSION CONTROL AND HARDENED. 2026-07-31.
--
-- ── WHY THEY WERE NOT HERE ───────────────────────────────────────────────────────────────────────────
-- These were created outside the repo (dashboard or an unrecorded migration), so supabase/migrations/
-- held no definition for any of them. That is a large part of why anon holding EXECUTE on all four went
-- unnoticed: there was no file in which SECURITY DEFINER and a missing revoke could appear side by side
-- in a diff, and a rebuild from migrations would not have recreated them at all.
--
-- ── THE SECOND DEFECT: NO search_path ────────────────────────────────────────────────────────────────
-- Every one is SECURITY DEFINER — it runs as the owner and bypasses RLS — and every one referenced its
-- tables UNQUALIFIED (`free_tier_usage`, `spend_ledger`) with no search_path pinned:
--
--     proconfig -> (no search_path set)     for all four
--
-- Postgres searches pg_temp FIRST by default. A caller able to create a temporary table named
-- `free_tier_usage` therefore shadows the real one, and the SECURITY DEFINER function reads and writes
-- the attacker's table AS THE OWNER. Revoking EXECUTE closed the direct route; this closes the hijack
-- that would return the moment anyone re-grants one of these or adds a new caller.
--
-- Both fixes together: schema-qualify every reference AND pin search_path with pg_temp LAST.
-- Definitions are the live ones from pg_get_functiondef on 2026-07-31 with only qualification and the
-- SET added. Behaviour verified unchanged afterwards:
--     free_tier_remaining(real user)      -> 6 talks / 5 images   (matches the badge)
--     free_tier_remaining(unknown user)   -> 10 talks / 5 images  (falls back to base)
--     free_tier_grant_bonus(bad email)    -> false
begin;

create or replace function public.free_tier_consume(
  p_user_id uuid, p_kind text, p_amount integer default 1, p_base integer default 5
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $function$
begin
  insert into public.free_tier_usage (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  if p_kind = 'talk' then
    update public.free_tier_usage
      set talks_used = talks_used + p_amount, updated_at = now()
      where user_id = p_user_id and (p_base + bonus_talks - talks_used) >= p_amount;
  elsif p_kind = 'image' then
    update public.free_tier_usage
      set images_used = images_used + p_amount, updated_at = now()
      where user_id = p_user_id and (p_base + bonus_images - images_used) >= p_amount;
  else
    return false;
  end if;
  return found;
end;
$function$;

create or replace function public.free_tier_remaining(
  p_user_id uuid, p_base_talks integer default 10, p_base_images integer default 5
) returns table (talks_remaining integer, images_remaining integer)
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare rec public.free_tier_usage;
begin
  select * into rec from public.free_tier_usage where user_id = p_user_id;
  if not found then
    return query select p_base_talks, p_base_images;
  else
    return query select
      greatest(0, p_base_talks  + rec.bonus_talks  - rec.talks_used),
      greatest(0, p_base_images + rec.bonus_images - rec.images_used);
  end if;
end;
$function$;

-- NOTE PLAINLY WHAT THIS IS: it raises anyone's spending limit given only their email address, and
-- authorises nothing itself. It is safe ONLY because nothing but the service role may execute it. If a
-- caller is ever added, it needs a real authorisation check first — not a grant.
create or replace function public.free_tier_grant_bonus(
  p_email text, p_bonus_talks integer default 0, p_bonus_images integer default 0
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare v_uid uuid;
begin
  select id into v_uid from auth.users where email = lower(p_email) limit 1;
  if v_uid is null then return false; end if;
  insert into public.free_tier_usage (user_id, bonus_talks, bonus_images)
    values (v_uid, p_bonus_talks, p_bonus_images)
  on conflict (user_id) do update
    set bonus_talks  = public.free_tier_usage.bonus_talks  + excluded.bonus_talks,
        bonus_images = public.free_tier_usage.bonus_images + excluded.bonus_images,
        updated_at   = now();
  return true;
end;
$function$;

create or replace function public.ledger_add(
  p_month text, p_kind text, p_cost_cents integer, p_cap_cents integer default 25000
) returns table (new_total_cents integer, threshold_crossed integer)
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare old_total int; v_new_total int; old_threshold int; new_threshold int;
begin
  insert into public.spend_ledger (month_key) values (p_month) on conflict (month_key) do nothing;
  select total_cents, last_alert_threshold into old_total, old_threshold
    from public.spend_ledger where month_key = p_month for update;
  v_new_total   := old_total + greatest(0, p_cost_cents);
  new_threshold := old_threshold;
  if    v_new_total >= p_cap_cents            and old_threshold < 100 then new_threshold := 100;
  elsif v_new_total >= (p_cap_cents * 8 / 10) and old_threshold < 80  then new_threshold := 80;
  elsif v_new_total >= (p_cap_cents / 2)      and old_threshold < 50  then new_threshold := 50;
  end if;
  update public.spend_ledger
    set total_cents = v_new_total,
        talk_count  = talk_count  + case when p_kind = 'talk'  then 1 else 0 end,
        image_count = image_count + case when p_kind = 'image' then 1 else 0 end,
        last_alert_threshold = new_threshold, updated_at = now()
    where month_key = p_month;
  return query select v_new_total,
    case when new_threshold > old_threshold then new_threshold else 0 end;
end;
$function$;

-- The definition and its access control now live in ONE file. They drifted apart before, and that is
-- how a SECURITY DEFINER quota-granting function ended up callable with a key that ships in page source.
revoke all on function public.free_tier_consume(uuid, text, integer, integer)   from public, anon, authenticated;
revoke all on function public.free_tier_remaining(uuid, integer, integer)       from public, anon, authenticated;
revoke all on function public.free_tier_grant_bonus(text, integer, integer)     from public, anon, authenticated;
revoke all on function public.ledger_add(text, text, integer, integer)          from public, anon, authenticated;

grant execute on function public.free_tier_consume(uuid, text, integer, integer)   to service_role;
grant execute on function public.free_tier_remaining(uuid, integer, integer)       to service_role;
grant execute on function public.free_tier_grant_bonus(text, integer, integer)     to service_role;
grant execute on function public.ledger_add(text, text, integer, integer)          to service_role;

-- The three intentionally public-callable SECURITY DEFINER functions get the same search_path pin.
-- Being public-callable makes pinning MORE important, not less.
alter function public.get_public_profile(text)  set search_path = public, pg_temp;
alter function public.is_handle_available(text) set search_path = public, pg_temp;
alter function public.handle_new_user()         set search_path = public, pg_temp;
alter function public.reject_reserved_handle()  set search_path = public, pg_temp;

commit;
