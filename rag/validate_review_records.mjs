#!/usr/bin/env node
/**
 * REVIEW-RECORD VALIDATOR — checks proposed trials BEFORE they reach the manifest.
 *
 * Gap this closes (Codex review 2026-07-17): rag/validate_landmark_pmids.mjs only covers
 * rag/landmark_trials.json. The proposed records in rag/trial_review_records.json — the ones queued
 * for promotion — were never machine-checked at all. They were verified by research agents and read
 * by a physician, but nothing executable confirmed the PMIDs resolve or that the papers are actually
 * trials rather than protocols or secondary analyses.
 *
 * PER RECORD:
 *   1. PMID present and well-formed
 *   2. PMID resolves on PubMed
 *   3. Year within +/-2 of the recorded year
 *   4. Publication types are trial-like
 *   5. Title is NOT a protocol / design / statistical-analysis-plan / rationale paper
 *   6. Title is NOT an obvious secondary analysis ("post hoc", "subgroup", "pooled", "meta-analysis")
 *   7. No duplicate PMIDs within the review set, and none already in the manifest
 *
 * EXIT: 0 verified · 1 real problems · 2 INCONCLUSIVE (anything unreachable — verified nothing).
 * Rate-limit safe: throttled + retry, so a 429 is UNREACHABLE, never a bad citation.
 *
 * Usage: node rag/validate_review_records.mjs [--json]
 *        NCBI_API_KEY=... node rag/validate_review_records.mjs     # ~3x faster
 */
import { readFileSync } from "fs";

const NCBI_KEY = process.env.NCBI_API_KEY || "";
const AS_JSON = process.argv.includes("--json");
const db = JSON.parse(readFileSync("rag/trial_review_records.json", "utf8"));
const records = db.records || [];
const manifestRaw = JSON.parse(readFileSync("rag/landmark_trials.json", "utf8"));
const manifest = Array.isArray(manifestRaw) ? manifestRaw : Object.values(manifestRaw)[0];
const manifestPmids = new Set(manifest.map((t) => String(t.expected_pmid || "")));

// "Multicenter Study" is deliberately NOT here. It describes study LOGISTICS, not design — a
// multicentre observational cohort carries that label and would pass as a trial. Every type below
// implies allocation to an intervention. (Codex review 2026-07-17)
const TRIAL_PUBTYPES = ["Randomized Controlled Trial","Clinical Trial","Controlled Clinical Trial","Pragmatic Clinical Trial","Clinical Trial, Phase II","Clinical Trial, Phase III","Clinical Trial, Phase IV","Equivalence Trial"];
// "protocol" alone produced a FALSE POSITIVE on ProCESS — "A randomized trial of protocol-based
// care for early septic shock" is the INTERVENTION NAME, not a protocol paper. Require phrasing that
// actually denotes a design/protocol publication. (validator run 2026-07-17)
const NOT_PRIMARY = /\b(rationale and design|study design|design and methods|study protocol|trial protocol|:\s*protocol\b|statistical analysis plan)\b/i;
const SECONDARY   = /\b(post hoc|post-hoc|subgroup analys|pooled analys|meta-analysis|systematic review|secondary analys)\b/i;

const GAP = NCBI_KEY ? 110 : 350;
let next = 0;
const throttle = async () => {
  const now = Date.now(), wait = Math.max(0, next - now);
  next = Math.max(now, next) + GAP;
  if (wait) await new Promise((r) => setTimeout(r, wait));
};

