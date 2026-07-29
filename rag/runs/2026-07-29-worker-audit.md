# Worker audit — 2026-07-29

Run unsupervised after the retrieval work, at Jenni's request ("look for bugs"). Findings were produced
by a subagent sweep of `worker.js`, then **verified by me individually** — an agent report is data, not
truth. Everything below that I acted on, I first reproduced.

## The rule I applied to myself

**Fixed without asking:** retrieval-path defects and pure correctness bugs, where the change is opt-in,
invisible to users, or can only make a report more accurate.

**Found, verified, NOT fixed:** anything touching spend, quota, or auth. A wrong fail-closed change to a
spend cap takes the app down for every user while you're away, and "Claude broke generation at 2am
tightening a guard nobody asked him to tighten" is a worse outcome than the bug. These need your call.

---

# FIXED (committed, mutation-tested)

### F1 · The rerank guard had the exact hole it was guarding — HIGH

`worker.js`, the guard I wrote the turn before. It read:

```js
if (union.some(c => c.bare_similarity != null && c.bare_ranked_score == null)) throw ...
```

This requires the lookup to have **succeeded** for a row before it can complain the row has no score. In
the case that actually matters — the RPC returns `[]`, or an id type mismatch makes every `Map` hit fail
— **both** fields are null on every candidate, `some(...)` is false, nothing throws.

The comparator then computed `-Infinity - (-Infinity)` = **NaN** for every pair. V8 leaves a
NaN-compared array in arrival order. So the union kept precisely the pooled facet ordering the rerank
exists to replace, and the response reported `rerank_applied: true`.

Reproduced directly before fixing. This is the third variant of the same defect in three days, and it was
in the guard written *specifically to prevent* the second one.

**Fix:** guard on coverage (`bare.size === 0` against a non-empty id list), reject a non-array response,
and report `rerank_scored` / `rerank_unscored` in the body. The old comment claimed the unscored count was
"COUNTED so it cannot hide" — it was counted into a `console.warn`, which is invisible to the evaluator
reading the JSON.

### F2 · `-Infinity` sentinels make a tie-break the primary key — MEDIUM

`NaN` is falsy. Inside `(primary(b) - primary(a)) || (pubRank(a) - pubRank(b))`, two unscored candidates
give `NaN`, and `||` hands the entire decision to `pubRank` — making publication type the **primary** key
for that subset, inside a comparator whose only purpose is to be secondary.

**Fix:** `-Number.MAX_VALUE`, which is finite, so two unscored candidates compare as a genuine `0`.

### F3 · Two different zeroes reported as the same thing — MEDIUM

`no_eligible_local_sources` was `filterApplied && length === 0`. That reads *"every candidate was
positively classified as non-evidence"* — a strong claim that should trigger a live-search fallback. But
if retrieval returned nothing at all, the filter loop never runs, `dropped` is `[]`, and the flag is
identical. The caller is told the corpus rejected everything when it offered nothing.

**Fix:** require `union_before_filter > 0`; the empty case gets its own `no_local_candidates`.

### F4 · Negative `match_count` sliced from the wrong end — LOW

`match_count: -5` → `Math.min(-5, 50)` = `-5` → `slice(0, -5)` drops the five **best-ranked** chunks off
the tail and returns the rest, while `count` reports the inflated length as if the request were honoured.

**Fix:** clamp at both ends, reject `NaN`.

### F5 · A malformed limit became an absent limit — MEDIUM

`parseInt("unlimited")` and `parseInt("250usd")` are `NaN`. Every comparison against `NaN` is false, so
`used >= limit` and `spentCents >= capCents` **stop tripping** — a dashboard typo silently switches the
guard off. `/health` then renders `NaN` as `null`, which reads as "not configured" rather than
"misconfigured".

**Fix:** an `intEnv()` helper that rejects `NaN` and negatives and falls back to the compiled-in default,
with a warning. Strictly safer: a typo now yields the default limit, never no limit.

### F7 · The legacy path now respects the cap and writes to the ledger — HIGH

See the former N3 below for the full reasoning, including why the path was metered rather than closed.

### F6 · A locator bug in my own audit test — LOW

`worker.indexOf("STAGE 2")` matched the file's header comment at offset ~3.9k rather than the code at
~32k, slicing a negative range to `""`. It failed loudly against an empty haystack — a `.includes()`
check would have **passed vacuously**. Anchored the end search after the start.

---

# NOT FIXED — needs your decision

Ranked by what I'd look at first. I verified each; I did not change any of them.

### N1 · Cancelling after the draft completes is a free talk — HIGH, and exploitable

The cancel checks all `return` **before** `ledger_add`. But `callAnthropicText` has already run to
completion, so the tokens are billed by Anthropic. Cancel therefore: refunds the user's quota **and**
never records the spend. Submit `/generate-async`, wait for `stage: "critique"`, POST
`/generate-cancel/`. Quota net-zero, real spend unbounded and invisible to the monthly cap.

*Why I left it:* the fix is a judgment call — meter before the cancel check, or abort the upstream call
properly. Both change refund semantics for honest users who cancel early, and I'd rather you pick.

### N2 · `getMonthlySpendCents` fails open — HIGH

Every failure path returns `0`: a 500, a bad service-role key, an RLS change, a network blip. All four
callers then evaluate `0 >= capCents` → false → proceed. **The $250 backstop disengages exactly when the
backend is sick.** Also `rows[0].total_cents || 0`, so schema drift reads as zero spend.

*Why I left it:* this is the one place a fail-open default is clearly wrong, but making it fail closed
means a Supabase hiccup stops all generation. That trade is yours, and it's not one to make while you're
unreachable.

