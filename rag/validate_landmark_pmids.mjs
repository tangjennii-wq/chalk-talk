#!/usr/bin/env node
/**
 * LANDMARK TRIAL PMID VALIDATOR — makes "trial chip = actual trial" checkable.
 *
 * WHY THIS EXISTS
 * Landmark trials were originally resolved by PubMed *relevance search*, which silently picked the
 * wrong paper again and again. A July 2026 audit found the stored paper was wrong for a large share
 * of trials, in every flavour:
 *   - a DIFFERENT trial       (ALCYONE -> GRIFFIN; ASTRAL-1 -> POLARIS; KEYNOTE-024 -> KEYNOTE-189;
 *                              MR CLEAN -> ASTER; SPRINT -> a Mayo isometric-exercise review)
 *   - a pooled analysis       (FIGARO-DKD -> the FIDELITY pooled analysis)
 *   - a design/rationale paper(RE-LY, ARISTOTLE, ACCORD, SOLVD)
 *   - a superseded phase      (TESTING -> the 2017 halted-early report, not the 2022 definitive one)
 *   - an editorial            (HOPE)
 *   - a statistical analysis plan (LOVIT)
 *   - another trial's PMID    (ADVANCE held ACCORD's PMID)
 * Relevance ranking does not know which paper IS the trial. Only an explicit, verified PMID does.
 *
 * WHAT IT CHECKS, per entry in rag/landmark_trials.json:
 *   1. expected_pmid present               -> else SUSPECT
 *   2. PMID resolves on PubMed             -> else SUSPECT
 *   3. publication year within +/-2 of the recorded trial year
 *   4. pubtypes are trial-ish, OR the entry is explicitly marked manual_2026-07
 *   5. title is not a design/protocol/statistical-analysis-plan paper
 *
 * Rate-limit safe: throttled to NCBI's documented limit and retries 429/5xx, because a transport
 * failure must never be reported as a bad citation (the same mistake validate_guidelines.mjs made).
 *
 * FALLBACK when PubMed can't answer (Jenni + Codex 2026-07-24)
 * PubMed's site/E-utilities is sometimes blocked or rate-limited (captcha-walled for sandboxed
 * agents; 429 storms locally). A PMID that PubMed could not reach used to land in UNREACHABLE and
 * verify nothing. We now fall back — but only where PubMed gave NO authoritative answer (UNREACHABLE,
 * or PMID-not-found) — to two independent, non-NCBI, non-captcha mirrors:
 *   - Europe PMC (EMBL-EBI full MEDLINE mirror, JSON REST) — looks the PMID up by EXT_ID and returns
 *     that record's title / journal / year / DOI / pubtypes.
 *   - Crossref (DOI registry) — confirms that DOI's journal + year independently, guarding against a
 *     wrong-but-similar record.
 * Trust order is strict (Codex 2026-07-24):
 *   1. PubMed direct                         -> pmid_verified:"pubmed_2026-07"
 *   2. Europe PMC + Crossref AGREE            -> pmid_verified:"europepmc_2026-07"  (distinct + auditable)
 *   3. Unresolved                            -> SUSPECT / UNREACHABLE -> manual review
 * A reachable PubMed MISMATCH is NEVER overridden by the mirrors — PubMed stays the authority; the
 * mirrors only fill gaps. Europe PMC verifies the STORED PMID by exact id (not a title search), so it
 * cannot silently swap in a similarly-titled paper; Crossref agreement is the extra guard.
 *
 * USAGE
 *   node rag/validate_landmark_pmids.mjs            # report
 *   node rag/validate_landmark_pmids.mjs --write    # also write verified status back to the JSON
 *   node rag/validate_landmark_pmids.mjs --no-fallback   # PubMed only (skip Europe PMC/Crossref)
 *   NCBI_API_KEY=... node rag/validate_landmark_pmids.mjs   # ~3x faster
 *
 * Exit 1 on any SUSPECT or MISMATCH, so it can gate a release.
 */
import { readFileSync, writeFileSync } from "fs";

const WRITE = process.argv.includes("--write");
const NO_FALLBACK = process.argv.includes("--no-fallback");
const NCBI_KEY = process.env.NCBI_API_KEY || "";
const CONTACT = process.env.CROSSREF_MAILTO || "tangjennii@gmail.com"; // polite-pool contact for Crossref/Europe PMC
const raw = JSON.parse(readFileSync("rag/landmark_trials.json", "utf8"));
const trials = Array.isArray(raw) ? raw : Object.values(raw)[0];

// MUST stay identical to the list in validate_review_records.mjs — a trial that passes review
// validation must also pass manifest validation. Divergence flagged BALANCE (Equivalence Trial) as a
// mismatch after it had passed review 90/90. "Equivalence Trial" and "Phase IV" are legitimate
// randomized-trial pubtypes; "Multicenter Study" is deliberately excluded (logistics, not design).
// (validator run 2026-07-17)
const TRIAL_PUBTYPES = ["Randomized Controlled Trial","Clinical Trial","Controlled Clinical Trial","Pragmatic Clinical Trial","Clinical Trial, Phase II","Clinical Trial, Phase III","Clinical Trial, Phase IV","Equivalence Trial"];
const NOT_PRIMARY_RE = /\b(rationale and design|study design|design and methods|study protocol|trial protocol|:\s*protocol\b|statistical analysis plan)\b/i;
const VERIFIED_OK = ["pubmed_2026-07", "manual_2026-07", "europepmc_2026-07"];

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

