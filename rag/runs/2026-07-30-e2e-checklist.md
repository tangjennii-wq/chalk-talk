# End-to-end click test — the last gate before Chalk Talk goes live

Everything up to here is unit-tested. This is the part that needs a browser, your Cloudflare account, and
a real Anthropic call. **Budget ~20 minutes and about 3 talk credits.**

Order matters: deploy the Worker first, then the front end. `index.html` is served by Pages on push and
the new client sends `X-CT-Receipt`; if the Worker is old it will ignore the header harmlessly, but if the
Worker is new and the *client* is old, every talk 402s. **Worker first.**

```bash
cd ~/Developer/chalk-talk
npx wrangler deploy
```

Then push, which publishes the front end.

---

## 0 · Prove you are testing the new Worker

Not that it responded — that it has the new behaviour.

```bash
curl -s -X POST "https://<your-worker>.workers.dev/retrieve" -H 'Content-Type: application/json' -d '{"query":"diabetic ketoacidosis","rerank":true}' | jq '{rerank_applied, rerank_scored}'
```

`rerank_scored: null` means an **old** Worker is still serving — that field does not exist in the previous
build. Stop and redeploy.

---

## 1 · START — the durable path is actually in use

Generate a talk. In DevTools → Network, find the `POST /generate-async` response.

- [ ] **`durable: true`** — the Workflow ran. `false` means `GEN_WORKFLOW` is unbound and you are on the
      old ~30-second path, which is the entire defect we set out to fix.
- [ ] A `jobId` came back and polling starts.

## 2 · FINISH — past 30 seconds, which was impossible before

- [ ] The talk completes. Note `elapsedSec` in the final `/generate-status` response.
- [ ] **If it exceeds ~30 seconds, that is the proof.** On the old path this generation would have been
      terminated mid-flight, leaving the job stuck and the credit gone.
- [ ] The talk renders with citations.

## 3 · RELOAD + RECONNECT — the mobile case

Start a talk. While it is drafting, **reload the page.**

- [ ] The app picks the job back up rather than starting over.
- [ ] The talk arrives.
- [ ] **Exactly one credit was spent**, not two. Check the badge before and after.

## 4 · CANCEL — and it must tell the truth

Start a talk, then cancel during the critique stage.

- [ ] The response carries **`cancelled: true`** (not merely `status: "cancelled"` — the two used to be
      the same thing even when the write failed).
- [ ] The credit is **returned** — badge goes back up.
- [ ] Cancelling twice does not refund twice.

## 5 · DUPLICATE SUBMIT — the refund-scope fix

Hardest to trigger by hand; the double-click is the realistic version.

- [ ] Double-click Generate quickly. Only **one** generation runs.
- [ ] **Only one credit is consumed.**
- [ ] The second request returns `resumed: true` rather than an error, and **does not refund the first
      one's credit** — that was the bug: `create()` throws for both "already running" and "failed to
      start", and refunding on the wrong one takes back a credit for a talk that is about to arrive.

## 6 · THE TWO GATES — verify they refuse, from a terminal

These are the bypasses that existed on the sync route. Substitute a real signed-in token.

**Writer allowlist** — an uncleared model must be refused for teaching content:

```bash
curl -s -X POST "https://<your-worker>.workers.dev/v1/messages" -H 'Content-Type: application/json' -H 'Origin: https://tangjennii.github.io' -H 'X-Supabase-Auth: <token>' -H 'X-CT-Meter: talk' -d '{"model":"claude-haiku-4-5-20251001","messages":[{"role":"user","content":"hi"}]}' | jq '.error.type'
```

- [ ] `"writer_not_cleared"` — and nothing was billed.

**Quota receipt** — a talk without one must be refused:

```bash
curl -s -X POST "https://<your-worker>.workers.dev/v1/messages" -H 'Content-Type: application/json' -H 'Origin: https://tangjennii.github.io' -H 'X-Supabase-Auth: <token>' -H 'X-CT-Meter: talk' -d '{"model":"claude-opus-5","messages":[{"role":"user","content":"hi"}]}' | jq '.error.type'
```

- [ ] `"receipt_required"` — this is the quota bypass, closed.

## 7 · NOTHING BROKE THAT USED TO WORK

- [ ] Images still generate.
- [ ] Boards mode still works.
- [ ] Check-for-updates still works.
- [ ] The free-tier badge shows the right remaining count.

## 8 · LOGS — one look, for the thing units cannot show

```bash
npx wrangler tail --format json | jq 'select(.outcome != "ok") | {outcome, eventTimestamp}'
```

- [ ] No `exceededCpu`. Generation is spent *waiting* on Anthropic, which consumes no CPU time — if this
      appears, something is doing real work in a step that shouldn't be.

---

## If something fails

**Roll back the Worker, not the repo.** Cloudflare keeps previous versions:

```bash
npx wrangler deployments list
npx wrangler rollback --message "reverting <what> — <why>"
```

The front end reverts forward (`git revert`), never by force-push — see RELEASE.md.

Both database migrations are additive and safe to leave in place: `canonical_match_chunks` replaces a
function with its own exported definition, and `score_candidate_chunks` is unreachable unless a request
sets `rerank: true`, which no shipped client does.

---

## What this still does not prove

- **Anthropic idempotency.** Unconfirmed — the API reference is client-rendered and returned only
  "Loading…" to a fetch. The paid-call guarantee is **at-most-once, fail-closed**, not exactly-once.
- **Retrieval quality.** Calibration has not been run; see `CALIBRATION_RUNBOOK.md`. That is a separate
  question from whether the app works, and it is measured with physician judgements, not clicks.
- **The remaining audit items** in `rag/runs/2026-07-29-worker-audit.md` — fail-open spend reads, the soft
  cap under concurrency, non-atomic job idempotency, cache-creation token pricing, and the unbound
  `RATE_LIMIT_KV`. None blocks launch; all are still open.
