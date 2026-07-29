// RETRIEVAL GUARD REGRESSIONS — found in the 2026-07-29 audit. Run: node test_retrieve_guards.mjs
//
// Every bug below is the same species: something reports a state it has not earned. A rerank that ranked
// nothing says it reranked. A filter that had nothing to filter says the corpus rejected everything. A
// spend cap parsed from a typo says there is no cap. They are cheap to fix and almost impossible to
// notice in production, because in each case the SUCCESSFUL-looking output is the bug.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
// Strip // comments before asserting anything about behaviour. Prose describing a hazard must not be
// able to satisfy — or violate — a test about the code. The "no -Infinity remains" assertion failed on
// its own explanatory comments the first time it ran, which is the mistake in miniature.
const workerCode = worker.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");

// ── 1 · THE GUARD THAT HAD THE HOLE IT WAS GUARDING ──────────────────────────
// `bare_similarity != null && bare_ranked_score == null` requires the lookup to have SUCCEEDED for a row
// before it can complain the row has no score. When the whole lookup misses — RPC returns [], or an id
// type mismatch makes every Map hit fail — both fields are null everywhere, the guard is silent, and the
// comparator computes -Infinity - -Infinity = NaN for every pair. V8 leaves a NaN-compared array in
// arrival order, so the union keeps the exact facet ordering the rerank exists to replace, and the
// response reports rerank_applied:true.
{
  // Demonstrate the failure mode itself, so the test documents WHY rather than just asserting a string.
  const rows = [{ chunk_id: 1, ranked_score: 0.9 }, { chunk_id: 2, ranked_score: 0.4 }];
  rows.forEach(c => { c.bare_similarity = null; c.bare_ranked_score = null; });
  const oldGuardFires = rows.some(c => c.bare_similarity != null && c.bare_ranked_score == null);
  ok(oldGuardFires === false, "the OLD guard is provably silent when the whole lookup misses");
  ok(Number.isNaN((-Infinity) - (-Infinity)), "…and -Infinity minus -Infinity is NaN, so the sort is a no-op");

  ok(/bare\.size === 0/.test(worker),
     "the rerank guards on COVERAGE — how many candidates were actually scored");
  ok(/scored 0 of \$\{ids\.length\} candidates/.test(worker),
     "…and names the count in the error, so the cause is not a guess");
  ok(/Array\.isArray\(bareRows\)/.test(worker),
     "a non-array RPC response is rejected rather than silently iterated to nothing");
}

// ── 2 · NaN COMPARATORS MUST NOT EXIST IN A `||` CHAIN ───────────────────────
// NaN is falsy. In `(primary(b) - primary(a)) || (pubRank(a) - pubRank(b))` a NaN primary hands the whole
// decision to the tie-break — making publication type the PRIMARY key for unscored pairs, inside a
// comparator whose entire purpose is to be secondary.
{
  ok(!/-Infinity/.test(workerCode),
     "no -Infinity sentinels remain in the ranking comparators — they produce NaN when two are compared");
  ok((workerCode.match(/-Number\.MAX_VALUE/g) || []).length >= 3,
     "…replaced by -Number.MAX_VALUE, which is finite, so two unscored candidates compare EQUAL (0)");
  const a = -Number.MAX_VALUE, b = -Number.MAX_VALUE;
  ok(b - a === 0, "two unscored candidates yield a real 0, which the || treats as a genuine tie");
  ok(!Number.isNaN(b - a), "…and never NaN, so the tie-break can never become the primary key");
}

// ── 3 · TWO DIFFERENT ZEROES ─────────────────────────────────────────────────
// "the filter rejected every candidate" and "there were no candidates" are opposite claims. The first is
// actionable (the corpus holds only errata for this topic); the second means retrieval found nothing.
// They produced an identical flag, because an empty union skips the filter loop entirely.
{
  ok(/_unionBeforeFilter/.test(worker),
     "the union size BEFORE the metadata filter is captured");
  ok(/no_eligible_local_sources:[\s\S]{0,220}_unionBeforeFilter \|\| 0\) > 0/.test(worker),
     "no_eligible_local_sources requires that there was something to reject");
  ok(/no_local_candidates:/.test(worker),
     "…and the genuinely-empty case has its own flag rather than borrowing that one");
}

// ── 4 · COVERAGE IS REPORTED, NOT LOGGED ─────────────────────────────────────
// A console.warn inside a Worker is invisible to the evaluator reading the JSON. The old comment claimed
// the unscored count was "COUNTED so it cannot hide"; it was counted into a log line.
{
  ok(/rerank_scored: merged\._rerankScored/.test(worker), "rerank_scored is in the response body");
  ok(/rerank_unscored: merged\._rerankUnscored/.test(worker), "rerank_unscored is in the response body");
}

// ── 5 · NEGATIVE match_count SLICED FROM THE WRONG END ───────────────────────
// slice(0, -5) drops the five BEST-ranked chunks off the tail and returns the rest, while `count`
// reports the inflated length as if the request had been honoured.
{
  const clamp = (v) => {
    const r = parseInt(v);
    return Math.min(Number.isFinite(r) && r > 0 ? r : 12, 50);
  };
  ok(clamp(-5) === 12, "match_count -5 falls back to the default instead of slicing from the tail");
  ok(clamp("abc") === 12, "a non-numeric match_count falls back rather than becoming NaN");
  ok(clamp(0) === 12, "zero falls back");
  ok(clamp(999) === 50, "an oversized request is still capped");
  ok(clamp(7) === 7, "a legitimate value is untouched");
  ok([1, 2, 3].slice(0, -1).length === 2, "…the underlying hazard is real: slice(0,-1) drops from the END");
  ok(/Number\.isFinite\(requestedCount\) && requestedCount > 0/.test(worker),
     "the Worker clamps at both ends");
}

// ── 6 · A MALFORMED LIMIT IS NOT AN ABSENT LIMIT ─────────────────────────────
// parseInt("unlimited") is NaN; every comparison against NaN is false, so `used >= limit` and
// `spentCents >= capCents` stop tripping. /health then renders NaN as null, which reads as
// "not configured" rather than "misconfigured".
{
  ok(Number.isNaN(parseInt("unlimited")) && !(5 >= parseInt("unlimited")),
     "the hazard is real: a NaN limit makes every >= comparison false");
  ok(JSON.stringify({ limit: NaN }) === '{"limit":null}',
     "…and NaN serializes to null, so the misconfiguration reads as absence");
  ok(/function intEnv\(/.test(worker), "config integers go through a validating helper");
  ok(/Number\.isFinite\(n\) \|\| n < 0/.test(worker), "…which rejects NaN and negatives");
  ok(!/parseInt\(env\./.test(worker), "no raw parseInt(env.*) remains for a limit or a cap");
  for (const v of ["FREE_TALKS", "FREE_IMAGES", "MAX_MONTHLY_SPEND_USD", "DAILY_LIMIT_PER_IP"]) {
    ok(new RegExp(`intEnv\\(env\\.${v}`).test(worker), `${v} is validated`);
  }
}

console.log("\n" + (failures === 0 ? "✔ RETRIEVAL GUARD TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
