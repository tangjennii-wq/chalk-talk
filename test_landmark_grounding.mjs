// LANDMARK TRIAL GROUNDING — run: node test_landmark_grounding.mjs
//
// guidelines.json names trials as bare acronyms; the prompt told the model to cite them "by name with
// their PMID/DOI URL" and nothing ever supplied the paper. `documents` has no acronym column and PubMed
// titles do not carry acronyms, so PEITHO / DAPA-HF / EMPEROR-Reduced / PROSEVA all return ZERO rows
// against a corpus that contains all four. Draft and review both worked from memory. PEITHO came back
// with its arms reversed — 5.6% attributed to tenecteplase and 2.6% to placebo, which reads as though
// lysis increased events — in rag/eval_paired_2026-07-27.json AND again in the July 26 eval.
//
// The rule under test: a trial we cannot resolve to a VERIFIED PMID is not named to the model at all.
// Naming an unsourceable trial is the instruction that produces invented figures.
import { readFileSync } from "fs";
import vm from "node:vm";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const src = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const index = JSON.parse(readFileSync(new URL("./landmark_pmids.json", import.meta.url), "utf8")).trials;
const guides = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8"));

function functionSource(name){
  const start = src.indexOf(`function ${name}(`);
  if(start < 0) throw new Error(`missing ${name}`);
  const open = src.indexOf("{", start);
  let depth = 0, quote = null, escape = false;
  for(let i=open; i<src.length; i++){
    const ch = src[i];
    if(quote){ if(escape) escape=false; else if(ch==="\\") escape=true; else if(ch===quote) quote=null; continue; }
    if(ch==='"'||ch==="'"||ch==="`"){ quote=ch; continue; }
    if(ch==="{") depth++;
    else if(ch==="}" && --depth===0) return src.slice(start, i+1);
  }
  throw new Error(`unclosed ${name}`);
}

const ctx = { LANDMARK_PMIDS: null, console: { info(){}, warn(){} } };
vm.createContext(ctx);
vm.runInContext(`${functionSource("normTrialName")}\n${functionSource("resolveTrials")}\n`
  + `this.normTrialName = normTrialName; this.resolveTrials = resolveTrials;`, ctx);
const { resolveTrials, normTrialName } = ctx;

// ── the three known failures, resolved to their real papers ─────────────────────────────────────────
// These are the trials behind three of the physician-confirmed errors. If the acronym stops resolving,
// the model is back to reciting the figures from memory and the regression is live again.
const KNOWN = [
  ["PEITHO",  "24716681", "reversed arms: 2.6% tenecteplase vs 5.6% placebo, stated the other way round"],
  ["SALSA",   "33104189", "overcorrection reduction described as significant when it was not"],
  ["AKIKI-2", "33812488", "randomisation threshold confused with the more-delayed treatment threshold"],
];
for (const [name, pmid, why] of KNOWN) {
  const r = resolveTrials([name], index);
  ok(r.resolved.length === 1 && r.resolved[0].pmid === pmid,
     `${name} resolves to PMID ${pmid} (${why})`);
}

// PEITHO is the flagship: the correct orientation has been in the corpus the whole time.
ok(index[normTrialName("PEITHO")] && index[normTrialName("PEITHO")].year === 2014,
   "PEITHO carries its year, so a talk cannot silently date it wrong");

// ── unresolvable trials are DROPPED, not merely uncited ─────────────────────────────────────────────
const mixed = resolveTrials(["PEITHO", "KEYNOTE-177", "PROSEVA", "PREVENT cohort"], index);
ok(mixed.resolved.map(t => t.name).sort().join(",") === "PEITHO,PROSEVA",
   "only trials with a verified PMID survive");
ok(mixed.dropped.sort().join(",") === "KEYNOTE-177,PREVENT cohort",
   "the rest are reported as dropped, so the caller can never name them");

// ── fail closed ─────────────────────────────────────────────────────────────────────────────────────
ok(resolveTrials(["PEITHO", "PROSEVA"], null).resolved.length === 0,
   "with no index loaded NOTHING is named — the talk loses citations rather than inventing them");
ok(resolveTrials(["PEITHO"], null).dropped.length === 1,
   "…and they are reported dropped, not silently discarded");

// ── acronym normalisation ───────────────────────────────────────────────────────────────────────────
ok(resolveTrials(["ROCKET AF"], index).resolved.length === 1, "punctuation differences still resolve (ROCKET AF)");
ok(resolveTrials(["peitho"], index).resolved.length === 1, "case differences still resolve");
ok(resolveTrials(["PEITHO", "PEITHO"], index).resolved.length === 1, "a repeated acronym is named once");

