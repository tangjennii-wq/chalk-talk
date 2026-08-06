// LOST-RESPONSE RECOVERY — run: node test_lost_response_recovery.mjs
//
// THE SCENARIO, EXECUTED END TO END:
//   1. The browser POSTs /generate-async. The server reserves a credit, mints a receipt and starts the
//      Workflow — and the RESPONSE IS LOST. The browser knows only the clientJobId it chose.
//   2. It re-submits the SAME clientJobId.
//   3. It must get back the SAME job, the SAME receipt, and the row's authoritative receiptExpiresAt —
//      with NO second reservation and NO second Workflow.
//
// Why this needs its own suite: every other test starts from a submit whose response arrived. The whole
// defect class here is what the browser holds when it doesn't. The earlier code returned {jobId} alone, so
// a talk the user had already paid for could not authorise its own citation audit.
//
// Both stages run against the REAL exported handler. Counters sit in the fetch stub and the Workflow stub,
// so "no second reservation" and "no second Workflow" are observations, not assertions about source text.
import worker from "./worker.js";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const ORIGIN = "https://tangjennii-wq.github.io";
const realFetch = globalThis.fetch;
const ctx = { waitUntil() {}, passThroughOnException() {} };
const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const JOB = "deadbeef-1111-4222-8333-444444444444";
const STORED_EXPIRY = new Date(Date.now() + 22 * 60 * 1000).toISOString();  // distinctly not now + 30min

// One world, shared across both requests: KV persists, the reservation persists, the Workflow persists.
function makeWorld() {
  const kv = new Map();
  const counts = { reserve: 0, reserveTook: 0, issue: 0, create: 0, abort: 0, refund: 0 };
  const instances = new Set();

  globalThis.fetch = async (u, init) => {
    const su = String(u);
    if (su.includes("/auth/v1/user")) return json({ id: "u-1", email: "j@t.dev" });

    if (su.includes("/rpc/reserve_talk_for_job")) {
      counts.reserve++;
      const body = JSON.parse(init.body);
      // JOB-KEYED, exactly like production: the first call takes a credit, repeats do not.
      const first = !kv.has("reserved:" + body.p_job_id);
      if (first) { kv.set("reserved:" + body.p_job_id, body.p_user_id); counts.reserveTook++; }
      return json([{ reserved: first, outcome: first ? "reserved" : "already_reserved", owner_id: body.p_user_id }]);
    }
    // A VOID RPC: 204, no body. This is what broke minting in production on 2026-08-06.
    if (su.includes("/rpc/receipt_issue")) { counts.issue++; return new Response(null, { status: 204 }); }
    if (su.includes("/generation_receipts") && su.includes("select=expires_at")) {
      return json([{ expires_at: STORED_EXPIRY }]);
    }
    if (su.includes("/rpc/abort_generation")) { counts.abort++; return json([{ aborted: true, refunded: true }]); }
    if (su.includes("/rpc/refund_talk_once")) { counts.refund++; return json([{ refunded: true }]); }
    return json([]);
  };

  const env = {
    ALLOWED_ORIGINS: ORIGIN, SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k",
    SUPABASE_ANON_KEY: "a", ANTHROPIC_API_KEY: "sk", FREE_TALKS: "10",
    JOBS_KV: {
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
    },
    GEN_WORKFLOW: {
      create: async (o) => {
        // Cloudflare throws when the id is already live. The handler must ask get(), not parse the message.
        if (instances.has(o.id)) throw new Error("instance already exists");
        instances.add(o.id); counts.create++;
        return { id: o.id };
      },
      get: async (id) => { if (!instances.has(id)) throw new Error("unknown id"); return { id }; },
    },
  };
  return { env, counts, kv, instances };
}

const submit = () => new Request("https://p.test/generate-async", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Supabase-Auth": "t" },
  body: JSON.stringify({ clientJobId: JOB, topic: "pulmonary embolism", style: "lecture", depth: "concise",
                         system: "s", messages: [{ role: "user", content: "go" }], model: "claude-opus-5" }),
});

// ── 1 · THE FIRST POST SUCCEEDS — AND ITS RESPONSE IS LOST ───────────────────
const world = makeWorld();
const first = await worker.fetch(submit(), world.env, ctx);
const firstBody = await first.json();     // the browser NEVER sees this: the response is dropped in transit
globalThis.fetch = realFetch;

ok(first.status === 200, `the original submit succeeds server-side (${first.status})`);
ok(world.counts.reserveTook === 1, `…taking exactly one credit (${world.counts.reserveTook})`);
ok(world.counts.create === 1, `…and starting exactly one Workflow (${world.counts.create})`);
ok(!!firstBody.receipt, "…with a receipt minted before the Workflow started");
ok(firstBody.receiptExpiresAt === STORED_EXPIRY,
   `…carrying the row's expiry (${firstBody.receiptExpiresAt})`);

