-- ATOMIC REFINE RENEWAL. 2026-07-31.
--
-- Split into its own file because it was first appended after the COMMIT of
-- receipt_redeem_per_stage_models.sql, leaving a CREATE OR REPLACE outside any transaction, and then
-- wrapped in a SECOND transaction in the same file. test_migration_atomicity.mjs caught both: one
-- migration, one transaction, one concern.
--
begin;
--
-- ── WHY THE TIME-WINDOW APPROACH WAS WRONG (Codex) ───────────────────────────────────────────────────
-- Deriving the receipt id from floor(now / TTL) fixed "an expired refine receipt is returned forever"
-- and introduced two worse defects:
--
--   1. IT RENEWED TALK RECEIPTS TOO. The same paid jobId landed in a new bucket every 30 minutes, so one
--      consumed credit yielded a fresh draft/critique/aux budget indefinitely — the unbounded-minting
--      defect returning through the door opened for refine.
--   2. FIXED WINDOWS OVERLAP. A receipt minted a second before a boundary stays valid for 30 minutes
--      while another full receipt is mintable a second after it, so two complete budgets coexist for
--      almost the whole next window.
--
-- ── THE DESIGN THAT HOLDS ────────────────────────────────────────────────────────────────────────────
--   * TALK receipts: one permanent deterministic id per job, insert-once, never renewed or reset.
--   * REFINE receipts: one stable id per talk, renewed ONLY once genuinely expired, in ONE locked
--     statement — so a renewal can never overlap a live receipt.
--
-- Verified against the live database:
--     first use    -> created
--     while live   -> still_valid   (used stays 1; a loop cannot replenish)
--     after expiry -> renewed       (used reset to 0, max 3, live again)
--     stranger     -> not_owner
create or replace function public.receipt_renew_refine(
  p_id uuid, p_user_id uuid, p_job text,
  p_allowed_models text[], p_stages jsonb, p_ttl_seconds int
) returns table (ok boolean, outcome text)
language plpgsql volatile security definer set search_path = public, pg_temp
as $function$
declare v_inserted boolean := false; v_renewed boolean := false; v_exists boolean := false;
begin
  if p_id is null or p_user_id is null then
    return query select false, 'bad_arguments'::text; return;
  end if;

  insert into public.generation_receipts (id, user_id, job_id, kind, allowed_models, stages, expires_at)
  values (p_id, p_user_id, p_job, 'refine', p_allowed_models, p_stages,
          now() + make_interval(secs => p_ttl_seconds))
  on conflict (id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted then return query select true, 'created'::text; return; end if;

  -- Decision and mutation in ONE statement, exactly as receipt_redeem does. Reading the expiry and then
  -- updating would let two callers both renew and produce overlapping budgets.
  update public.generation_receipts
     set stages = p_stages,
         expires_at = now() + make_interval(secs => p_ttl_seconds),
         allowed_models = p_allowed_models
   where id = p_id and user_id = p_user_id and expires_at <= now();

  get diagnostics v_renewed = row_count;
  if v_renewed then return query select true, 'renewed'::text; return; end if;

  select true into v_exists from public.generation_receipts where id = p_id and user_id = p_user_id;
  if v_exists then return query select true, 'still_valid'::text; return; end if;
  return query select false, 'not_owner'::text;
end;
$function$;

revoke all on function public.receipt_renew_refine(uuid, uuid, text, text[], jsonb, int) from public, anon, authenticated;
grant execute on function public.receipt_renew_refine(uuid, uuid, text, text[], jsonb, int) to service_role;

commit;