// ── the corpus-wide numbers, pinned so a regression is visible ───────────────────────────────────────
const named = [];
for (const v of Object.values(guides.specialties || {})) for (const t of (v.trials || [])) named.push(t);
const res = resolveTrials(named, index);
ok(res.resolved.length + res.dropped.length === new Set(named.map(normTrialName)).size,
   "every named trial is either resolved or dropped — none falls through");
// COUNTS MOVED 2026-08-19 (+1 each): INCREASE was added to the Pulmonary trials list so the PH-ILD
// entry requests the abstract it teaches. Resolved went 144 -> 145 and backed 162 -> 163.
// COUNTS MOVED AGAIN 2026-08-20 (+1 each): SEQUOIA-HCM was added to the Cardiovascular trials list so
// the HCM entry can cite aficamten's own pivotal trial rather than leaving the model to supply one from
// memory beside EXPLORER-HCM. Unique 201 -> 202, resolved 145 -> 146, backed 163 -> 164, mentions
// 220 -> 221, and dropped stays at 56.
// AND AGAIN 2026-08-21 (+3 each): the pericarditis stub was replaced with a real entry, which names ICAP,
// CORP and RHAPSODY. ICAP and CORP already had verified PMIDs and were simply never listed as citable;
// RHAPSODY was added under a manual_2026-08-21 stamp. Unique 208 -> 211, resolved 152 -> 155, backed
// 170 -> 173, mentions 227 -> 230, dropped STILL 56. That an entry can be starved of citable trials while
// the PMIDs sit in the index is the failure this pass found: the card came back with ONE reference.
// AND AGAIN, SAME DAY (+6 each): the CRRT entry was created from nothing, and named RENAL, ATN, RICH,
// ELAIN, AKIKI-2 and IDEAL-ICU. All six already had verified PMIDs except RICH, which was added to
// rag/landmark_trials.json under a new manual_2026-08-20 stamp. Unique 202 -> 208, resolved 146 -> 152,
// backed 164 -> 170, mentions 221 -> 227, and dropped is STILL 56.
//
// THE DIRECTION IS THE ASSERTION, not the number. Both times the new mention RESOLVED — it joined the
// backed set rather than the unresolvable tail. A trial added to guidelines.json WITHOUT a verified PMID
// raises `mentions` and `dropped` while leaving `resolved` flat, and that is the drift these pins catch:
// the prompt would then instruct the model to cite a paper nothing can supply.
//
// Derived independently, not read off the output: guidelines.json makes 227 trial MENTIONS across
// specialties; those collapse to 208 UNIQUE names, of which 152 resolve and 56 do not. resolveTrials()
// dedupes, so it is the unique figure that applies there.
ok(new Set(named.map(normTrialName)).size === 211, `211 unique trial names across guidelines.json (got ${new Set(named.map(normTrialName)).size})`);
ok(res.resolved.length === 155, `155 of them resolve to a verified PMID (got ${res.resolved.length})`);
ok(res.dropped.length === 56, `56 are unsourceable and therefore never named (got ${res.dropped.length})`);
ok(named.filter(t => !!index[normTrialName(t)]).length === 173,
   `173 of the 230 mentions are backed by a verified PMID (got ${named.filter(t => !!index[normTrialName(t)]).length})`);
// The unresolvable tail must not have grown. This is the half that matters: a corpus edit is allowed to
// add citable trials, never to add uncitable ones.
ok(named.length - named.filter(t => !!index[normTrialName(t)]).length === 57,
   "…and the unbacked remainder is STILL 57 mentions — every trial these edits added is citable");

// ── the instruction itself ──────────────────────────────────────────────────────────────────────────
ok(/Landmark trials to cite when relevant \(each has its abstract below — cite the PMID given, never construct one\)/.test(src),
   "the prompt hands over the verified PMID rather than asking the model to supply one");
ok(/LANDMARK TRIAL EVIDENCE \(abstracts as published — the source of record for every figure below\)/.test(src),
   "…and the abstracts themselves travel with it, which is the whole point of the patch");
ok(!/guidelineContext \+= "\\nLandmark trials to cite when relevant: " \+ glRef\.trials\.join/.test(src),
   "the old unfiltered join — which named every trial, sourced or not — is gone");
ok(/loadLandmarkPmids\(\);/.test(src), "the index is loaded at boot");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ LANDMARK GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
