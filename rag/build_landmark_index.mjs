// BUILD THE ACRONYM -> VERIFIED PMID INDEX — run: node rag/build_landmark_index.mjs
//
// guidelines.json names landmark trials as bare acronyms ("PEITHO", "PROSEVA", "SALSA") and the prompt
// tells the model to cite them "by name with their PMID/DOI URL". Nothing ever supplied the paper. The
// corpus holds 559 landmark documents, but `documents` has no acronym column and PubMed titles do not
// contain acronyms — searching titles for PEITHO, DAPA-HF, EMPEROR-Reduced or PROSEVA returns zero. So
// the trial's own figures reached neither the draft nor the review, and both produced them from memory.
// That is the mechanism behind the reversed-arms class of error (PEITHO's 2.6/5.6 among them).
//
// rag/landmark_trials.json already holds the missing join key: name -> expected_pmid, with provenance in
// pmid_verified. This emits the browser-loadable half of it, published beside guidelines.json.
//
// GENERATED — do not hand-edit landmark_pmids.json. Edit rag/landmark_trials.json and re-run.
import { readFileSync, writeFileSync } from "fs";

// Same allowlist the PMID validator gates on: a PMID nobody confirmed is not evidence.
// Date-stamped on purpose: a stamp records WHEN a PMID was confirmed, so a new verification pass
// adds a value here rather than back-dating itself into an older one. manual_2026-08 is the
// 19 Aug 2026 pass (INCREASE). A row whose stamp is not listed here is SKIPPED, silently — which
// is why adding the trial without adding its stamp would have looked like it worked and produced
// an index without it.
const VERIFIED_OK = ["pubmed_2026-07", "manual_2026-07", "europepmc_2026-07", "manual_2026-08"];

// guidelines.json writes acronyms inconsistently (ROCKET-AF vs ROCKET AF, PARTNER 2 vs PARTNER-2), so
// both sides are reduced to alphanumerics before matching. Four trials resolve ONLY because of this.
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const trials = JSON.parse(readFileSync("rag/landmark_trials.json", "utf8"));
const index = {};
let skipped = 0;

for (const t of trials) {
  if (!t || !t.expected_pmid || !VERIFIED_OK.includes(t.pmid_verified)) { skipped++; continue; }
  const key = norm(t.name);
  if (!key) { skipped++; continue; }
  // A collision is FATAL. Two trials sharing a normalised acronym means the index would hand the model
  // the wrong paper under the right name — the exact failure this whole patch exists to remove, and one
  // that would read as grounded. Keeping the first was the wrong instinct: there is no basis for choosing.
  if (index[key] && index[key].pmid !== String(t.expected_pmid)) {
    console.error(`COLLISION: normalised acronym ${key} maps to BOTH PMID ${index[key].pmid} (${index[key].name}) `
      + `and PMID ${t.expected_pmid} (${t.name}). Right acronym, wrong paper is worse than no paper — `
      + `disambiguate the names in rag/landmark_trials.json before regenerating.`);
    process.exit(1);
  }
  index[key] = { name: t.name, pmid: String(t.expected_pmid), year: t.year || null };
}

// Coverage against what guidelines.json actually names, so the number is visible rather than assumed.
const guides = JSON.parse(readFileSync("guidelines.json", "utf8"));
const named = [], unresolved = [];
for (const [sp, v] of Object.entries(guides.specialties || {})) {
  for (const name of (v.trials || [])) {
    named.push(name);
    if (!index[norm(name)]) unresolved.push(`${sp}: ${name}`);
  }
}

writeFileSync("landmark_pmids.json", JSON.stringify({
  schema_version: 1,
  generated: "by rag/build_landmark_index.mjs from rag/landmark_trials.json",
  note: "Acronym (alphanumerics only, upper case) -> verified PMID. A trial absent from here has no "
      + "verified source, and the prompt must NOT instruct the model to cite it.",
  trials: index,
}, null, 2) + "\n");

console.log(`indexed ${Object.keys(index).length} trials with a verified PMID (${skipped} skipped)`);
console.log(`guidelines.json names ${named.length} trials; ${named.length - unresolved.length} resolve `
          + `(${Math.round(100 * (named.length - unresolved.length) / named.length)}%)`);
console.log(`${unresolved.length} UNRESOLVABLE — these must be dropped from the cite instruction:`);
for (const u of unresolved) console.log("  " + u);
console.log("-> landmark_pmids.json");
