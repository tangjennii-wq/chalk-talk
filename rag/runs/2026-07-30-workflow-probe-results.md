# Workflow runtime probe — results, and the two corrections they forced

Run against the real Cloudflare runtime, 2026-07-30. **The probe found the double-charge risk it was
built to find, in the constant written to prevent it.**

## Raw

```
raw counts:   {"q1":1,"q2":4,"q3":6,"q4first":1,"q4second":4}
raw statuses: {"limit0":"complete","limitN":"errored","nonretryable":"complete","replay":"errored"}
```

| | question | documented | **measured** |
|---|---|---|---|
| Q1 | `retries: { limit: 0 }` | not mentioned at all | **accepted, callback ran exactly once** |
| Q2 | does `limit: 3` mean 3 or 4 executions? | contradicts itself | **4 — `limit` is 1 + N RETRIES** |
| Q3 | does `NonRetryableError` stop retries? | "stops step retries" | **no — 6 executions against `limit: 5`** |
| Q4 | is a completed step re-executed when a later one fails? | cached | **cached — confirmed, ran once** |

## What changed, and why it mattered

### 1 · `PAID_RETRY` was a two-call configuration

`limit: 1` looked conservative. With 1 + N semantics it permits **two executions of a paid model call**.
The constant whose entire job was preventing a double charge was authorising one.

Now `limit: 0`, which Q1 measured as exactly one execution. The docs never mention it; the runtime
supports it. **The safe configuration is the one that isn't documented, and the one the docs imply is
safe permits two charges.**

### 2 · `NonRetryableError` is not a guard

Six executions against `limit: 5` — it was not recognised at all. Anything that treated it as a stop was
relying on nothing. It is still thrown, for the message it puts on the instance status, and that is all.

**Diagnosis in progress.** The probe threw it with a custom `name` (`"ProbeStop"`), and so did
`generation_workflow.js` (`"DuplicatePaidAttempt"`, `"PermanentModelFailure"`, `"EmptyDraft"`). The
leading hypothesis is that the runtime detects these by `error.name` and a custom name defeats it. Round
two adds three variants — bare, named, and a plain `Error` wearing the name — which separates "custom
name breaks it" from "it never works" from "`name` is the discriminator". All custom names have been
removed from the production path meanwhile, since they cost nothing and may be the cause.

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

Four mutations verified: restoring `limit: 1`, removing the result cache, clearing the marker on any
error, and reintroducing a custom error name each turn the suite red.

29 suites, 1158 assertions.

## Still open

- **Q3 diagnosis** — probe redeployed with three variants; keep it up until the answer is in.
- **Anthropic idempotency** — still unconfirmed; the reference page is client-rendered. The guarantee
  remains **at-most-once, fail-closed**, not exactly-once.
- **Do not deploy** until Q3 is understood.
