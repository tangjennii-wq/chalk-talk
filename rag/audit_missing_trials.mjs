#!/usr/bin/env node
/**
 * MISSING-TRIAL AUDIT — read-only.
 *
 * Compares the trial names Jenni already curated in GUIDELINES[specialty].trials (index.html)
 * against the verified manifest rag/landmark_trials.json.
 *
 * WHY: the guideline layer names trials the retrieval corpus does not contain. A talk can therefore
 * discuss DELIVER or PEXIVAS while the store has no paper to cite for it — which is exactly how a
 * teaching claim ends up uncited (or worse, cited to a review that merely mentions the trial).
 *
 * THIS SCRIPT WRITES NOTHING except its own report. It does NOT touch landmark_trials.json and does
 * NOT ingest. Selecting a candidate for ingestion requires a verified canonical primary-results PMID,
 * which only a human-reviewed lookup can supply — PubMed relevance search is never proof.
 *
 * Usage: node rag/audit_missing_trials.mjs
 *   -> rag/missing_trials_candidates.json
 *   -> MISSING_TRIALS_REVIEW.md
 */
import { readFileSync, writeFileSync } from "fs";

// ── load GUIDELINES out of index.html ──
const html = readFileSync("index.html", "utf8");
const start = html.indexOf("var GUIDELINES");
if (start < 0) { console.error("GUIDELINES not found"); process.exit(1); }
const eq = html.indexOf("=", start);
let i = html.indexOf("{", eq), depth = 0, end = -1;
for (let j = i; j < html.length; j++) {
  const c = html[j];
  if (c === "{") depth++;
  else if (c === "}") { depth--; if (depth === 0) { end = j; break; } }
}
const G = eval("(" + html.slice(i, end + 1) + ")");

// ── load the verified manifest ──
const raw = JSON.parse(readFileSync("rag/landmark_trials.json", "utf8"));
const manifest = Array.isArray(raw) ? raw : Object.values(raw)[0];

/**
 * Conservative normalization. Deliberately does NOT strip roman numerals or trailing digits, because
 * "AKIKI" and "AKIKI-2", "UKPDS 33" and "UKPDS 34", "BENEFIT" and "BENEFIT-EXT" are DIFFERENT trials.
 * Over-normalizing would hide real gaps by falsely matching a sibling trial.
 */
function norm(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/–|—/g, "-")     // en/em dash -> hyphen
    .replace(/[^A-Z0-9\- ]/g, "")       // drop punctuation, keep hyphen/space/digits
    .replace(/\s+/g, " ")
    .trim();
}

// Known alias pairs — only where the two strings are unambiguously the SAME trial.
const ALIASES = {
  "EMPA-REG": "EMPA-REG OUTCOME",
  "DECLARE": "DECLARE-TIMI 58",
  "EMPEROR-REDUCED": "EMPEROR-Reduced",
  "EMPEROR-PRESERVED": "EMPEROR-Preserved",
  "ARDSNET": "ARDS Network",
  "ARDS NET": "ARDS Network",
  "FHN": "FHN Daily",
  "DEFUSE-3": "DEFUSE 3",
  "DEFUSE3": "DEFUSE 3",
  "RACE-II": "RACE II",
  "ISIS2": "ISIS-2",
};

const haveByNorm = new Map();
for (const t of manifest) {
  haveByNorm.set(norm(t.name), t);
  if (t.full) haveByNorm.set(norm(t.full), t);
}
function lookup(name) {
  const n = norm(name);
  if (haveByNorm.has(n)) return { hit: haveByNorm.get(n), via: "exact" };
  const alias = ALIASES[n];
  if (alias && haveByNorm.has(norm(alias))) return { hit: haveByNorm.get(norm(alias)), via: `alias:${alias}` };
  return null;
}

// ── walk the curated trial lists ──
const candidates = [], present = [];
let totalListed = 0;
for (const specialty of Object.keys(G)) {
  const trials = G[specialty].trials;
  if (!Array.isArray(trials)) continue;
  for (const entry of trials) {
    // entries may be strings or objects
    const label = typeof entry === "string" ? entry : (entry && (entry.name || entry.trial || entry.title)) || "";
    if (!label.trim()) continue;
    totalListed++;
    // A curated entry is often "NAME - one line description"; take the leading token group as the name.
    const nameOnly = label.split(/\s+[-–—:]\s+/)[0].trim();
    const found = lookup(nameOnly) || lookup(label);
    const rec = {
      guideline_spelling: label,
      normalized: norm(nameOnly),
      specialty,
      in_manifest: !!found,
      matched_via: found ? found.via : null,
      manifest_name: found ? found.hit.name : null,
      review_status: found ? "present" : "CANDIDATE — needs canonical PMID lookup",
    };
    (found ? present : candidates).push(rec);
  }
}

