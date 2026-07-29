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

  // ── parseInt IS NOT VALIDATION (Codex, 2026-07-29, second pass) ─────────────
  // My first fix used parseInt and its comment cited "250usd" as an example it REJECTED. It did not:
  // parseInt is a prefix parser. Worse than the NaN case it replaced, because NaN at least disabled the
  // comparison visibly, whereas "1e3" meant as 1000 silently becomes a $1 cap and "0x10" becomes $0.
  // This section originally tested only "unlimited" — the one malformed value parseInt happens to
  // reject — so the suite passed while the fix was wrong. Exercise the helper, over a table.
  const intEnvSrc = worker.match(/function intEnv\([\s\S]*?\n\}/)[0];
  const intEnv = new Function("console", intEnvSrc + "; return intEnv;")({ warn() {} });
  const FALLBACK = 99;
  for (const [input, expected, why] of [
    ["250",       250,      "a clean integer passes through"],
    ["  250  ",   250,      "surrounding whitespace is tolerated"],
    ["250usd",    FALLBACK, "the exact example the old comment wrongly claimed was rejected"],
    ["1e3",       FALLBACK, "exponent notation — parseInt gave 1, i.e. a $1 cap"],
    ["0x10",      FALLBACK, "hex — parseInt gave 0, i.e. a $0 cap blocking every request"],
    ["250.7",     FALLBACK, "a decimal is not an integer"],
    ["unlimited", FALLBACK, "non-numeric"],
    ["-5",        FALLBACK, "negative"],
    ["",          FALLBACK, "empty"],
    [null,        FALLBACK, "unset"],
  ]) {
    const got = intEnv(input, FALLBACK, "TEST");
    ok(got === expected, `intEnv(${JSON.stringify(input)}) -> ${got} — ${why}`);
  }
  ok(!/const n = parseInt\(raw, 10\);[\s\S]{0,80}Number\.isFinite/.test(worker),
     "…and intEnv no longer validates by parseInt, which accepts any numeric PREFIX");
  ok(!/parseInt\(env\./.test(worker), "no raw parseInt(env.*) remains for a limit or a cap");
  for (const v of ["FREE_TALKS", "FREE_IMAGES", "MAX_MONTHLY_SPEND_USD", "DAILY_LIMIT_PER_IP"]) {
    ok(new RegExp(`intEnv\\(env\\.${v}`).test(worker), `${v} is validated`);
  }
}

// ── 7 · A PARTIAL RERANK IS NOT A RERANK ─────────────────────────────────────
// The coverage guard rejected scoring ZERO candidates but allowed scoring 20 of 24 — reporting
// rerank_applied:true with rerank_unscored:4, while those four were forced to the bottom regardless of
// merit. That is the global-top-N failure this stage was built to remove, just smaller, and an
// experiment reading rerank_applied:true has no reason to discard the topic.
{
  ok(/strict_rerank/.test(workerCode), "a strict_rerank mode exists");
  ok(/unscored > 0 && body\.strict_rerank === true/.test(workerCode),
     "…which throws when ANY candidate went unscored, rather than only when all did");
  ok(/strict_rerank: true/.test(readFileSync(new URL("./rag/eval_pipeline_arms.mjs", import.meta.url), "utf8")),
     "…and the evaluator sets it, so a partial rerank fails the arm instead of entering calibration");
  // Production stays lenient on purpose: dropping a whole talk's retrieval because one stale chunk
  // lacks an embedding is worse for the user than a slightly imperfect ordering.
  ok(/STRICT ONLY WHEN ASKED/.test(worker),
     "…while production tolerates it, and the asymmetry is stated rather than implied");
}

