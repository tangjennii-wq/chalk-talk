// GENERATED ARTEFACTS MATCH THEIR SOURCE — run: node test_generated_artifacts.mjs
//
// landmark_pmids.json is BUILT from rag/landmark_trials.json by rag/build_landmark_index.mjs. The
// builder says so in its own header — "GENERATED — do not hand-edit landmark_pmids.json" — and I
// hand-edited it anyway, adding INCREASE to the output while the source knew nothing about it. The next
// person to run the builder would have silently erased it.
//
// Nothing in CI could see that. A comment is not a guard. This is: it recomputes what the builder would
// emit, from the source, and compares it to what is committed. A hand-edit fails. A source edit without
// a rebuild fails. A stale artefact fails.
//
// Compared SEMANTICALLY (by acronym -> pmid/year/name) rather than byte-for-byte, so reformatting the
// source does not produce a spurious failure — the thing that must not drift is the DATA.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const builderSrc = readFileSync(new URL("./rag/build_landmark_index.mjs", import.meta.url), "utf8");
const source = JSON.parse(readFileSync(new URL("./rag/landmark_trials.json", import.meta.url), "utf8"));
const built = JSON.parse(readFileSync(new URL("./landmark_pmids.json", import.meta.url), "utf8"));

// Take the builder's OWN rules rather than restating them here — a test that hardcodes a copy of the
// allowlist stops tracking the builder the moment someone edits one and not the other.
const okLine = builderSrc.match(/const VERIFIED_OK = (\[[^\]]*\]);/);
ok(!!okLine, "sanity: the builder's VERIFIED_OK allowlist was located");
const VERIFIED_OK = JSON.parse(okLine[1].replace(/'/g, '"'));
const normLine = builderSrc.match(/const norm = \(s\) => ([^\n;]+);/);
ok(!!normLine, "sanity: the builder's key-normalising function was located");
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
ok(normLine[1].includes("toUpperCase") && normLine[1].includes("[^A-Z0-9]"),
   "…and still normalises to upper-case alphanumerics, which is what this test assumes");

// ── recompute the index the builder would emit ──────────────────────────────────────────────────────
const expected = {};
let skipped = 0;
for (const t of source) {
  if (!t || !t.expected_pmid || !VERIFIED_OK.includes(t.pmid_verified)) { skipped++; continue; }
  const key = norm(t.name);
  if (!key) { skipped++; continue; }
  if (!expected[key]) expected[key] = { name: t.name, pmid: String(t.expected_pmid), year: t.year };
}

const got = built.trials || {};
const eKeys = Object.keys(expected).sort(), gKeys = Object.keys(got).sort();

// ── the three ways this drifts ──────────────────────────────────────────────────────────────────────
const phantom = gKeys.filter(k => !expected[k]);
if (phantom.length) console.log("\n  IN THE ARTEFACT BUT NOT THE SOURCE (hand-edited?):\n    " + phantom.join("\n    ") + "\n");
ok(phantom.length === 0,
   `nothing in landmark_pmids.json is absent from rag/landmark_trials.json (${phantom.length} phantom) — this is the hand-edit check`);

const missing = eKeys.filter(k => !got[k]);
if (missing.length) console.log("\n  IN THE SOURCE BUT NOT THE ARTEFACT (needs a rebuild):\n    " + missing.join("\n    ") + "\n");
ok(missing.length === 0,
   `every authorised trial reached the artefact (${missing.length} missing) — run node rag/build_landmark_index.mjs`);

const drifted = eKeys.filter(k => got[k] && (String(got[k].pmid) !== expected[k].pmid
                                          || String(got[k].year) !== String(expected[k].year)
                                          || got[k].name !== expected[k].name));
if (drifted.length) console.log("\n  VALUES DISAGREE:\n    "
  + drifted.map(k => `${k}: artefact ${JSON.stringify(got[k])} vs source ${JSON.stringify(expected[k])}`).join("\n    ") + "\n");
ok(drifted.length === 0, `every trial carries the same pmid, year and name in both (${drifted.length} drifted)`);

ok(eKeys.length === gKeys.length, `counts agree (${eKeys.length} source-authorised, ${gKeys.length} in artefact)`);

// ── the provenance stamp is a date, and is not back-dated ───────────────────────────────────────────
// pmid_verified records WHEN a PMID was confirmed. A new verification pass adds a value to the allowlist
// rather than borrowing an older one, so the stamp keeps meaning something.
const stamps = new Set(source.map(t => t.pmid_verified));
const unlisted = [...stamps].filter(s => !VERIFIED_OK.includes(s));
ok(unlisted.length === 0,
   `every stamp in the source is on the allowlist${unlisted.length ? " — SILENTLY SKIPPED: " + unlisted.join(", ") : ""}`);
// DAY-LEVEL PRECISION IS ALLOWED, and became necessary on 2026-08-20: a second manual pass landed in the
// same MONTH as manual_2026-08, and reusing that stamp would have back-dated today's verification into
// last week's - exactly the borrowing the rule above exists to prevent. The requirement is a DATE, not a
// particular granularity, so the day suffix is optional and a bare boolean still fails.
ok([...stamps].every(s => /_\d{4}-\d{2}(-\d{2})?$/.test(s)),
   "every stamp carries a YYYY-MM(-DD) verification date rather than a bare boolean");
ok([...stamps].some(s => /_\d{4}-\d{2}-\d{2}$/.test(s)),
   "…and at least one is day-stamped, which is what a same-month second pass requires");

// INCREASE specifically: the row this test exists because of.
ok(!!expected.INCREASE && expected.INCREASE.pmid === "33440084",
   "INCREASE is authorised BY THE SOURCE, not just present in the artefact");
const inc = source.find(t => t.name === "INCREASE");
ok(inc && inc.pmid_verified === "manual_2026-08",
   "…stamped with the August pass it was actually verified in, not back-dated into the July batch");
ok(inc && /Read in the primary record 19 Aug 2026/.test(inc.pmid_note || ""),
   "…and carries a note saying what was read, and when");

console.log(`\n${n} assertions over ${source.length} source trials, `
  + (failures === 0 ? "✔ GENERATED ARTEFACTS OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
