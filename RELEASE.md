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
| `BUILD_ID` / `build.txt` | `2026-07-28-03` (tagged `staging-2026-07-28-03`) |
| front end | **unchanged since `2026-07-28-03`** — the recent work is Worker, SQL and tests only |
| database | production `chalktalk` (`hrcvcjiefndvytlcbmpa`); there is no staging project |
| tests | 25 suites, all green, all wired into `.github/workflows/tests.yml` |

## Two things that surprised me, so they are written down

**Commits to `main` are being pushed automatically.** `git reflog show origin/main` records
`update by push` for commits I only ever committed locally — almost certainly GitHub Desktop auto-sync,
which has caused trouble here before (it once committed a half-resolved merge with literal conflict
markers). **Treat every commit on `main` as immediately public.** If you want a change staged rather than
published, work on a branch.

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
- **`intEnv()` config validation** — `MAX_MONTHLY_SPEND_USD="250usd"` used to silently disable the cap.
- **The legacy `/v1/messages` path is now capped and metered** — it was an unledgered relay on the
  Anthropic key, reachable by omitting one header.

Already applied to the database (nothing to deploy): `canonical_match_chunks`,
`score_candidate_chunks_authority_parity`.

## Deploying

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

**Do not `reset --hard` and force-push.** The old instructions did, which destroys history that is already
public — and since pushes here happen automatically, "already public" is the normal case.

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

## Still outstanding

- **Rotate the exposed OpenAI and Supabase service-role keys.** Carried across several sessions.
- **Eleven Worker findings** left for a decision — `rag/runs/2026-07-29-worker-audit.md`. Start with
  `WRITER_CLEARED`: it fails closed only on the async route, so the sync route will write medical content
  with an unbenchmarked model.
- **`RATE_LIMIT_KV` is not bound** in `wrangler.toml`, so the per-IP daily limit does nothing while
  `/health` reports it enforcing.
- **Calibration has not been run** — see `CALIBRATION_RUNBOOK.md`.
