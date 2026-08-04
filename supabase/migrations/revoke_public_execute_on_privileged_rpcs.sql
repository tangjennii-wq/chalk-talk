-- PRIVILEGED RPCs WERE CALLABLE FROM A BROWSER. Found 2026-07-31.
--
-- ── THE MISTAKE THAT MADE IT INVISIBLE ───────────────────────────────────────────────────────────────
-- add_receipts.sql already contained:
--
--     revoke all on function public.receipt_redeem(...) from anon, authenticated;
--     revoke all on function public.receipt_issue(...)  from anon, authenticated;
--
-- and stated in a comment that these were "service role only … a client that could mint its own receipt
-- would make the whole mechanism ornamental". They were not service-role only. CREATE FUNCTION grants
-- EXECUTE to PUBLIC by default, and revoking from anon and authenticated leaves that grant untouched —
-- both roles inherit it through PUBLIC. `has_function_privilege('anon', …, 'EXECUTE')` returned true
-- the entire time. Only RLS on generation_receipts (enabled, zero policies) was actually stopping it.
--
-- Auditing every callable function rather than only the receipt pair then found four SECURITY DEFINER
-- billing RPCs in the same state. SECURITY DEFINER runs as the function OWNER and BYPASSES row-level
-- security, so for these there was no second line of defence at all. The Supabase anon key ships inside
-- index.html.
--
--   free_tier_grant_bonus(p_email, p_bonus_talks, p_bonus_images)  -- SECURITY DEFINER, no caller check
--       SELECT id FROM auth.users WHERE email = lower(p_email)     -- ANY user, looked up by email
--       INSERT ... bonus_talks = bonus_talks + EXCLUDED.bonus_talks
--
--     Anyone who viewed source could grant themselves unlimited free talks, every one of which spends
--     the app-funded Anthropic key. This defeats the receipt mechanism from one layer below it: the
--     receipts were bounding calls correctly, against a quota anybody could inflate.
--
--   ledger_add(p_month, p_kind, p_cost_cents, p_cap_cents)         -- SECURITY DEFINER, no caller check
--     Cost is clamped by GREATEST(0, …) so it cannot be used to HIDE spend, but it can be driven past
--     the cap — which disables generation for every user and fires false spend alerts. Denial of
--     service plus corrupted accounting.
--
--   free_tier_consume(p_user_id, …)    burn another user's quota; user_id is a plain parameter
--   free_tier_remaining(p_user_id, …)  read another user's quota
--
-- ── SAFE TO REVOKE, CHECKED RATHER THAN ASSUMED ──────────────────────────────────────────────────────
-- The client calls none of them: zero references in index.html. The Worker reaches all of them through
-- supaServiceRPC, i.e. the service role, which is unaffected by revoking from PUBLIC. Retrieval is
-- deliberately left reachable by anon — the Worker calls match_chunks with the anon key.
--
-- ── VERIFIED BY ATTEMPTING THE EXPLOIT, NOT BY READING THE GRANT TABLE ───────────────────────────────
-- `set local role anon` / `set local role authenticated`, then calling each function for real:
--
--     free_tier_grant_bonus  blocked (insufficient_privilege)   ledger_add       blocked
--     free_tier_consume      blocked                            receipt_issue    blocked
--     free_tier_remaining    blocked                            receipt_redeem   blocked
--     match_chunks           REACHABLE  <- retrieval still works, which over-revoking would have broken
--
-- Both roles, same result. Reading privileges is what produced the original false confidence.
begin;

revoke all on function public.free_tier_grant_bonus(text, integer, integer)     from public, anon, authenticated;
revoke all on function public.free_tier_consume(uuid, text, integer, integer)   from public, anon, authenticated;
revoke all on function public.free_tier_remaining(uuid, integer, integer)       from public, anon, authenticated;
revoke all on function public.ledger_add(text, text, integer, integer)          from public, anon, authenticated;
revoke all on function public.receipt_issue(uuid, uuid, text, text, text[], jsonb, int) from public, anon, authenticated;
revoke all on function public.receipt_redeem(uuid, uuid, text, text, text)      from public, anon, authenticated;
revoke all on function public.receipt_gc()                                      from public, anon, authenticated;

grant execute on function public.free_tier_grant_bonus(text, integer, integer)     to service_role;
grant execute on function public.free_tier_consume(uuid, text, integer, integer)   to service_role;
grant execute on function public.free_tier_remaining(uuid, integer, integer)       to service_role;
grant execute on function public.ledger_add(text, text, integer, integer)          to service_role;
grant execute on function public.receipt_issue(uuid, uuid, text, text, text[], jsonb, int) to service_role;
grant execute on function public.receipt_redeem(uuid, uuid, text, text, text)      to service_role;
grant execute on function public.receipt_gc()                                      to service_role;

commit;

-- STANDING RULE, because this is the second time a default grant has outlived an explicit revoke:
-- any new SECURITY DEFINER function must revoke from PUBLIC in the same migration that creates it.
-- test_rpc_exposure.mjs enforces the repo half of this; the live half belongs in the deploy smoke test.
