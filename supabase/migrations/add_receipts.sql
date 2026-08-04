-- RECEIPTS — atomic authorisation for paid model calls.
--
-- ── WHY THIS LEFT KV (Codex, 2026-07-30) ─────────────────────────────────────────────────────────────
-- Receipt redemption was a KV read-modify-write. Codex said that cannot bound concurrent reuse. Measured
-- rather than argued, against the real handler with an async KV stub:
--
--     stage budget: 3
--     concurrent requests: 10
--     allowed through: 10
--     UPSTREAM CALLS BILLED: 10
--
-- Not "could occasionally exceed" — every single one got through. Ten simultaneous requests each read
-- used=0, each decided it was within budget, and each spent money. The bound was decorative under the
-- one condition where a bound matters.
--
-- Postgres has row-level locking, so a single UPDATE ... WHERE used < max is genuinely atomic: concurrent
-- transactions serialise on the row and exactly `max` of them can win. That is the property KV cannot
-- provide, and Supabase is already in the request path for quota, so this adds a dependency we already
-- have rather than a new one.
--
-- Cost: one database round trip per paid model call. Accepted deliberately — a billing control that is
-- fast and wrong is worth less than one that is correct.
--
-- ── VERIFIED AGAINST PRODUCTION, AND A TRAP WORTH RECORDING (2026-07-30) ─────────────────────────────
-- Sequential redemptions, each its own statement — which is what separate HTTP requests are:
--
--     redeem #1 -> ok, used 1/2
--     redeem #2 -> ok, used 2/2
--     redeem #3 -> REFUSED, stage_exhausted
--     wrong job -> wrong_job          wrong user -> wrong_owner
--     uncleared model -> model_not_authorised    unknown stage -> stage_not_authorised
--
-- THE TRAP. My first attempt tested concurrency with
--     select ... from generate_series(1,10) cross join lateral receipt_redeem(...)
-- and got TEN authorised against a budget of two. That is not the function failing — every lateral
-- invocation runs inside ONE statement and therefore shares one snapshot, so each reads used=0. It
-- measured a property of my test, not of the lock.
--
-- ── THE CONCURRENT CASE, NOW MEASURED (2026-07-30) ───────────────────────────────────────────────────
-- I first wrote that I could not orchestrate genuinely parallel connections from the tooling available,
-- and left it as a psql loop for Jenni. That was giving up one step early. dblink was available:
-- temporarily installed, a login role created with EXECUTE on this function and an RLS policy scoped to
-- one test job id, then TEN separate backends opened and fired with dblink_send_query so every request
-- was in flight before any result was read.
--
--     concurrent_connections: 10
--     authorised:              2      <- exactly the budget
--     refused:                 8
--     counter_after:           2
--
-- Ten transactions, one row, two winners. The row lock does what the design assumes.
--
-- Two false starts worth keeping, because both produced a confident wrong answer:
--   1. generate_series + lateral -> 10 authorised. One statement, one snapshot, every call read used=0.
--      It measured the test, not the lock. I nearly reported it as the function failing.
--   2. Issuing the receipt inside the same DO block as the dblink calls -> 0 authorised. The insert had
--      not committed, so the external connections could not see the row at all.
-- A concurrency test that shares a snapshot, or races against uncommitted data, is not a concurrency
-- test. Both failure modes look like a result.
--
-- Everything created for this was removed and the removal verified: role, extension, policy, grants and
-- the test receipt all confirmed absent afterwards.
--
begin;

create table if not exists public.generation_receipts (
  id             uuid primary key,
  user_id        uuid not null,
  -- Binds the receipt to ONE generation. A receipt for job A cannot authorise job B, which is what
  -- stopped a single consumed credit from funding unlimited talks.
  job_id         text,
  kind           text not null default 'talk',
  -- The model gate travels with the receipt rather than on a client header, so there is no request
  -- Chalk Talk's front end can shape that routes around it.
  allowed_models text[] not null,
  -- {"draft": {"max": 1, "used": 0}, ...}. Per-stage so a draft authorisation cannot be spent as a
  -- critique, and so each attempt is individually countable.
  stages         jsonb not null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);

create index if not exists generation_receipts_expiry_idx on public.generation_receipts (expires_at);
create index if not exists generation_receipts_user_idx   on public.generation_receipts (user_id);

-- ── REDEEM: one atomic UPDATE, which is the whole point ──────────────────────────────────────────────
-- The WHERE clause carries every condition, so the decision and the decrement are the same statement.
-- Splitting them — read, decide, write — is exactly the shape that let ten requests through three slots.
create or replace function public.receipt_redeem(
  p_receipt uuid,
  p_user_id uuid,
  p_job     text,
  p_stage   text,
  p_model   text
)
returns table (ok boolean, reason text, used int, max_allowed int)
language plpgsql
volatile
as $$
declare
  v_used int;
  v_max  int;
  v_rec  public.generation_receipts%rowtype;
