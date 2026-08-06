-- PER-STAGE MODEL AUTHORISATION. 2026-07-31.
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────────────────────────────────
-- allowed_models was FLAT across the whole receipt. A talk receipt has to authorise both the writer
-- (Opus, for the draft) and the aux model (Haiku, for the citation audit) — so the flat list contained
-- both, and therefore authorised HAIKU FOR THE DRAFT AND REFINE STAGES.
--
-- That defeats WRITER_CLEARED, whose entire purpose is that a Chalk Talk talk is written only by a model
-- benchmarked for clinical prose. The medical guarantee had quietly degraded to "some cleared model wrote
-- it, possibly the cheap one benchmarked for classification". The flat union was my FIRST fix for the
-- 402s, and it broke something worse than it repaired.
--
-- Each stage now carries its own model set, checked inside the single atomic UPDATE. allowed_models stays
-- as a fallback so receipts minted before this still redeem — they keep the old behaviour for the 30
-- minutes until they expire.
--
-- ── VERIFIED AGAINST THE LIVE DATABASE ───────────────────────────────────────────────────────────────
--     draft + claude-opus-5                -> ok
--     draft + claude-haiku-4-5-20251001    -> model_not_authorised_for_stage
--     aux   + claude-haiku-4-5-20251001    -> ok
--
-- ── EXPORTED, NOT RETYPED ────────────────────────────────────────────────────────────────────────────
-- pg_get_functiondef() output from production, reformatted only in whitespace. Retyping is what let the
-- reserve_talk_for_job owner check drift out of the repo earlier the same day; test_rpc_exposure.mjs now
-- fails if the Worker's expected contract is absent from the checked-in SQL.
--
-- ── HOW A LATER REFINE GETS AUTHORISED ───────────────────────────────────────────────────────────────
-- SUPERSEDED, and the superseded version is recorded because it was wrong in an instructive way. The
-- first answer derived the receipt id from (user, job, kind, TIME WINDOW = floor(now / TTL)). That made a
-- repeat mint a no-op within a window and a fresh mint after one — which solved the expired-receipt bug
-- and created two worse defects: it renewed TALK budgets too (one credit, a new draft budget every 30
-- minutes), and fixed windows OVERLAP, so two full receipts could be live at once across a boundary.
--
-- The design that holds is at the foot of this file: talk receipts get one PERMANENT id and are never
-- renewed; refine receipts get one stable id per talk plus receipt_renew_refine, which resets the budget
-- only once the previous receipt has genuinely expired, in a single locked statement. Ownership is
-- re-verified on every refine-session regardless.
begin;

create or replace function public.receipt_redeem(
  p_receipt uuid,
  p_user_id uuid,
  p_job     text,
  p_stage   text,
  p_model   text
)
returns table (ok boolean, reason text, used integer, max_allowed integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_used int;
  v_max  int;
  v_rec  public.generation_receipts%rowtype;
begin
  -- The decision and the decrement remain ONE statement: splitting them is what let ten concurrent
  -- requests through a budget of three.
  --
  -- The model condition prefers the STAGE's own list. `stages->stage->'models'` is a jsonb array when
  -- present; when absent (a receipt minted before this migration) it falls back to allowed_models.
  update public.generation_receipts r
     set stages = jsonb_set(r.stages, array[p_stage, 'used'],
           to_jsonb(((r.stages -> p_stage ->> 'used')::int) + 1))
   where r.id = p_receipt
     and r.user_id = p_user_id
     and (r.job_id is null or r.job_id = p_job)
     and r.expires_at > now()
     and r.stages ? p_stage
     and ((r.stages -> p_stage ->> 'used')::int) < ((r.stages -> p_stage ->> 'max')::int)
     and (
           case
             when (r.stages -> p_stage) ? 'models'
               then r.stages -> p_stage -> 'models' @> to_jsonb(p_model)
             else p_model = any(r.allowed_models)
           end
         )
  returning ((r.stages -> p_stage ->> 'used')::int),
            ((r.stages -> p_stage ->> 'max')::int)
    into v_used, v_max;

  if found then
    return query select true, 'ok'::text, v_used, v_max;
    return;
  end if;

  select * into v_rec from public.generation_receipts where id = p_receipt;
  if not found then                       return query select false, 'unknown_or_expired'::text, 0, 0; return; end if;
  if v_rec.user_id <> p_user_id then      return query select false, 'wrong_owner'::text, 0, 0; return; end if;
  if v_rec.expires_at <= now() then       return query select false, 'expired'::text, 0, 0; return; end if;
  if v_rec.job_id is not null and v_rec.job_id <> p_job then
                                          return query select false, 'wrong_job'::text, 0, 0; return; end if;
  if not (v_rec.stages ? p_stage) then    return query select false, 'stage_not_authorised'::text, 0, 0; return; end if;

  -- Model refusal is reported against the STAGE, because "Haiku is fine for aux but not for draft" is a
  -- different and more useful message than "Haiku is not on the receipt".
  if (v_rec.stages -> p_stage) ? 'models' then
    if not ((v_rec.stages -> p_stage -> 'models') @> to_jsonb(p_model)) then
      return query select false, 'model_not_authorised_for_stage'::text, 0, 0; return;
    end if;
  elsif not (p_model = any(v_rec.allowed_models)) then
    return query select false, 'model_not_authorised'::text, 0, 0; return;
  end if;

  return query select false, 'stage_exhausted'::text,
                      ((v_rec.stages -> p_stage ->> 'used')::int),
                      ((v_rec.stages -> p_stage ->> 'max')::int);
end;
$function$;

comment on function public.receipt_redeem is
  'Atomically authorise ONE paid model call against a receipt, bound to user, job, STAGE and the models '
  'that stage permits. Per-stage models exist because a flat allowlist authorised the aux model for the '
  'draft stage, defeating WRITER_CLEARED. Falls back to allowed_models for receipts minted before that.';

revoke all on function public.receipt_redeem(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.receipt_redeem(uuid, uuid, text, text, text) to service_role;

commit;
