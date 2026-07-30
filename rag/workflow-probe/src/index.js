// WORKFLOW RUNTIME PROBE — a throwaway Worker answering four questions the docs do not settle.
//
// Separate from Chalk Talk on purpose: it exists to make steps FAIL, which is not something to do inside
// the Worker holding the real API keys. No paid API is called and no Chalk Talk data is touched.
//
// ── WHY THIS IS SPLIT INTO START / POLL (2026-07-30) ─────────────────────────────────────────────────
// The first version created all four instances and then polled them inside the SAME request, sleeping a
// second at a time for up to 90s each — six minutes of a single held-open HTTP request. It deployed
// fine and the request died with Cloudflare edge error 1104.
//
// I do not know exactly what 1104 means and am not going to guess, because the fix does not depend on
// it: a Worker request should not sit blocked for minutes waiting on background work. That is the same
// mistake as the ctx.waitUntil bug this probe exists to investigate, in a different costume. So the
// request now does one of two cheap things and returns immediately.
import { WorkflowEntrypoint } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

const MODES = ["limit0", "limitN", "nonretryable", "nrnamed", "nrduck", "replay"];
const RUN_KEY = "current-run";

export class Probe extends WorkflowEntrypoint {
  async run(event, step) {
    const { mode, runId } = event.payload;
    // Counts live in KV, not in a top-level variable: the engine may restart and a local counter would
    // measure its own restarts. That is one of the documented Rules of Workflows.
    const bump = async (k) => {
      const n = parseInt((await this.env.PROBE_KV.get(k)) || "0", 10) + 1;
      await this.env.PROBE_KV.put(k, String(n), { expirationTtl: 3600 });
      return n;
    };

    // Q1 — is `retries: { limit: 0 }` accepted at all, and does the callback run exactly once?
    if (mode === "limit0") {
      await step.do("q1", { retries: { limit: 0, delay: 0 }, timeout: "1 minute" }, async () => {
        await bump(`${runId}:q1`);
        throw new Error("always fails");
      });
    }

    // Q2 — does `limit: 3` mean 3 executions, or 1 + 3? COUNT them.
    if (mode === "limitN") {
      await step.do("q2", { retries: { limit: 3, delay: 1, backoff: "constant" }, timeout: "1 minute" }, async () => {
        await bump(`${runId}:q2`);
        throw new Error("always fails");
      });
    }

    // ── Q3 · WHY DID NonRetryableError NOT STOP? (round 2) ────────────────────
    // Round 1 threw `new NonRetryableError("stop", "ProbeStop")` — with a custom `name` — and the
    // callback ran SIX times, i.e. 1 + limit(5). It was not recognised as non-retryable at all.
    //
    // Hypothesis: the runtime identifies these by `error.name === "NonRetryableError"`, so supplying a
    // custom name defeats the mechanism. The docs present the second argument as an ordinary optional
    // name and say nothing about this.
    //
    // This matters directly: generation_workflow.js threw with custom names too
    // ("DuplicatePaidAttempt", "PermanentModelFailure", "EmptyDraft"), so if the hypothesis holds, none
    // of those would have stopped a retry either. Three variants isolate it.
    if (mode === "nonretryable") {          // BASELINE, no custom name
      await step.do("q3", { retries: { limit: 5, delay: 1 }, timeout: "1 minute" }, async () => {
        await bump(`${runId}:q3`);
        throw new NonRetryableError("stop");
      });
    }
    if (mode === "nrnamed") {               // the round-1 failure, reproduced
      await step.do("q3named", { retries: { limit: 5, delay: 1 }, timeout: "1 minute" }, async () => {
        await bump(`${runId}:q3named`);
        throw new NonRetryableError("stop", "ProbeStop");
      });
    }
    if (mode === "nrduck") {                // a PLAIN Error wearing the name — is `name` the discriminator?
      await step.do("q3duck", { retries: { limit: 5, delay: 1 }, timeout: "1 minute" }, async () => {
        await bump(`${runId}:q3duck`);
        const e = new Error("stop");
        e.name = "NonRetryableError";
        throw e;
      });
    }

    // Q4 — THE LOAD-BEARING ONE. Is a COMPLETED step re-executed when a LATER step fails? If it is,
    // splitting draft from critique buys nothing and Chalk Talk's migration needs rethinking.
    if (mode === "replay") {
      await step.do("q4-first", { retries: { limit: 1, delay: 1 }, timeout: "1 minute" }, async () => {
        await bump(`${runId}:q4first`);
        return { ok: true };
      });
      await step.do("q4-second", { retries: { limit: 3, delay: 1, backoff: "constant" }, timeout: "1 minute" }, async () => {
        await bump(`${runId}:q4second`);
        throw new Error("fail");
      });
    }
    return { mode };
  }
}

const num = (v) => (v == null ? null : parseInt(v, 10));

async function readCounts(env, runId) {
  const [q1, q2, q3, q3n, q3d, f, s] = await Promise.all([
    env.PROBE_KV.get(`${runId}:q1`), env.PROBE_KV.get(`${runId}:q2`), env.PROBE_KV.get(`${runId}:q3`),
    env.PROBE_KV.get(`${runId}:q3named`), env.PROBE_KV.get(`${runId}:q3duck`),
    env.PROBE_KV.get(`${runId}:q4first`), env.PROBE_KV.get(`${runId}:q4second`),
  ]);
  return { q1: num(q1), q2: num(q2), q3: num(q3), q3named: num(q3n), q3duck: num(q3d),
           q4first: num(f), q4second: num(s) };
}

