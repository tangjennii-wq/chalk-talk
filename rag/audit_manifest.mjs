#!/usr/bin/env node
/**
 * Chalk Talk — guidelines_manifest.json auditor (Phase A).
 *
 * Structural hygiene for the card layer, per Codex's checklist. Flags things that quietly rot:
 * duplicate titles, same-title/different-summary, duplicate PMID/DOI, missing source_url,
 * review_due in the past, cards with no verifiable identifier, and paywalled cards not flagged as such.
 *
 * These are WARNINGS by default (structural, not citation-fatal). --strict makes any finding exit 1.
 * Complements rag/validate_guidelines.mjs, which checks that the citations themselves resolve.
 *
 * Usage: node rag/audit_manifest.mjs [--strict]
 */
import { readFileSync } from "fs";
const STRICT = process.argv.includes("--strict");
const TODAY = "2026-07-13";
const { cards } = JSON.parse(readFileSync("rag/guidelines_manifest.json", "utf8"));

const findings = [];
const flag = (kind, msg) => findings.push({ kind, msg });

// group helpers
const by = (fn) => { const m = new Map(); for (const c of cards) { const k = fn(c); if (k==null) continue; (m.get(k) || m.set(k, []).get(k)).push(c); } return m; };

// 1. duplicate titles / same-title different-summary
for (const [title, group] of by(c => c.title)) {
  if (group.length > 1) {
    const summaries = new Set(group.map(g => g.summary));
    if (summaries.size > 1)
      flag("same-title-different-summary", `"${title}" — ${group.length} cards with DIFFERENT summaries (specialties: ${group.map(g=>g.specialties.join("+")).join(" | ")}). Reconcile into one.`);
    else
      flag("duplicate-title", `"${title}" — ${group.length} identical-summary cards (ids: ${group.map(g=>g.id).join(", ")})`);
  }
}

// 2. duplicate PMID / DOI across different titles
for (const field of ["pmid", "doi"]) {
  for (const [val, group] of by(c => c[field])) {
    const titles = [...new Set(group.map(g => g.title))];
    if (titles.length > 1)
      flag(`duplicate-${field}`, `${field.toUpperCase()} ${val} shared by ${titles.length} different guidelines: ${titles.join(" | ")}`);
  }
}

// 3. missing source_url
for (const c of cards) if (!c.source_url) flag("missing-source_url", `${c.id}`);

// 4. missing last_verified
for (const c of cards) if (!c.last_verified) flag("missing-last_verified", `${c.id}`);

// 5. review_due in the past
for (const c of cards) if (c.review_due && c.review_due < TODAY) flag("review-overdue", `${c.id} (due ${c.review_due})`);

// 6. no verifiable identifier (no pmid AND no doi) — only a landing-page URL
for (const c of cards) if (!c.pmid && !c.doi) flag("no-verifiable-id", `${c.id} — only source_url, no PMID/DOI`);

// 7. paywalled but not flagged
for (const c of cards) if (/paywall/i.test(c.access_raw || "") && c.access !== "paywalled_summary_only")
  flag("paywall-unflagged", `${c.id}`);

// 8. needs_review status
for (const c of cards) if (c.status === "needs_review") flag("needs-review", `${c.id}`);

// ---- report ----
const order = ["same-title-different-summary","duplicate-title","duplicate-pmid","duplicate-doi","missing-source_url","missing-last_verified","review-overdue","no-verifiable-id","paywall-unflagged","needs-review"];
const grouped = {};
for (const f of findings) (grouped[f.kind] ||= []).push(f.msg);

console.log(`Auditing ${cards.length} cards…\n`);
let hard = 0;
for (const kind of order) {
  const msgs = grouped[kind]; if (!msgs) continue;
  const HARD = ["same-title-different-summary","duplicate-pmid","duplicate-doi","missing-source_url"].includes(kind);
  if (HARD) hard += msgs.length;
  console.log(`${HARD ? "✖" : "⚠"} ${kind} (${msgs.length})`);
  for (const m of msgs) console.log(`    ${m}`);
  console.log("");
}
console.log("═══ SUMMARY ═══");
console.log(`  cards: ${cards.length}`);
console.log(`  findings: ${findings.length}  (hard: ${hard})`);
console.log(`  no verifiable id: ${(grouped["no-verifiable-id"]||[]).length}  ·  overdue reviews: ${(grouped["review-overdue"]||[]).length}`);

if ((STRICT && findings.length) || (!STRICT && hard)) {
  console.log(`\n${(STRICT?findings.length:hard)} ${STRICT?"finding(s)":"hard finding(s)"} — review before treating the manifest as authoritative.`);
  process.exit(1);
}
console.log("\n✔ No hard structural problems.");
