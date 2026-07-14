#!/usr/bin/env node
/**
 * Chalk Talk — build guidelines_manifest.json from the audited source.
 *
 * Phase A of the guideline-card migration. This is a GENERATED, NON-LOSSY transform of
 * rag/guidelines_extracted.json (itself extracted from index.html, the runtime source of truth).
 * index.html stays authoritative until the manifest is proven; this script can be re-run any time.
 *
 * One canonical card per unique guideline NAME. Cross-specialty duplicates (PE under Cardiology+Pulmonary,
 * CAP under Pulmonary+ID, etc.) collapse into a single card with a specialties[] array — Codex's
 * "stable IDs, not duplicate text."
 *
 * Auto-derived fields are conservative; rich fields (topics, key_recommendations, practice_changers,
 * do_not_teach, caveats) are left EMPTY for hand-enrichment in Phase B. The verbatim `summary` (the
 * original `keys`) is preserved exactly so nothing the runtime relies on is lost.
 *
 * Usage: node rag/build_manifest.mjs
 */
import { readFileSync, writeFileSync } from "fs";

const LAST_VERIFIED = "2026-07-13";           // this audit
const entries = JSON.parse(readFileSync("rag/guidelines_extracted.json", "utf8"));

// ---- helpers ---------------------------------------------------------------

// First run of society-like tokens, after an optional leading 4-digit year.
// "2025 AHA/ACC Hypertension" -> ["AHA","ACC"]; "KDIGO 2025 ADPKD" -> ["KDIGO"].
// NOTE: first-society-run only — a title naming a second society later (…+ ESC 2019) is caught
// by the auditor as a caveat, not silently merged.
function societiesOf(title) {
  const t = String(title || "").replace(/^\s*(19|20)\d{2}\s+/, "");
  const m = t.match(/^([A-Z][A-Z0-9]+(?:\/[A-Z0-9]+)*)/);
  if (!m) return [];
  return m[1].split("/").filter(s => s.length >= 2);
}

function idsFromUrl(url) {
  const u = String(url || "");
  const pm = u.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{6,9})/);
  let doi = null;
  const d = u.match(/(?:\/doi\/(?:full\/|abs\/|pdf\/|epdf\/)?|doi\.org\/)(10\.\d{4,9}\/[^\s"?#]+)/i);
  if (d) doi = d[1].replace(/[).,;]+$/, "");
  return { pmid: pm ? pm[1] : null, doi };
}

const LIVING_SOC = new Set(["NCCN", "GINA", "GOLD"]);
function evidenceType(title, keys) {
  const s = `${title} ${keys}`;
  if (/position statement/i.test(title)) return "position_statement";
  if (/\bliving\b|versioned continuously|continuously updated|last updated/i.test(s)) return "living_guideline";
  const soc = societiesOf(title);
  if (soc.some(x => LIVING_SOC.has(x))) return "living_guideline";
  return "guideline";
}

function statusOf(evType, title, keys) {
  const s = `${title} ${keys}`;
  if (/\bcontested\b|did not endorse|actively disagree|DISAGREE|no longer a single consensus|no consensus/i.test(s))
    return "contested";
  if (evType === "living_guideline") return "living";
  return "current";
}

function reviewDue(evType, status) {
  const base = new Date(LAST_VERIFIED + "T00:00:00Z");
  let days = 365;                                   // stable guideline: yearly
  if (evType === "living_guideline" || status === "living") days = 90;   // living: quarterly
  else if (evType === "position_statement") days = 180;
  else if (status === "contested") days = 180;
  const due = new Date(base.getTime() + days * 86400000);
  return due.toISOString().slice(0, 10);
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
}

// ---- merge by name ---------------------------------------------------------
// Merge ONLY rows that are byte-identical on (name, year, access, url, keys) — a true cross-specialty
// duplicate. Same-name rows whose summary/metadata DIFFER stay as separate cards (the auditor flags them
// as same-title/different-text for reconciliation). This keeps the transform strictly non-lossy.
const byName = new Map();
for (const e of entries) {
  const nm = String(e.name || "").trim();
  if (!nm) continue;
  const key = JSON.stringify([nm, e.year ?? null, e.access || "", e.url || "", e.keys || ""]);
  if (!byName.has(key)) byName.set(key, { ...e, specialties: [e.specialty] });
  else {
    const c = byName.get(key);
    if (!c.specialties.includes(e.specialty)) c.specialties.push(e.specialty);
  }
}

// ---- build cards -----------------------------------------------------------
const usedIds = new Set();
const cards = [];
for (const e of byName.values()) {
  const evidence_type = evidenceType(e.name, e.keys);
  const status = statusOf(evidence_type, e.name, e.keys);
  const { pmid, doi } = idsFromUrl(e.url);

  let id = slug(e.name);
  if (e.year && !id.includes(String(e.year))) id += `-${e.year}`;
  let uid = id, n = 2;
  while (usedIds.has(uid)) uid = `${id}-${n++}`;
  usedIds.add(uid);

  const accessRaw = e.access || "";
  const access = /paywall/i.test(accessRaw) ? "paywalled_summary_only"
              : /open|cc /i.test(accessRaw) ? "open" : (accessRaw || "unknown");

  cards.push({
    id: uid,
    title: e.name,
    societies: societiesOf(e.name),
    year: e.year ?? null,
    status,                                   // current | living | superseded | contested | needs_review
    evidence_type,                            // guideline | living_guideline | position_statement | fda_approval | landmark_trial | society_consensus
    specialties: e.specialties,
    topics: [],                               // hand-enrich (Phase B)
    source_url: e.url || null,
    pmid: pmid || null,
    doi: doi || null,
    access,
    access_raw: accessRaw,                    // preserved verbatim for non-lossy round-trip
    summary: e.keys || "",                    // VERBATIM original `keys` — runtime grounding, do not edit here
    key_recommendations: [],                  // hand-enrich (Phase B/C)
    practice_changers: [],                    // hand-enrich (Phase B)
    do_not_teach: [],                         // hand-enrich (Phase B) — the negative-knowledge guardrail
    landmark_trials: [],
    supersedes: [],
    caveats: [],
    last_verified: LAST_VERIFIED,
    review_due: reviewDue(evidence_type, status),
  });
}

cards.sort((a, b) => a.title.localeCompare(b.title));

const manifest = {
  schema_version: 1,
  generated: LAST_VERIFIED,
  runtime_source: "index.html (var GUIDELINES) — authoritative; this manifest is a generated derivative for Phase A",
  count: cards.length,
  cards,
};
writeFileSync("rag/guidelines_manifest.json", JSON.stringify(manifest, null, 2));
console.log(`Built ${cards.length} canonical cards from ${entries.length} source rows.`);
const merged = entries.length - cards.length;
console.log(`Merged ${merged} cross-specialty duplicate row(s) into shared cards.`);
const byType = {};
for (const c of cards) byType[c.evidence_type] = (byType[c.evidence_type]||0)+1;
const byStatus = {};
for (const c of cards) byStatus[c.status] = (byStatus[c.status]||0)+1;
console.log("evidence_type:", byType);
console.log("status:", byStatus);
console.log("-> rag/guidelines_manifest.json");
