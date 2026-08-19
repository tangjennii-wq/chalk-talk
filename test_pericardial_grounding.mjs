// PERICARDIAL GROUNDING — run: node test_pericardial_grounding.mjs
//
// A physician review of an "Acute Pericarditis" card found a fabricated malignancy figure. The cause was
// not the model drifting: getGuidelinesForTopic("Acute Pericarditis") returned NULL, so the talk was
// written with ZERO guideline context. Two independent bugs produced that, and neither could be seen
// from the output — an ungrounded talk looks exactly like a grounded one until a number is wrong.
//
//   1. No Cardiovascular keyword matched. "Acute Pericarditis" contains "cardi" but the list held only
//      "cardio" and "cardiac". "Pericardial Effusion and Cardiac Tamponade" routed ONLY by luck, on the
//      word "Cardiac" in its title.
//   2. The TOPICS fallback compares with === against its own catalogue, which stores "Acute
//      pericarditis" in sentence case. Case-sensitive equality missed it.
import { readFileSync } from "fs";
import vm from "node:vm";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;

// ── ROUTING, EXECUTED — not regex-matched. The bug lived in the comparison, so the test runs it. ────
function fnSrc(name){
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error("missing " + name);
  const open = html.indexOf("{", start);
  let d = 0, q = null, e = false;
  for (let i = open; i < html.length; i++) { const c = html[i];
    if (q) { if (e) e = false; else if (c === "\\\\") e = true; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === "{") d++; else if (c === "}" && --d === 0) return html.slice(start, i + 1);
  }
  throw new Error("unclosed " + name);
}
// TOPICS[cat].topics — the real shape. My first stub omitted the .topics level, so the fallback loop
// read undefined and matched nothing; the pericardial assertions passed only because the keyword fix
// handles them before the fallback is reached. A stub that does not mirror the real structure is not
// exercising the code it claims to.
// getGuidelinesForTopic now depends on TOPIC_CATEGORY_SPECIALTY, so the lift has to bring it along.
// It failed loudly (ReferenceError) rather than silently returning null, which is the right way round.
function objSrc(name){
  const at = html.indexOf(`var ${name} = {`);
  if (at < 0) throw new Error("missing " + name);
  return html.slice(at, html.indexOf("};", at) + 2);
}
const CAT_MAP_SRC = objSrc("TOPIC_CATEGORY_SPECIALTY");

const ctx = { GUIDELINES: G, TOPICS: { "Cardiology": { topics: { "Pericardial Disease":
  ["Acute pericarditis", "Pericardial effusion", "Constrictive pericarditis", "Tamponade"] } } },
  String, Object, console: { warn(){} } };
vm.createContext(ctx);
vm.runInContext(CAT_MAP_SRC + "\n" + fnSrc("getGuidelinesForTopic") + "\nthis.route = getGuidelinesForTopic;", ctx);
const route = ctx.route;

// The exact titles that failed. Each must now reach Cardiovascular.
for (const topic of ["Acute Pericarditis", "Pericardial Effusion and Cardiac Tamponade",
                     "Constrictive Pericarditis", "Myocarditis", "Recurrent pericarditis",
                     "Cardiac tamponade in malignancy"]) {
  const r = route(topic);
  ok(!!r && r.specialties.includes("Cardiovascular"), `"${topic}" routes to Cardiovascular`);
}
// THE CASE BUG MUST BE TESTED ON THE FALLBACK PATH, WHICH IS THE ONLY PLACE IT LIVES.
// Asserting route("acute pericarditis") proved nothing once "pericard" was a keyword: the keyword match
// fires first and the fallback is never reached. Reverting === survived the whole mutation pass because
// of that. This uses a topic no keyword can match, so the ONLY way it routes is through TOPICS.
const fallbackCtx = { GUIDELINES: G, String, Object, console: { warn(){} },
  // A REAL category name, because routing is now an exact table with no catch-all. The old stub used a
  // decorated invented name and correctly routed to nothing — the test was asserting against a category
  // the app has never had.
  TOPICS: { "Nephrology and Urology": { topics: { "Obscure": ["Bartter syndrome variant"] } } } };
