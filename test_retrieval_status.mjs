// RETRIEVAL STATUS IS EXPLICIT — run: node test_retrieval_status.mjs
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────
// A live talk on diuretics in heart failure was generated with ZERO retrieved evidence and presented
// like any other. /retrieve had returned 502 (Postgres 57014, statement timeout: match_chunks orders by
// a computed ranked_score, so the HNSW index cannot serve it and every query full-scans the corpus).
// The client logged one console warning and carried on.
//
// Codex's rule, which this pins: FAIL OPEN FOR GENERATION, FAIL CLOSED FOR PROVENANCE. The talk may
// still be written; it may never be labelled grounded. So retrieval outcome must be an explicit state
// the client can propagate — never an empty array it has to interpret, and never a thrown error it
// silently swallows.
//
// The invariant with teeth: NO response may say retrieval_status "ok" while returning zero sources.
import worker from "./worker.js";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const ORIGIN = "http://localhost:8000";
const realFetch = globalThis.fetch;
const ctx = { waitUntil() {} };
const baseEnv = {
  ALLOWED_ORIGINS: ORIGIN,
  OPENAI_API_KEY: "sk-test",
  SUPABASE_URL: "https://x.test",
  SUPABASE_ANON_KEY: "anon",
};

// supabaseReply: (url, body) => Response
function harness(supabaseReply) {
  const seen = { rpcs: [], bodies: [] };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("openai.com")) {
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: new Array(8).fill(0.1) }] }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("/rest/v1/rpc/")) {
      seen.rpcs.push(u.split("/rpc/")[1]);
      try { seen.bodies.push(JSON.parse(init.body)); } catch (_) { seen.bodies.push(null); }
      return supabaseReply(u, init);
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return seen;
}

const call = (body) => worker.fetch(new Request("https://p.test/retrieve", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: ORIGIN },
  body: JSON.stringify(body),
}), baseEnv, ctx);

const chunk = (id) => ({
  chunk_id: id, document_id: "d" + id, chunk_index: 0, section: "s", text: "t", tokens: 10,
  similarity: 0.8, ranked_score: 0.9, source: "pubmed", source_tier: 1, title: "T",
  journal: "NEJM", year: 2022, journal_rank: 1,
});

// ── 1 · THE STATEMENT TIMEOUT THAT ACTUALLY HAPPENED ─────────────────────────
// PostgREST hands back the SQLSTATE in the body, so this is the real shape.
{
  harness(() => new Response(
    JSON.stringify({ code: "57014", message: "canceling statement due to statement timeout" }),
    { status: 500, headers: { "Content-Type": "application/json" } }));
  const res = await call({ query: "diuretics in heart failure" });
  const b = await res.json();
  globalThis.fetch = realFetch;
  ok(res.status === 200, `a timeout returns 200 so the client can propagate it (got ${res.status})`);
  ok(b.retrieval_status === "retrieval_timeout", `…classified as retrieval_timeout (got ${b.retrieval_status})`);
  ok(b.retrieval_applied === false, "…retrieval_applied is false");
  ok(Array.isArray(b.results) && b.results.length === 0, "…and no sources are claimed");
  ok(b.no_eligible_local_sources === false && b.no_local_candidates === false,
     "…neither 'zero' flag is asserted: nothing was evaluated, so neither claim is earned");
}

// ── 2 · A NON-TIMEOUT FAILURE IS A DIFFERENT STATE ───────────────────────────
{
  harness(() => new Response(JSON.stringify({ code: "42883", message: "function does not exist" }),
    { status: 404, headers: { "Content-Type": "application/json" } }));
  const b = await (await call({ query: "diuretics in heart failure" })).json();
  globalThis.fetch = realFetch;
  ok(b.retrieval_status === "retrieval_error", `infrastructure failure is retrieval_error (got ${b.retrieval_status})`);
  ok(b.retrieval_applied === false, "…retrieval_applied is false");
}

