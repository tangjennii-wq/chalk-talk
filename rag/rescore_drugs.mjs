#!/usr/bin/env node
/**
 * RESCORE A SAVED BENCHMARK RUN — no model calls, no spend.
 *
 *   node rag/rescore_drugs.mjs --report rag/eval_paired_2026-07-27.json
 *   node rag/rescore_drugs.mjs                          # only if exactly one rescorable report exists
 *
 * MUST BE RUN FROM A NETWORK THAT CAN REACH rxnav.nlm.nih.gov. A drug name is only a fabrication once
 * an authority says it does not exist; where RxNorm is unreachable this script reports INCONCLUSIVE
 * rather than converting "unknown" into "clean".
 *
 * WHY THIS EXISTS. On 2026-07-27 a 20-row paired run disqualified gpt-5.6-sol for "fabricating"
 * nterlipressin and nargatroban. It had fabricated nothing: findDrugMisspellings was reading
 * JSON.stringify(talk), where an escaped newline is the two literal characters \ and n, so /[a-z]{6,}/
 * welded that n onto the drug following a paragraph break. (Codex, 2026-07-28.)
 *
 * The saved report keeps each arm's parsed `talk`, so the verdict can be recomputed from it directly.
 * A benchmark run costs ~50 minutes and real money; re-deriving a number you already paid for is
 * always preferable to buying it twice, and it also keeps the comparison honest — the SAME outputs are
 * graded by both the old and the new instrument, so any change in verdict is attributable to the fix
 * and to nothing else.
 *
 * WHAT THIS DOES AND DOES NOT TOUCH. It recomputes ONLY the drug-name check. Citation existence, schema
 * completeness and board structure are untouched and are carried over from the original run. It never
 * writes over the input report.
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import vm from "vm";

const ARGV = process.argv.slice(2);
const argVal = (k, d) => { const i = ARGV.indexOf(k); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };

// DO NOT DEFAULT TO A SINGLE HARDCODED PATH. rag/eval_gemini_report.json is gitignored and every run
// overwrites it, so pointing there by default made a MISSING file look like an EMPTY one: the script
// printed "NOTHING TO RESCORE" while a complete, git-tracked run sat beside it under another name.
// (Codex, 2026-07-28.) When --report is omitted, find the candidates and say what was found.
let REPORT = argVal("--report", "");
if (!REPORT) {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const found = readdirSync(dir)
    .filter(f => /\.json$/.test(f) && /(eval|paired|report|run)/i.test(f) && !/fixtures|rescored/i.test(f))
    .map(f => {
      try { const d = JSON.parse(readFileSync(dir + f, "utf8")); const rows = d.results || [];
            return { f, rows: rows.length, talks: rows.filter(r => Object.values(r).some(v => v && v.talk)).length }; }
      catch { return null; }
    })
    .filter(x => x && x.talks > 0)
    .sort((a, b) => b.talks - a.talks);

  if (!found.length) {
    console.error("✖ No rescorable report found in rag/. Pass one explicitly:  --report <path>");
    process.exit(1);
  }
  if (found.length > 1) {
    console.error("✖ Several reports carry model output — name the one you mean with --report:");
    for (const c of found) console.error(`     rag/${c.f}   (${c.rows} rows, ${c.talks} with parsed talks)`);
    process.exit(1);
  }
  REPORT = "rag/" + found[0].f;
  console.log(`(no --report given; using the only rescorable report found: ${REPORT})`);
}

// ── borrow the detector from the harness WITHOUT importing it ─────────────────
// eval_gemini_quality.mjs self-executes a paid run on import and now refuses to be imported at all,
// so we lift the function source the same way rag/test_drug_detector.mjs does.
const src = readFileSync(new URL("./eval_gemini_quality.mjs", import.meta.url), "utf8");
const decl = (name) => { const i = src.indexOf("const " + name + " = "); const e = /;\n/.exec(src.slice(i)); return src.slice(i, i + e.index + 1); };
// NB: start from `async function` when that is how it is declared. Slicing at "function name(" silently
// drops the `async` keyword and the extracted copy then throws on its first await. (2026-07-28)
const fnSrc = (name) => {
  let i = src.indexOf("async function " + name + "(");
  if (i < 0) i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("fn not found: " + name);
  const e = /\n\}/.exec(src.slice(i));
  return src.slice(i, i + e.index + 2);
};

// LIFT THE VERIFIER TOO — DO NOT REIMPLEMENT IT. (2026-07-28)
// I first wrote a fresh RxNorm check here against approximateTerm.json with a score>=90 cutoff. That is
// a FUZZY endpoint on a different scale, so it returned "unknown" for amlodipine, methicillin,
// ciprofloxacin, cisplatin, atenolol, nebivolol, norfloxacin, conivaptan, moxifloxacin and vericiguat —
// ten real, correctly-spelled drugs — and the rescore accused both models of fabricating all of them.
// The harness's rxnormKnows uses rxcui.json?name=X&search=2, an EXACT normalized-name lookup, and was
// already correct. A rescoring tool that reimplements the thing it is rescoring is not a check; it is a
// second opinion from a worse instrument.
const ctx = {
  console: { log() {}, warn() {} }, Set, Map, String, Array, Object, JSON, Math, RegExp, Infinity,
  fetch, Promise, setTimeout, Date, encodeURIComponent,
};
vm.createContext(ctx);
vm.runInContext([
  decl("DRUGS"), decl("NOT_DRUGS"), decl("DRUGSET"), decl("SUFFIX_OK"), decl("DRUG_SUFFIX"),
  fnSrc("editDistance"), fnSrc("plainText"), fnSrc("findDrugMisspellings"),
  "const rxCache = new Map(); let rxNext = 0;",
  fnSrc("rxnormKnows"), fnSrc("verifyDrugFlags"),
].join("\n"), ctx);
const findDrugMisspellings = vm.runInContext("findDrugMisspellings", ctx);
const plainText = vm.runInContext("plainText", ctx);
const verifyDrugFlags = vm.runInContext("verifyDrugFlags", ctx);
const rxnormKnows = vm.runInContext("rxnormKnows", ctx);

// ── CANARY: verify the verifier before trusting a single verdict ──────────────
// The failure above was silent — a broken lookup and a genuine fabrication produce the identical
// "unknown". Known-real drugs are checked FIRST; if the authority cannot recognize them, the fault is
// in the instrument and no model may be judged by it.
const CANARY = ["atenolol", "amlodipine", "ciprofloxacin", "vancomycin"];
{
  const results = await Promise.all(CANARY.map(async d => [d, await rxnormKnows(d)]));
  const missed = results.filter(([, k]) => k !== true);
  if (missed.length === CANARY.length && missed.every(([, k]) => k === null)) {
    console.error("✖ RxNorm is unreachable from this network — every canary returned UNKNOWN.");
    console.error("  Re-run from a network that can reach rxnav.nlm.nih.gov.");
    process.exit(3);
  }
  if (missed.length) {
    console.error("✖ INSTRUMENT FAILURE — RxNorm did not recognize known-real drug(s): " +
                  missed.map(([d, k]) => `${d} (${k === null ? "unreachable" : "reported UNKNOWN"})`).join(", "));
    console.error("  A verifier that cannot confirm amlodipine cannot be used to accuse a model of");
    console.error("  fabrication. Refusing to score. Fix the lookup before rescoring anything.");
    process.exit(3);
  }
}

// ── load ──────────────────────────────────────────────────────────────────────
let report;
try { report = JSON.parse(readFileSync(REPORT, "utf8")); }
catch (e) { console.error(`✖ cannot read ${REPORT}: ${e.message}`); process.exit(1); }

const rows = report.results || [];
const arms = [...new Set(rows.flatMap(r => Object.keys(r).filter(k => r[k] && typeof r[k] === "object" && ("hard" in r[k] || "error" in r[k]) && k !== "judge")))];

const withTalks = rows.filter(r => arms.some(a => r[a] && r[a].talk)).length;
console.log(`Report: ${REPORT}`);
console.log(`Rows: ${rows.length} · rows carrying a parsed talk: ${withTalks} · arms: ${arms.join(", ") || "(none found)"}\n`);
if (!withTalks) {
  console.error("✖ NOTHING TO RESCORE — no row in this report carries a parsed `talk`.");
  console.error("  This report holds no model output, so the run cannot be re-derived and must be repeated.");
  process.exit(2);
}

// ── rescore ───────────────────────────────────────────────────────────────────
const changed = [];
for (const arm of arms) {
  for (const row of rows) {
    const a = row[arm];
    if (!a || a.error || !a.talk) continue;

    const oldDrugHard = (a.hard || []).filter(h => /drug/i.test(h));
    const cands = findDrugMisspellings(plainText(a.talk));
    // the harness's own verifier, byte for byte — same endpoint, same rate limiting, same fail-open rule
    const confirmed = await verifyDrugFlags(cands);
    const unverified = confirmed.unverified || 0;

    const newDrugHard = confirmed.map(c => `misspelled/fabricated drug: "${c.found}"${c.closest && c.distance != null ? ` → ${c.closest}` : ""}`);
    a.hard = (a.hard || []).filter(h => !/drug/i.test(h)).concat(newDrugHard);
    a.soft = a.soft || {};
    a.soft.drug_flags = confirmed.length;
    if (unverified) a.soft.unverified_drug_candidates = unverified;

    if (oldDrugHard.length !== newDrugHard.length) {
      changed.push({ topic: row.topic, style: row.style, arm, was: oldDrugHard, now: newDrugHard });
    }
  }
}

// ── report ────────────────────────────────────────────────────────────────────
if (changed.length) {
  console.log("═══ VERDICTS THAT CHANGED (the instrument was wrong, the output was not) ═══");
  for (const c of changed) {
    console.log(`  ${c.arm} · ${c.topic} [${c.style}]`);
    for (const w of c.was) console.log(`      WAS: ✖ ${w}`);
    if (!c.now.length) console.log(`      NOW: ✓ clean`);
    for (const nn of c.now) console.log(`      NOW: ✖ ${nn}`);
  }
  console.log("");
} else {
  console.log("No drug verdict changed under the corrected detector.\n");
}

console.log("═══ DETERMINISTIC RESULT, RECOMPUTED (rows that RAN only) ═══");
let anyUnverified = 0;
for (const arm of arms) {
  const all = rows.map(r => r[arm]).filter(Boolean);
  const ran = all.filter(r => !r.error);
  const hard = ran.filter(r => (r.hard || []).length);
  const fab = ran.reduce((a, r) => a + (r.soft?.fabricated_pmids || 0), 0);
  const drug = ran.reduce((a, r) => a + (r.soft?.drug_flags || 0), 0);
  const unver = ran.reduce((a, r) => a + (r.soft?.unverified_drug_candidates || 0), 0);
  anyUnverified += unver;
  console.log(`  ${arm.toUpperCase().padEnd(14)} ${ran.length - hard.length}/${ran.length} clean · hard-fails ${hard.length} · fabricated citations ${fab} · drug misspellings ${drug}` +
              (all.length - ran.length ? `   (${all.length - ran.length} row(s) never executed — not a random sample)` : ""));
  for (const r of hard) for (const h of (r.hard || [])) console.log(`      ✖ ${h}`);
  // An UNREACHABLE verifier produces the same zero as a verifier that found nothing wrong. Saying so is
  // the difference between a result and a reassurance. (Same fail-open class as the gate fixed 2026-07-27.)
  if (unver) console.log(`      ⚠ ${unver} drug-shaped token(s) NEVER CONFIRMED against RxNorm — "0 misspellings" above is NOT a finding for this arm`);
}

if (anyUnverified) {
  console.log("\n⚠ RESCORE INCONCLUSIVE — RxNorm could not be reached for every candidate.");
  console.log("  A drug name is only a fabrication once an AUTHORITY says it does not exist; an unreachable");
  console.log("  authority means UNKNOWN, and this script will not convert unknown into a pass. Re-run from a");
  console.log("  network that can reach rxnav.nlm.nih.gov before treating any arm here as cleared.");
}

const out = REPORT.replace(/\.json$/, "") + ".rescored.json";
writeFileSync(out, JSON.stringify({ ...report, rescored_at: new Date().toISOString(), rescore_note: "drug check recomputed on plainText(talk); all other checks carried over from the original run", results: rows }, null, 2) + "\n");
console.log(`\n-> written to ${out}  (the original report was NOT modified)`);
console.log("\nNOTE: this rescores the DETERMINISTIC drug check only. The judge's preference score is");
console.log("unchanged and remains non-independent — claude-opus-5 graded its own output in that run.");
