// CITATION IDENTITY CHECK — run: node test_citation_identity.mjs
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────
// Found in production, 2026-07-31, on the first real talk after the durable-execution deploy. A talk on
// diuretics in heart failure lost THREE correct landmark citations — DOSE, ADVOR and CARRESS-HF — to the
// DOI identity guard. All three are real NEJM papers, correctly cited.
//
// The cause was _journalAgree. Its initials fallback maps each token to its first letter, so it turns
// "new england journal of medicine" into "nejm" — and turns the single token "nejm" into "n". The two
// can never be equal. The comment above that line cites "N Engl J Med" vs "New England Journal of
// Medicine", which is MULTI-TOKEN and does pass; that is why it survived review. The tested shape worked
// and the shape a model actually emits did not.
//
// Two things are asserted here:
//   1. the acronym forms models really produce match their own journal names;
//   2. a journal-name disagreement ALONE cannot drop a reference whose title still agrees — because a
//      DOI pointing at a genuinely different paper disagrees on the title too.
// And the guard must still catch the thing it was built for: a real DOI for an unrelated article.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const src = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const grab = (name) => {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("could not find " + name + " in index.html");
  let i = src.indexOf("{", start), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error("unbalanced braces in " + name);
};
const tstop = src.match(/var\s+_TSTOP\s*=\s*\{[^}]*\}\s*;/);
if (!tstop) throw new Error("could not find _TSTOP in index.html");
const ctx = {};
new Function("ctx", tstop[0] + grab("_tWords") + grab("_titleSimilar") + grab("_journalAgree") +
  "ctx._tWords=_tWords;ctx._titleSimilar=_titleSimilar;ctx._journalAgree=_journalAgree;")(ctx);
const { _titleSimilar, _journalAgree } = ctx;

// ── 1 · THE THREE CITATIONS PRODUCTION ACTUALLY DROPPED ─────────────────────
// Crossup titles are the real Crossref container-title strings for these DOIs.
{
  const dropped = [
    ["NEJM", "The New England Journal of Medicine", "10.1056/NEJMoa1005419",  "DOSE"],
    ["NEJM", "The New England Journal of Medicine", "10.1056/NEJMoa2203094",  "ADVOR"],
    ["NEJM", "The New England Journal of Medicine", "10.1056/NEJMoa1210357",  "CARRESS-HF"],
  ];
  for (const [claimed, crossref, doi, trial] of dropped)
    ok(_journalAgree(claimed, crossref) === true,
       `${trial} (${doi}) is no longer dropped — "${claimed}" matches "${crossref}"`);
}

// ── 2 · ACRONYMS MODELS ACTUALLY EMIT ───────────────────────────────────────
{
  const shouldAgree = [
    ["NEJM", "The New England Journal of Medicine"],
    ["JACC", "Journal of the American College of Cardiology"],
    ["JASN", "Journal of the American Society of Nephrology"],
    ["BMJ",  "The BMJ"],
    ["N Engl J Med", "The New England Journal of Medicine"],
    ["Eur Heart J",  "European Heart Journal"],
    ["Ann Intern Med", "Annals of Internal Medicine"],
    ["Kidney Int", "Kidney International"],
    ["JAMA Cardiol", "JAMA Cardiology"],
    ["Lancet", "The Lancet"],
    ["Circulation", "Circulation"],
  ];
  for (const [a, b] of shouldAgree)
    ok(_journalAgree(a, b) === true, `"${a}" agrees with "${b}"`);
}

// ── 3 · THE GUARD MUST STILL REFUSE GENUINELY DIFFERENT JOURNALS ────────────
// If this ever goes quiet, the fix above has been widened into a rubber stamp.
{
  const shouldDisagree = [
    ["NEJM", "Journal of the American College of Cardiology"],
    ["Chest", "Gut"],
    ["Blood", "Bone"],
    ["Diabetes Care", "Circulation"],
  ];
  for (const [a, b] of shouldDisagree)
    ok(_journalAgree(a, b) === false, `"${a}" is correctly NOT matched to "${b}"`);
}

// ── 4 · THE DROP RULE ───────────────────────────────────────────────────────
// Reimplements the decision from verifyModelDois so the policy itself is testable without a browser,
// then asserts index.html still contains that policy rather than the old `mismatch.length >= 1`.
{
  const decide = (claimedTitle, claimedYear, claimedJournal, v) => {
    const mismatch = [];
    const titleSim = (claimedTitle && v.title) ? _titleSimilar(claimedTitle, v.title) : null;
    if (titleSim != null && titleSim < 0.5) mismatch.push("title");
    if (claimedYear && v.year && Math.abs(claimedYear - v.year) > 1) mismatch.push("year");
    if (claimedJournal && v.journal && !_journalAgree(claimedJournal, v.journal)) mismatch.push("journal");
    const decisive = mismatch.filter(m => m !== "journal");
    return decisive.length >= 1 || (mismatch.includes("journal") && titleSim != null && titleSim < 0.8);
  };

  // The model prefixes the trial acronym to the title — this is normal, and containment tolerates it.
  ok(decide("ADVOR trial: Acetazolamide in Acute Decompensated Heart Failure", 2022, "NEJM",
            { title: "Acetazolamide in Acute Decompensated Heart Failure with Volume Overload",
              year: 2022, journal: "The New England Journal of Medicine" }) === false,
     "a correctly-cited landmark trial with an acronym journal is KEPT");

  ok(decide("Diuretic Strategies in Patients with Acute Decompensated Heart Failure", 2011, "NEJM",
            { title: "Diuretic Strategies in Patients with Acute Decompensated Heart Failure",
              year: 2011, journal: "N Engl J Med" }) === false,
     "…and so is an exact title match across journal-name formats");

  // The guard's real job: a real DOI belonging to an unrelated paper.
  ok(decide("Acetazolamide in Acute Decompensated Heart Failure", 2022, "NEJM",
            { title: "A randomised trial of malaria vaccine efficacy in infants",
              year: 2019, journal: "The Lancet" }) === true,
     "a DOI pointing at an UNRELATED paper is still dropped");

  ok(decide("Some Cardiology Paper", 2001, "NEJM",
            { title: "Some Cardiology Paper", year: 2019, journal: "The New England Journal of Medicine" }) === true,
     "a year that is years off is still decisive on its own");

  // Journal alone, title agreeing → kept. This is the policy change; state it as a test so that
  // reverting it is a visible decision rather than a silent one.
  ok(decide("Ultrafiltration in Decompensated Heart Failure with Cardiorenal Syndrome", 2012, "Circulation",
            { title: "Ultrafiltration in Decompensated Heart Failure with Cardiorenal Syndrome",
              year: 2012, journal: "The New England Journal of Medicine" }) === false,
     "journal disagreement ALONE does not drop a reference whose title matches exactly");
}

// ── 5 · THE SOURCE STILL CARRIES THE FIX ────────────────────────────────────
// Comments are stripped first: three earlier tests in this repo passed by matching their own prose.
{
  const code = src.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  ok(/acroMatch/.test(code), "the one-token acronym branch is present in index.html");
  ok(!/if\(mismatch\.length\s*>=\s*1\s*&&\s*x\.ref\.id/.test(code),
     "the old `mismatch.length >= 1` drop rule is gone");
  ok(/decisive\.length\s*>=\s*1/.test(code), "…replaced by the corroboration rule");
  ok(/journal:\s*\\?"/.test(code) || /"journal: /.test(code),
     "the warning prints the journal values when journal is what disagreed");
}

console.log("\n" + (failures === 0 ? "✔ CITATION IDENTITY OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
