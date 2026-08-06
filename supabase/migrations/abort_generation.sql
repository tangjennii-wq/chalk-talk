-- ABORT A GENERATION THAT NEVER STARTED. 2026-07-31.
--
-- The startup sequence is reserve -> mint receipt -> save job -> start Workflow. Any step after the
-- reservation can fail, and once minting moved BEFORE create() a failure could leave both a consumed
-- credit and a usable receipt for work that will never run — a refunded job holding live authorisation.
--
-- One transaction does the whole cleanup: revoke the receipt, refund exactly once, and refuse to do
-- either for a delivered job or another user's job. Separate refund and revoke calls could interleave and
-- leave half of it done.
begin;

create or replace function public.abort_generation(
  p_job_id text, p_user_id uuid, p_reason text default null
) returns table (aborted boolean, refunded boolean, outcome text)
language plpgsql volatile security definer set search_path = public, pg_temp
as $function$
declare v_owner uuid; v_inserted boolean := false;
begin
  if p_job_id is null or p_job_id = '' or p_user_id is null then
    return query select false, false, 'bad_arguments'::text; return;
  end if;

  select user_id into v_owner from public.job_reservations where job_id = p_job_id;
  if v_owner is null then
    delete from public.generation_receipts where job_id = p_job_id and user_id = p_user_id;
    return query select true, false, 'no_reservation'::text; return;
  end if;
  if v_owner is distinct from p_user_id then
    return query select false, false, 'not_owner'::text; return;
  end if;

  -- NEVER claw back a talk the user received.
  if exists (select 1 from public.talks where id::text = p_job_id) then
    return query select false, false, 'already_delivered'::text; return;
  end if;

  -- Deleting the row IS the revocation: receipt_redeem then answers unknown_or_expired.
  delete from public.generation_receipts where job_id = p_job_id and user_id = p_user_id;

  insert into public.refunded_jobs (job_id, user_id, reason)
  values (p_job_id, p_user_id, coalesce(p_reason, 'aborted'))
  on conflict (job_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted then
    insert into public.free_tier_usage (user_id) values (p_user_id) on conflict (user_id) do nothing;
    update public.free_tier_usage
       set talks_used = greatest(0, talks_used - 1), updated_at = now()
     where user_id = p_user_id;
    update public.job_reservations set state = 'refunded', settled_at = now() where job_id = p_job_id;
    return query select true, true, 'aborted_and_refunded'::text; return;
  end if;

  return query select true, false, 'already_refunded'::text;
end;
$function$;

comment on function public.abort_generation is
  'Clean up a generation that failed to start: revoke its receipt and refund its reservation, in ONE '
  'transaction, at most once, never for a delivered job, never for another user''s job.';

revoke all on function public.abort_generation(text, uuid, text) from public, anon, authenticated;
grant execute on function public.abort_generation(text, uuid, text) to service_role;

commit;
