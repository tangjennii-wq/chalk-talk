#!/usr/bin/env node
/**
 * LANDMARK TRIAL PMID VALIDATOR — makes "trial chip = actual trial" checkable.
 *
 * WHY THIS EXISTS
 * Landmark trials were originally resolved by PubMed *relevance search*, which silently picked the
 * wrong paper again and again (ALCYONE->GRIFFIN, SPRINT->a Mayo isometric-exercise review, HOPE->an
 * editorial, ADVANCE held ACCORD's PMID, ...). Relevance ranking does not know which paper IS the
 * trial. Only an explicit, verified PMID does.
 *
 * WHAT IT CHECKS, per entry in rag/landmark_trials.json:
 *   1. expected_pmid present + resolves                                   -> else SUSPECT
 *   2. publication year within +/-2 of the recorded trial year           -> else MISMATCH
 *   3. pubtypes trial-ish (or entry marked manual_2026-07)                -> else MISMATCH
 *   4. not a design/protocol/statistical-analysis-plan paper             -> else MISMATCH
 *   5. the returned TITLE actually confirms this trial (Codex 2026-07-24) -> else weak/wrong (below)
 *
 * TITLE CONFIRMATION & PROMOTION (Codex follow-up 2026-07-24)
 * Objective checks (2-4) do not prove the PMID is THIS trial — a different RCT from the same year can
 * pass. So titleMatch() also compares the returned article title to the recorded trial. Because a
 * strict title gate false-flagged ~139 hand-audited legacy entries (whose `full` is the trial's
 * expanded NAME, not the article title), title severity is applied by verification state:
 *   - NOT-yet-verified entry (websearch/none): title must be STRONG to auto-verify. A weak/wrong title
 *     -> SUSPECT and the PMID is NOT promoted until a human confirms it.
 *   - ALREADY-verified entry (pubmed/manual/europepmc): never downgraded. A weak/wrong title is only
 *     surfaced as a non-blocking ADVISORY for optional review.
 *
 * FALLBACK when PubMed can't answer — trust order (Codex 2026-07-24):
 *   1. PubMed direct                              -> pmid_verified:"pubmed_2026-07"
 *   2. Europe PMC + Crossref FULL agreement       -> pmid_verified:"europepmc_2026-07"
 *   3. Unresolved                                 -> SUSPECT / UNREACHABLE -> manual review
 * Level-2 requires genuine agreement: Europe PMC resolves the exact PMID, its year/pubtype/title
 * confirm the trial, AND Crossref independently supplies title+journal+year that ALL agree with the
 * Europe PMC record. Europe PMC alone, a missing DOI, a missing Crossref field, or an unreachable
 * Crossref is NOT verified. A reachable PubMed MISMATCH is never overridden by the mirrors.
 *
 * WRITE SAFETY (Codex 2026-07-24)
 * The validator computes every status BEFORE touching the manifest and never partial-writes. With
 * --write: if ANY blocking problem exists (MISMATCH/SUSPECT/UNREACHABLE), the manifest is left
 * untouched; promotions are applied only on a fully-clean run. A durable JSON report of every problem
 * + advisory is ALWAYS written to rag/landmark_validation_report.json, regardless of --write.
 *
 * USAGE
 *   node rag/validate_landmark_pmids.mjs            # report only (writes the JSON report)
 *   node rag/validate_landmark_pmids.mjs --write    # + promote verified status IF the run is clean
 *   node rag/validate_landmark_pmids.mjs --no-fallback   # PubMed only (skip Europe PMC/Crossref)
 *   NCBI_API_KEY=... node rag/validate_landmark_pmids.mjs   # ~3x faster
 *
 * EXIT: 0 = all verified · 1 = blocking problems (SUSPECT/MISMATCH) · 2 = inconclusive (UNREACHABLE)
 */
import { readFileSync, writeFileSync } from "fs";
import { titleSeverity, objectiveProblems, crossrefAgrees } from "./validator_lib.mjs";

const WRITE = process.argv.includes("--write");
const NO_FALLBACK = process.argv.includes("--no-fallback");
const NCBI_KEY = process.env.NCBI_API_KEY || "";
const CONTACT = process.env.CROSSREF_MAILTO || "tangjennii@gmail.com"; // polite-pool contact
const REPORT_PATH = "rag/landmark_validation_report.json";
const MANIFEST_PATH = "rag/landmark_trials.json";
const VERIFIED_OK = ["pubmed_2026-07", "manual_2026-07", "europepmc_2026-07"];

const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const trials = Array.isArray(raw) ? raw : Object.values(raw)[0];

