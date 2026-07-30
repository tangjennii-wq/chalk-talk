# End-to-end click test — the last gate before Chalk Talk goes live

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
curl -s -X POST "https://<your-worker>.workers.dev/retrieve" -H 'Content-Type: application/json' -d '{"query":"diabetic ketoacidosis","rerank":true}' | jq '{rerank_applied, rerank_scored}'
```

- [ ] `rerank_scored` is a **number**. `null` means the old build is still serving — that field does not
      exist there.

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

**(c) An uncleared model with a valid receipt.** Generate a talk normally, grab the `receipt` from the
`/v1/free-tier/consume` response in the Network tab and its `X-CT-Job`, then:

```bash
curl -s -X POST "https://<your-worker>.workers.dev/v1/messages" -H 'Content-Type: application/json' -H 'Origin: https://tangjennii.github.io' -H 'X-Supabase-Auth: <token>' -H 'X-CT-Meter: talk' -H 'X-CT-Receipt: <receipt>' -H 'X-CT-Job: <job>' -H 'X-CT-Stage: draft' -d '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"hi"}]}' | jq '.error.type'
```

- [ ] `"writer_not_cleared"` — the model gate rides on the receipt, so no header routes around it.

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
