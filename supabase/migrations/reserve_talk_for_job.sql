-- ONE RESERVATION PER JOB, ENFORCED IN POSTGRES. 2026-07-31.
--
-- ── THE BUG (Codex) ──────────────────────────────────────────────────────────────────────────────────
-- Duplicate submissions could consume TWO credits. The submit handler checked KV for an existing job,
-- and KV is EVENTUALLY CONSISTENT: a double-click can miss that read, consume a second talk, and only
-- then learn from Workflow.create() that the instance already exists — returning `resumed: true` with
-- the surplus reservation still taken.
--
-- My own test asserted `consume === 0` for the duplicate and PASSED, because the KV stub inside it is
-- strongly consistent. It was testing the stub, not the system. That is the same failure mode as every
-- other instrument in this project that reported a state it had not earned.
--
-- ── WHY A JOB-KEYED REFUND CANNOT FIX IT ─────────────────────────────────────────────────────────────
-- Refunding the surplus immediately would spend the ONE refund slot `refunded_jobs` allows for this job
-- id, so a later genuine cancellation of the original reservation would find `already_refunded` and
-- decline to return the credit. Fixing a double-charge that way manufactures a lost refund. The
-- reservation has to be idempotent, not compensated afterwards.
--
-- ── THE PRIMITIVE ────────────────────────────────────────────────────────────────────────────────────
-- job_reservations.job_id is the primary key, so `insert ... on conflict do nothing` admits exactly one
-- reserver per job however many requests race. Only that winner consumes quota; everyone else is told
-- `already_reserved` and consumes nothing. A duplicate submit is free BY CONSTRUCTION rather than by a
-- KV read happening to be fresh.
--
-- Measured live: five submits for one job id -> 1 reserved, 4 already_reserved, talks_used 4 -> 5
-- (exactly one credit). The probe was reversed and the row removed afterwards.
begin;

-- The return type gained owner_id, and CREATE OR REPLACE cannot change an OUT-parameter row type.
drop function if exists public.reserve_talk_for_job(text, uuid, integer);

create table if not exists public.job_reservations (
  job_id      text primary key,
  user_id     uuid not null,
  state       text not null default 'reserved' check (state in ('reserved', 'refunded')),
  reserved_at timestamptz not null default now(),
  settled_at  timestamptz
);

create index if not exists job_reservations_user_idx on public.job_reservations (user_id);

-- ── EXPORTED FROM THE LIVE DATABASE, NOT REWRITTEN FROM MEMORY ──────────────────────────────────────
-- The owner check below was applied to production with execute_sql and this file was NOT updated. So
-- the repo said `already_reserved` on every conflict while production said `owned_by_other` — meaning a
-- rebuild from migrations would have RESTORED the cross-user vulnerability, and the Worker (which reads
-- owner_id) would have broken against the rebuilt function.
--
-- This is the same defect I wrote a security review about EARLIER TODAY: the four billing functions had
-- no checked-in definition, and that is why anon holding EXECUTE on them went unnoticed. Repeating it
-- within hours is the argument for exporting rather than retyping. The body below is
-- pg_get_functiondef() output from the live database on 2026-07-31, reformatted only in whitespace.
--
-- ── WHY THE OWNER CHECK EXISTS ───────────────────────────────────────────────────────────────────────
-- p_job_id is CLIENT-SUPPLIED. Returning `already_reserved` on any primary-key conflict gave a second
-- user a free pass on a known job id; the handler then overwrote the KV record's userId and the stored
-- job body before discovering the existing Workflow, redirecting the first user's generation to the
-- second. A cross-account leak, and worse than the double-charge this function was written to prevent.
--
-- Verified live: owner -> reserved, owner again -> already_reserved, STRANGER -> owned_by_other.
create or replace function public.reserve_talk_for_job(
  p_job_id text, p_user_id uuid, p_base integer default 10
) returns table (reserved boolean, outcome text, owner_id uuid)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_inserted boolean := false;
  v_got      boolean := false;
  v_owner    uuid;
begin
  if p_job_id is null or p_job_id = '' or p_user_id is null then
    return query select false, 'bad_arguments'::text, null::uuid; return;
  end if;

  insert into public.job_reservations (job_id, user_id) values (p_job_id, p_user_id)
  on conflict (job_id) do nothing;

  get diagnostics v_inserted = row_count;
  if not v_inserted then
    select user_id into v_owner from public.job_reservations where job_id = p_job_id;
    if v_owner is distinct from p_user_id then
      -- A DIFFERENT user holds this job id. Consumes nothing, and the caller must refuse the request
      -- rather than adopting the job.
      return query select false, 'owned_by_other'::text, v_owner; return;
    end if;
    -- The caller's own duplicate submit: free, by construction.
    return query select false, 'already_reserved'::text, v_owner; return;
  end if;

  insert into public.free_tier_usage (user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.free_tier_usage
     set talks_used = talks_used + 1, updated_at = now()
   where user_id = p_user_id and (p_base + bonus_talks - talks_used) >= 1;

  get diagnostics v_got = row_count;
  if not v_got then
    -- Out of quota: roll the reservation back so the job id stays reusable after a top-up.
    delete from public.job_reservations where job_id = p_job_id;
    return query select false, 'quota_exhausted'::text, null::uuid; return;
  end if;

  return query select true, 'reserved'::text, p_user_id;
end;
$function$;

comment on function public.reserve_talk_for_job is
  'Reserve exactly one talk per job id, ever, BOUND TO AN OWNER. On conflict it reports who holds the '
  'reservation so a caller can distinguish its own duplicate (free) from another users job (refuse). Without the owner check, a client-supplied job id let a second user adopt the first users job.';

-- refund_talk_once also settles the reservation, so "reserved?" and "refunded?" are one record that
-- cannot disagree with itself.
create or replace function public.refund_talk_once(
  p_job_id text, p_user_id uuid, p_reason text default null
) returns table (refunded boolean, outcome text)
language plpgsql volatile security definer set search_path = public, pg_temp
as $function$
declare v_inserted boolean := false;
begin
  if p_job_id is null or p_job_id = '' or p_user_id is null then
    return query select false, 'bad_arguments'::text; return;
  end if;

  insert into public.refunded_jobs (job_id, user_id, reason)
  values (p_job_id, p_user_id, coalesce(p_reason, 'unspecified'))
  on conflict (job_id) do nothing;

  get diagnostics v_inserted = row_count;
  if not v_inserted then
    return query select false, 'already_refunded'::text; return;
  end if;

  insert into public.free_tier_usage (user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.free_tier_usage
     set talks_used = greatest(0, talks_used - 1), updated_at = now()
   where user_id = p_user_id;

  update public.job_reservations set state = 'refunded', settled_at = now() where job_id = p_job_id;

  return query select true, 'refunded'::text;
end;
$function$;

revoke all on function public.reserve_talk_for_job(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_talk_for_job(text, uuid, integer) to service_role;

alter table public.job_reservations enable row level security;
revoke all on public.job_reservations from anon, authenticated;
grant all on public.job_reservations to service_role;

commit;
