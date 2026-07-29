# Release sequence

Rewritten 2026-07-29. The previous version described shipping `launch-integration` into `main` — a merge
that already happened — and quoted SHAs and build IDs that no longer exist. Following it would have meant
force-pushing `main` back to a July 21 commit. Every number below was verified against the repository and
the live database on 2026-07-29 rather than carried forward.

(First-time Worker setup lives in `DEPLOY.md`.)

## State

| | |
|---|---|
| branch | **`main`** — `launch-integration` is fully merged and is history now |
| `BUILD_ID` / `build.txt` | `2026-07-29-02` |
| front end | **changed** — `pollAsyncGeneration` gained a `stalled` branch, so this one *does* need deploying |
| database | production `chalktalk` (`hrcvcjiefndvytlcbmpa`); there is no staging project |
| tests | 27 suites, all green, all wired into `.github/workflows/tests.yml` |

## Two things worth knowing before you deploy

**Unexpected pushes to `main` were observed; the source is unknown.** `git reflog show origin/main`
records `update by push` for several commits that were only ever committed locally in a session. That
proves pushes happened — it does **not** prove what initiated them, and a later commit (`a0d0b97`) did
*not* auto-push, so whatever it is does not fire every time. GitHub Desktop auto-sync is the obvious
suspect given this repo's history with it, but that is a hypothesis, not a finding.

*(Corrected 2026-07-29: an earlier version of this file stated flatly that commits are pushed
automatically. The reflog does not support that, and I should not have written it as established.)*

Practical consequence either way: **check `git log origin/main..main` before assuming a commit is
private**, and work on a branch if you want something staged rather than published.

**Pages serves `main`, but nothing deploys the Worker on push.** `.github/workflows/tests.yml` is the only
workflow and it has no deploy step — verified. So:

- an `index.html` change is **live as soon as it is pushed**
- a `worker.js` change is **inert until you run `npx wrangler deploy`**

That asymmetry is the trap: the Worker fixes committed on 2026-07-29 are **not running in production yet**.

## What is committed but not deployed

Run `npx wrangler deploy` to make these live. All are Worker-side.

- **Authority parity in the rerank** — sorts on `bare_ranked_score`, so a rerank no longer silently
  repeals the tier / landmark / elite-journal / RCR boosts. Opt-in, default off.
- **Rerank coverage guard** — refuses to report `rerank_applied: true` when the scorer matched nothing.
- **`no_eligible_local_sources`** no longer fires when the union was empty *before* the filter ran.
- **`match_count` clamped at both ends** — a negative value used to slice the best chunks off the tail.
- **`intEnv()` config validation** — a malformed `MAX_MONTHLY_SPEND_USD` no longer silently weakens or
  disables the cap. (The first attempt used `parseInt`, which turned `"1e3"` into a **$1** cap and
  `"0x10"` into **$0**; it now validates the whole string.)
- **The legacy `/v1/messages` path is capped and metered** — it was an unledgered relay on the Anthropic
  key, reachable by omitting one header.
- **Unauthenticated image generation is capped and metered** — the same hole on the OpenAI key, with a
  per-IP counter that does nothing because `RATE_LIMIT_KV` is unbound.
- **Cancellation tells the truth** — a failed KV write now returns 502 with `cancelled:false` instead of
  reporting success while generation continued and billed.
- **`strict_rerank`** — opt-in mode where a *partially* scored rerank fails rather than reporting
  `rerank_applied:true`. The evaluator sets it; production stays lenient deliberately.

Already applied to the database (nothing to deploy): `canonical_match_chunks`,
`score_candidate_chunks_authority_parity`.

> **This list is not a readiness statement.** These are the fixes that were safe to make unsupervised.
> The largest risks are still open — see *Still outstanding*.

## Deploying

**This release changes `index.html`**, which Pages serves — so it goes live on push, before the Worker is
deployed. Between those two moments the client has a `stalled` branch and the Worker never sets the flag:
harmless (the branch simply never fires), but deploy the Worker promptly so the two halves match.

```bash
# 1. everything green, from a clean tree
for f in test_*.mjs rag/test_*.mjs; do node "$f" >/dev/null || echo "FAILED: $f"; done
git status --porcelain          # expect empty

# 2. Worker
npx wrangler deploy

# 3. prove the deployed Worker is the new one — not that it responded, that it has the new behaviour
curl -s -X POST "$WORKER_URL/retrieve" \
  -H 'Content-Type: application/json' \
  -d '{"query":"diabetic ketoacidosis","rerank":true}' | jq '{rerank_applied, rerank_scored, rerank_unscored}'
# EXPECT rerank_applied:true and rerank_scored > 0.
# rerank_applied:false means score_candidate_chunks is missing or threw.
# rerank_scored:null means an OLD Worker is still serving — the field does not exist there.
```