### ~~N3~~ → **FIXED (F7): the legacy path now respects the cap and writes to the ledger**

Omit the `X-Supabase-Auth` header and you fell through to a branch with no `getMonthlySpendCents` check
and no `meterCost` — spend on your key, invisible to `spend_ledger`, with the only remaining gate being
the per-IP counter that doesn't work (N4).

I moved this out of "not fixed" after verifying two things:

1. **`RATE_LIMIT_KV` is genuinely unbound** — `wrangler.toml` declares only `JOBS_KV`. So the guard named
   in the code comment provides nothing, and `/health` advertises it as enforced with full headroom.
2. **No shipped frontend uses the path** — `PROXY_CONFIG.enabled` is `false` on both `main` and
   `launch-integration`. (Also: `launch-integration` is now fully merged into `main`, which is 18 ahead,
   so the old "main is 34 behind" note is stale.)

**I did not close the path**, deliberately — "no caller I can find" is not "no caller", and silently
403-ing an unknown client while you're away is the worse failure. I metered it instead, which is strictly
additive: every existing caller keeps working, the spend becomes visible, and it stops at the same $250
backstop as everything else. Closing it entirely is still available to you and is now a one-line change.

*A note on how this nearly went wrong:* my first version referenced `meterKind` and `monthKey`, both
`const`-scoped to the free-tier branch. That is a **ReferenceError at runtime, not a syntax error** —
`node --check` passed it, and so did importing the module, because the handler body never runs. Only
calling the handler catches it. `test_legacy_path_metering.mjs` now does, and I mutation-tested it by
reintroducing the exact error: `--check` still says OK, the suite goes red.

### N4 · The daily rate limit doesn't work, and reports that it does — HIGH, **confirmed live**

**`RATE_LIMIT_KV` is not bound in `wrangler.toml`** — verified, not inferred. So this is not a latent
risk; the per-IP daily limit is doing nothing in production right now, while `/health` returns
`{used: 0, limit: 10, remaining: 10}`.

Two defects. Without `RATE_LIMIT_KV` bound, both functions early-return and `used` is always `0` — yet
`/health` returns `{used: 0, limit: 10, remaining: 10}`, which reads as an enforced limit with full
headroom. And the increment is a non-atomic read-modify-write in `ctx.waitUntil`, *after* the response:
50 concurrent requests all read `0`, all pass, and the counter lands on `1`.

**Worth checking first:** is `RATE_LIMIT_KV` actually bound in production? If not, N1/N3 have no brake.

### N5 · `WRITER_CLEARED` fails closed only on the async route — HIGH

`callAnthropicText` fails closed correctly. But `POST /v1/messages` validates only membership in
`ALLOWED_MODELS`, and Sonnet 4 and Haiku 4.5 are on that list. So the writer gate is client-side-only for
the sync route — the same defeat mode as the 2026-07-26 note ("refuse-to-write became write-with-
anything"), relocated. The `X-CT-Meter: talk` header already says it's a writing call; nothing checks it.

*This one I'd prioritise*, because it's a medical-content guarantee rather than a money one.

### N6 · Infrastructure failure told to the user as "you're out of free talks" — MEDIUM

`consumeQuota` catches everything and returns `false`, which callers render as *"You've used all your
free talks."* A timeout says you're out of quota. Separately, `return r === true` is shape-dependent: if
anyone converts `free_tier_consume` to `RETURNS TABLE` (as two sibling RPCs already are), the body becomes
`[{...}]`, `=== true` is false, and **the quota is decremented while the user is told they have none.**

### N7 · Image cost booked at a flat 8¢ — MEDIUM

`IMAGE_FLAT_CENTS = 8` regardless of model, size or quality, while `ALLOWED_IMAGE_MODELS` includes
`gpt-image-2` and size/quality are caller-supplied. Undercounting flows straight into the cap. Same shape
as the `MODEL_PRICES` 3× error already documented in the file, one layer down.

### N8 · Metering reports $0 on any parse trouble — MEDIUM

Any exception in `extractUsage` yields zeros → `cents === 0` → the `if (cents > 0)` skips the ledger write
entirely. A call that cost money is recorded as never having happened. Also: `cache_creation_input_tokens`
(billed at 1.25× input) is never counted, and an unpriced model falls back to **Sonnet** rates — the wrong
direction for a cap, which should assume the most expensive row.

### N9 · Refund is a no-op for users without an email — MEDIUM

`consumeQuota` keys on `user.id`; `refundQuota` keys on `email` and returns early if absent. Phone or
anonymous auth ⇒ every refund silently burns the credit. The return value is discarded at all three call
sites, so a `FALSE` is indistinguishable from success. The asymmetry also means a refund grants *bonus*
quota rather than decrementing `talks_used`, so the two counters drift.

### N10 · Cancel reports success unconditionally — LOW

The KV write is wrapped in `catch (_) {}` and `{status: "cancelled"}` is returned regardless. If the write
fails, generation runs to completion and bills, and the client was told it was cancelled.

### N11 · `ranked_score || 0` coerces null to mid-range — LOW, latent

Null → `0` is mid-range, not last, unlike the `-Number.MAX_VALUE` handling now used elsewhere.
**Currently unreachable:** no document has a null `source_tier`, `is_landmark_trial` or `journal_rank`
(checked 2026-07-29), and `min_similarity` 0.30 means real scores exceed 0 anyway. It becomes live the
moment an ingester admits a null into any boost column.

---

## Categories the sweep found clean

Cap comparisons (`>=` / `>` used consistently and correctly — the bypasses above are structural, not
fencepost), path-prefix slicing, job ownership checks, and share-token handling (the regex admits only hex
and hyphens before interpolation; the payload projection matches its stated PII policy).