vm.createContext(fallbackCtx);
vm.runInContext(CAT_MAP_SRC + "\n" + fnSrc("getGuidelinesForTopic") + "\nthis.route = getGuidelinesForTopic;", fallbackCtx);
const fb = fallbackCtx.route;
ok(!!fb("Bartter syndrome variant"), "sanity: the TOPICS fallback routes an exact-case catalogue entry");
ok(!!fb("bartter syndrome variant") && !!fb("BARTTER SYNDROME VARIANT"),
   "…and routes it in ANY case — the === the fallback used missed its own sentence-case catalogue");

// And it must not have become greedy: a pleural effusion is Pulmonary, not Cardiovascular.
const pleural = route("Pleural effusion and thoracentesis");
ok(!pleural || !pleural.specialties.includes("Cardiovascular"),
   "…without dragging pleural effusion into Cardiovascular — 'effusion' alone is deliberately not a keyword");

// The grounding must actually CARRY the new entry, not merely match the specialty.
const ctxText = route("Acute Pericarditis").context;
ok(/Pericardial Effusion, Tamponade and Pericardiocentesis/.test(ctxText),
   "the pericardial entry reaches the prompt context for a pericarditis topic");
ok(/250-500 mL/.test(ctxText), "…carrying its content, not just its title");

// ── THE ENTRY: every clinical number in it was read in a primary source ─────────────────────────────
const entry = G.Cardiovascular.guidelines.find(e => /Pericardial Effusion, Tamponade/.test(e.name)).keys;

// The commonest teaching error on this topic, and the one the card actually made.
ok(/HYPOTENSIVE, HYPOVOLAEMIC/.test(entry) && /250-500 mL/.test(entry),
   "fluids are scoped to the hypotensive hypovolaemic patient at 250-500 mL…");
ok(/REDUCE CARDIAC OUTPUT/.test(entry), "…with the harm from higher volumes stated, not implied");
ok(/DIURETICS ARE CONTRAINDICATED/.test(entry), "IV diuretics are marked contraindicated");
ok(/25 percent/.test(entry) && /POSITIVE-PRESSURE VENTILATION/.test(entry),
   "positive-pressure ventilation carries its magnitude");

// The two figures a relayed review asserted TWICE, and which the primary source contradicts.
ok(/NOT MORE THAN 1 L/.test(entry),
   "decompression syndrome carries the 1 L figure the ESC source actually gives…");
ok(/a 500 mL ceiling is quoted in some review material and is NOT the figure this source\s+gives/.test(entry),
   "…and names the 500 mL figure as not-from-this-source, so it is not silently adopted later");
ok(/MAJOR complications 0\.3-3\.9/.test(entry) && /MINOR complications 0\.4-20/.test(entry),
   "the complication rate is the major/minor split the source gives, not a single blended number");
ok(!/4-10 percent/.test(entry), "…and the unverified '4-10 percent overall' figure is absent");

// Size nuance: 20 mm belongs to the CHRONIC category.
ok(/THE 20 mm FIGURE BELONGS TO THE CHRONIC CATEGORY/.test(entry),
   "the 20 mm threshold is tied to chronic effusion, not offered as a standalone trigger");
ok(/symptoms, failure of medical therapy, or\s+diagnostic need/.test(entry),
   "…and the real drivers of non-tamponade drainage are named");

// Trials: real numbers, and a fence around what they studied.
ok(/16\.7 percent \(20\/120\)/.test(entry) && /37\.5\s+percent \(45\/120\)/.test(entry), "ICAP carries n/N, not just percentages");
ok(/21\.6 percent \(26\/120\)/.test(entry) && /42\.5 percent \(51\/120\)/.test(entry), "CORP-2 likewise");
ok(/BOTH\s+TRIALS STUDIED PERICARDITIS, NOT MALIGNANT EFFUSIONS/.test(entry),
   "…fenced to what they studied, so the recurrence benefit is not carried into malignant effusion");

// The number nobody could verify stays out, AND is named as unestablished so it is not re-invented.
ok(/Do not attach a percentage to how often cytology returns a\s+new malignancy/.test(entry),
   "the malignancy-on-cytology percentage is refused rather than guessed…");
ok(!/harbors newly discovered malignancy/.test(entry) && !/roughly 2 percent/.test(entry),
   "…and the fabricated 2 percent figure appears nowhere");

// Provenance: which document, read when.
ok(/read directly on 19 Aug 2026/.test(entry) && /s41572-023-00446-1/.test(entry),
   "the entry records which sources were read directly, and when");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ PERICARDIAL GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