// ── PubMed E-utilities ────────────────────────────────────────────────────────
const GAP = NCBI_KEY ? 110 : 350;
let next = 0;
async function throttle() {
  const now = Date.now(), wait = Math.max(0, next - now);
  next = Math.max(now, next) + GAP;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}
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
    return {
      ok: true,
      year: parseInt(String(rec.pubdate || "").slice(0, 4), 10) || null,
      title: String(rec.title || "").replace(/\.\s*$/, ""),
      journal: rec.fulljournalname || rec.source || "",
      pubtypes: rec.pubtype || [],
    };
  } catch (e) { return { transient: true, error: e.message }; }
}

// ── FALLBACK MIRRORS (Europe PMC + Crossref) — only when PubMed gave no authoritative answer ──
let epmcNext = 0;
async function epmcThrottle() {
  const now = Date.now(), wait = Math.max(0, epmcNext - now);
  epmcNext = Math.max(now, epmcNext) + 250;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}
// Look the STORED PMID up by exact id (not a title search) in Europe PMC's MEDLINE mirror.
async function epmcByPmid(pmid, attempt = 0) {
  await epmcThrottle();
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=`
            + encodeURIComponent(`EXT_ID:${pmid} AND SRC:MED`) + `&format=json&resultType=core&email=${encodeURIComponent(CONTACT)}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": `chalk-talk-validator (${CONTACT})` } });
    if (r.status === 429 || r.status >= 500) {
      if (attempt < 3) { await new Promise((res) => setTimeout(res, 800 * 2 ** attempt)); return epmcByPmid(pmid, attempt + 1); }
      return { transient: true, error: `europepmc ${r.status}` };
    }
    if (!r.ok) return { transient: true, error: `europepmc ${r.status}` };
    const j = await r.json();
    const rec = j?.resultList?.result?.find((x) => String(x.pmid) === String(pmid)) || j?.resultList?.result?.[0];
    if (!rec || String(rec.pmid) !== String(pmid)) return { ok: false, error: "PMID not found in Europe PMC" };
    return {
      ok: true,
      year: parseInt(String(rec.pubYear || "").slice(0, 4), 10) || null,
      title: String(rec.title || "").replace(/\.\s*$/, ""),
      journal: rec.journalInfo?.journal?.title || rec.journalTitle || "",
      doi: rec.doi || null,
      pubtypes: (rec.pubTypeList?.pubType || []).map(String),
    };
  } catch (e) { return { transient: true, error: e.message }; }
}
async function crossrefByDoi(doi, attempt = 0) {
  if (!doi) return { ok: false, error: "no DOI to cross-check" };
  await epmcThrottle();
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(CONTACT)}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": `chalk-talk-validator (mailto:${CONTACT})` } });
    if (r.status === 429 || r.status >= 500) {
      if (attempt < 3) { await new Promise((res) => setTimeout(res, 800 * 2 ** attempt)); return crossrefByDoi(doi, attempt + 1); }
      return { transient: true, error: `crossref ${r.status}` };
    }
    if (r.status === 404) return { ok: false, error: "DOI not in Crossref" };
    if (!r.ok) return { transient: true, error: `crossref ${r.status}` };
    const m = (await r.json())?.message;
    if (!m) return { ok: false, error: "empty Crossref record" };
    const y = m.issued?.["date-parts"]?.[0]?.[0] || m["published-print"]?.["date-parts"]?.[0]?.[0]
            || m["published-online"]?.["date-parts"]?.[0]?.[0] || null;
    return { ok: true, year: y ? parseInt(y, 10) : null, journal: (m["container-title"] || [])[0] || "", title: (m.title || [])[0] || "" };
  } catch (e) { return { transient: true, error: e.message }; }
}

// Trust level 2: resolve ONLY on genuine Europe PMC + Crossref agreement (title+journal+year).
//   contradicted -> real problem (MISMATCH)   inconclusive -> transport, keep PubMed's verdict
async function fallbackVerify(t) {
  const e = await epmcByPmid(String(t.expected_pmid));
  if (e.transient) return { category: "inconclusive", note: `Europe PMC ${e.error} (transport)` };
  if (!e.ok)       return { category: "contradicted", reasons: [e.error], note: e.error };

  const contra = [];   // active disagreements -> MISMATCH
  const block  = [];   // could-not-confirm (transport) -> inconclusive
  for (const p of objectiveProblems(t, e)) contra.push(`EuropePMC: ${p}`);
  const ts = titleSeverity(t, e);
  if (ts.sev !== "strong")
    contra.push(`EuropePMC title does not confirm the trial (overlap ${ts.score.toFixed(2)}, acronym ${ts.acronymHit ? "found" : "absent"})`);

  let crNote = "";
  if (!e.doi) {
    contra.push("Europe PMC record carries no DOI — Crossref cannot corroborate");
  } else {
    const cr = await crossrefByDoi(e.doi);
    if (cr.transient) block.push(`Crossref ${cr.error} (could not corroborate)`);
    else {
      const ag = crossrefAgrees(e, cr);
      if (!ag.agree) for (const rn of ag.reasons) contra.push(`Crossref: ${rn}`);
      else crNote = `Crossref confirms DOI ${e.doi} (${cr.journal}, ${cr.year})`;
    }
  }

  const category = contra.length ? "contradicted" : (block.length ? "inconclusive" : "resolved");
  return {
    category, reasons: contra, blockers: block,
    title: e.title, journal: e.journal, year: e.year, doi: e.doi,
    note: category === "resolved" ? `Europe PMC + Crossref agreement — ${crNote}`
        : category === "contradicted" ? contra.join(" | ") : block.join(" | "),
  };
}

