/**
 * validator_lib.mjs — pure, network-free decision logic for validate_landmark_pmids.mjs.
 *
 * Everything here is deterministic and side-effect-free so it can be unit-tested without hitting
 * PubMed / Europe PMC / Crossref (see test_landmark_validator.mjs). The validator wires these to the
 * live fetches; the network code stays in the validator, the JUDGEMENT lives here.
 */

// Keep identical to TRIAL_PUBTYPES in validate_review_records.mjs — a trial that passes review
// validation must also pass manifest validation. (Manual invariant; both files list the same set.)
export const TRIAL_PUBTYPES = ["Randomized Controlled Trial", "Clinical Trial", "Controlled Clinical Trial", "Pragmatic Clinical Trial", "Clinical Trial, Phase II", "Clinical Trial, Phase III", "Clinical Trial, Phase IV", "Equivalence Trial"];
export const NOT_PRIMARY_RE = /\b(rationale and design|study design|design and methods|study protocol|trial protocol|:\s*protocol\b|statistical analysis plan)\b/i;

// ── TITLE CONFIRMATION ────────────────────────────────────────────────────────
// Year + pubtype + not-a-protocol do NOT prove the PMID is THIS trial — a different RCT from the same
// year could pass. titleMatch compares the returned article title against the recorded trial via two
// signals, tuned so legacy entries whose `full` is only the expanded NAME (e.g. DCCT) still confirm:
//   - acronym-in-title: modern trials carry "(ACRONYM)" or ": the ACRONYM trial"
//   - distinctive-token overlap between `full`(+name) and the returned title
// strong = confirmed; wrong = acronym absent AND overlap very low (likely a different paper);
// weak = the middle band (unconfirmed — treated as SUSPECT for not-yet-verified entries).
export const TITLE_STOP = new Set(("a an the of in for and or with without versus vs on to after at as by from into is are be its their among between during over per one two three study studies trial trials "
  + "randomized randomised controlled control placebo double blind phase patients patient group groups arm open label multicenter multicentre pilot report reports results result analysis effect effects "
  + "treatment therapy efficacy safety outcome outcomes clinical comparison compared").split(/\s+/));

export function titleWords(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean); }

export function titleMatch(full, name, returnedTitle) {
  const rt = titleWords(returnedTitle);
  const rtSet = new Set(rt);
  const rtJoined = rt.join("");
  const core = String(name || "").split("(")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const nameTokens = titleWords(String(name || "").split("(")[0]);
  const acronymHit = (core.length >= 3 && rtJoined.includes(core))
    || nameTokens.some((tok) => tok.length >= 4 && rtSet.has(tok));
  const exp = new Set(titleWords(`${full} ${String(name || "").split("(")[0]}`).filter((w) => w.length > 2 && !TITLE_STOP.has(w)));
  let hit = 0; for (const w of exp) if (rtSet.has(w)) hit++;
  const score = exp.size ? hit / exp.size : 0;
  const strong = score >= 0.5 || (acronymHit && score >= 0.25);
  const wrong = !acronymHit && score < 0.2;
  return { acronymHit, score, strong, wrong };
}

// severity label for an entry given the returned record's title
export function titleSeverity(trial, rec) {
  const tm = titleMatch(trial.full, trial.name, rec && rec.title);
  return { sev: tm.wrong ? "wrong" : (tm.strong ? "strong" : "weak"), score: tm.score, acronymHit: tm.acronymHit };
}

// ── OBJECTIVE CHECKS (hard gates) ─────────────────────────────────────────────
// rec = { year, title, pubtypes }. Returns an array of hard problems (empty = passes).
export function objectiveProblems(trial, rec) {
  const p = [];
  if (rec.year && trial.year && Math.abs(rec.year - trial.year) > 2) p.push(`year ${rec.year} vs recorded ${trial.year}`);
  if (NOT_PRIMARY_RE.test(rec.title || "")) p.push("looks like a design/protocol paper, not primary results");
  const trialish = (rec.pubtypes || []).some((x) => TRIAL_PUBTYPES.includes(x));
  if (!trialish && trial.pmid_verified !== "manual_2026-07")
    p.push(`pubtypes not trial-ish [${(rec.pubtypes || []).join(", ")}] — set pmid_verified:"manual_2026-07" if canonical anyway`);
  return p;
}

// ── JOURNAL / TITLE AGREEMENT (for the Europe PMC + Crossref fallback) ─────────
export function normJournal(j) { return String(j || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim(); }
const JOURNAL_STOP = new Set(["the", "of", "and", "for", "a", "an", "de", "la", "le"]);
export function journalKey(j) { return normJournal(j).split(/\s+/).filter((w) => w && !JOURNAL_STOP.has(w)).map((w) => w[0]).join(""); }

// True when two journal names denote the same journal — handles abbreviation vs full
// ("N Engl J Med" == "New England Journal of Medicine") via the first-letter key.
export function journalAgree(a, b) {
  if (!a || !b) return false;
  const na = normJournal(a), nb = normJournal(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ka = journalKey(a), kb = journalKey(b);
  if (ka.length >= 2 && ka === kb) return true;
  const ta = new Set(na.split(/\s+/)), tb = new Set(nb.split(/\s+/));
  let inter = 0; for (const x of ta) if (tb.has(x)) inter++;
  return inter / (Math.min(ta.size, tb.size) || 1) >= 0.6;
}

// overlap coefficient of two article titles (same paper -> high overlap)
export function titleSimilar(a, b) {
  const A = new Set(titleWords(a).filter((w) => w.length > 2 && !TITLE_STOP.has(w)));
  const B = new Set(titleWords(b).filter((w) => w.length > 2 && !TITLE_STOP.has(w)));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

// Full Europe-PMC ↔ Crossref agreement (Codex 2026-07-24): Crossref must supply title, journal AND
// year, and ALL must agree with the Europe PMC record. Any missing field or disagreement = no
// agreement. `epmc` = {year,title,journal}; `cr` = {ok,year,title,journal} (or falsy/!ok).
export function crossrefAgrees(epmc, cr) {
  const reasons = [];
  if (!cr || !cr.ok) { reasons.push("Crossref did not resolve the DOI"); return { agree: false, reasons }; }
  if (!cr.year)    reasons.push("Crossref record has no year");
  if (!cr.journal) reasons.push("Crossref record has no journal");
  if (!cr.title)   reasons.push("Crossref record has no title");
  if (reasons.length) return { agree: false, reasons };
  if (epmc.year && Math.abs(cr.year - epmc.year) > 1) reasons.push(`Crossref year ${cr.year} != Europe PMC ${epmc.year}`);
  if (!journalAgree(cr.journal, epmc.journal))        reasons.push(`Crossref journal "${cr.journal}" != Europe PMC "${epmc.journal}"`);
  if (titleSimilar(cr.title, epmc.title) < 0.6)       reasons.push(`Crossref title does not match Europe PMC title`);
  return { agree: reasons.length === 0, reasons };
}
