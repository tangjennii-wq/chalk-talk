# Workflow runtime probe — results, and the two corrections they forced

Run against the real Cloudflare runtime, 2026-07-30. **The probe found the double-charge risk it was
built to find, in the constant written to prevent it.**

## Raw

```
round 1 (NonRetryableError WITH a custom name):
raw counts:   {"q1":1,"q2":4,"q3":6,"q4first":1,"q4second":4}

round 2 (identical, except the custom name removed):
raw counts:   {"q1":1,"q2":4,"q3":1,"q4first":1,"q4second":4}
```

| | question | documented | **measured** |
|---|---|---|---|
| Q1 | `retries: { limit: 0 }` | not mentioned at all | **accepted, callback ran exactly once** |
| Q2 | does `limit: 3` mean 3 or 4 executions? | contradicts itself | **4 — `limit` is 1 + N RETRIES** |
| Q3 | does `NonRetryableError` stop retries? | "stops step retries" | **only without a custom name — 6 executions with, 1 without** |
| Q4 | is a completed step re-executed when a later one fails? | cached | **cached — confirmed, ran once** |

## What changed, and why it mattered

### 1 · `PAID_RETRY` was a two-call configuration

`limit: 1` looked conservative. With 1 + N semantics it permits **two executions of a paid model call**.
The constant whose entire job was preventing a double charge was authorising one.

Now `limit: 0`, which Q1 measured as exactly one execution. The docs never mention it; the runtime
supports it. **The safe configuration is the one that isn't documented, and the one the docs imply is
safe permits two charges.**

### 2 · `NonRetryableError` is defeated by its own optional second argument — DIAGNOSED

Round 1 threw `new NonRetryableError("stop", "ProbeStop")` → **6 executions** against `limit: 5`.
Round 2 changed exactly one thing, dropping the name → **1 execution**.

```
new NonRetryableError("stop", "ProbeStop")   ->  6
new NonRetryableError("stop")                ->  1
```

**Passing a custom `name` silently defeats it.** The docs present that second argument as an ordinary
optional name and say nothing about the consequence. `generation_workflow.js` passed one on every throw
(`"DuplicatePaidAttempt"`, `"PermanentModelFailure"`, `"EmptyDraft"`), so none of them would have stopped
a retry — a guard that was doing nothing while reading as though it were.

All custom names are gone. `NonRetryableError` does now work, and is used, but it is **not** the primary
defence: a guard that fails silently when someone adds a helpful-looking argument is not one to lean on.
`limit: 0` and the result cache are what hold.

*A note on the evidence.* The two measurements come from consecutive runs rather than one run with both
variants — my edit adding named/duck-typed modes landed after the deploy. One variable changed between
them and nothing else, so the comparison is sound, but a single run containing both is available any
time by re-running the probe (it now carries `nrnamed` and `nrduck` modes, which would also settle
whether `name` alone is the discriminator).

### 3 · A hole the probe made me find, which no question asked about

Reading Q4's confirmation that steps restart from the beginning, I looked again at the old code:

```js
out = await call();
await releaseAttempt(...);   // marker cleared
return out;                  // engine persists the result AFTER this
```

A restart between those two lines sees no marker and buys a second draft. **No retry setting prevents
this — a restart is not a retry.** A marker alone cannot fix it either, because the safe state after a
successful call is not "no attempt", it is "attempt made, and here is what it produced".

So the result is now **cached durably**, checked first, and written *before* the marker is released — no
window exists where neither is set. This is Cloudflare's own check-before-charge pattern, with our
storage standing in for the provider "was this billed?" endpoint Anthropic does not offer.

### 4 · Ambiguity now fails closed explicitly

A provider that answered with an HTTP status cannot have billed for a completion. A network error or
timeout might have. The marker is released only in the first case; in the second it stays, and a later
execution refuses. `definitelyNotBilled()` makes that distinction explicit rather than incidental.

## What did NOT change

**Q4 vindicated the architecture.** Completed steps are cached, so a critique failure does not re-buy the
draft. The draft/critique split holds and the migration is sound — only its retry configuration was wrong.

## Tests

`test_generation_workflow.mjs` now models the **measured** semantics, not the documented ones: the stub
executes `1 + limit` times and does *not* honour `NonRetryableError`. Modelling the docs would have let
this double-charge pass locally and fail in production, which is precisely the failure the probe exists
to catch.

A dedicated section pins all four measured properties in one place, so if the platform ever changes,
one section fails and names what moved. It includes the assertion Codex asked for explicitly:

```
✓ Q2: limit: 1 => TWO executions — never call this 'one paid call'
```

Seven mutations verified across the suite: restoring `limit: 1`, removing the result cache, clearing the
marker on any error, reintroducing a custom error name, and merging critique back into the draft step
each turn it red.

29 suites, 1169 assertions.

**On the `errored` statuses in the raw output** — expected, and not a problem. Every probe throws
deliberately; `errored` is the instance doing what it was asked. The execution *counts* are the result.

## Verdict: all four questions answered, architecture holds

| | |
|---|---|
| Q1 `limit: 0` | accepted, exactly one execution — now used for every paid step |
| Q2 `limit: N` | 1 + N retries — the old `limit: 1` was a two-call config |
| Q3 `NonRetryableError` | works, but only without a custom name — all names removed |
| Q4 step caching | confirmed — the draft/critique split is sound |

**Next, in order:** server-side writer allowlist → server-side quota enforcement → end-to-end click test
(start, reload, reconnect, finish, cancel, duplicate submit) → deploy Worker and front end together.

## Still open

- **Anthropic idempotency** — unconfirmed; the reference page is client-rendered and returns only
  "Loading…" to a fetch. The guarantee remains **at-most-once, fail-closed**, not exactly-once.
- ~~The probe Worker is still deployed.~~ **Deleted 2026-07-30**, along with its KV namespace. The
  source stays in `rag/workflow-probe/` so it can be redeployed if the platform's behaviour ever needs
  re-checking — it also carries `nrnamed` and `nrduck` modes that would confirm the Q3 diagnosis within
  a single run.