// ── 8 · CANCEL MUST NOT CLAIM AN OUTCOME IT DID NOT ACHIEVE ──────────────────
// It wrapped everything in catch(_){} and returned {status:"cancelled"} regardless. A failed KV write
// meant generation continued, completed and was billed — while the UI said cancelled and the user
// stopped worrying. The user's whole reason for cancelling is to stop spending.
{
  const cancel = worker.slice(worker.indexOf("async function handleGenerateCancel"),
                              worker.indexOf("function corsPreflight"));
  ok(cancel.length > 0, "found handleGenerateCancel");
  ok(!/catch \(_\) \{\}\s*\n\s*return jsonOK\(\{ status: "cancelled" \}/.test(cancel),
     "the unconditional success return after a swallowed error is gone");
  ok(/cancel_failed/.test(cancel), "a failed cancel returns an error code");
  ok(/cancelled: false/.test(cancel), "…and says cancelled:false explicitly, rather than omitting it");
  ok(/kv_write_failed/.test(cancel) && /kv_read_failed/.test(cancel),
     "…distinguishing a read failure from a write failure");
  ok(/readback_mismatch/.test(cancel),
     "…and reads the record back, because a resolved put is not proof the runner will see it");
}

// ── 9 · UNAUTHENTICATED IMAGE GENERATION IS CAPPED AND LEDGERED ──────────────
// Without X-Supabase-Auth, isFreeTier was false, so the cap check, quota consume and ledger write were
// all skipped while the request still ran on env.OPENAI_API_KEY. The only guard was a per-IP counter
// backed by an unbound KV namespace. My own omission: I metered the sibling hole on /v1/messages the
// same day and did not check whether this endpoint had it too.
{
  const img = worker.slice(worker.indexOf("async function handleImageGeneration"),
                           worker.indexOf("// cancel MUST verify"));
  ok(img.length > 0, "found handleImageGeneration");
  ok(/if \(!isFreeTier\) \{[\s\S]{0,400}getMonthlySpendCents/.test(img),
     "the monthly cap is checked on the unauthenticated path too");
  ok(!/\} else if \(upstream\.ok\) \{\s*\n\s*ctx\.waitUntil\(incrementDailyCount/.test(img),
     "the if/else that metered ONLY free-tier requests is gone");
  ok(/if \(upstream\.ok\) \{[\s\S]{0,500}ledger_add/.test(img),
     "…every successful image is written to the ledger, whoever asked for it");
  ok(/anonMonthKey/.test(img), "…using a month key that exists on both paths");
}

// ── 10 · A KILLED BACKGROUND JOB MUST BE VISIBLE, NOT AN INFINITE SPINNER ────
// runGeneration is handed to ctx.waitUntil AFTER the job id is returned, and Cloudflare terminates
// post-response work at ~30s regardless of plan. A 50-100s draft+critique is killed mid-flight: no
// `done`, no `error`, and no refund, because the refund lives inside the terminated function. The record
// just stops changing while the client polls it forever.
//
// This does NOT fix that — the fix is durable execution. It makes the failure reportable.
{
  const status = worker.slice(worker.indexOf("async function handleGenerateStatus"),
                              worker.indexOf("async function handleGenerateCancel"));
  ok(status.length > 0, "found handleGenerateStatus");
  ok(/stalled: true/.test(status), "a long-idle running job is reported as stalled");
  ok(/idle_seconds/.test(status), "…with how long it has been idle, so the claim is checkable");
  ok(/STALL_AFTER_MS/.test(status), "…against a named threshold rather than a bare number");
  // Read-only: the runner may still be alive, and racing it from a polling endpoint risks
  // double-refunding or clobbering a real result.
  ok(!/JOBS_KV\.put/.test(status), "the status endpoint does NOT mutate the job record");
  ok(!/refundQuota|refundOnce/.test(status), "…and does not refund from a read path");
  ok(/not something you did/.test(status),
     "…and the message tells the user it is a known defect rather than blaming their input");

  // The false premise that shipped this feature must not survive in the config.
  const wrangler = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
  ok(!/Requires the Workers Paid plan \(for the longer/.test(wrangler),
     "wrangler.toml no longer claims Paid buys a longer ctx.waitUntil budget");
  ok(/up to 30 seconds/.test(wrangler) && /cpu_ms/.test(wrangler),
     "…and records the real limit plus the CPU-time confusion that caused it");
}

console.log("\n" + (failures === 0 ? "✔ RETRIEVAL GUARD TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
