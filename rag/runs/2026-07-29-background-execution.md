# Background generation is built on a 30-second budget it needs 50–100 seconds of

**Status: real pre-launch defect. Not fixed — this is a design decision, and the fix is architectural.**
Found by Codex 2026-07-29, independently confirmed against Cloudflare's documentation.

## The defect

```js
ctx.waitUntil(runGeneration(jobId, body, env));
return jsonOK({ jobId, createdAt: now }, origin);
```

`runGeneration` does a draft, then a critique — two sequential model calls, 50–100 seconds in practice.
It runs *after* the response is sent.

> "`waitUntil()` can extend execution for up to 30 seconds after the response is sent or the client
> disconnects."
> — [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

The page states this **three separate times**, in the Duration section, in the Subrequests prose, and in
the wall-time table. In none of them is there a plan qualifier, and there is no config lever for it.

### The Paid-plan belief was wrong, and it is why this shipped

`wrangler.toml` said JOBS_KV "requires the Workers Paid plan (for the longer `ctx.waitUntil` budget)".
There is no longer budget. Paid raises **CPU time** — 30s default to 5 min via `cpu_ms` — which is a
different limit that happens to share the number 30.

That coincidence is the whole trap. And CPU time is the wrong axis anyway: generation is spent almost
entirely *waiting* on Anthropic, and waiting consumes no CPU time at all. `cpu_ms: 300000` would change
nothing. The comment has been corrected in place.

### What the user experiences

The job is killed mid-generation. Nothing writes `done`, nothing writes `error`, and — because the refund
lives inside `runGeneration` — nothing refunds. The record simply stops changing.

So: **the spinner runs forever, and the talk credit is silently gone.** Worse on mobile, which is exactly
the case background generation exists to serve. It will *sometimes* work, since 30 seconds is a floor on
termination rather than a promise of it, which makes it the most annoying kind of bug — intermittent, and
correlated with longer (more valuable) talks.

## What was done now

**Nothing that fixes it.** Two things that stop it being invisible:

1. `wrangler.toml` — the false Paid-plan premise corrected, with the citation.
2. `/generate-status` — a job idle >90s in `running`/`critique` now returns `stalled: true` with
   `idle_seconds` and a plain-language explanation, instead of a status the client polls forever.

The status check is **read-only by design**. It classifies; it does not mutate and it does not refund. The
runner may still be alive and about to write, and racing it from a polling endpoint risks double-refunding
or clobbering a real result. Diagnosis belongs where the read is; remediation belongs where the state is
owned.

## The three real options

| | fit | wall-clock | cost of change |
|---|---|---|---|
| **Workflows** | **best** — durable multi-step execution with retries and persisted state, which is exactly what draft → critique → save is | unlimited per step | highest: restructure `runGeneration` into steps |
| **Queues** | good if the job is "submit once, process, save" | 15 min per consumer invocation | moderate: producer + consumer, job state still needs a home |
| **Durable Objects** | best for *ownership* — atomic idempotency and cancellation (see the open non-atomic `clientJobId` and cancel-race findings) | unlimited while a caller is connected | subtle: moving the same long promise into a DO request needs careful lifecycle design and does not by itself buy durability |

**Recommendation: Workflows for execution, and consider a Durable Object for job ownership.** They solve
different problems and the open findings want both — Workflows for "the work survives", a DO for "exactly
one job, cancellable, atomically". Queues is the cheaper path if you want one change rather than two.

Whichever is chosen, the refund must move **outside** the terminable region, or a killed job keeps costing
the user a talk.

## How to confirm it before building anything

Cheapest first: the evidence is probably already in the logs.

```bash
npx wrangler tail --format json | jq 'select(.outcome != "ok") | {outcome, scriptName, eventTimestamp}'
```

`exceededCpu` would mean I have the axis wrong. Anything else — particularly `canceled` — on invocations
that returned a job id is this defect. Also worth a direct check: submit a real generation, poll status,
and see whether `elapsedSec` on completed jobs clusters *under* ~30s while longer ones never complete.
That distribution would be the fingerprint.