// ── COMPUTE PASS (no mutation of the manifest happens here) ────────────────────
let fallbackResolved = 0;
const promotions = [];   // { trial, status } — applied only on a clean --write run
const results = [];
for (const t of trials) {
  const r = { name: t.name, expected_pmid: t.expected_pmid, recorded_year: t.year, specialty: t.specialty,
              current: t.pmid_verified || null, status: null, reasons: [], title: null, journal: null, pubyear: null };
  const alreadyVerified = VERIFIED_OK.includes(t.pmid_verified);

  if (!t.expected_pmid) { r.status = "SUSPECT"; r.reasons = ["no expected_pmid recorded"]; results.push(r); results.length && process.stdout.write(`\r  checked ${results.length}/${trials.length}`); continue; }

  const pm = await esummary(String(t.expected_pmid));

  if (pm.transient || !pm.ok) {
    const pubmedNote = pm.transient ? `${pm.error} (transport, NOT a bad PMID)` : pm.error;
    if (!NO_FALLBACK) {
      const fb = await fallbackVerify(t);
      r.title = fb.title || null; r.journal = fb.journal || null; r.pubyear = fb.year || null;
      if (fb.category === "resolved") {
        fallbackResolved++; r.status = "OK"; r.via = "europepmc"; r.note = fb.note;
        if (!alreadyVerified) promotions.push({ trial: t, status: "europepmc_2026-07" });
        results.push(r); process.stdout.write(`\r  checked ${results.length}/${trials.length}`); continue;
      }
      if (fb.category === "contradicted") {
        r.status = "MISMATCH"; r.reasons = [`PubMed: ${pubmedNote}`, ...(fb.reasons || [fb.note])];
        results.push(r); process.stdout.write(`\r  checked ${results.length}/${trials.length}`); continue;
      }
      r.status = pm.transient ? "UNREACHABLE" : "SUSPECT";
      r.reasons = [`${pubmedNote} — fallback could not confirm: ${fb.note}`];
      results.push(r); process.stdout.write(`\r  checked ${results.length}/${trials.length}`); continue;
    }
    r.status = pm.transient ? "UNREACHABLE" : "SUSPECT"; r.reasons = [pubmedNote];
    results.push(r); process.stdout.write(`\r  checked ${results.length}/${trials.length}`); continue;
  }

  // PubMed direct
  r.title = pm.title; r.journal = pm.journal; r.pubyear = pm.year;
  const obj = objectiveProblems(t, pm);
  const ts = titleSeverity(t, pm);
  r.titleScore = +ts.score.toFixed(2); r.titleSev = ts.sev; r.acronymHit = ts.acronymHit;

  if (obj.length) {
    r.status = "MISMATCH"; r.reasons = obj;
  } else if (!alreadyVerified && ts.sev !== "strong") {
    // objective checks pass, but the title does not confirm THIS trial and the entry isn't yet
    // verified -> hold it as SUSPECT; do not promote until a human confirms the PMID.
    r.status = "SUSPECT";
    r.reasons = [`title ${ts.sev} match (overlap ${ts.score.toFixed(2)}, acronym ${ts.acronymHit ? "found" : "absent"}) — PMID not confirmed as this trial; NOT auto-verified`];
  } else {
    r.status = "OK";
    if (!alreadyVerified) promotions.push({ trial: t, status: "pubmed_2026-07" });
    if (alreadyVerified && ts.sev !== "strong")
      r.advisory = `already ${t.pmid_verified}, but title ${ts.sev} match (overlap ${ts.score.toFixed(2)}, acronym ${ts.acronymHit ? "found" : "absent"}) — optional review; not downgraded`;
  }
  results.push(r);
  process.stdout.write(`\r  checked ${results.length}/${trials.length}`);
}
console.log("\n");

