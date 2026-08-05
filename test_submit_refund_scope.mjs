// SUBMIT / REFUND SCOPE — run: node test_submit_refund_scope.mjs
//
// WHY (Codex, 2026-07-29): "the test should also prove that only the reservation belonging to the newly
// created job can ever be refunded."
//
// The hazard is specific. /generate-async reserves a talk, then starts a Workflow. If create() throws,
// the handler refunds. But create() ALSO throws when an instance with that id is already live — i.e. on
// a duplicate submit — and in that case the reservation being refunded would be the one belonging to a
// job that is still running. The user loses a credit for a talk they are about to receive, and the
// second submit reports failure for a generation that is in fact fine.
//
// Cloudflare documents no stable error class for the duplicate-id case, so the handler must not
// string-match the message. It asks instead: get(jobId). This suite executes the real handler and counts
// refunds under each interleaving.
import worker from "./worker.js";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const ORIGIN = "http://localhost:8000";
const realFetch = globalThis.fetch;

/** Counts every quota RPC by name, so a refund cannot happen without this seeing it. */
function makeHarness({ createBehaviour, instanceExists }) {
  const kv = new Map();
  const rpc = { consume: 0, refund: 0, viaBonus: 0, viaJobKey: 0, viaUserScoped: 0 };
  const reservedJobs = new Set();   // stands in for public.job_reservations
  const created = [];
  const env = {
    ALLOWED_ORIGINS: ORIGIN,
    ANTHROPIC_API_KEY: "sk-test",
    SUPABASE_URL: "https://x.test",
    SUPABASE_SERVICE_ROLE_KEY: "k",
    MAX_MONTHLY_SPEND_USD: "250",
    JOBS_KV: {
      get: async (k) => kv.get(k) ?? null,
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
    },
    GEN_WORKFLOW: {
      create: async (opts) => {
        if (createBehaviour === "throw") throw new Error("instance already exists");
        created.push(opts.id);
        return { id: opts.id };
      },
      get: async (id) => {
        if (!instanceExists) throw new Error("no such instance");
        return { id, status: async () => ({ status: "running" }) };
      },
    },
  };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "u1", email: "a@b.c" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Submit now reserves per JOB, not per user — consumeQuota is atomic per user but cannot see a job,
    // which is how a duplicate whose KV read missed took a second credit. The stub is job-aware for the
    // same reason the real primitive is: a strongly-consistent stub of the OLD design is what let the
    // double-charge pass a test in the first place.
    if (u.includes("/rpc/reserve_talk_for_job")) {
      let jid = "";
      try { jid = JSON.parse(init && init.body || "{}").p_job_id || ""; } catch (_) {}
      if (reservedJobs.has(jid)) {
        return new Response(JSON.stringify([{ reserved: false, outcome: "already_reserved" }]),
          { status: 200, headers: { "Content-Type": "application/json" } });
      }
      reservedJobs.add(jid);
      rpc.consume++;
      return new Response(JSON.stringify([{ reserved: true, outcome: "reserved" }]),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Still counted, so a regression back to the user-scoped consume at submit is visible.
    if (u.includes("/rpc/free_tier_consume")) { rpc.consume++; rpc.viaUserScoped++; return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } }); }
    // Talk refunds moved to the job-keyed atomic RPC on 2026-07-31. BOTH are counted: grant_bonus so a
    // regression back to the email-keyed primitive is immediately visible, refund_talk_once because it
    // is what production now calls. The property under test — exactly one refund — is unchanged.
    if (u.includes("/rpc/free_tier_grant_bonus")) { rpc.refund++; rpc.viaBonus++; return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } }); }
    if (u.includes("/rpc/refund_talk_once")) { rpc.refund++; rpc.viaJobKey++; return new Response(JSON.stringify([{ refunded: true, outcome: "refunded" }]), { status: 200, headers: { "Content-Type": "application/json" } }); }
    if (u.includes("/rpc/") || u.includes("/rest/")) return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { env, rpc, kv, created };
}

function submit(clientJobId) {
  return new Request("https://p.test/generate-async", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Supabase-Auth": "t" },
    body: JSON.stringify({
      clientJobId,
      draft: { sys: "s", content: [{ type: "text", text: "t" }], models: ["claude-opus-5"] },
      critique: { sys: "c", prefix: "p", models: ["claude-opus-5"] },
    }),
  });
}
const ctx = { waitUntil() {} };
const JOB = "abcdef0123456789abcdef0123456789";