// ── FALLBACK MIRRORS (Europe PMC + Crossref) ──────────────────────────────────
// Only consulted when PubMed gave no authoritative answer. Both are throttled and fail OPEN: a
// transport error here leaves the entry exactly where PubMed put it (never invents a pass).
let epmcNext = 0;
async function epmcThrottle() {
  const now = Date.now(), wait = Math.max(0, epmcNext - now);
  epmcNext = Math.max(now, epmcNext) + 250;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

// Look the STORED PMID up by exact id in Europe PMC's MEDLINE mirror (not a title search — so it
// cannot substitute a similarly-titled paper). Returns that record's canonical metadata + DOI.
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
    const pubtypes = (rec.pubTypeList?.pubType || []).map(String);
    return {
      ok: true,
      year: parseInt(String(rec.pubYear || "").slice(0, 4), 10) || null,
      title: String(rec.title || "").replace(/\.\s*$/, ""),
      journal: rec.journalInfo?.journal?.title || rec.journalTitle || "",
      doi: rec.doi || null,
      pubtypes,
    };
  } catch (e) { return { transient: true, error: e.message }; }
}

// Independent DOI check: confirm the DOI's journal + year in Crossref's registry.
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

// Trust level 2: Europe PMC finds the stored PMID AND (Crossref agrees on year, OR the DOI is absent
// but Europe PMC's own year/pubtypes already satisfy the trial checks). Returns a resolution object
// or null (=> keep whatever PubMed decided). Never overrides a reachable PubMed MISMATCH; the caller
// only invokes this for UNREACHABLE / PMID-not-found.
async function fallbackVerify(t) {
  const e = await epmcByPmid(String(t.expected_pmid));
  if (e.transient) return { resolved: false, note: `Europe PMC ${e.error} (transport)`, transient: true };
  if (!e.ok)       return { resolved: false, note: e.error };

  const probs = [];
  if (e.year && t.year && Math.abs(e.year - t.year) > 2) probs.push(`EuropePMC year ${e.year} vs recorded ${t.year}`);
  if (NOT_PRIMARY_RE.test(e.title)) probs.push("EuropePMC title looks like a design/protocol paper");
  const trialish = (e.pubtypes || []).some((p) => TRIAL_PUBTYPES.includes(p));
  if (!trialish && t.pmid_verified !== "manual_2026-07")
    probs.push(`EuropePMC pubtypes not trial-ish [${(e.pubtypes || []).join(", ")}]`);

  // Independent Crossref confirmation of the DOI's year (guards against a wrong record).
  let cr = null;
  if (e.doi) {
    cr = await crossrefByDoi(e.doi);
    if (cr.ok && cr.year && e.year && Math.abs(cr.year - e.year) > 1)
      probs.push(`Crossref year ${cr.year} disagrees with EuropePMC ${e.year}`);
  }

  const crossChecked = !!(e.doi && cr && cr.ok);
  return {
    resolved: probs.length === 0,
    problems: probs,
    title: e.title, journal: e.journal, year: e.year, doi: e.doi,
    crossChecked,
    note: probs.length
      ? probs.join(" | ")
      : `via Europe PMC${crossChecked ? " + Crossref" : " (no DOI for Crossref cross-check)"}`,
  };
}

