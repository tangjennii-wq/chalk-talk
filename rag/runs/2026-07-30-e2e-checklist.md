# End-to-end pass — testing the current bounded architecture

**This is not public-launch approval.** It exercises integration of what exists now: durable execution,
receipts, and the authorisation gates. The prompt-ownership migration
(`2026-07-30-server-owned-generation-design.md`) comes after, and *that* is the launch gate. Running this
first is deliberate — it surfaces integration failures while the surface area is still small.

Everything up to here is unit-tested (30 suites, 1195 assertions). This is the part that needs a browser,
your Cloudflare account, and real Anthropic calls. **Budget ~25 minutes and about 4 talk credits.**

---

## ⚠ ORDER: FRONT END FIRST, THEN THE WORKER

An earlier version of this file said Worker first. **That was wrong and would have broken every talk.**
The receipt work reversed the compatibility direction:

| | result |
|---|---|
| **new Worker + old client** | **every free-tier talk 402s** — the old client sends no `X-CT-Receipt` / `X-CT-Job` / `X-CT-Stage`, and the new Worker requires them |
| **old Worker + new client** | fine — the old Worker ignores headers it does not know |

So push first (Pages publishes `index.html`), confirm the new build is actually being served, *then*
`wrangler deploy`. The window in between is safe.

**The compatibility assumption is verified, not assumed.** Codex asked for that explicitly, and it is
exactly the kind of claim I have been wrong about before. I extracted the Worker as it stands at the last
deployed commit (`db77cb9`) and ran it against the new front end's request shapes:

| new-frontend shape | old deployed Worker |
|---|---|
| `/consume` body carrying `clientJobId` | **200** — extra field ignored, no `receipt` in the response (so the client sends no receipt headers) |
| `/v1/messages` with `X-CT-Receipt`, `X-CT-Job`, `X-CT-Stage` | **200**, one upstream call |
| the same on an `aux` call | **200**, one upstream call |
| `/generate-async` | **200** |

No new field is rejected. **Front-end-first is safe, and no compatibility bridge is needed.** Deploy the
Worker promptly afterwards anyway: until you do, the new gates are not enforcing.

```bash
cd ~/Developer/chalk-talk
git push origin main
```

- [ ] Hard-reload the site. In the console, `BUILD_ID` reads **`2026-07-30-02`**. If it still shows the
      old id you are testing a cached page and everything below is meaningless.

```bash
npx wrangler deploy
```

- [ ] Deploy succeeded and the output lists **`env.GEN_WORKFLOW (ChalkTalkGeneration)`** among the
      bindings. No binding, no durable path.

---

## 0 · Prove you are on the new Worker

Not that it responded — that it has the new behaviour.

```bash
curl -s -X POST "https://chalk-talk-proxy.chalktalk.workers.dev/retrieve" -H 'Content-Type: application/json' -H 'Origin: https://tangjennii-wq.github.io' -d '{"query":"diabetic ketoacidosis","rerank":true}' | jq '{rerank_applied, rerank_scored, count}'
```

- [ ] `rerank_scored` is a **number**. `null` means the old build is still serving — that field does not
      exist there.

> **The `Origin` header is required on every curl in this file, including this one.** Without it the
> proxy answers `origin_not_allowed` and you learn nothing about the endpoint you meant to test. The
> first version of this line omitted it and produced exactly that false result.

---

## 1 · START — the durable path is in use

Generate a talk. DevTools → Network → the `POST /generate-async` response.

- [ ] **`durable: true`.** `false` means `GEN_WORKFLOW` is unbound and you are on the old ~30-second
      path, which is the entire defect this was built to fix.

## 2 · FINISH — past 30 seconds, which was previously impossible

- [ ] The talk completes; note `elapsedSec` on the final `/generate-status`.
- [ ] **If it exceeds ~30s, that is the proof.** On the old path this generation would have been killed
      mid-flight, leaving the job stuck and the credit gone.
- [ ] The talk renders with citations.

## 3 · RELOAD + RECONNECT — the mobile case

Start a talk; reload the page while it drafts.

- [ ] It picks the job back up rather than restarting.
- [ ] The talk arrives.
- [ ] **Exactly one credit spent.** Check the badge before and after.

## 4 · CANCEL — and it must tell the truth

Cancel during the critique stage.

- [ ] The response carries **`cancelled: true`**, not merely `status: "cancelled"` — those used to be the
      same thing even when the write failed.
- [ ] The credit comes back.
- [ ] Cancelling twice does not refund twice.

## 5 · DUPLICATE SUBMIT

- [ ] Double-click Generate. Only **one** generation runs, **one** credit consumed.
- [ ] The second request returns `resumed: true` and **does not refund the first one's credit** — that
      was the bug: `create()` throws for both "already running" and "failed to start".

## 6 · THE AUTHORISATION GATES — verify they refuse, from a terminal

Substitute a real signed-in token. **Each of these should also cost nothing** — that is the point.

**(a) No receipt** — the quota bypass:

```bash
curl -s -X POST "https://<your-worker>.workers.dev/v1/messages" -H 'Content-Type: application/json' -H 'Origin: https://tangjennii.github.io' -H 'X-Supabase-Auth: <token>' -H 'X-CT-Meter: talk' -d '{"model":"claude-opus-5","messages":[{"role":"user","content":"hi"}]}' | jq '.error.type, .error.detail.reason'
```

- [ ] `"receipt_required"`, reason `"unknown_or_expired"`.

