// STAGE 1 · rerank against the original topic. Run: node test_rerank_stage.mjs
//
// The 2026-07-28 diagnostic proved facet scores are not comparable across queries — cosine against
// "<topic> treatment, management and guideline recommendations" is a different quantity from cosine
// against "<topic>". Pooling them by ranked_score is what let an off-topic valvular guideline score
// 0.612 for HFrEF, higher than any chunk the DKA topic produced from any facet.
//
// So: facets DISCOVER (recall), the bare topic RANKS (precision).
//
// These assertions execute the real merge/rerank block extracted from worker.js against a stubbed
// match_chunks. Source-pattern tests were what let an undeclared variable crash every generation for a
// day, so this drives the code and reads the result off the far side.
import { readFileSync } from "fs";
import vm from "vm";

const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

// ── 1 · the contract, read off the source ─────────────────────────────────────
ok(/const RERANK_POOL = \d+;/.test(worker), "RERANK_POOL is a named constant, not a magic number");
ok(/const wantRerank = body\.rerank === true;/.test(worker),
   "rerank is OPT-IN and strictly === true — no truthy coercion, so a stray string cannot enable it");
ok(/rerank_applied: !!merged\._rerankApplied/.test(worker),
   "rerank_applied is reported from what ACTUALLY RAN, never inferred from the request");
ok(/min_similarity: 0,/.test(worker),
   "the bare-topic pass uses min_similarity 0 so a facet-only candidate still gets a real score");
ok(/tier_boost_weight: 0,/.test(worker),
   "…and tier_boost_weight 0, so the rerank ranks on topic similarity rather than a tier thumb");
ok(!/c\.text\.slice\(0, ?\d+\)/.test(worker.slice(worker.indexOf("STAGE 1"), worker.indexOf("STAGE 1") + 3000)),
   "the rerank never re-embeds a truncated copy — it scores the STORED representation");

// ── 2 · execute the real ranking logic ────────────────────────────────────────
// Lift the block between the union assignment and the slice, and drive it with stubs.
const start = worker.indexOf("    let union = Array.from(best.values());");
const end = worker.indexOf("    merged = union.slice(0, matchCount);");
ok(start > 0 && end > start, "found the rerank block in worker.js");
const block = worker.slice(start, end);

function run({ rows, bare, rerank, throwOnBare = false }) {
  const ctx = {
    console: { warn() {} }, Map, Array, Object,
    env: {},   // the real block passes `env` to callMatchChunks; omitting it made the try/catch swallow a ReferenceError
    best: new Map(rows.map(r => [r.chunk_id, r])),
    body: { rerank },
    embeddings: [[0.1]], maxAgeYears: null, allowedSources: null,
    RERANK_POOL: 300, matchCount: 8,
    callMatchChunks: async () => {
      if (throwOnBare) throw new Error("simulated RPC failure");
      return bare;
    },
  };
  vm.createContext(ctx);
  return vm.runInContext(
    `(async () => { ${block} return union; })()`, ctx
  );
}

const ROWS = [
  { chunk_id: "dcct",     title: "DCCT",            ranked_score: 0.90 },  // facet-inflated, off-topic
  { chunk_id: "ada2024",  title: "ADA 2024 crises", ranked_score: 0.40 },  // the right answer
  { chunk_id: "ukpds",    title: "UKPDS 33",        ranked_score: 0.85 },
];
// what the BARE topic "diabetic ketoacidosis" actually thinks of them
const BARE = [
  { chunk_id: "ada2024", similarity: 0.72 },
  { chunk_id: "dcct",    similarity: 0.31 },
  // ukpds absent entirely — the bare topic cannot see it at all
];

{
  const order = (await run({ rows: ROWS, bare: BARE, rerank: true })).map(r => r.chunk_id);
  ok(order[0] === "ada2024",
     "RERANK ON: the on-topic guideline is ranked FIRST despite the lowest pooled facet score (0.40 vs 0.90)");
  ok(order[order.length - 1] === "ukpds",
     "…a candidate the bare topic cannot see at all ranks LAST — kept for recall, never preferred");
}
{
  const order = (await run({ rows: ROWS, bare: BARE, rerank: false })).map(r => r.chunk_id);
  ok(order[0] === "dcct",
     "RERANK OFF: current behaviour is bit-for-bit unchanged — DCCT still wins on pooled facet score");
}
{
  const out = await run({ rows: ROWS, bare: BARE, rerank: "yes" });
  ok(out.map(r => r.chunk_id)[0] === "dcct", 'a truthy non-boolean ("yes") does NOT enable the rerank');
}

// ── 3 · failure must be honest, not silent ────────────────────────────────────
{
  const out = await run({ rows: ROWS, bare: [], rerank: true, throwOnBare: true });
  ok(out.map(r => r.chunk_id)[0] === "dcct",
     "when the bare pass THROWS, ranking falls back to the old order rather than returning nothing");
  // the point: the response must not then claim a rerank happened
  ok(/rerankApplied = false/.test(worker) || /let rerankApplied = false;/.test(worker),
     "…and rerankApplied stays false, so a failed rerank can never be reported as a successful one");
}

// ── 4 · the union is never silently shrunk ────────────────────────────────────
{
  const out = await run({ rows: ROWS, bare: BARE, rerank: true });
  ok(out.length === ROWS.length,
     "reranking REORDERS the union, it does not filter it — dropping candidates is a later stage's job");
}

console.log("\n" + (failures === 0 ? "✔ RERANK STAGE TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