// ── 3 · RETRIEVAL WORKED BUT MATCHED NOTHING ─────────────────────────────────
// Distinct from a timeout: the corpus answered, and the answer was "nothing relevant".
{
  harness(() => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
  const b = await (await call({ query: "diuretics in heart failure" })).json();
  globalThis.fetch = realFetch;
  ok(b.retrieval_status === "no_relevant_sources", `empty-but-healthy is no_relevant_sources (got ${b.retrieval_status})`);
  ok(b.retrieval_applied === false, "…retrieval_applied is false — nothing was grounded");
}

// ── 4 · THE HAPPY PATH ───────────────────────────────────────────────────────
{
  harness(() => new Response(JSON.stringify([chunk(1), chunk(2)]),
    { status: 200, headers: { "Content-Type": "application/json" } }));
  const b = await (await call({ query: "diuretics in heart failure" })).json();
  globalThis.fetch = realFetch;
  ok(b.retrieval_status === "ok", "sources returned → ok");
  ok(b.retrieval_applied === true, "…retrieval_applied is true");
  ok(b.count > 0, "…and count is non-zero");
}

// ── 5 · THE INVARIANT ────────────────────────────────────────────────────────
// If this ever fails, a talk can be labelled grounded while carrying no evidence — the exact defect
// that started this. Asserted across every branch above rather than argued.
{
  const scenarios = [
    ["timeout",  () => new Response(JSON.stringify({ code: "57014", message: "canceling statement due to statement timeout" }), { status: 500, headers: { "Content-Type": "application/json" } })],
    ["error",    () => new Response(JSON.stringify({ code: "42883", message: "boom" }), { status: 500, headers: { "Content-Type": "application/json" } })],
    ["empty",    () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })],
    ["hasRows",  () => new Response(JSON.stringify([chunk(1)]), { status: 200, headers: { "Content-Type": "application/json" } })],
  ];
  let violations = 0;
  for (const [name, reply] of scenarios) {
    harness(reply);
    const b = await (await call({ query: "diuretics in heart failure" })).json();
    globalThis.fetch = realFetch;
    const claimsOk = b.retrieval_status === "ok" || b.retrieval_applied === true;
    const hasSources = (b.count || 0) > 0;
    if (claimsOk && !hasSources) { violations++; console.log("   violated by: " + name); }
  }
  ok(violations === 0, "NO response claims ok/applied while returning zero sources");
}

// ── 6 · TWO-STAGE IS OPT-IN, AND OFF BY DEFAULT ──────────────────────────────
// Default-on would silently change ranking policy: candidates are chosen by raw cosine, so a boosted
// document outside the pool is unreachable. That difference is what calibration exists to measure.
{
  let seen = harness(() => new Response(JSON.stringify([chunk(1)]), { status: 200, headers: { "Content-Type": "application/json" } }));
  await call({ query: "diuretics in heart failure" });
  globalThis.fetch = realFetch;
  ok(seen.rpcs.every(r => r.startsWith("match_chunks?") || r === "match_chunks"),
     `default request hits match_chunks, NOT the two-stage path (saw ${seen.rpcs.join(",")})`);

  seen = harness(() => new Response(JSON.stringify([chunk(1)]), { status: 200, headers: { "Content-Type": "application/json" } }));
  const b = await (await call({ query: "diuretics in heart failure", use_hnsw_candidates: true })).json();
  globalThis.fetch = realFetch;
  ok(seen.rpcs.some(r => r.includes("match_chunks_hnsw")), "the flag routes to match_chunks_hnsw");
  ok(seen.bodies.some(x => x && x.candidate_pool === 500), "…with the default candidate pool of 500");
  ok(b.hnsw_candidates_requested === true, "…and the response reports that it was requested");

  seen = harness(() => new Response(JSON.stringify([chunk(1)]), { status: 200, headers: { "Content-Type": "application/json" } }));
  await call({ query: "diuretics in heart failure", use_hnsw_candidates: true, candidate_pool: 9999 });
  globalThis.fetch = realFetch;
  ok(seen.bodies.some(x => x && x.candidate_pool === 1000),
     "a pool above pgvector's ef_search ceiling is clamped to 1000, not sent as-is");
}

console.log("\n" + (failures === 0 ? "✔ RETRIEVAL STATUS OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