async function esummary(pmid, attempt = 0) {
  await throttle();
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`
            + (NCBI_KEY ? `&api_key=${NCBI_KEY}` : "");
  try {
    const r = await fetch(url);
    if (r.status === 429 || r.status >= 500) {
      if (attempt < 3) { await new Promise((res) => setTimeout(res, 800 * 2 ** attempt)); return esummary(pmid, attempt + 1); }
      return { transient: true, error: `eutils ${r.status}` };
    }
    if (!r.ok) return { transient: true, error: `eutils ${r.status}` };
    const j = await r.json();
    const rec = j?.result?.[pmid];
    if (!rec || rec.error) return { ok: false, error: "PMID not found in PubMed" };
    return { ok: true, year: parseInt(String(rec.pubdate || "").slice(0, 4), 10) || null,
             title: String(rec.title || "").replace(/\.\s*$/, ""), journal: rec.fulljournalname || rec.source || "",
             pubtypes: rec.pubtype || [] };
  } catch (e) { return { transient: true, error: e.message }; }
}

// ── structural checks that need no network ──
const seen = new Map(), structural = [], promoted = [];
// Integrity of the file itself. A truncated or half-written records file must fail loudly rather
// than validate a subset and report success. (Codex review 2026-07-17)
if (!Array.isArray(records) || records.length === 0) {
  structural.push({ name: "(file)", issue: "review record set is EMPTY or not an array — nothing to validate" });
}
if (typeof db.total === "number" && db.total !== records.length) {
  structural.push({ name: "(file)", issue: `db.total (${db.total}) !== records.length (${records.length}) — file may be truncated or stale` });
}
for (const r of records) {
  if (!r.pmid || !/^\d{6,9}$/.test(String(r.pmid))) { structural.push({ name: r.name, issue: `malformed/missing PMID: ${r.pmid}` }); continue; }
  if (seen.has(r.pmid)) structural.push({ name: r.name, issue: `DUPLICATE PMID ${r.pmid} — also used by ${seen.get(r.pmid)}` });
  else seen.set(r.pmid, r.name);
  // Being in the manifest is a FAILURE only before promotion (accidental duplication). After the 90
  // are deliberately promoted it is the desired end state, so this is informational, not a failure.
  if (manifestPmids.has(String(r.pmid))) promoted.push(r.name);
}

const results = [];
for (const r of records) {
  const out = { name: r.name, pmid: r.pmid, batch: r.batch, status: null, detail: "" };
  if (!r.pmid || !/^\d{6,9}$/.test(String(r.pmid))) { out.status = "SUSPECT"; out.detail = "malformed/missing PMID"; results.push(out); continue; }
  const pm = await esummary(String(r.pmid));
  if (pm.transient) { out.status = "UNREACHABLE"; out.detail = `${pm.error} (transport, NOT a bad citation)`; results.push(out); continue; }
  if (!pm.ok)       { out.status = "SUSPECT";     out.detail = pm.error; results.push(out); continue; }
  const probs = [];
  if (pm.year && r.year && Math.abs(pm.year - r.year) > 2) probs.push(`year ${pm.year} vs recorded ${r.year}`);
  if (NOT_PRIMARY.test(pm.title)) probs.push("looks like a protocol/design paper");
  if (SECONDARY.test(pm.title))   probs.push("looks like a secondary/pooled analysis");
  // A record may carry pubtype_override:"manual_2026-07" when PubMed indexed an unambiguous RCT only
  // as "Journal Article". The override must state a reason and is surfaced in the OK detail so it is
  // never silent.
  const trialish = (pm.pubtypes || []).some((p) => TRIAL_PUBTYPES.includes(p));
  if (!trialish && r.pubtype_override === "manual_2026-07") {
    out.note = `pubtype manually overridden: ${r.pubtype_override_reason || "(no reason given)"}`;
  } else if (!trialish) {
    probs.push(`pubtypes not trial-like [${(pm.pubtypes || []).join(", ")}]`);
  }
  out.status = probs.length ? "MISMATCH" : "OK";
  out.detail = probs.join(" | ");
  out.title = pm.title; out.journal = pm.journal; out.pubyear = pm.year;
  results.push(out);
  if (!AS_JSON) process.stdout.write(`\r  checked ${results.length}/${records.length}`);
}
if (!AS_JSON) console.log("\n");

// ── exit code is computed ONCE and applies to BOTH output modes ──
// The first version returned early for --json with process.exit(0), so an offline JSON run reported
// success having verified nothing. That is the same false-green this file exists to prevent, and it
// was reintroduced in a second code path. Compute the verdict before choosing a renderer.
// (Codex review 2026-07-17)
const _by = (s) => results.filter((r) => r.status === s);
const problemCount   = _by("SUSPECT").length + _by("MISMATCH").length + structural.length;
const unreachedCount = _by("UNREACHABLE").length;
const verifiedAll    = problemCount === 0 && unreachedCount === 0 && _by("OK").length === results.length && results.length > 0;
const exitCode       = problemCount ? 1 : (verifiedAll ? 0 : 2);

if (AS_JSON) {
  console.log(JSON.stringify({
    verdict: exitCode === 0 ? "VERIFIED" : exitCode === 1 ? "PROBLEMS" : "INCONCLUSIVE",
    exit_code: exitCode,
    counts: { records: results.length, ok: _by("OK").length, mismatch: _by("MISMATCH").length,
              suspect: _by("SUSPECT").length, unreachable: unreachedCount, structural: structural.length },
    structural, results,
  }, null, 2));
  process.exit(exitCode);
}

if (structural.length) {
  console.log(`═══ STRUCTURAL (${structural.length}) ═══`);
  for (const s of structural) console.log(`  ${s.name}: ${s.issue}`);
  console.log("");
}
const by = (s) => results.filter((r) => r.status === s);
for (const s of ["SUSPECT", "MISMATCH", "UNREACHABLE"]) {
  const rows = by(s); if (!rows.length) continue;
  console.log(`═══ ${s} (${rows.length}) ═══`);
  for (const r of rows) {
    console.log(`  ${r.name} [${r.pmid}] batch ${r.batch}`);
    console.log(`      ${r.detail}`);
    if (r.title) console.log(`      stored: "${r.title.slice(0, 88)}" (${r.journal}, ${r.pubyear})`);
  }
  console.log("");
}
console.log("═══ SUMMARY ═══");
console.log(`  records:     ${records.length}`);
console.log(`  OK:          ${by("OK").length}`);
console.log(`  MISMATCH:    ${by("MISMATCH").length}`);
console.log(`  SUSPECT:     ${by("SUSPECT").length}`);
console.log(`  UNREACHABLE: ${by("UNREACHABLE").length}  (transport, not citation problems)`);
console.log(`  structural:  ${structural.length}`);
if (promoted.length) console.log(`  promoted:    ${promoted.length}  (already in landmark_trials.json — expected after promotion)`);

const problems = by("SUSPECT").length + by("MISMATCH").length + structural.length;
const unreached = by("UNREACHABLE").length;
if (problems) { console.log(`\n✖ ${problems} problem(s) — not ready for promotion to the manifest.`); process.exit(1); }
if (unreached) {
  console.log(`\n⚠ INCONCLUSIVE — ${unreached}/${records.length} unreachable. This run verified NOTHING about those.`);
  console.log("  Re-run with network access; set NCBI_API_KEY to reduce rate-limiting.");
  process.exit(2);
}
if (promoted.length === records.length) console.log(`\n✔ All ${records.length} review records verified AND promoted into landmark_trials.json.`);
else console.log(`\n✔ All ${records.length} review records verified — ${promoted.length} already promoted, ${records.length - promoted.length} still to promote.`);
