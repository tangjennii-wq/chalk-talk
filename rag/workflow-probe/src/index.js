// WORKFLOW RUNTIME PROBE — a throwaway Worker that answers four questions the docs do not settle.
//
// Deliberately separate from Chalk Talk: it exists to make steps FAIL on purpose, which is not something
// to do inside the real Worker. It calls no paid API and touches no Chalk Talk data.
//
// Deploy, hit `/`, read the verdict. See ../probe_workflow_runtime.md for what each answer changes.
import { WorkflowEntrypoint } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

export class Probe extends WorkflowEntrypoint {
  async run(event, step) {
    const mode = event.payload.mode;
    // The log is accumulated INSIDE steps and returned, because a top-level array would be rebuilt on
    // every engine restart — the exact non-durable-state mistake the Rules of Workflows warn about.
    // Counting is done by writing to KV instead, which survives.
    const bump = async (k) => {
      const n = parseInt((await this.env.PROBE_KV.get(k)) || "0", 10) + 1;
      await this.env.PROBE_KV.put(k, String(n), { expirationTtl: 600 });
      return n;
    };
    const runId = event.payload.runId;

    // ── Q1 · is `retries: { limit: 0 }` accepted, and does the callback run exactly once? ──
    if (mode === "limit0") {
      try {
        await step.do("q1", { retries: { limit: 0, delay: 0 }, timeout: "1 minute" }, async () => {
          await bump(`${runId}:q1`);
          throw new Error("always fails");
        });
      } catch (e) {
        return { q: "limit0", error: String(e && e.message), runs: await this.env.PROBE_KV.get(`${runId}:q1`) };
      }
      return { q: "limit0", error: null, runs: await this.env.PROBE_KV.get(`${runId}:q1`) };
    }

    // ── Q2 · does `limit: 3` mean 3 executions or 4? COUNT them. ──
    if (mode === "limitN") {
      try {
        await step.do("q2", { retries: { limit: 3, delay: 1, backoff: "constant" }, timeout: "1 minute" }, async () => {
          await bump(`${runId}:q2`);
          throw new Error("always fails");
        });
      } catch (_) {}
      return { q: "limitN", runs: await this.env.PROBE_KV.get(`${runId}:q2`) };
    }

    // ── Q3 · does NonRetryableError stop after ONE execution, even with limit: 5? ──
    if (mode === "nonretryable") {
      try {
        await step.do("q3", { retries: { limit: 5, delay: 1 }, timeout: "1 minute" }, async () => {
          await bump(`${runId}:q3`);
          throw new NonRetryableError("stop", "ProbeStop");
        });
      } catch (_) {}
      return { q: "nonretryable", runs: await this.env.PROBE_KV.get(`${runId}:q3`) };
    }

    // ── Q4 · THE ONE THAT MATTERS MOST ──
    // Is a COMPLETED step re-executed when a LATER step fails? If it is, splitting draft from critique
    // buys nothing and Chalk Talk's whole migration needs rethinking rather than tuning.
    if (mode === "replay") {
      await step.do("q4-first", { retries: { limit: 1, delay: 1 }, timeout: "1 minute" }, async () => {
        await bump(`${runId}:q4first`);
        return { ok: true };
      });
      try {
        await step.do("q4-second", { retries: { limit: 3, delay: 1, backoff: "constant" }, timeout: "1 minute" },
          async () => { await bump(`${runId}:q4second`); throw new Error("fail"); });
      } catch (_) {}
      return {
        q: "replay",
        firstRuns: await this.env.PROBE_KV.get(`${runId}:q4first`),
        secondRuns: await this.env.PROBE_KV.get(`${runId}:q4second`),
      };
    }
    return { q: "none" };
  }
}

const MODES = ["limit0", "limitN", "nonretryable", "replay"];

async function runMode(env, mode) {
  const runId = mode + "-" + Date.now().toString(36);
  let instance;
  try {
    instance = await env.PROBE.create({ params: { mode, runId } });
  } catch (err) {
    return { mode, fatal: `create() threw: ${String(err && err.message || err)}` };
  }
  for (let n = 0; n < 90; n++) {
    const s = await instance.status();
    if (["complete", "errored", "terminated"].includes(s.status)) {
      return { mode, status: s.status, output: s.output ?? null, error: s.error ?? null };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { mode, fatal: "timed out waiting for a terminal status" };
}

/** Turn raw results into the four answers, plus the verdict for Chalk Talk. */
function verdict(results) {
  const by = Object.fromEntries(results.map((r) => [r.mode, r]));
  const num = (v) => (v == null ? null : parseInt(v, 10));
  const lines = [];
  const flag = (pass, text) => lines.push((pass === null ? "?  " : pass ? "OK " : "!! ") + text);

  // Q1
  const q1 = by.limit0;
  if (q1 && q1.fatal) flag(false, `limit:0 — REJECTED by the platform (${q1.fatal}). Keep using limit: 1.`);
  else if (q1 && q1.output) {
    const runs = num(q1.output.runs);
    flag(runs === 1, `limit:0 — accepted; callback ran ${runs} time(s). ` +
      (runs === 1 ? "A valid way to express never-retry." : "NOT a never-retry; do not use it."));
  } else flag(null, "limit:0 — inconclusive");

  // Q2 — the number to write back into generation_workflow.js
  const q2 = by.limitN;
  if (q2 && q2.output) {
    const runs = num(q2.output.runs);
    flag(runs !== null, `limit:3 produced ${runs} execution(s) → ` +
      (runs === 3 ? "`limit` means TOTAL ATTEMPTS." : runs === 4 ? "`limit` means ADDITIONAL RETRIES (1 + N)." : "an unexpected count — investigate."));
    if (runs === 4) lines.push("     NB: PAID_RETRY limit:1 therefore allows TWO executions of a paid call.");
  } else flag(null, "limit:N — inconclusive");

  // Q3
  const q3 = by.nonretryable;
  if (q3 && q3.output) {
    const runs = num(q3.output.runs);
    flag(runs === 1, `NonRetryableError with limit:5 ran the callback ${runs} time(s). ` +
      (runs === 1 ? "Stops immediately, as documented." : "SERIOUS: it did NOT stop retries."));
  } else flag(null, "NonRetryableError — inconclusive");

  // Q4 — load bearing
  const q4 = by.replay;
  if (q4 && q4.output) {
    const first = num(q4.output.firstRuns), second = num(q4.output.secondRuns);
    flag(first === 1, `step caching: the completed first step ran ${first} time(s) while the second failed ${second} time(s). ` +
      (first === 1 ? "Completed steps ARE cached — the draft/critique split holds."
                   : "COMPLETED STEPS ARE RE-EXECUTED. Chalk Talk's design does not hold; stop and rethink."));
  } else flag(null, "step caching — inconclusive");

  return lines;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const only = url.searchParams.get("mode");
    const modes = only ? [only] : MODES;
    const results = [];
    for (const m of modes) results.push(await runMode(env, m));
    const lines = verdict(results);
    const body = [
      "CLOUDFLARE WORKFLOW RUNTIME PROBE",
      "=================================",
      "",
      ...lines,
      "",
      "Raw:",
      JSON.stringify(results, null, 2),
      "",
      "Any '!!' line means an assumption in generation_workflow.js is wrong. The Q4 line is the one that",
      "would invalidate the design rather than merely adjust it.",
    ].join("\n");
    return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
};
