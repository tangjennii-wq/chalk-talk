# Durable generation — what was built, and what still has to be proven on Cloudflare

Built 2026-07-29 against Codex's design. **The code is written and unit-tested; it has not run on
Cloudflare once.** Everything below distinguishes those two states, because the failure mode this whole
migration exists to fix was a feature that looked deployed and wasn't.

## Shape

```
POST /generate-async
  ├─ reserve 1 talk           (atomic, unchanged — free_tier_consume decrements only if quota remains)
  ├─ write job record         (KV)
  ├─ write job BODY           (KV — NOT the event payload; see below)
  └─ GEN_WORKFLOW.create({ id: jobId, params: { jobId, userEmail, wantCritique } })

ChalkTalkGeneration.run()
  ├─ step "draft"     PAID_RETRY  → guarded model call
  ├─ step "critique"  PAID_RETRY  → guarded model call (skipped when not requested)
  ├─ step "meter"     CHEAP_RETRY → ledger, idempotent per job
  └─ step "finalize"  CHEAP_RETRY → job record → done
```

| file | why it is separate |
|---|---|
| `generation_workflow.js` | the step logic, **no Cloudflare imports** — so Node can execute it |
| `worker_entry.js` | the only file importing `cloudflare:workers` / `cloudflare:workflows`; `wrangler.toml` `main` points here |
| `worker.js` | request handling, unchanged entry for every existing test (`makeWorkflowDeps` injects the side effects) |

That split exists so the logic is testable without deploying. A workflow that can only be exercised on
Cloudflare is a workflow whose correctness is an assertion.

## The thing that could have cost real money

**`step.do()` retries five times by default.** Cloudflare's documented default when no config is passed:

```js
retries: { limit: 5, delay: 10000, backoff: "exponential" }, timeout: "10 minutes"
```

A naive `step.do("draft", () => callAnthropic(...))` bills up to **five drafts for one talk**. Every paid
step here passes an explicit `PAID_RETRY` instead, and `test_generation_workflow.mjs` asserts on the
config the step actually received — mutation-verified by removing it.

Three further defences, because the retry count alone is not trustworthy:

1. **An attempt marker written before the call.** Anthropic has no "was this charged?" endpoint, so
   unlike the payment-processor example in Cloudflare's own docs we cannot ask the provider. On re-entry,
   a marker with no result means a call may already have been billed — so the step **refuses** and fails
   the instance rather than re-issuing. That trades a rare lost generation for never double-charging.
2. **`NonRetryableError` on anything not plainly transient.** A 400 retried is a 400 retried; it only
   delays the refund.
3. **Idempotent metering and refunding**, keyed per job, so a retry of the cheap steps cannot double-bill
   or double-credit.

**The docs are ambiguous about `limit`** — the prose says "total number of attempts (limited to 10,000
retries)" while the code comment on the same page says `limit: 10, // The total number of attempts`, and
`limit: 0` is never documented at all. So the guard, not the number, is what protects the user.

## Two constraints that would have bitten in production, not in testing

- **The request body never crosses a step boundary.** Event payloads and step return values are both
  capped at 1 MiB; `MAX_REQUEST_BYTES` is 5 MB because a talk can carry an uploaded reference. The body
  goes to KV at submit and is loaded *inside* the step that needs it. Passing it through the payload
  would have worked for every small talk and failed on exactly the large uploads the feature exists for.
- **No fall-through on a failed `create()`.** If the Workflow cannot start, the endpoint refunds and
  returns 503 rather than quietly running the legacy path — otherwise the response says "started" either
  way and the 30-second bug returns invisibly.

## Not done, deliberately

- **No Durable Object.** Per Codex: Workflows already solve execution and instance lifecycle. Revisit
  only if cancellation or idempotency still needs stronger coordination after this is proven.
- **The legacy `waitUntil` path still exists**, used only when `GEN_WORKFLOW` is unbound. `/generate-async`
  returns `durable: true|false` so which path ran is never a guess. **Delete it once the checklist below
  passes** — leaving both indefinitely means two paths and one set of tests.
- **`step.do`'s `rollback` option is unused.** It is the docs' sanctioned compensation mechanism, but a
  rollback for a model call would mean refunding a talk credit, which `refundOnce` already handles at the
  instance level. Worth revisiting if step-level compensation ever gets more complicated.

## What has to be proven on Cloudflare — none of this is verified

Unit tests cover the logic. They cannot cover the platform. In order:

1. **`wrangler deploy` succeeds** with the new `main` (`worker_entry.js`) and the `[[workflows]]` binding.
   Requires `compatibility_date >= 2024-10-22`; ours is `2025-01-01`.
2. **A real generation completes past 30 seconds** and writes `done`. This is the entire point — confirm
   `elapsedSec` exceeds 30 on a talk that previously would have stalled.
3. **`/generate-async` returns `durable: true`.** If it returns `false`, the binding is not live and the
   old path is running.
4. **Cancel terminates the instance**, the record shows `cancelled`, and the credit returns exactly once.
5. **Reload mid-generation reconnects** and the talk still arrives.
6. **A forced failure refunds.** Point a model id at something invalid and confirm one credit returns and
   the instance reports `errored`.
7. **Duplicate submit** with the same `clientJobId` does not create a second instance or reserve a second
   talk.
8. `npx wrangler tail` shows no `exceededCpu` — waiting on Anthropic should consume no CPU time.

Until 1–8 pass, **the `waitUntil` defect should still be treated as live**, because on any deploy where
the binding is missing, it is.
