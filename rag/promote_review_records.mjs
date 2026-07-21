#!/usr/bin/env node
/**
 * PROMOTE verified review records into the canonical manifest (Codex plan, step 2).
 *
 * Converts rag/trial_review_records.json entries into landmark_trials.json schema and merges them,
 * deduping by BOTH normalized name AND expected_pmid so a trial already present (e.g. STICH, if the
 * manifest holds it) is not double-added while its sibling (STICHES) still is.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write landmark_trials.json.
 * Only promotes records the validator would pass: a resolvable PMID and no SUSPECT status.
 *
 * Usage:
 *   node rag/validate_review_records.mjs      # must be GREEN first (90 OK, 0/0/0)
 *   node rag/promote_review_records.mjs       # dry run — show the merge
 *   node rag/promote_review_records.mjs --apply
 *   node rag/validate_landmark_pmids.mjs      # re-validate the enlarged manifest
 */
import { readFileSync, writeFileSync } from "fs";

const APPLY = process.argv.includes("--apply");
const db = JSON.parse(readFileSync("rag/trial_review_records.json", "utf8"));
const raw = JSON.parse(readFileSync("rag/landmark_trials.json", "utf8"));
const manifest = Array.isArray(raw) ? raw : Object.values(raw)[0];

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const haveName = new Set(manifest.map((t) => norm(t.name)));
const havePmid = new Set(manifest.map((t) => String(t.expected_pmid || "")));

const promoted = [], skipped = [], blocked = [];
for (const r of db.records) {
  if (!r.pmid || r.conf === "SUSPECT") { blocked.push(`${r.name} (${r.conf === "SUSPECT" ? "SUSPECT" : "no PMID"})`); continue; }
  if (haveName.has(norm(r.name)) || havePmid.has(String(r.pmid))) { skipped.push(`${r.name} (already in manifest)`); continue; }
  promoted.push({
    name: r.name,
    full: r.name,                         // ingest only uses `full` as a search fallback; expected_pmid wins
    year: r.year,
    specialty: r.spec,
    expected_pmid: String(r.pmid),
    pmid_verified: r.pubtype_override === "manual_2026-07" ? "manual_2026-07" : "pubmed_2026-07",
    teaching_role: r.role,                 // carried through for the app; ingest ignores it
    source_batch: r.batch,
  });
  haveName.add(norm(r.name)); havePmid.add(String(r.pmid));   // guard against intra-batch dups too
}

console.log(`review records:      ${db.records.length}`);
console.log(`  -> promote:        ${promoted.length}`);
console.log(`  -> already present:${skipped.length}${skipped.length ? "  (" + skipped.join(", ") + ")" : ""}`);
console.log(`  -> blocked:        ${blocked.length}${blocked.length ? "  (" + blocked.join(", ") + ")" : ""}`);
console.log(`\nmanifest: ${manifest.length}  ->  ${manifest.length + promoted.length}`);

if (!APPLY) { console.log(`\nDRY RUN — pass --apply to write landmark_trials.json.`); process.exit(0); }

const out = Array.isArray(raw) ? [...manifest, ...promoted] : (raw[Object.keys(raw)[0]] = [...manifest, ...promoted], raw);
writeFileSync("rag/landmark_trials.json", JSON.stringify(out, null, 2));
console.log(`\n✔ Wrote ${manifest.length + promoted.length} trials to rag/landmark_trials.json.`);
console.log(`Next: node rag/validate_landmark_pmids.mjs   (expect ${manifest.length + promoted.length} OK)`);