// ── REPORT ────────────────────────────────────────────────────────────────────
const by = (s) => results.filter((r) => r.status === s);
const advisories = results.filter((r) => r.status === "OK" && r.advisory);

for (const s of ["MISMATCH", "SUSPECT", "UNREACHABLE"]) {
  const rows = by(s);
  if (!rows.length) continue;
  console.log(`═══ ${s} (${rows.length}) ═══`);
  for (const r of rows) {
    console.log(`  ${r.name}  [pmid ${r.expected_pmid || "—"}]`);
    for (const reason of r.reasons) console.log(`      ${reason}`);
    if (r.title) console.log(`      stored paper: "${r.title.slice(0, 90)}" (${r.journal}, ${r.pubyear})`);
  }
  console.log("");
}
if (advisories.length) {
  console.log(`═══ TITLE ADVISORY — already verified, weak title, non-blocking (${advisories.length}) ═══`);
  for (const r of advisories) {
    console.log(`  ${r.name}  [pmid ${r.expected_pmid}]  ${r.advisory}`);
    if (r.title) console.log(`      stored paper: "${r.title.slice(0, 90)}" (${r.journal}, ${r.pubyear})`);
  }
  console.log("");
}

const blocking  = by("SUSPECT").length + by("MISMATCH").length;
const unreached = by("UNREACHABLE").length;

// durable JSON report — ALWAYS written, regardless of --write
const report = {
  generated_at: new Date().toISOString(),
  manifest: MANIFEST_PATH,
  totals: {
    total: results.length, ok: by("OK").length, mismatch: by("MISMATCH").length,
    suspect: by("SUSPECT").length, unreachable: unreached,
    fallback_verified: fallbackResolved, advisories: advisories.length, promotable: promotions.length,
  },
  problems: results.filter((r) => r.status !== "OK").map((r) => ({
    name: r.name, pmid: r.expected_pmid, status: r.status, recorded_year: r.recorded_year,
    specialty: r.specialty, current: r.current, reasons: r.reasons,
    stored_paper: r.title ? { title: r.title, journal: r.journal, year: r.pubyear } : null,
  })),
  advisories: advisories.map((r) => ({
    name: r.name, pmid: r.expected_pmid, current: r.current, note: r.advisory,
    stored_paper: { title: r.title, journal: r.journal, year: r.pubyear },
  })),
};
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

const okDirect = by("OK").filter((r) => r.via !== "europepmc").length;
console.log("═══ SUMMARY ═══");
console.log(`  OK:          ${by("OK").length}  (${okDirect} PubMed direct${fallbackResolved ? `, ${fallbackResolved} via Europe PMC + Crossref` : ""})`);
console.log(`  MISMATCH:    ${by("MISMATCH").length}`);
console.log(`  SUSPECT:     ${by("SUSPECT").length}`);
console.log(`  UNREACHABLE: ${unreached}  (transport, not citation problems)`);
console.log(`  advisory:    ${advisories.length}  (already-verified, weak title — non-blocking)`);
console.log(`  promotable:  ${promotions.length}  (unverified entries that passed cleanly)`);
console.log(`\n-> durable report written: ${REPORT_PATH}`);

// ── WRITE SAFETY: promote only on a fully-clean run; never partial-write ────────
if (WRITE) {
  if (blocking || unreached) {
    console.log(`\n✖ ${blocking + unreached} blocking problem(s) — manifest NOT modified (no partial writes).`);
    console.log(`  Resolve the entries in ${REPORT_PATH}, then re-run with --write.`);
  } else {
    for (const p of promotions) p.trial.pmid_verified = p.status;
    writeFileSync(MANIFEST_PATH, JSON.stringify(raw, null, 2) + "\n");
    console.log(`\n-> clean run: promoted ${promotions.length} entr${promotions.length === 1 ? "y" : "ies"}; wrote ${MANIFEST_PATH}`);
  }
}

// ── EXIT SEMANTICS: 0 verified · 1 blocking problems · 2 inconclusive ──────────
if (blocking) {
  console.log(`\n✖ ${blocking} problem(s). Every trial chip must point at the canonical primary trial paper.`);
  if (unreached) console.log(`  (also ${unreached} unreachable — this run is ALSO incomplete)`);
  process.exit(1);
}
if (unreached) {
  console.log(`\n⚠ INCONCLUSIVE — ${unreached}/${results.length} entries could not be reached. Verified NOTHING about those.`);
  console.log("  Re-run with network access; set NCBI_API_KEY to reduce rate-limiting.");
  process.exit(2);
}
console.log(`\n✔ All ${results.length} landmark trials resolve to a verified primary-results paper.`);