// dedupe candidates by normalized name, remembering every specialty that asked for it
const byNorm = new Map();
for (const c of candidates) {
  const k = c.normalized;
  if (!byNorm.has(k)) byNorm.set(k, { ...c, specialties: [c.specialty], spellings: [c.guideline_spelling] });
  else {
    const e = byNorm.get(k);
    if (!e.specialties.includes(c.specialty)) e.specialties.push(c.specialty);
    if (!e.spellings.includes(c.guideline_spelling)) e.spellings.push(c.guideline_spelling);
  }
}
const unique = [...byNorm.values()].sort((a, b) =>
  a.specialties[0].localeCompare(b.specialties[0]) || a.normalized.localeCompare(b.normalized));

writeFileSync("rag/missing_trials_candidates.json", JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  manifest_size: manifest.length,
  guideline_trials_listed: totalListed,
  already_present: present.length,
  unique_candidates: unique.length,
  note: "READ-ONLY audit. A candidate is NOT approved for ingestion until a canonical primary-results PMID is verified. PubMed relevance search is not proof.",
  candidates: unique,
}, null, 2));

// ── markdown review file ──
const bySpec = {};
for (const c of unique) (bySpec[c.specialties[0]] ||= []).push(c);

let md = `# Missing landmark trials — review queue\n\n`;
md += `Generated ${new Date().toISOString().slice(0, 10)} · **read-only audit, nothing ingested**\n\n`;
md += `| | |\n|---|---|\n`;
md += `| trials named across \`GUIDELINES[].trials\` | ${totalListed} |\n`;
md += `| already in the verified manifest | ${present.length} |\n`;
md += `| **unique candidates missing** | **${unique.length}** |\n`;
md += `| manifest size | ${manifest.length} |\n\n`;
md += `## Rules before anything here gets ingested\n\n`;
md += `1. A **canonical primary-results PMID**, verified on PubMed. Relevance search is never proof.\n`;
md += `2. Trial-like PubMed publication type.\n`;
md += `3. Reject protocols, design papers, statistical analysis plans, secondary/subgroup analyses, pooled analyses, reviews, editorials, and later follow-up papers unless deliberately chosen.\n`;
md += `4. Teaching value stated: why should a resident know this trial?\n`;
md += `5. Guideline relationship: incorporated / predates / disagrees.\n\n`;
md += `Normalization is deliberately conservative — \`AKIKI\` vs \`AKIKI-2\`, \`UKPDS 33\` vs \`UKPDS 34\`, \`BENEFIT\` vs \`BENEFIT-EXT\` are different trials and must not be collapsed.\n\n---\n\n`;

for (const spec of Object.keys(bySpec).sort()) {
  md += `## ${spec} (${bySpec[spec].length})\n\n`;
  md += `| trial (as written in guideline) | normalized | also listed under | status |\n|---|---|---|---|\n`;
  for (const c of bySpec[spec]) {
    const others = c.specialties.slice(1).join(", ") || "—";
    md += `| ${c.spellings[0].replace(/\|/g, "\\|")} | \`${c.normalized}\` | ${others} | needs PMID |\n`;
  }
  md += `\n`;
}
writeFileSync("MISSING_TRIALS_REVIEW.md", md);

console.log(`trials named in GUIDELINES[].trials : ${totalListed}`);
console.log(`already in verified manifest        : ${present.length}`);
console.log(`unique candidates MISSING           : ${unique.length}`);
console.log(`manifest size                       : ${manifest.length}`);
console.log(`\nby specialty:`);
for (const spec of Object.keys(bySpec).sort((a, b) => bySpec[b].length - bySpec[a].length))
  console.log(`  ${spec}: ${bySpec[spec].length}`);
console.log(`\n-> rag/missing_trials_candidates.json`);
console.log(`-> MISSING_TRIALS_REVIEW.md`);
console.log(`\nNOTHING was ingested and landmark_trials.json was NOT modified.`);