function verdict(counts, statuses, createErrors) {
  const L = [];
  const line = (pass, text) => L.push((pass === null ? "?  " : pass ? "OK " : "!! ") + text);

  // Q1 — informational. Chalk Talk uses limit: 1 and never limit: 0.
  if (createErrors.limit0) {
    line(true, `limit:0 — REJECTED before the step ran (${createErrors.limit0}). Confirms limit:1 is the right choice.`);
  } else if (statuses.limit0 === "errored" && counts.q1 === null) {
    line(true, "limit:0 — the instance errored without the callback running: the config was rejected. Keep limit:1.");
  } else if (counts.q1 !== null) {
    line(counts.q1 === 1, `limit:0 — accepted; callback ran ${counts.q1} time(s). ` +
      (counts.q1 === 1 ? "A valid never-retry, though we do not rely on it." : "NOT a never-retry — do not use it."));
  } else line(null, "limit:0 — inconclusive");

  // Q2 — the number to write into the source.
  if (counts.q2 !== null) {
    line(true, `limit:3 produced ${counts.q2} execution(s) → ` + (
      counts.q2 === 3 ? "`limit` means TOTAL ATTEMPTS. PAID_RETRY limit:1 allows ONE paid call." :
      counts.q2 === 4 ? "`limit` means ADDITIONAL RETRIES (1+N). PAID_RETRY limit:1 allows TWO paid calls — tell Claude." :
      "an unexpected count — tell Claude."));
  } else line(null, "limit:N — inconclusive");

  // Q3 — three variants, to find out WHY round 1 did not stop.
  const bare = counts.q3, named = counts.q3named, duck = counts.q3duck;
  if (bare !== null) {
    line(bare === 1, `NonRetryableError (no custom name), limit:5 → ${bare} execution(s). ` +
      (bare === 1 ? "Stops, as documented." : "Does NOT stop even bare — do not rely on it at all."));
  } else line(null, "NonRetryableError bare — inconclusive");
  if (named !== null) {
    line(named === 1, `NonRetryableError WITH custom name, limit:5 → ${named} execution(s). ` +
      (named === 1 ? "The custom name is harmless." : "The custom name DEFEATS it — never pass one."));
  } else line(null, "NonRetryableError named — inconclusive");
  if (duck !== null) {
    line(true, `plain Error with name="NonRetryableError", limit:5 → ${duck} execution(s). ` +
      (duck === 1 ? "`name` IS the discriminator." : "`name` alone is not enough; the real class is required."));
  } else line(null, "duck-typed name — inconclusive");
  if (bare === 1 && named !== null && named > 1) {
    L.push("     => DIAGNOSIS: passing a custom name defeats NonRetryableError. Throw it with a message only.");
  }

  // Q4 — invalidates the design if wrong.
  if (counts.q4first !== null) {
    line(counts.q4first === 1,
      `step caching: the completed first step ran ${counts.q4first} time(s) while the second failed ${counts.q4second} time(s). ` +
      (counts.q4first === 1
        ? "Completed steps ARE cached — the draft/critique split holds."
        : "COMPLETED STEPS ARE RE-EXECUTED. Chalk Talk's design does not hold — stop and tell Claude."));
  } else line(null, "step caching — inconclusive");

  return L;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/reset") {
      await env.PROBE_KV.delete(RUN_KEY);
      return new Response("reset — curl / again to start a fresh run\n");
    }

    let runId = await env.PROBE_KV.get(RUN_KEY);

    // ── START: create the four instances and return at once. No blocking. ────
    if (!runId) {
      runId = "r" + Date.now().toString(36);
      const createErrors = {};
      for (const mode of MODES) {
        try {
          await env.PROBE.create({ id: `${runId}-${mode}`, params: { mode, runId } });
        } catch (err) {
          createErrors[mode] = String((err && err.message) || err).slice(0, 160);
        }
      }
      await env.PROBE_KV.put(RUN_KEY, runId, { expirationTtl: 3600 });
      await env.PROBE_KV.put(`${runId}:createErrors`, JSON.stringify(createErrors), { expirationTtl: 3600 });
      return new Response(
        `STARTED run ${runId} — four workflow instances.\n` +
        `Wait ~45 seconds, then curl this URL again for the verdict.\n`);
    }

    // ── POLL: read statuses and counts, print the verdict when all are done. ──
    const statuses = {};
    let terminal = 0;
    for (const mode of MODES) {
      try {
        const inst = await env.PROBE.get(`${runId}-${mode}`);
        const s = await inst.status();
        statuses[mode] = s.status;
        if (["complete", "errored", "terminated"].includes(s.status)) terminal++;
      } catch (err) {
        statuses[mode] = "missing";
        terminal++;   // it will never become terminal; do not wait forever on it
      }
    }
    const counts = await readCounts(env, runId);
    let createErrors = {};
    try { createErrors = JSON.parse((await env.PROBE_KV.get(`${runId}:createErrors`)) || "{}"); } catch (_) {}

    if (terminal < MODES.length) {
      return new Response(
        `run ${runId}: ${terminal}/${MODES.length} finished — ${JSON.stringify(statuses)}\n` +
        `Not done yet. Curl again in ~20 seconds.\n`);
    }

    const body = [
      "CLOUDFLARE WORKFLOW RUNTIME PROBE",
      "=================================",
      "",
      ...verdict(counts, statuses, createErrors),
      "",
      "raw counts:   " + JSON.stringify(counts),
      "raw statuses: " + JSON.stringify(statuses),
      "create errors: " + JSON.stringify(createErrors),
      "",
      "Any '!!' means an assumption in generation_workflow.js is wrong.",
      "The step-caching line is the one that would invalidate the design rather than adjust it.",
      "",
      `To run again: curl <this-url>/reset then curl <this-url>/`,
    ].join("\n");
    return new Response(body + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
};
