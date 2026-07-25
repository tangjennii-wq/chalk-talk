// Unit tests for the landmark validator's pure decision logic (rag/validator_lib.mjs).
// Covers the title thresholds and the Europe PMC + Crossref agreement branches that Codex flagged.
// Run: node test_landmark_validator.mjs
import {
  titleMatch, titleSeverity, objectiveProblems,
  journalAgree, titleSimilar, crossrefAgrees,
} from "./rag/validator_lib.mjs";

let failures = 0;
function ok(c, m) { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; }

// ── titleMatch / titleSeverity ────────────────────────────────────────────────
const strongAcr = titleMatch("Up-titration of GDMT for acute heart failure (STRONG-HF)", "STRONG-HF",
  "Safety, tolerability and efficacy of up-titration of guideline-directed medical therapies for acute heart failure (STRONG-HF): a randomised trial");
ok(strongAcr.strong && !strongAcr.wrong, "STRONG-HF: acronym + overlap -> strong");

const legacy = titleMatch("Diabetes Control and Complications Trial", "DCCT",
  "The effect of intensive treatment of diabetes on the development and progression of long-term complications in insulin-dependent diabetes mellitus");
ok(legacy.strong && !legacy.acronymHit, "DCCT legacy: strong via token overlap even with no acronym in title (no false flag)");

const wrongPaper = titleMatch("Denosumab for Prevention of Fractures in Postmenopausal Women with Osteoporosis", "FREEDOM",
  "A randomized trial of intensive versus standard blood-pressure control");
ok(wrongPaper.wrong, "clearly different paper (osteoporosis vs BP) -> wrong");

const weakMid = titleMatch("Tolvaptan for hyponatremia", "SALT",
  "Tolvaptan and serum sodium in heart failure patients");   // 1/3 distinctive tokens, acronym absent
ok(!weakMid.strong && !weakMid.wrong, `partial overlap, acronym absent -> weak middle band (score ${weakMid.score.toFixed(2)})`);

ok(titleSeverity({ full: "x", name: "FREEDOM" }, { title: "A randomized trial of intensive versus standard blood-pressure control" }).sev === "wrong",
  "titleSeverity maps a different-paper title to 'wrong'");
ok(titleSeverity({ full: "Diabetes Control and Complications Trial", name: "DCCT" },
  { title: "The effect of intensive treatment of diabetes on the development and progression of long-term complications in insulin-dependent diabetes mellitus" }).sev === "strong",
  "titleSeverity maps the DCCT legacy title to 'strong'");

// ── objectiveProblems ─────────────────────────────────────────────────────────
ok(objectiveProblems({ year: 2020, pmid_verified: "websearch_2026-07" }, { year: 2015, title: "x", pubtypes: ["Randomized Controlled Trial"] }).length === 1,
  "year off by 5 -> one objective problem");
ok(objectiveProblems({ year: 2020, pmid_verified: "websearch_2026-07" }, { year: 2020, title: "x", pubtypes: ["Randomized Controlled Trial"] }).length === 0,
  "matching year + trial pubtype -> no objective problem");
ok(objectiveProblems({ year: 2020, pmid_verified: "websearch_2026-07" }, { year: 2020, title: "Rationale and design of the FOO trial", pubtypes: ["Randomized Controlled Trial"] }).some((p) => /design\/protocol/.test(p)),
  "design/rationale title -> flagged as protocol paper");
ok(objectiveProblems({ year: 2020, pmid_verified: "websearch_2026-07" }, { year: 2020, title: "x", pubtypes: ["Review"] }).some((p) => /not trial-ish/.test(p)),
  "review pubtype -> flagged not trial-ish");
ok(objectiveProblems({ year: 2020, pmid_verified: "manual_2026-07" }, { year: 2020, title: "x", pubtypes: ["Review"] }).length === 0,
  "manual_2026-07 bypasses the pubtype gate (canonical-but-odd-pubtype escape hatch)");

// ── journalAgree (abbreviation handling) ──────────────────────────────────────
ok(journalAgree("N Engl J Med", "New England Journal of Medicine"), "NEJM abbreviation == full name (first-letter key)");
ok(journalAgree("The Lancet", "Lancet"), "Lancet with/without leading 'The'");
ok(journalAgree("J Am Coll Cardiol", "Journal of the American College of Cardiology"), "JACC abbreviation == full name");
ok(journalAgree("JAMA", "JAMA"), "exact journal match");
ok(!journalAgree("Blood", "BMJ"), "Blood != BMJ (single-letter keys must NOT collide)");
ok(!journalAgree("NEJM", "Lancet"), "different journals do not agree");

// ── titleSimilar ──────────────────────────────────────────────────────────────
ok(titleSimilar("Dupilumab in Adults with Eosinophilic Esophagitis", "Dupilumab in adults and adolescents with eosinophilic esophagitis") >= 0.6,
  "same paper, minor wording differences -> similar");
ok(titleSimilar("Tafamidis for transthyretin amyloid cardiomyopathy", "Colchicine for acute pericarditis") < 0.6,
  "unrelated titles -> not similar");

// ── crossrefAgrees (Codex #1: title+journal+year all required and must agree) ──
const epmc = { year: 2019, title: "Vutrisiran in patients with hereditary transthyretin amyloidosis", journal: "N Engl J Med" };
ok(crossrefAgrees(epmc, { ok: true, year: 2019, title: "Vutrisiran in Patients with Hereditary Transthyretin Amyloidosis", journal: "New England Journal of Medicine" }).agree,
  "full agreement (year+journal+title) -> agree");
ok(!crossrefAgrees(epmc, { ok: true, year: null, title: "Vutrisiran in patients with hereditary transthyretin amyloidosis", journal: "N Engl J Med" }).agree,
  "missing Crossref YEAR -> not agree (was previously allowed to pass)");
ok(!crossrefAgrees(epmc, { ok: true, year: 2019, title: "Vutrisiran in patients with hereditary transthyretin amyloidosis", journal: null }).agree,
  "missing Crossref JOURNAL -> not agree (Codex: journal must agree)");
ok(!crossrefAgrees(epmc, { ok: true, year: 2019, title: null, journal: "N Engl J Med" }).agree,
  "missing Crossref TITLE -> not agree (Codex: title must agree)");
ok(!crossrefAgrees(epmc, { ok: true, year: 2015, title: "Vutrisiran in patients with hereditary transthyretin amyloidosis", journal: "N Engl J Med" }).agree,
  "Crossref year disagrees -> not agree");
ok(!crossrefAgrees(epmc, { ok: true, year: 2019, title: "Vutrisiran in patients with hereditary transthyretin amyloidosis", journal: "The Lancet" }).agree,
  "Crossref journal disagrees -> not agree");
ok(!crossrefAgrees(epmc, { ok: true, year: 2019, title: "An entirely different paper about cardiogenic shock", journal: "N Engl J Med" }).agree,
  "Crossref title disagrees -> not agree");
ok(!crossrefAgrees(epmc, { ok: false, error: "DOI not in Crossref" }).agree,
  "Crossref did not resolve the DOI -> not agree");

console.log("\n" + (failures === 0 ? "✔ LANDMARK VALIDATOR TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
