-- EXACTLY-ONCE REFUND, KEYED BY JOB. 2026-07-31.
--
-- ── TWO DEFECTS, BOTH ABOUT MONEY ────────────────────────────────────────────────────────────────────
-- 1. THE DURABLE WORKFLOW NEVER REFUNDED. refundOnce() was exported from generation_workflow.js and
--    called by nothing; makeWorkflowDeps() supplied no deps.refund, so the call inside it would have
--    thrown had anything reached it. Every cancelled or failed durable generation kept the credit. The
--    legacy waitUntil runner has its OWN local refundOnce and does refund — which is exactly why this
--    survived review: the helper existed, tests referenced it, and the path that runs in production was
--    the one without it.
--
-- 2. THE PRIMITIVE WAS WRONG EVEN WHERE IT WAS WIRED. It called free_tier_grant_bonus(email, 1, 0) — a
--    BONUS GRANT KEYED BY EMAIL — guarded by a KV marker. KV is eventually consistent and cannot be an
--    exactly-once lock, so concurrent cancels could each read "not yet refunded" and each grant. Bonus
--    talks never expire, so a double refund permanently inflates quota.
--
-- ── WHAT THIS DOES ───────────────────────────────────────────────────────────────────────────────────
-- The ledger row IS the lock. `insert ... on conflict (job_id) do nothing` is atomic: of N concurrent
-- callers for one job, exactly one inserts, and only that one credits. The credit RESTORES the taken
-- reservation (talks_used - 1) rather than granting a bonus, so a refund can never leave the account
-- better off than before the talk.
--
-- Verified live, three sequential calls for one job id:
--     call 1 -> refunded: true,  outcome: refunded
--     call 2 -> refunded: false, outcome: already_refunded
--     call 3 -> refunded: false, outcome: already_refunded
-- (The probe's real credit was reversed and every artifact removed afterwards.)
begin;

create table if not exists public.refunded_jobs (
  job_id      text primary key,
  user_id     uuid not null,
  reason      text,
  refunded_at timestamptz not null default now()
);

create index if not exists refunded_jobs_user_idx on public.refunded_jobs (user_id);

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

  return query select true, 'refunded'::text;
end;
$function$;

comment on function public.refund_talk_once is
  'Refund exactly one reserved talk for a job, at most once ever. The refunded_jobs row is both ledger '
  'and lock. Restores talks_used rather than granting a bonus, so a refund cannot leave the account '
  'with more quota than it started with.';

revoke all on function public.refund_talk_once(text, uuid, text) from public, anon, authenticated;
grant execute on function public.refund_talk_once(text, uuid, text) to service_role;

alter table public.refunded_jobs enable row level security;
revoke all on public.refunded_jobs from anon, authenticated;
grant all on public.refunded_jobs to service_role;

commit;
