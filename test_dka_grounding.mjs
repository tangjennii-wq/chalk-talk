// DKA / HHS GROUNDING — run: node test_dka_grounding.mjs
//
// Seven of the physician-confirmed findings were DKA or HHS, and NONE of them was a corrupted corpus
// entry: until 2026-08-18 there was no hyperglycemic-crises entry at all. The model had nothing to anchor
// to and recited the 2009 figures from memory. That is where "potassium below 3.3" came from — a real
// threshold, retired in 2024, and wrong in the direction that kills: give insulin at K 3.4 and you drive
// potassium intracellularly into an arrhythmia.
//
// This asserts the entry EXISTS, ROUTES for the topics a physician would type, reaches BOTH the lecture
// and the boards review prompt, and states the three rules that were flagged. It cannot assert the model
// obeys them — that is what the DKA canary is for.
import { readFileSync } from "fs";
import vm from "node:vm";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const guides = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8"));

function fnSrc(name){
  let start = html.indexOf(`function ${name}(`);
  if(start < 0) throw new Error(`missing ${name}`);
  if(html.slice(Math.max(0,start-6), start) === "async ") start -= 6;
  const open = html.indexOf("{", start);
  let d=0,q=null,e=false;
  for(let i=open;i<html.length;i++){ const c=html[i];
    if(q){ if(e) e=false; else if(c==="\\") e=true; else if(c===q) q=null; continue; }
    if(c==='"'||c==="'"||c==="`"){ q=c; continue; }
    if(c==="{") d++; else if(c==="}" && --d===0) return html.slice(start,i+1);
  }
  throw new Error(`unclosed ${name}`);
}

// getGuidelinesForTopic falls back to the ABIM TOPICS map when keyword matching misses, so the real one
// is lifted rather than stubbed — a stub would let a routing regression pass by changing what "miss" means.
const topicsSrc = (() => {
  const i = html.indexOf("var TOPICS = {");
  let d = 0, j = html.indexOf("{", i);
  for (let k = j; k < html.length; k++) {
    if (html[k] === "{") d++;
    else if (html[k] === "}" && --d === 0) return html.slice(i, k + 1) + ";";
  }
  throw new Error("unclosed TOPICS");
})();

const ctx = {
  GUIDELINES: guides.specialties, console: { info(){}, warn(){} },
  BOARDS_DIFFICULTY: { 4: { label: "Board-level", directive: "" } }, boardsDifficulty: () => 4,
  writeAllowedModels: (m) => m,
  LECTURE_CRITIQUE_PROMPT: "LECTURE_CRITIQUE", BOARDS_CRITIQUE_PROMPT: "BOARDS_CRITIQUE",
  MODEL_MAIN: "m1", MODEL_SONNET_FALLBACK: "m2", MODEL_CRITIC: "m3",
};
vm.createContext(ctx);
vm.runInContext(`${topicsSrc}\n${fnSrc("getGuidelinesForTopic")}\n${fnSrc("buildCritiqueSpec")}\n`
  + "this.gl = getGuidelinesForTopic; this.spec = buildCritiqueSpec;", ctx);

// ── it routes for what a physician would actually type ──────────────────────────────────────────────
const ASK = ["Diabetic ketoacidosis", "DKA management", "Hyperglycemic hyperosmolar state",
                "HHS in the elderly", "Insulin therapy in DKA"];
for (const t of ASK) {
  const r = ctx.gl(t);
  ok(!!r && /Hyperglycemic Crises/i.test(r.context || ""),
     `"${t}" routes to the hyperglycemic-crises entry`);
}

const ctxText = ctx.gl("Diabetic ketoacidosis").context;

// ── THE POTASSIUM RULE — the one that can kill ──────────────────────────────────────────────────────
ok(/BELOW 3\.5 mmol\/L, HOLD INSULIN/.test(ctxText),
   "potassium below 3.5 mmol/L means HOLD INSULIN, stated as an instruction not a fact");
ok(/3\.3 mmol\/L is the SUPERSEDED 2009 figure and must not be taught/.test(ctxText),
   "…and 3.3 is named as the superseded figure, so a model recalling it has a contradiction to resolve");
ok(!/potassium below 3\.3|K below 3\.3|withhold insulin.{0,40}3\.3/i.test(ctxText),
   "…and 3.3 never appears as a live threshold anywhere in the entry");

// ── RESOLUTION — no single criterion suffices ───────────────────────────────────────────────────────
ok(/beta-hydroxybutyrate below 0\.6 mmol\/L AND \(venous pH 7\.3 or more OR bicarbonate 18 mmol\/L or more\)/i.test(ctxText),
   "resolution is BOHB AND (pH OR bicarbonate) — the AND/OR structure is explicit");
ok(/ANION GAP IS EXPLICITLY NOT A RESOLUTION CRITERION/.test(ctxText),
   "…and the anion gap is ruled out, which is the 2009 habit a talk would fall back on");

// ── INSULIN — the step-down that needs dextrose ─────────────────────────────────────────────────────
ok(/0\.1 units\/kg\/h for moderate\/severe DKA/.test(ctxText), "the fixed-rate infusion is 0.1 units/kg/h");
ok(/reduce the infusion to 0\.05 units\/kg\/h AND ADD 5-10 percent DEXTROSE/.test(ctxText),
   "the step-down to 0.05 is bound to adding dextrose — the flagged error was reducing insulin without it");
ok(/HHS[^.]*STARTS at 0\.05 units\/kg\/h/.test(ctxText),
   "…and HHS starting at 0.05 is distinguished from the DKA step-down, which share the number");

// ── the diagnostic threshold that moved ─────────────────────────────────────────────────────────────
ok(/200 mg\/dL \(11\.1 mmol\/L\) or more, OR a prior history of/.test(ctxText),
   "the diagnostic glucose is 200, with the history alternative that admits euglycaemic DKA");
ok(/EUGLYCEMIC DKA/.test(ctxText) && /SGLT2/.test(ctxText), "…and euglycaemic DKA is named with its cause");

// ── BOTH review prompts receive it, not just the lecture one ────────────────────────────────────────
for (const style of ["lecture", "boards"]) {
  const spec = ctx.spec(style, "Diabetic ketoacidosis", ctx.gl("Diabetic ketoacidosis"), []);
  ok(/BELOW 3\.5 mmol\/L, HOLD INSULIN/.test(spec.prefix),
     `the ${style} REVIEW prompt carries the potassium rule`);
  ok(/beta-hydroxybutyrate below 0\.6/i.test(spec.prefix), `…and the ${style} resolution criteria`);
}

// ── and the drafting prompt, which builds its context from the same object ──────────────────────────
ok(/guidelineContext = "\\n\\n═══ GUIDELINE REFERENCE CONTEXT \(use this to anchor your recommendations\) ═══" \+ glRef\.context;/.test(html),
   "the DRAFT prompt is built from glRef.context — the same string asserted above");

// ── provenance, because this entry is treated as ground truth ───────────────────────────────────────
const entry = guides.specialties.Endocrinology.guidelines.find(g => /Hyperglycemic Crises/i.test(g.name));
ok(!!entry && entry.year === 2024, "the entry is dated 2024");
ok(/10\.2337\/dci24-0032/.test(entry.url || ""), "…and carries the consensus DOI");
ok(/SOURCING NOTE/.test(entry.keys) && /cross-checked/.test(entry.keys),
   "…and records how its figures were verified, since a wrong entry here is DEFENDED rather than caught");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ DKA GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