The front end needs no deploy unless `index.html` changed; if it did, bump `BUILD_ID` **and** `build.txt`
together — the update banner compares them.

## Rolling back

**Do not `reset --hard` and force-push.** The old instructions did, which destroys history that may
already be public — and given the unexplained pushes noted above, you cannot assume a commit is private.

```bash
# Worker: redeploy the previous version. Cloudflare keeps them.
npx wrangler deployments list
npx wrangler rollback --message "reverting <what> — <why>"

# Front end / repo: revert forward, never rewrite.
git revert <sha>        # or: git revert <oldest>..<newest>
git push origin main
```

Rolling back a migration is a **separate, deliberate act** — reverting the SQL file changes nothing in the
database. Both current migrations are additive (`canonical_match_chunks` replaces a function with its own
exported definition; `score_candidate_chunks` is new and unreachable unless a request sets `rerank:true`),
so there is nothing to undo in an emergency. Every migration containing `DROP` or `ALTER` is wrapped in
`BEGIN`/`COMMIT`, enforced by `test_migration_atomicity.mjs`, so a failed apply leaves the database as it
was rather than half-migrated.

## Still outstanding — read this before calling anything ready

None of the fixes above touches the largest risks. They are architectural, they need decisions, and
making them unsupervised risked breaking generation for every user. Full detail in
`rag/runs/2026-07-29-worker-audit.md`. In priority order:

1. **Background generation can be killed at ~30 seconds.** `ctx.waitUntil()` extends execution for **up
   to 30 seconds** after the response is sent — verified in Cloudflare's own limits page, which states it
   three times, and **nothing there indicates the Paid plan lifts it**. Independently confirmed by Codex.
   A 50–100s draft+critique stalls at `running`, never writes `done`, and never reaches its refund path,
   so the user watches a spinner forever *and* loses a talk. The `wrangler.toml` comment claiming JOBS_KV
   "requires the Workers Paid plan (for the longer `ctx.waitUntil` budget)" was the false premise this
   shipped on — Paid raises **CPU** time, a different limit that shares the number 30, and generation is
   almost all *waiting*, which consumes no CPU at all. Comment corrected in place.
   **Full analysis and the three options: `rag/runs/2026-07-29-background-execution.md`.**
   Interim only, and it now works end to end: `/generate-status` reports `stalled: true` after several
   missed heartbeats, `pollAsyncGeneration` throws on it, and `generate()` renders the server's
   explanation. **The first attempt shipped only the server half** — the client ignored the field and
   spun for the full nine-minute timeout, which is the bug this list exists to catch. A critique
   heartbeat was added at the same time, because critique is one long non-streaming call and a
   legitimate 90s review was otherwise indistinguishable from a terminated Worker. **The first heartbeat
   was itself dangerous** — an uninterruptible sleep that delayed finalization by 0–20s and could push a
   critique that finished inside the 30s budget past it, i.e. the diagnostic causing the failure it
   diagnoses. It is a cancellable interval now. **This makes the failure visible and honest; it does not
   fix it.** A stall is treated as *suspected*, not confirmed: the reconnect key is retained, and the
   advice is reload-then-cancel rather than "just try again", because a merely-slow job that is
   restarted means two generations and potentially two charges.
2. **`/v1/messages` never verifies that `/consume` happened.** A signed-in caller can skip the frontend
   and generate with zero talks remaining. Needs a server-issued reservation, not a client convention.
3. **`WRITER_CLEARED` is enforced only on the async route.** The sync route accepts any member of
   `ALLOWED_MODELS`, which includes Sonnet and Haiku — so a tampered client can have unbenchmarked models
   write medical teaching content. **This is a content-safety guarantee, not a spend one.**
4. **`getMonthlySpendCents` fails open** — every error returns `0`, so the cap disengages exactly when
   Supabase is unhealthy, and `/status` simultaneously reports healthy remaining capacity.
5. **The cap is a soft backstop, not a hard cap.** Spend is read before work and recorded after, so
   concurrent requests can all observe `$249` and proceed. Overshoot is bounded only by in-flight cost.
   The UI copy should say "backstop" unless reservations are added.
6. **Async idempotency is non-atomic** — two requests with the same `clientJobId` can both see no record,
   both reserve quota, and both start provider work. KV has no compare-and-set; this needs a Durable
   Object or a database unique constraint.
7. **`cache_creation_input_tokens` is never priced** (1.25×–2× input), so the ledger runs below the
   Anthropic invoice and the cap trips later than intended.
8. **`RATE_LIMIT_KV` is not bound** in `wrangler.toml`, so the per-IP daily limit does nothing while
   `/health` reports it enforcing with full headroom.
9. **Rotate the exposed OpenAI and Supabase service-role keys.** Carried across several sessions.
10. **Calibration has not been run** — see `CALIBRATION_RUNBOOK.md`.