begin
  update public.generation_receipts r
     set stages = jsonb_set(
           r.stages,
           array[p_stage, 'used'],
           to_jsonb(((r.stages -> p_stage ->> 'used')::int) + 1))
   where r.id = p_receipt
     and r.user_id = p_user_id
     and (r.job_id is null or r.job_id = p_job)
     and r.expires_at > now()
     and r.stages ? p_stage
     and ((r.stages -> p_stage ->> 'used')::int) < ((r.stages -> p_stage ->> 'max')::int)
     and p_model = any(r.allowed_models)
  returning ((r.stages -> p_stage ->> 'used')::int),
            ((r.stages -> p_stage ->> 'max')::int)
    into v_used, v_max;

  if found then
    return query select true, 'ok'::text, v_used, v_max;
    return;
  end if;

  -- Only on the failure path do we spend a second query working out WHY. Distinguishing the reasons
  -- matters: "you are out of budget" and "that model is not authorised" are different bugs for whoever
  -- is reading the logs, and one of them is a 403 rather than a 402.
  select * into v_rec from public.generation_receipts where id = p_receipt;
  if not found then                       return query select false, 'unknown_or_expired'::text, 0, 0; return; end if;
  if v_rec.user_id <> p_user_id then      return query select false, 'wrong_owner'::text, 0, 0; return; end if;
  if v_rec.expires_at <= now() then       return query select false, 'expired'::text, 0, 0; return; end if;
  if v_rec.job_id is not null and v_rec.job_id <> p_job then
                                          return query select false, 'wrong_job'::text, 0, 0; return; end if;
  if not (p_model = any(v_rec.allowed_models)) then
                                          return query select false, 'model_not_authorised'::text, 0, 0; return; end if;
  if not (v_rec.stages ? p_stage) then    return query select false, 'stage_not_authorised'::text, 0, 0; return; end if;
  return query select false, 'stage_exhausted'::text,
                      ((v_rec.stages -> p_stage ->> 'used')::int),
                      ((v_rec.stages -> p_stage ->> 'max')::int);
end;
$$;

comment on function public.receipt_redeem is
  'Atomically authorise ONE paid model call against a receipt, bound to user, job, stage and model. The '
  'decision and the decrement are a single UPDATE so concurrent requests serialise on the row — a KV '
  'read-modify-write let 10 simultaneous requests through a budget of 3, all of them billed.';

-- ── ISSUE: minted server-side only ───────────────────────────────────────────────────────────────────
-- Service-role only, so a browser cannot mint its own authorisation. That would make every check below
-- it ornamental.
create or replace function public.receipt_issue(
  p_id uuid, p_user_id uuid, p_job text, p_kind text,
  p_allowed_models text[], p_stages jsonb, p_ttl_seconds int
) returns void
language sql volatile as $$
  insert into public.generation_receipts (id, user_id, job_id, kind, allowed_models, stages, expires_at)
  values (p_id, p_user_id, p_job, p_kind, p_allowed_models, p_stages,
          now() + make_interval(secs => p_ttl_seconds))
  on conflict (id) do nothing;
$$;

-- Housekeeping. Receipts are short-lived; nothing depends on them after expiry.
create or replace function public.receipt_gc() returns int
language sql volatile as $$
  with d as (delete from public.generation_receipts where expires_at < now() - interval '1 day' returning 1)
  select count(*)::int from d;
$$;

-- ⚠ THIS BLOCK DID NOT DO WHAT IT SAYS. Corrected 2026-07-31 in
-- revoke_public_execute_on_privileged_rpcs.sql — see that file for the full finding.
--
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, and revoking from anon and authenticated does
-- NOT remove it: both roles keep inheriting it through PUBLIC. So `has_function_privilege('anon',
-- 'receipt_issue', 'EXECUTE')` was TRUE from the day this migration ran. What actually stopped a
-- browser minting receipts was RLS on generation_receipts (enabled, zero policies) plus the table
-- grant below — not the function-level control this comment claims.
--
-- The revokes are LEFT AS WRITTEN rather than edited, because the mistake is the point: an explicit
-- revoke that reads correctly, passes review, and silently leaves the default grant in place.
--
-- Service role only. These are minted and redeemed by the Worker, never by a browser: a client that
-- could mint its own receipt would make the whole mechanism ornamental.
revoke all on public.generation_receipts from anon, authenticated;
revoke all on function public.receipt_redeem(uuid, uuid, text, text, text) from anon, authenticated;
revoke all on function public.receipt_issue(uuid, uuid, text, text, text[], jsonb, int) from anon, authenticated;
grant execute on function public.receipt_issue(uuid, uuid, text, text, text[], jsonb, int) to service_role;
grant execute on function public.receipt_redeem(uuid, uuid, text, text, text) to service_role;
grant execute on function public.receipt_gc() to service_role;
grant all on public.generation_receipts to service_role;

alter table public.generation_receipts enable row level security;
-- No policies: with RLS on and none defined, anon/authenticated get nothing. service_role bypasses RLS.

commit;