let fallbackResolved = 0;
const results = [];
for (const t of trials) {
  const r = { name: t.name, expected_pmid: t.expected_pmid, status: null, detail: "" };

  if (!t.expected_pmid) { r.status = "SUSPECT"; r.detail = "no expected_pmid recorded"; results.push(r); continue; }

  const pm = await esummary(String(t.expected_pmid));

  // PubMed could not give an authoritative answer (transport error, or PMID not found). Trust order:
  // fall back to Europe PMC + Crossref. A reachable MISMATCH below is handled by PubMed alone.
  if (pm.transient || !pm.ok) {
    const pubmedNote = pm.transient ? pm.error + " (transport, NOT a bad PMID)" : pm.error;
    if (!NO_FALLBACK) {
      const fb = await fallbackVerify(t);
      if (fb.resolved) {
        fallbackResolved++;
        r.status = "OK"; r.via = "europepmc"; r.detail = fb.note;
        r.title = fb.title; r.journal = fb.journal; r.pubyear = fb.year;
        if (WRITE && !VERIFIED_OK.includes(t.pmid_verified)) t.pmid_verified = "europepmc_2026-07";
        results.push(r); continue;
      }
      if (fb.problems && fb.problems.length) {   // mirror actively disagrees -> real problem
        r.status = "MISMATCH";
        r.detail = `PubMed: ${pubmedNote}; Europe PMC fallback: ${fb.note}`;
        r.title = fb.title; r.journal = fb.journal; r.pubyear = fb.year;
        results.push(r); continue;
      }
      // mirror could not help (not found / its own transport error) -> keep PubMed's verdict
      r.status = pm.transient ? "UNREACHABLE" : "SUSPECT";
      r.detail = `${pubmedNote} — fallback could not resolve: ${fb.note}`;
      results.push(r); continue;
    }
    r.status = pm.transient ? "UNREACHABLE" : "SUSPECT"; r.detail = pubmedNote;
    results.push(r); continue;
  }

  const problems = [];
  if (pm.year && t.year && Math.abs(pm.year - t.year) > 2)
    problems.push(`year ${pm.year} vs recorded ${t.year}`);
  if (NOT_PRIMARY_RE.test(pm.title))
    problems.push("looks like a design/protocol paper, not primary results");
  const trialish = (pm.pubtypes || []).some((p) => TRIAL_PUBTYPES.includes(p));
  if (!trialish && t.pmid_verified !== "manual_2026-07")
    problems.push(`pubtypes not trial-ish [${(pm.pubtypes || []).join(", ")}] — set pmid_verified:"manual_2026-07" if canonical anyway`);

  r.status = problems.length ? "MISMATCH" : "OK";
  r.detail = problems.join(" | ");
  r.title = pm.title;
  r.journal = pm.journal;
  r.pubyear = pm.year;
  if (r.status === "OK" && WRITE && !VERIFIED_OK.includes(t.pmid_verified)) t.pmid_verified = "pubmed_2026-07";
  results.push(r);
  process.stdout.write(`\r  checked ${results.length}/${trials.length}`);
}
console.log("\n");

const by = (s) => results.filter((r) => r.status === s);
for (const s of ["SUSPECT", "MISMATCH", "UNREACHABLE"]) {
  const rows = by(s);
  if (!rows.length) continue;
  console.log(`═══ ${s} (${rows.length}) ═══`);
  for (const r of rows) {
    console.log(`  ${r.name}  [pmid ${r.expected_pmid || "—"}]`);
    console.log(`      ${r.detail}`);
    if (r.title) console.log(`      stored paper: "${r.title.slice(0, 90)}" (${r.journal}, ${r.pubyear})`);
  }
  console.log("");
}

const okDirect = by("OK").filter((r) => r.via !== "europepmc").length;
console.log("═══ SUMMARY ═══");
console.log(`  OK:          ${by("OK").length}  (${okDirect} PubMed direct${fallbackResolved ? `, ${fallbackResolved} via Europe PMC + Crossref` : ""})`);
console.log(`  MISMATCH:    ${by("MISMATCH").length}`);
console.log(`  SUSPECT:     ${by("SUSPECT").length}`);
console.log(`  UNREACHABLE: ${by("UNREACHABLE").length}  (transport, not citation problems)`);
if (fallbackResolved) {
  console.log(`\n  ↳ ${fallbackResolved} entr${fallbackResolved === 1 ? "y" : "ies"} PubMed could not reach were verified via the Europe PMC + Crossref`);
  console.log(`    fallback and marked pmid_verified:"europepmc_2026-07" (distinct from pubmed_2026-07 for audit).`);
}

if (WRITE) {
  writeFileSync("rag/landmark_trials.json", JSON.stringify(raw, null, 2));
  console.log("\n-> wrote verified status back to rag/landmark_trials.json");
}

// ── EXIT SEMANTICS ────────────────────────────────────────────────────────────
// A run that could not REACH PubMed has verified NOTHING. The first version of this script
// counted only SUSPECT+MISMATCH, so a fully-offline run printed "Every landmark trial resolves"
// and exited 0 — a false green, and precisely the bug class this file exists to catch: a transport
// failure masquerading as a result. Three distinct outcomes now:
//   0 = verified      (OK === total)
//   1 = real problems (SUSPECT / MISMATCH)
//   2 = inconclusive  (anything UNREACHABLE — verified nothing, claim nothing)
// (Codex review 2026-07-17)
const problems  = by("SUSPECT").length + by("MISMATCH").length;
const unreached = by("UNREACHABLE").length;

if (problems) {
  console.log(`\n✖ ${problems} problem(s). Every trial chip must point at the canonical primary trial paper.`);
  if (unreached) console.log(`  (also ${unreached} unreachable — this run is ALSO incomplete)`);
  process.exit(1);
}
if (unreached) {
  console.log(`\n⚠ INCONCLUSIVE — ${unreached}/${results.length} entries could not be reached.`);
  console.log("  This run verified NOTHING about those entries. It is not a pass.");
  console.log("  Re-run with network access; set NCBI_API_KEY to reduce rate-limiting.");
  process.exit(2);
}
if (by("OK").length !== results.length) {
  console.log(`\n⚠ INCONCLUSIVE — only ${by("OK").length}/${results.length} entries reached OK.`);
  process.exit(2);
}
console.log(`\n✔ All ${results.length} landmark trials resolve to a verified primary-results paper.`);