// ── 2 · THE BROWSER RE-SUBMITS THE SAME clientJobId ─────────────────────────
// Rebuild the fetch stub over the SAME world, exactly as a retry from a fresh connection would arrive.
{
  const w = world;
  globalThis.fetch = async (u, init) => {
    const su = String(u);
    if (su.includes("/auth/v1/user")) return json({ id: "u-1", email: "j@t.dev" });
    if (su.includes("/rpc/reserve_talk_for_job")) {
      w.counts.reserve++;
      const body = JSON.parse(init.body);
      const first2 = !w.kv.has("reserved:" + body.p_job_id);
      if (first2) { w.kv.set("reserved:" + body.p_job_id, body.p_user_id); w.counts.reserveTook++; }
      return json([{ reserved: first2, outcome: first2 ? "reserved" : "already_reserved", owner_id: body.p_user_id }]);
    }
    if (su.includes("/rpc/receipt_issue")) { w.counts.issue++; return new Response(null, { status: 204 }); }
    if (su.includes("/generation_receipts") && su.includes("select=expires_at")) {
      return json([{ expires_at: STORED_EXPIRY }]);
    }
    if (su.includes("/rpc/abort_generation")) { w.counts.abort++; return json([{ aborted: true, refunded: true }]); }
    if (su.includes("/rpc/refund_talk_once")) { w.counts.refund++; return json([{ refunded: true }]); }
    return json([]);
  };
  const second = await worker.fetch(submit(), world.env, ctx);
  const b = await second.json();
  globalThis.fetch = realFetch;

  ok(second.status === 200, `the re-submit succeeds (${second.status})`);
  ok(b.jobId === JOB, `…returning the SAME job id (${b.jobId})`);
  ok(b.resumed === true, "…flagged as resumed rather than newly created");
  ok(b.durable === true, "…still on the durable path");
  ok(!!b.receipt, "…WITH a receipt, which is the whole point of this suite");
  ok(b.receipt === firstBody.receipt,
     "…and it is the SAME receipt, because the id derives from (user, job, kind) — not a second allowance");
  ok(b.receiptExpiresAt === STORED_EXPIRY,
     `…with the row's ORIGINAL expiry, not a fresh 30 minutes (${b.receiptExpiresAt})`);

  // The two properties that make a re-submit safe rather than a double charge.
  ok(world.counts.reserveTook === 1,
     `NO SECOND CREDIT: exactly one reservation was taken across both requests (${world.counts.reserveTook})`);
  ok(world.counts.create === 1,
     `NO SECOND WORKFLOW: exactly one instance was created across both requests (${world.counts.create})`);
  ok(world.counts.abort === 0 && world.counts.refund === 0,
     `and nothing was aborted or refunded — the job is running, not failed (abort ${world.counts.abort}, refund ${world.counts.refund})`);
  ok(world.instances.size === 1, `one live Workflow instance total (${world.instances.size})`);
}

// ── 3 · THE CLIENT ACTUALLY DOES THIS ───────────────────────────────────────
// The Worker being idempotent is worthless if the browser never re-asks. Both recovery branches must call
// the re-submit, and neither may fall through to a synchronous model call.
{
  const { readFileSync } = await import("fs");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const code = html.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  // End the slice on the next FUNCTION, not on a comment. The first version used "\n// Poll a job" as the
  // marker — after comment lines had already been stripped from `code`, so indexOf returned -1, the slice
  // ran to end of file, and the "no bare null" assertion failed on an unrelated function. The test was
  // wrong about correct code, which is the same mistake this suite exists to prevent.
  const sub = code.slice(code.indexOf("async function submitAsyncGeneration"));
  const nextFn = sub.indexOf("\nasync function ", 30);
  const body = sub.slice(0, nextFn > 0 ? nextFn : sub.length);

  ok(/async function resubmitForCredentials/.test(code), "the client has an idempotent re-submit helper");
  ok(/resubmitForCredentials\(clientJobId, payload\)/.test(body),
     "…called from the recovery paths with the ORIGINAL clientJobId");
  ok((body.match(/resubmitForCredentials\(/g) || []).length >= 2,
     `…on BOTH the confirmed-exists and inconclusive branches (${(body.match(/resubmitForCredentials\(/g) || []).length})`);
  ok(!/return null/.test(body),
     "…and no failure path returns a bare null, which the caller would read as permission to go synchronous");
  ok(/sr\.status === 404/.test(body),
     "…while a CONFIRMED never-created job still reports a clean start failure instead of re-submitting");
}

console.log("\n" + (failures === 0 ? "✔ LOST-RESPONSE RECOVERY OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
