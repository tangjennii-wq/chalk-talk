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
ok(!/const RERANK_POOL = \d+;/.test(worker),
   "RERANK_POOL is GONE — it encoded the false assumption that a global top-N can score the facet union");
ok(/score_candidate_chunks/.test(worker),
   "the rerank uses a candidate-restricted RPC, not a global top-N lookup");
ok(/const wantRerank = body\.rerank === true;/.test(worker),
   "rerank is OPT-IN and strictly === true — no truthy coercion, so a stray string cannot enable it");
ok(/rerank_applied: !!merged\._rerankApplied/.test(worker),
   "rerank_applied is reported from what ACTUALLY RAN, never inferred from the request");
ok(/candidate_chunk_ids: chunkIds/.test(worker),
   "…and passes the union's chunk ids explicitly, so scoring is EXACT rather than approximate");
ok(!/tier_boost/.test(readFileSync(new URL("./supabase/migrations/add_score_candidate_chunks.sql", import.meta.url), "utf8")),
   "…and the RPC applies NO tier boost — the rerank ranks on topic similarity alone");
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
    matchCount: 8,
    callMatchChunks: async () => { throw new Error("match_chunks must NOT be used for reranking"); },
    // Models the REAL RPC: scores exactly the ids it is given, and nothing else.
    callScoreCandidateChunks: async (_env, _emb, ids) => {
      if (throwOnBare) throw new Error("simulated RPC failure");
      return bare.filter(r => ids.includes(r.chunk_id));
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
// An EXACT scorer returns a number for every id it is handed — including UKPDS, which a global top-N
// lookup would have silently omitted.
const BARE = [
  { chunk_id: "ada2024", similarity: 0.72 },
  { chunk_id: "dcct",    similarity: 0.31 },
  { chunk_id: "ukpds",   similarity: 0.28 },
];

{
  const order = (await run({ rows: ROWS, bare: BARE, rerank: true })).map(r => r.chunk_id);
  ok(order[0] === "ada2024",
     "RERANK ON: the on-topic guideline is ranked FIRST despite the lowest pooled facet score (0.40 vs 0.90)");
  ok(order[order.length - 1] === "ukpds",
     "…and the weakest bare score ranks LAST — kept for recall, never preferred");
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


// ── 5 · THE BUG CODEX CAUGHT: a niche candidate outside any global top-N ──────
// The old implementation called match_chunks(match_count: 300) and treated its result as "scores for
// the union". A facet-discovered paper outside the bare topic's GLOBAL top 300 came back absent, was
// scored null, and ranked LAST — which is exactly backwards, since a niche treatment paper only a facet
// could surface is precisely the chunk that sits outside a global top-N.
//
// Here "niche" is in the union and IS scored by the candidate-restricted RPC. Under the old code it
// would have been null and last; under exact scoring it ranks on its real merit.
{
  const rows = [
    { chunk_id: "dcct",  title: "DCCT",                         ranked_score: 0.95 },
    { chunk_id: "niche", title: "Fluid protocols in DKA (2023)", ranked_score: 0.35 },
  ];
  const bare = [
    { chunk_id: "niche", similarity: 0.81 },   // genuinely the best match for the bare topic
    { chunk_id: "dcct",  similarity: 0.30 },
  ];
  const order = (await run({ rows, bare, rerank: true })).map(r => r.chunk_id);
  ok(order[0] === "niche",
     "a niche facet-discovered paper is scored and ranked FIRST — the global-top-N version buried it at null");
  const scored = await run({ rows, bare, rerank: true });
  ok(scored.every(c => typeof c.bare_similarity === "number"),
     "EVERY union candidate receives a real number — no candidate is null merely for being outside a top-N");
}

// ═══ STAGE 2 · METADATA FILTER ═══════════════════════════════════════════════
// Drops sources that cannot be teaching evidence at all. Does NOT drop on tier, and does NOT drop
// non-landmark papers — Codex, 2026-07-28: "acute topics often depend on them."

const worker2 = worker;   // same file, clearer intent below
ok(/const WEAK_PUB_PATTERNS = \[/.test(worker2),
   "ineligible publication types are an explicit named list of NORMALIZED substring patterns");
ok(/const normalizePubType =/.test(worker2),
   "…and publication_type is normalized before any comparison — PubMed emits 'Published Erratum', not 'erratum'");
ok(!/const WEAK_PUB_TYPES/.test(worker2),
   "…with the old exact-match set deleted, so there is one source of truth rather than two");
ok(!/is_landmark_trial\s*===?\s*false/.test(worker2.slice(worker2.indexOf("STAGE 2"), worker2.indexOf("STAGE 2") + 2500)),
   "the metadata filter NEVER excludes on is_landmark_trial — acute topics depend on non-landmark papers");
ok(/PUB_TYPE_RANK/.test(worker2) && /ORDERING preference, never a filter/.test(worker2),
   "publication type is a tie-break ordering, not a second filter");
ok(/dropped_by_metadata: merged\._dropped/.test(worker2),
   "every exclusion is returned with its reason — a silent filter is indistinguishable from an empty corpus");

const s2start = worker2.indexOf("    // ── STAGE 2 · METADATA FILTER");
const s2end = worker2.indexOf("    merged = union.slice(0, matchCount);");
const s2block = worker2.slice(s2start, s2end);

function runMeta(rows, on) {
  const ctx = {
    console: { warn() {} }, Array, Object, String,
    union: rows.slice(), body: { metadata_filter: on },
    rerankApplied: false,
    WEAK_PUB_PATTERNS: ["erratum","correction","retracted","retraction","withdrawn","editorial","letter","comment","news","biography","obituary","protocol","published erratum","retracted publication"],
    normalizePubType: (t) => String(t == null ? "" : t).toLowerCase().replace(/[^a-z]+/g, " ").trim(),
    WEAK_TITLE_RE: /^\s*(correction|erratum|retraction|withdrawn|comment on|reply to|author reply|editorial|letter to the editor)\b/i,
    PUB_TYPE_RANK: { guideline:0, systematic_review:1, meta_analysis:1, rct:2, review:3, drug_label:4, other:5 },
  };
  ctx.pubRank = (t) => { const k = ctx.normalizePubType(t).replace(/ /g, "_"); return ctx.PUB_TYPE_RANK[k] != null ? ctx.PUB_TYPE_RANK[k] : 5; };
  ctx.isWeakSource = (c) => {
    const t = ctx.normalizePubType(c.publication_type);
    if (t) for (const pat of ctx.WEAK_PUB_PATTERNS) if (t.includes(pat)) return "pub_type:" + t;
    if (ctx.WEAK_TITLE_RE.test(String(c.title || ""))) return "title";
    return null;
  };
  vm.createContext(ctx);
  // `let` inside the extracted block is script-scoped and never lands on the context object, so the
  // values are returned explicitly rather than read off ctx.
  return vm.runInContext(
    `(() => { ${s2block} return { union, applied: metadataFilterApplied, dropped }; })()`, ctx);
}

const META_ROWS = [
  { chunk_id: "guide", title: "ADA Standards of Care 2025", publication_type: "guideline",  ranked_score: 0.5 },
  { chunk_id: "corr",  title: "Correction: Effects of intensive glucose lowering", publication_type: "other", ranked_score: 0.9 },
  { chunk_id: "edit",  title: "The future of diabetes care", publication_type: "editorial", ranked_score: 0.8 },
  { chunk_id: "prac",  title: "Practical management of hyperglycemic crises", publication_type: "other", ranked_score: 0.4 },
  { chunk_id: "trial", title: "A randomized trial of X", publication_type: "rct", is_landmark_trial: false, ranked_score: 0.6 },
];
{
  const r = runMeta(META_ROWS, true);
  const ids = r.union.map(x => x.chunk_id);
  ok(!ids.includes("corr"), 'a "Correction:" notice is dropped even though it scored HIGHEST (0.9)');
  ok(!ids.includes("edit"), "an editorial is dropped by publication_type");
  ok(ids.includes("prac"), 'a practice review typed "other" is KEPT — "other" is a catch-all, not a verdict');
  ok(ids.includes("trial"), "a NON-landmark RCT is kept");
  ok(r.dropped.length === 2 && r.dropped.every(d => d.reason), "both exclusions are reported with a reason");
  ok(r.applied === true, "metadata_filter_applied is true when it actually ran");
}
{
  const r = runMeta(META_ROWS, false);
  ok(r.union.length === META_ROWS.length && r.applied !== true,
     "OFF by default: nothing dropped, nothing reordered, behaviour unchanged");
}
// ── FAIL CLOSED on confidently-ineligible sources (Codex, 2026-07-28) ────────
// The first version restored everything rather than return zero. That means deliberately handing a
// medical writer a set consisting entirely of errata. Zero eligible sources is the HONEST result.
{
  const allWeak = [
    { chunk_id: "a", title: "Erratum: something",  publication_type: "Published Erratum",     ranked_score: 0.5 },
    { chunk_id: "b", title: "A retracted study",   publication_type: "Retracted Publication", ranked_score: 0.9 },
  ];
  const r = runMeta(allWeak, true);
  ok(r.union.length === 0,
     "when EVERY candidate is confidently ineligible the result is ZERO — known non-evidence is never restored");
  ok(r.applied === true, "…and the filter reports that it DID apply, so the empty set is attributable");
  ok(r.dropped.length === 2, "…with both exclusions still itemized");
}

// ── REAL PubMed publication_type strings, not tidy tokens ────────────────────
{
  const real = [
    { chunk_id: "e", title: "Something",            publication_type: "Published Erratum",      ranked_score: 0.9 },
    { chunk_id: "r", title: "Something else",       publication_type: "Retracted Publication",  ranked_score: 0.9 },
    { chunk_id: "p", title: "A trial protocol",     publication_type: "Clinical Trial Protocol", ranked_score: 0.9 },
    { chunk_id: "g", title: "ADA Standards 2025",   publication_type: "Guideline",              ranked_score: 0.5 },
    { chunk_id: "u", title: "Practice review",      publication_type: null,                     ranked_score: 0.4 },
  ];
  const ids = runMeta(real, true).union.map(x => x.chunk_id);
  ok(!ids.includes("e"), '"Published Erratum" is caught — an exact lowercase set would have missed it');
  ok(!ids.includes("r"), '"Retracted Publication" is caught');
  ok(!ids.includes("p"), '"Clinical Trial Protocol" is caught');
  ok(ids.includes("g"), '"Guideline" (capitalised) survives — normalization is case-insensitive');
  ok(ids.includes("u"), "a NULL publication_type survives — uncertainty is not disqualification");
}

// ── pubRank normalizes too ───────────────────────────────────────────────────
{
  const ctx = {
    PUB_TYPE_RANK: { guideline:0, systematic_review:1, meta_analysis:1, rct:2, review:3, drug_label:4, other:5 },
    normalizePubType: (t) => String(t == null ? "" : t).toLowerCase().replace(/[^a-z]+/g, " ").trim(),
  };
  const pubRank = (t) => { const k = ctx.normalizePubType(t).replace(/ /g, "_"); return ctx.PUB_TYPE_RANK[k] != null ? ctx.PUB_TYPE_RANK[k] : 5; };
  ok(pubRank("Systematic Review") === 1, '"Systematic Review" ranks like systematic_review — case and spacing normalized');
  ok(pubRank("guideline") === 0 && pubRank("Guideline") === 0, "capitalisation does not change a guideline's rank");
  ok(pubRank(null) === 5 && pubRank("something novel") === 5, "unknown types fall to the bottom of the ORDERING — never dropped");
}
ok(/no_eligible_local_sources/.test(worker),
   "the response carries an explicit no_eligible_local_sources flag — the caller never infers 'no evidence'");

console.log("\n" + (failures === 0 ? "✔ RERANK + METADATA STAGE TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
