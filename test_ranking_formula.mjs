// RANKING PARITY — score_candidate_chunks must rank the way production ranks.
// Run: node test_ranking_formula.mjs
//
// WHY THIS EXISTS (Codex, 2026-07-29). Stage 1 shipped sorting the candidate union by raw cosine. The
// order it replaced was match_chunks.ranked_score, which is not cosine — it is cosine plus four
// authority boosts (tier, landmark, elite-journal, and a capped RCR term). So "rerank ON" quietly meant
// "rerank ON *and* authority policy OFF", two changes wearing the name of one.
//
// That is not a small measurement error, it is the failure mode this project keeps repeating: an
// instrument that produces a number whose label is wrong. The four-arm calibration was one command away
// from spending ~130 physician judgments measuring a difference that could not be attributed to either
// stage. Nothing in the flags would have looked wrong — rerank_applied would have said true.
//
// WHAT THIS ASSERTS. Not that the code "looks right": that the ranking EXPRESSION and the DEFAULT WEIGHTS
// in score_candidate_chunks are token-for-token the ones in canonical match_chunks. If someone tunes a
// boost in one file and not the other, the confound returns silently and every flag still reports
// success. This makes that a red suite instead.
//
// WHY IT PARSES SQL TEXT. No JS test can catch this — the divergence lives in two .sql files that never
// execute in this process. Comparing them as text is crude and it is the only thing that actually binds
// them. The live database is checked separately by smoke test 3 in the migration header, which runs both
// functions on one embedding and asserts the scores agree to 1e-9.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const canonical = readFileSync(new URL("./supabase/migrations/canonical_match_chunks.sql", import.meta.url), "utf8");
const scorer    = readFileSync(new URL("./supabase/migrations/add_score_candidate_chunks.sql", import.meta.url), "utf8");

// Strip SQL line comments so prose about the formula cannot satisfy a test about the formula. That
// mistake has already been made once on this project — a test asserted the presence of a comment string
// and passed while the code it described was wrong.
const code = (s) => s.split("\n").map(l => l.replace(/--.*$/, "")).join("\n");
const norm = (s) => s.replace(/\s+/g, " ").trim();

// ── 1. the boost terms, extracted from each ranked_score expression ───────────
// Anchored on the term itself rather than on position, so reordering the additions is not a failure —
// only a change in what is added.
const TERMS = [
  ["tier",     /\(\s*\(\s*4\s*-\s*d\.source_tier\s*\)\s*\*\s*tier_boost_weight\s*\)/],
  ["landmark", /case\s+when\s+d\.is_landmark_trial\s+then\s+landmark_boost\s+else\s+0\s+end/],
  ["elite",    /case\s+when\s+d\.journal_rank\s*=\s*1\s+then\s+elite_journal_boost\s+else\s+0\s+end/],
  ["rcr",      /least\s*\(\s*case\s+when\s+d\.rcr\s+is\s+not\s+null\s+and\s+d\.rcr\s*>\s*1\s+then\s+rcr_weight\s*\*\s*ln\s*\(\s*1\s*\+\s*d\.rcr\s*\)\s+else\s+0\s+end\s*,\s*0\.10\s*\)/],
];
const cCode = norm(code(canonical));
const sCode = norm(code(scorer));
for (const [name, re] of TERMS) {
  ok(re.test(cCode), `canonical match_chunks contains the ${name} term`);
  ok(re.test(sCode), `score_candidate_chunks contains the SAME ${name} term`);
}

// ── 2. the similarity term is identical in form ───────────────────────────────
const SIM = /\(\s*1\s*-\s*\(\s*c\.embedding\s*<=>\s*query_embedding\s*\)\s*\)/;
ok(SIM.test(cCode), "canonical computes similarity as 1 - (embedding <=> query)");
ok(SIM.test(sCode), "scorer computes similarity the same way");

// ── 3. DEFAULT WEIGHTS MUST BE EQUAL — the contract ───────────────────────────
// A tuned boost in one file and not the other reintroduces the confound with every flag still green.
const defaultOf = (sql, param) => {
  const m = code(sql).match(new RegExp(param + "\\s+double precision\\s+default\\s+([0-9.]+)", "i"));
  return m ? parseFloat(m[1]) : null;
};
for (const p of ["tier_boost_weight", "rcr_weight", "landmark_boost", "elite_journal_boost"]) {
  const a = defaultOf(canonical, p), b = defaultOf(scorer, p);
  ok(a !== null, `canonical declares a default for ${p} (${a})`);
  ok(b !== null, `scorer declares a default for ${p} (${b})`);
  ok(a !== null && a === b, `${p} defaults AGREE (${a} vs ${b}) — divergence here silently re-splits the arms`);
};

// ── 4. the scorer must actually RETURN ranked_score ───────────────────────────
// Sorting on a column the function does not return yields nulls, which sort to a constant and reproduce
// arrival order — while rerank_applied still reports true.
ok(/returns table\s*\([^)]*ranked_score/is.test(code(scorer)),
   "score_candidate_chunks returns ranked_score, not similarity alone");
ok(/returns table\s*\([^)]*\bsimilarity\b/is.test(code(scorer)),
   "…and still returns raw similarity for diagnostics");

// ── 5. the scorer must NOT re-apply the journal_rank hard filter ──────────────
// Its candidates already survived match_chunks. Re-filtering could only drop rows already in the union.
ok(!/journal_rank\s*<=/.test(sCode),
   "scorer does not re-apply the journal_rank filter — it scores, it does not select");

// ── 6. the Worker must sort on the boosted score ──────────────────────────────
// The specific regression: the sort comparator naming bare_similarity instead of bare_ranked_score.
const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const sortLine = (worker.match(/union\.sort\(\(a, b\) => \(b\.bare_[a-z_]+/g) || []);
ok(sortLine.length > 0, "found the rerank sort comparator in worker.js");
ok(sortLine.every(s => s.includes("bare_ranked_score")),
   "the rerank sorts on bare_ranked_score — sorting on bare_similarity is the confound");
ok(/bare_ranked_score == null/.test(worker),
   "worker throws or guards when ranked_score is missing, rather than ranking on nulls");

// ── 7. canonical must match what is actually deployed ─────────────────────────
// This file is an export, not a design document. If someone hand-edits it, the repo starts lying again
// in the opposite direction, so assert the shape the live catalog reported on 2026-07-29.
ok(/max_journal_rank smallint DEFAULT 2/.test(canonical), "canonical carries max_journal_rank default 2");
const params = (canonical.match(/CREATE OR REPLACE FUNCTION public\.match_chunks\(([\s\S]*?)\)\s*RETURNS/)?.[1] || "")
  .split(",").filter(s => s.trim()).length;
ok(params === 10, `canonical match_chunks declares 10 parameters (found ${params})`);
const cols = (canonical.match(/RETURNS TABLE\(([\s\S]*?)\)\s*LANGUAGE/)?.[1] || "")
  .split(",").filter(s => s.trim()).length;
ok(cols === 24, `canonical match_chunks returns 24 columns (found ${cols})`);

console.log("\n" + (failures === 0 ? "✔ RANKING PARITY TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
