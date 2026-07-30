# Workflow runtime probe — run this before trusting the durable path

**I could not run this.** My sandbox has no route to Cloudflare (`api.cloudflare.com` → `000`) and no
wrangler credentials, so this needs your machine. It takes about three minutes and calls no paid API.

```bash
cd rag/workflow-probe
npx wrangler kv namespace create PROBE_KV     # paste the printed id into wrangler.toml
npx wrangler deploy
curl "https://chalk-talk-workflow-probe.<your-subdomain>.workers.dev/"
```

It prints a verdict directly — `OK` / `!!` per question — followed by the raw instance output.

When you're done:

```bash
npx wrangler delete            # remove the probe Worker
npx wrangler kv namespace delete --binding PROBE_KV
```

## What it answers, and what each answer changes

| | question | why it matters |
|---|---|---|
| Q1 | Is `retries: { limit: 0 }` accepted, and does the callback run exactly once? | Codex flagged it as undocumented. Chalk Talk deliberately does **not** use it — this only tells us whether a cleaner expression of never-retry exists. |
| Q2 | Does `limit: 3` produce **3** executions or **4**? | The docs contradict themselves. If it means 1 + N, then `PAID_RETRY`'s `limit: 1` permits **two** executions of a paid call, and that number should be written into `generation_workflow.js` rather than left to the next person's guess. |
| Q3 | Does `NonRetryableError` stop after one execution even with `limit: 5`? | It is the documented way to halt retries. More than one execution would mean a paid call can repeat despite the guard, leaving the attempt marker as the sole protection. |
| **Q4** | **Is a completed step re-executed when a later step fails?** | **The load-bearing one.** Splitting draft from critique exists entirely so a critique failure never re-buys the draft. If completed steps are not cached, that split buys nothing and the migration needs rethinking, not tuning. |

## Reading the result

- **All four `OK`** → the assumptions under `generation_workflow.js` hold. Proceed to the writer
  allowlist and quota enforcement, then the end-to-end click test.
- **Q2 says 1 + N** → not a failure, but update `PAID_RETRY`'s comment and the migration doc so the
  real attempt count is written down.
- **Q3 not exactly 1** → serious. The attempt marker becomes the only thing preventing a repeat charge.
- **Q4 first-step count > 1** → stop. Tell me before building anything further on it.

Note that Chalk Talk is designed to survive Q1–Q3 going the wrong way: `limit: 1`, `NonRetryableError`
and the attempt marker are three independent defences, and the marker refuses to re-issue a paid call no
matter how the retry count is interpreted. Q4 is the only one that would invalidate the structure.

**The guarantee stays at-most-once, fail-closed** regardless of what this returns. Nothing here can make
it exactly-once — that needs confirmed idempotency support from Anthropic's Messages API, which I could
not verify because the reference page is client-rendered and returned only "Loading…" to a plain fetch.