// ── 1 · a clean submit reserves once and refunds nothing ─────────────────────
{
  const h = makeHarness({ createBehaviour: "ok", instanceExists: false });
  const res = await worker.fetch(submit(JOB), h.env, ctx);
  const body = await res.json();
  globalThis.fetch = realFetch;
  ok(res.status === 200, "a clean submit succeeds");
  ok(body.durable === true, "…on the durable path");
  ok(h.rpc.consume === 1, "…reserving exactly one talk");
  ok(h.rpc.refund === 0, "…and refunding nothing");
  ok(h.created.length === 1 && h.created[0] === JOB, "…with the instance id equal to the job id");
}

// ── 2 · THE ONE CODEX ASKED FOR ──────────────────────────────────────────────
// Duplicate submit where the FIRST job's KV record has been lost (a read hiccup), so the early
// existence check misses and we reach create() — which throws because the instance is live.
// The reservation now in flight belongs to a RUNNING job. It must not be refunded.
{
  const h = makeHarness({ createBehaviour: "throw", instanceExists: true });
  const res = await worker.fetch(submit(JOB), h.env, ctx);
  const body = await res.json();
  globalThis.fetch = realFetch;
  ok(res.status === 200, "a duplicate submit whose instance is live returns success, not an error");
  ok(body.resumed === true, "…reported as resumed");
  ok(body.durable === true, "…still on the durable path");
  ok(h.rpc.refund === 0,
     "NO REFUND: the reservation belongs to a job that is still running and must not be clawed back");
}

// ── 3 · a GENUINE start failure refunds exactly the reservation it just made ──
{
  const h = makeHarness({ createBehaviour: "throw", instanceExists: false });
  const res = await worker.fetch(submit(JOB), h.env, ctx);
  globalThis.fetch = realFetch;
  ok(res.status === 503, "a real start failure returns 503");
  ok(h.rpc.consume === 1 && h.rpc.refund === 1,
     "…refunding exactly one talk — the one this request reserved, no more");
  ok(h.rpc.viaJobKey === 1 && h.rpc.viaBonus === 0,
     "…through the JOB-KEYED atomic refund, not the email-keyed bonus grant");
  ok((await h.env.JOBS_KV.get("job:" + JOB)) === null,
     "…and clearing the job record it created, so a retry is not blocked by a phantom");
}

// ── 4 · the early existence check short-circuits BEFORE reserving ────────────
// The cheapest correct behaviour: a duplicate that the KV check catches must not reserve at all.
{
  const h = makeHarness({ createBehaviour: "ok", instanceExists: true });
  await h.env.JOBS_KV.put("job:" + JOB, JSON.stringify({ status: "running", userId: "u1", createdAt: "t" }));
  const res = await worker.fetch(submit(JOB), h.env, ctx);
  const body = await res.json();
  globalThis.fetch = realFetch;
  ok(res.status === 200 && body.resumed === true, "a duplicate caught by the KV check returns the existing job");
  ok(h.rpc.consume === 0, "…without reserving a second talk");
  ok(h.rpc.refund === 0, "…and without refunding anything");
  ok(h.created.length === 0, "…and without creating a second instance");
}

// ── 5 · the handler must not decide by reading the error message ─────────────
// Cloudflare documents no stable error class or code for a duplicate id, so matching on text would
// break silently the moment they reword it.
{
  const src = (await import("fs")).readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("if (env.GEN_WORKFLOW) {"), src.indexOf("// LEGACY PATH"));
  const code = block.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  ok(/GEN_WORKFLOW\.get\(jobId\)/.test(code),
     "the duplicate case is decided by ASKING the platform (get), not by parsing a message");
  ok(!/err\.message.*(already|exists|duplicate)/i.test(code),
     "…and no string-matching on the thrown error remains");
  ok(!/waitUntil\(runGeneration/.test(code),
     "…and a failed create never silently falls through to the legacy 30-second path");
}

console.log("\n" + (failures === 0 ? "✔ SUBMIT / REFUND SCOPE TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