**(b) Relabelled as `aux`** — the hole a header-based gate could not close:

```bash
curl -s -X POST "https://<your-worker>.workers.dev/v1/messages" -H 'Content-Type: application/json' -H 'Origin: https://tangjennii.github.io' -H 'X-Supabase-Auth: <token>' -H 'X-CT-Meter: aux' -d '{"model":"claude-haiku-4-5-20251001","messages":[{"role":"user","content":"hi"}]}' | jq '.error.type'
```

- [ ] `"receipt_required"` — **not** a 200. `aux` is not an exemption; it still spends your key.

**(bb) No sign-in token at all** — the app-funded path Codex asked about, now closed:

```bash
curl -s -X POST "https://<your-worker>.workers.dev/v1/messages" -H 'Content-Type: application/json' -H 'Origin: https://tangjennii.github.io' -H 'X-CT-Meter: aux' -d '{"model":"claude-opus-5","messages":[{"role":"user","content":"manage DKA"}]}' | jq '.error.type'
```

- [ ] `"authorisation_required"`. There is no unauthenticated route to the app key any more. (BYOK is
      unaffected: a personal key calls Anthropic directly and never reaches this Worker.)

**(c) An uncleared model with a valid receipt.** Generate a talk normally, grab the `receipt` from the
`/v1/free-tier/consume` response in the Network tab and its `X-CT-Job`, then:

```bash
curl -s -X POST "https://<your-worker>.workers.dev/v1/messages" -H 'Content-Type: application/json' -H 'Origin: https://tangjennii.github.io' -H 'X-Supabase-Auth: <token>' -H 'X-CT-Meter: talk' -H 'X-CT-Receipt: <receipt>' -H 'X-CT-Job: <job>' -H 'X-CT-Stage: draft' -d '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"hi"}]}' | jq '.error.type'
```

- [ ] `"writer_not_cleared"` — the model gate rides on the receipt, so no header routes around it.

## 6b · CONCURRENCY — ✅ ALREADY DONE, no action needed

**Measured against production, 2026-07-30.** I said this needed your psql loop; it did not — dblink let
me open ten real backends and fire them all with `dblink_send_query` before reading any result.

```
concurrent_connections: 10
authorised:              2      <- exactly the budget
refused:                 8
counter_after:           2
```

Ten transactions, one row, two winners. Everything created for the test — a login role, the dblink
extension, an RLS policy scoped to one test job id, and the test receipt — was removed and the removal
verified.

*(Two earlier attempts each produced a confident wrong answer: `generate_series` + `lateral` gave 10
authorised because one statement shares one snapshot; issuing the receipt inside the same transaction as
the dblink calls gave 0 authorised because the insert had not committed. Recorded in the migration.)*

## 6c · CRITIQUE FAILURE MUST NOT RE-BUY THE DRAFT

The property the whole draft/critique split exists for. Easiest trigger: point the critic at a
nonexistent model id in the request the app sends, or temporarily remove `claude-opus-5` from the
critic's chain.

- [ ] The instance errors after the draft.
- [ ] `wrangler tail` shows **one** draft call, not two — a critique failure never re-purchases it.
- [ ] The credit is refunded exactly once.

## 7 · NOTHING BROKE THAT USED TO WORK

The receipt now covers **every** free-tier call, so these are the ones most likely to have been caught by
it accidentally:

- [ ] Images still generate.
- [ ] Boards mode still works.
- [ ] Check-for-updates still works.
- [ ] Podcast script / diagram prompts (the `aux` paths) still work **from the app**.
- [ ] The free-tier badge shows the right remaining count.

> If an `aux` feature 402s, that is a real bug and not a false alarm: it means the front end is calling it
> outside a generation, with no receipt. Tell me which feature — the fix is to mint an `aux` receipt for
> it rather than to weaken the gate.

## 8 · LOGS — one look

```bash
npx wrangler tail --format json | jq 'select(.outcome != "ok") | {outcome, eventTimestamp}'
```

- [ ] No `exceededCpu`. Generation is spent *waiting* on Anthropic, which consumes no CPU time.

---

## If something fails

```bash
npx wrangler deployments list
npx wrangler rollback --message "reverting <what> — <why>"
```

The front end reverts forward (`git revert`), never by force-push. **If you roll back the Worker, also
revert the front end** — a new client against an old Worker is fine, but you want the pair matched.

Both database migrations are additive and safe to leave: `canonical_match_chunks` replaces a function
with its own exported definition, and `score_candidate_chunks` is unreachable unless a request sets
`rerank: true`, which no shipped client does.

---

## What this still does not prove

- **Anthropic idempotency.** Unconfirmed — the API reference is client-rendered and returned only
  "Loading…" to a fetch. The paid-call guarantee is **at-most-once, fail-closed**, not exactly-once.
- **Intent.** Someone holding a valid `aux` receipt can send a medical prompt to a cheap model on their
  own bounded budget. The server cannot read intent. What it guarantees is that nothing reaches the
  upstream unauthorised, a Chalk Talk *talk* is written only by a cleared model, and every call is
  bounded and attributable.
- **Retrieval quality.** Calibration unrun — `CALIBRATION_RUNBOOK.md`. A separate question from whether
  the app works, and measured with physician judgements rather than clicks.
- **The remaining audit items** in `rag/runs/2026-07-29-worker-audit.md`: fail-open spend reads, the soft
  cap under concurrency, non-atomic job idempotency, cache-creation token pricing, unbound
  `RATE_LIMIT_KV`. None blocks launch; all still open.
