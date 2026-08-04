# Security review — privileged RPCs callable from a browser

**Date:** 2026-07-31 · **Severity:** high · **Status:** closed in production, verified by exploitation
**Scope:** every callable function in `public`, not only the receipt pair

---

## The finding

Four `SECURITY DEFINER` billing RPCs carried `EXECUTE` for `anon` and `authenticated`. The Supabase anon
key ships inside `index.html`, so any reader of page source could `POST /rest/v1/rpc/<fn>` directly.

`SECURITY DEFINER` executes as the function owner and **bypasses row-level security**, so for these four
there was no second line of defence — the RLS everyone assumes is protecting Supabase tables was never
in the path.

| function | `SECURITY DEFINER` | authorises caller? | impact |
|---|---|---|---|
| `free_tier_grant_bonus(p_email, talks, images)` | yes | **no** | grant anyone unlimited free talks; each spends the app-funded Anthropic key |
| `ledger_add(month, kind, cost_cents, cap_cents)` | yes | **no** | inflate spend past the cap → generation disabled for every user; false spend alerts |
| `free_tier_consume(p_user_id, …)` | yes | **no** | burn another user's quota (`user_id` is a plain parameter) |
| `free_tier_remaining(p_user_id, …)` | yes | **no** | read another user's quota |

The worst of them in full:

```sql
free_tier_grant_bonus(p_email text, p_bonus_talks int, p_bonus_images int)
  SELECT id INTO v_uid FROM auth.users WHERE email = lower(p_email);   -- ANY user, by email
  INSERT INTO free_tier_usage ... bonus_talks = bonus_talks + EXCLUDED.bonus_talks;
```

No caller check, no ownership check, no rate limit. **This defeated the receipt mechanism from one layer
beneath it**: receipts were bounding paid calls correctly, against a quota anybody could inflate.

## Root cause

`CREATE FUNCTION` grants `EXECUTE` to `PUBLIC` by default. `revoke ... from anon, authenticated` does
**not** remove that grant — both roles keep inheriting it through `PUBLIC`.

`add_receipts.sql` had already made exactly this mistake, and said so in a comment:

> Service role only. These are minted and redeemed by the Worker, never by a browser: a client that
> could mint its own receipt would make the whole mechanism ornamental.

That claim was false from the day the migration ran. `has_function_privilege('anon', 'receipt_issue',
'EXECUTE')` returned `true`. Only RLS on `generation_receipts` (enabled, zero policies) was stopping it.
The original revoke is deliberately left in the repo, annotated, because the failure mode is the lesson:
**an explicit revoke that reads correctly, passes review, and silently leaves the default grant in place.**

## Why code review could never have caught it

**The four billing functions have no checked-in definition.** They were created outside the repo — via
the Supabase dashboard or an unrecorded migration — so `supabase/migrations/` contains only two
`SECURITY DEFINER` functions, both from `add_profile_handles.sql`. There was no file for a reviewer to
read, no diff in which `SECURITY DEFINER` and a missing revoke could appear side by side, and nothing a
CI guard over the repo could have inspected.

That is arguably the more important finding than any single grant: **the repo cannot reproduce
production.** A rebuild from migrations would not recreate these functions at all, and until today
nothing would have noticed.

Capturing their definitions is follow-up work. As an interim guarantee, the revoke itself is now
reproducible and `test_rpc_exposure.mjs` fails if any of the four loses its checked-in revoke.

## Fix

`revoke all ... from public, anon, authenticated` on all seven privileged functions, `grant execute` to
`service_role` only. Recorded in `supabase/migrations/revoke_public_execute_on_privileged_rpcs.sql`.

Safe because — checked, not assumed — the client calls none of them (zero references in `index.html`)
and the Worker reaches all of them through `supaServiceRPC`, i.e. the service role.

## Verification — by attempting the exploit, not by reading grants

Reading privileges is what produced the original false confidence, so each call was actually made under
`set local role anon` and again under `set local role authenticated`:

```
free_tier_grant_bonus   blocked (insufficient_privilege)
free_tier_consume       blocked (insufficient_privilege)
free_tier_remaining     blocked (insufficient_privilege)
ledger_add              blocked (insufficient_privilege)
receipt_issue           blocked (insufficient_privilege)
receipt_redeem          blocked (insufficient_privilege)
match_chunks            REACHABLE          <- retrieval must keep working; over-revoking is its own outage
```

Identical for both roles.

---

## Anomaly screening

Read-only. **This cannot identify who called anything** — `updated_at` records when a row last changed,
not by whom. Absence of anomalies is not proof the function was never abused; it is the absence of
evidence that it was.

```
free_tier_usage rows with bonus_talks > 0 or bonus_images > 0 ....... 0
free_tier_usage rows total .......................................... 0
rows with any usage ................................................. 0
max talks_used / images_used / bonus_talks .......................... 0 / 0 / 0
spend_ledger rows ................................................... 0
generation_receipts live ............................................ 0
talks saved ......................................................... 62
auth.users .......................................................... 2
```

**No evidence of exploitation.** No user holds a bonus balance, so `free_tier_grant_bonus` shows no trace
of ever having been called — by an attacker or by Jenni. Nothing to compare against known manual grants,
because there are no grants.

### Separate observation, not a security issue

`spend_ledger` is **empty despite 62 saved talks**, and `free_tier_usage` has **zero rows**. Consistent
with all generation so far having run BYOK — a personal Anthropic key calls the API directly and never
touches the proxy, so neither `free_tier_consume` nor `ledger_add` is reached. It matches the earlier
finding that desktop sessions with a personal key take the sync path and never engage the free tier.

The implication for launch: **the metering, the spend cap and the ledger have never executed against real
traffic.** They are unit-tested and were exercised against stubs, but the first genuine free-tier
generation will be the first time they run in production. Worth watching the first few closely, and worth
noting that the `$250` cap has never actually fired.

### Correlation with logs — not done

Supabase and Worker request logs were not correlated against these timestamps. With zero bonus rows and
zero ledger rows there are no timestamps to correlate. If you want assurance rather than screening, the
Supabase dashboard retains PostgREST request logs; filtering for `rpc/free_tier_grant_bonus` over the
retention window would answer it directly. That is a dashboard action, not something reachable from here.

---

## Follow-ups

1. **Standing rule:** any new `SECURITY DEFINER` function must `revoke ... from public` in the same
   migration that creates it. Enforced for the repo by `test_rpc_exposure.mjs`, which enumerates every
   `SECURITY DEFINER` function in the checked-in schema rather than a fixed list.
2. **Live half:** the privilege check belongs in the pre-deploy smoke test — the repo guard cannot see
   production.
3. **Defence in depth:** `free_tier_grant_bonus` should authorise its caller regardless of who may
   execute it. A function that grants quota by email with no caller check is one `grant` away from being
   exploitable again, and the next `grant` may be well-intentioned.
