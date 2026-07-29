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
// WHAT THIS ASSERTS, STATED NARROWLY (corrected 2026-07-29 — the first version of this header overclaimed).
// It extracts the COMPLETE ranked_score expression from each .sql file, normalizes whitespace, and
// requires the two strings to be equal. It also requires the four boost DEFAULTS to be equal.
//
// WHAT IT DOES NOT PROVE. That either file matches the DEPLOYED function. Both could be edited into
// agreement with each other and disagree with the database. An earlier draft checked only that four
// expected terms appeared in both files, and claimed "token-for-token" — under that check an extra term,
// a duplicated term, or a flipped sign outside the four regexes would have passed while the header said
// otherwise. That is the same species of defect this suite exists to catch, so it is worth naming.
//
// THE DECISIVE CHECK IS AGAINST THE LIVE DATABASE, not this file: smoke test 3 in the migration header
// runs match_chunks and score_candidate_chunks on the same embedding and requires the ranked_scores to
// agree to 1e-9. Verified 2026-07-29 over 25 chunks, worst delta 0.000000000000. This suite is the cheap
// guard that runs on every commit; that one is the guard that is actually authoritative.
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

// ── 1b. THE WHOLE EXPRESSION, not just the terms we thought to look for ───────
// Presence checks are open-ended: an EXTRA term, a DUPLICATED term, a flipped sign or a restructured
// expression all satisfy "contains the four terms" while changing the ranking. Extract the complete
// ranked_score expression from each file and require string equality after whitespace normalization.
const rankedExpr = (sql) => {
  const c = code(sql);
  const end = c.indexOf("as ranked_score");
  if (end < 0) return null;
  const start = c.lastIndexOf("(1 - (c.embedding", end);
  if (start < 0 || start > end) return null;
  return norm(c.slice(start, end));
};
const cExpr = rankedExpr(canonical), sExpr = rankedExpr(scorer);
ok(!!cExpr, "extracted the complete ranked_score expression from canonical match_chunks");
ok(!!sExpr, "extracted the complete ranked_score expression from score_candidate_chunks");
ok(!!cExpr && cExpr === sExpr,
   "the COMPLETE ranked_score expressions are identical — not merely both containing the expected terms");
if (cExpr && sExpr && cExpr !== sExpr) {
  console.log("    canonical: " + cExpr);
  console.log("    scorer   : " + sExpr);
}
// Exactly four additive boost terms. Guards the specific case string equality would miss only if BOTH
// files were changed together — a duplicated term added to each.
// Count only the top-level additions that OPEN a boost term (`+ (` or `+ least(`). A naive count of "+"
// reads 5, because ln(1 + d.rcr) contains one inside the RCR term — caught by this test failing.
const plusCount = (s) => (s.match(/\+\s*(\(|least\()/g) || []).length;
ok(cExpr !== null && plusCount(cExpr) === 4,
   `canonical ranked_score adds exactly 4 boost terms (found ${cExpr === null ? "n/a" : plusCount(cExpr)})`);
ok(sExpr !== null && plusCount(sExpr) === 4,
   `scorer ranked_score adds exactly 4 boost terms (found ${sExpr === null ? "n/a" : plusCount(sExpr)})`);
// No subtraction: every boost is additive, so a minus in this expression is a sign error.
ok(cExpr !== null && !/\s-\s(?!\(?\s*\()/.test(cExpr.replace(/\(1 - \(c\.embedding <=> query_embedding\)\)/g, "").replace(/\(4 - d\.source_tier\)/g, "")),
   "no stray subtraction in the canonical boost chain — every boost term is additive");

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

// ── 6b. authority_tiebreak must TIE-BREAK, not re-sort (Codex, 2026-07-29) ────
// Its primary comparator read bare_similarity in the reranked path — so enabling the "tie-break" would
// have re-sorted the whole union by raw cosine and discarded the authority boosts, exactly the confound
// fixed in the main sort. It was never enabled, so it corrupted no measurement; it was latent, waiting
// for whoever turned the flag on. pubRank may only speak when the primary scores are equal.
const authBlock = worker.slice(worker.indexOf("const wantAuthority"),
                               worker.indexOf("merged = union.slice(0, matchCount);"));
ok(authBlock.length > 0, "found the authority_tiebreak block in worker.js");
ok(/bare_ranked_score/.test(authBlock),
   "authority_tiebreak's primary key is bare_ranked_score in the reranked path");
ok(!/x\.bare_similarity/.test(authBlock),
   "…and NOT bare_similarity — that would repeal the boosts under the name of a tie-break");
ok(/\|\|\s*\(pubRank/.test(authBlock),
   "pubRank is applied only via || — it speaks when the primary scores tie, never overrides them");

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
