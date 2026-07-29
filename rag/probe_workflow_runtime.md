# Runtime probe — the Workflow behaviours the docs do not settle

Four questions the documentation leaves open. Each could change how the paid path behaves, and none can
be answered by reading. Run these against a **throwaway Worker**, never the real one — the whole point is
to make steps fail on purpose.

Chalk Talk's design deliberately does **not depend** on any of these answers: it uses `limit: 1` (never
the undocumented `limit: 0`), and an attempt marker refuses to re-issue a paid call regardless of how the
retry count is interpreted. The probe exists to *replace assumptions with facts*, not to unblock the
build.

## Setup

```bash
mkdir /tmp/wf-probe && cd /tmp/wf-probe
npm create cloudflare@latest -- --type=hello-world
# add to wrangler.toml:
#   [[workflows]]
#   binding = "PROBE"
#   name = "probe"
#   class_name = "Probe"
```

## The probe

```js
import { WorkflowEntrypoint } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

export class Probe extends WorkflowEntrypoint {
  async run(event, step) {
    const mode = event.payload.mode;
    const log = [];

    // Q1 — does `limit: 0` even parse, and how many times does the callback run?
    if (mode === "limit0") {
      try {
        await step.do("q1", { retries: { limit: 0, delay: 0 }, timeout: "1 minute" }, async () => {
          log.push("ran");
          throw new Error("always fails");
        });
      } catch (e) { log.push("caught: " + e.message); }
    }

    // Q2 — does `limit: N` mean N attempts, or 1 + N retries? COUNT them.
    if (mode === "limitN") {
      try {
        await step.do("q2", { retries: { limit: 3, delay: 1, backoff: "constant" }, timeout: "1 minute" }, async () => {
          log.push("ran");
          throw new Error("always fails");
        });
      } catch (e) { log.push("caught"); }
    }

    // Q3 — does NonRetryableError really stop after ONE execution?
    if (mode === "nonretryable") {
      try {
        await step.do("q3", { retries: { limit: 5, delay: 1 }, timeout: "1 minute" }, async () => {
          log.push("ran");
          throw new NonRetryableError("stop");
        });
      } catch (e) { log.push("caught"); }
    }

    // Q4 — is a completed step really not re-executed when a LATER step fails?
    if (mode === "replay") {
      await step.do("q4-first", { retries: { limit: 1, delay: 1 }, timeout: "1 minute" }, async () => {
        log.push("first ran");
        return { ok: true };
      });
      try {
        await step.do("q4-second", { retries: { limit: 3, delay: 1, backoff: "constant" }, timeout: "1 minute" },
          async () => { log.push("second ran"); throw new Error("fail"); });
      } catch (e) { log.push("caught"); }
    }

    return { log };
  }
}

export default {
  async fetch(req, env) {
    const mode = new URL(req.url).searchParams.get("mode") || "limitN";
    const i = await env.PROBE.create({ params: { mode } });
    // poll until terminal, then return the log
    for (let n = 0; n < 60; n++) {
      const s = await i.status();
      if (["complete", "errored", "terminated"].includes(s.status)) return Response.json(s);
      await new Promise(r => setTimeout(r, 1000));
    }
    return Response.json(await i.status());
  },
};
```

## What each answer changes

| | question | if it comes back… |
|---|---|---|
| **Q1** | Is `retries: { limit: 0 }` accepted, and does the callback run exactly once? | **Accepted + runs once** → a cleaner way to express "never retry a paid call" than `limit: 1`. **Rejected** → confirms `limit: 1` + `NonRetryableError` is the only supported shape, and the current code is already right. |
| **Q2** | Does `limit: 3` produce 3 executions or 4? | Count `"ran"` in the log. Whichever it is, **write it into `generation_workflow.js`** — the docs contradict themselves and the next person will guess too. |
| **Q3** | Does `NonRetryableError` stop after one execution even with `limit: 5`? | Exactly one `"ran"` confirms the guard works. **More than one is serious** — it would mean a paid call could repeat despite the guard, and the attempt marker becomes the only protection. |
| **Q4** | Is `q4-first` re-executed when `q4-second` fails? | Exactly one `"first ran"` confirms step caching. **More than one invalidates the whole design** — it would mean a critique failure re-buys the draft, which is the entire reason for splitting them. |

**Q4 is the one that matters most.** If step results are not replayed the way the docs describe, splitting
draft and critique buys nothing and the migration needs rethinking rather than tuning.

## Still unresolved after this probe

**Whether Anthropic's Messages API accepts an idempotency key.** I could not confirm it — the API
reference at `platform.claude.com/docs/en/api/messages` is client-rendered and returned only "Loading…"
placeholders to a plain fetch. If it *does* support one, sending a deterministic key derived from the
jobId and step name would upgrade the paid path from **at-most-once** to **exactly-once**, and the
attempt-marker refusal could be replaced by a safe retry. That is the single largest available
improvement to this design, and it needs checking in a browser or against the SDK types.

Until then the deliberate choice, matching Codex's recommendation for medical generation, is
**fail-closed / at-most-once: never silently issue a second paid generation request.** A lost generation
costs one retry; a duplicate charge costs money and trust.

## One documentation discrepancy worth knowing

Two independent readings of the Workflows docs produced different shapes for the optional `retention`
argument to `create()` — `{ successRetention, errorRetention }` versus `{ success, error }`. Chalk Talk
does not pass `retention`, so nothing depends on it, but do not copy either shape from memory if you ever
add it. Read it at the time.
