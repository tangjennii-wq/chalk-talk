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
| `BUILD_ID` / `build.txt` | `2026-07-30-01` |
| front end | **changed** — `pollAsyncGeneration` gained a `stalled` branch, so this one *does* need deploying |
| database | production `chalktalk` (`hrcvcjiefndvytlcbmpa`); there is no staging project |
| tests | 30 suites, all green, all wired into `.github/workflows/tests.yml` |
| wrangler `main` | **`worker_entry.js`** (was `worker.js`) — it exports the Workflow class as well as the fetch handler |

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

`rag/runs/2026-07-29-worker-audit.md` has the detail. In priority order:

1. **Background generation — durable path BUILT and its platform assumptions MEASURED, not yet run
   end-to-end.** `ctx.waitUntil()` is cut off ~30s after the response on either plan while a
   draft+critique needs 50–100s, so the legacy path loses long generations *and* the user's credit. A
   Cloudflare Workflow now replaces it. A runtime probe measured the four behaviours the docs leave open
   (`rag/runs/2026-07-30-workflow-probe-results.md`) and two came back worse than documented — `limit: N`
   is 1 + N executions, so the original `limit: 1` was a two-call config, and `NonRetryableError` is
   silently defeated by a custom `name`. Both corrected. **Remaining: the end-to-end click test in
   `rag/runs/2026-07-30-e2e-checklist.md`, then deploy.** Until `/generate-async` returns
   `durable: true` in production, treat the defect as live.
2. **`getMonthlySpendCents` fails open** — every error returns `0`, so the cap disengages exactly when
   Supabase is unhealthy, while `/status` reports healthy remaining capacity.
3. **The cap is a soft backstop, not a hard cap.** Spend is read before work and recorded after, so
   concurrent requests can all observe `$249` and proceed. The UI copy should say "backstop".
4. **Async idempotency is non-atomic** — two requests with the same `clientJobId` can both see no record
   and both start work. KV has no compare-and-set; this wants a Durable Object or a DB constraint.
5. **`cache_creation_input_tokens` is never priced** (1.25×–2× input), so the ledger runs below the
   Anthropic invoice and the cap trips later than intended.
6. **`RATE_LIMIT_KV` is not bound** in `wrangler.toml`, so the per-IP daily limit does nothing while
   `/health` reports it enforcing with full headroom.
7. **Rotate the exposed OpenAI and Supabase service-role keys.** Carried across several sessions.
8. **Calibration has not been run** — `CALIBRATION_RUNBOOK.md`. Separate from launch readiness.

### Closed since the audit

- ~~`/v1/messages` never verifies that `/consume` happened~~ — receipts, bound to the paying user.
- ~~`WRITER_CLEARED` enforced only on the async route~~ — enforced on both, with the receipt making it
  authoritative rather than advisory.
- ~~Unauthenticated image generation spends the OpenAI key uncapped~~ — capped and ledgered.
- ~~The legacy `/v1/messages` path is unledgered~~ — capped and ledgered.
- ~~Cancellation reports success it did not achieve~~ — 502 with `cancelled: false`.
