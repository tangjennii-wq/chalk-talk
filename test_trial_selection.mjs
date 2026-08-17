// TRIAL SELECTION — run: node test_trial_selection.mjs
//
// A specialty can name far more trials than one /trials request can carry (Cardiovascular resolves 33
// against a cap of 12), so the list is ranked before it is cut. Ranking is allowed to be imperfect. What
// is NOT allowed is a trial reaching the prompt with no evidence behind it — so the last assertion here
// is the load-bearing one: only trials whose abstracts actually came BACK may be named.
//
// The acronym namespace overlaps ordinary English. IMPACT, HOPE, DELIVER, FLOW and POINT are all real
// landmark trials in this index. "Impact of heart failure" must not be read as a request for IMPACT.
import { readFileSync } from "fs";
import vm from "node:vm";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const src = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const index = JSON.parse(readFileSync(new URL("./landmark_pmids.json", import.meta.url), "utf8")).trials;
const guides = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8"));

function fnSrc(name){
  const start = src.indexOf(`function ${name}(`);
  if(start < 0) throw new Error(`missing ${name}`);
  const open = src.indexOf("{", start);
  let d=0, q=null, e=false;
  for(let i=open;i<src.length;i++){ const c=src[i];
    if(q){ if(e) e=false; else if(c==="\\") e=true; else if(c===q) q=null; continue; }
    if(c==='"'||c==="'"||c==="`"){ q=c; continue; }
    if(c==="{") d++; else if(c==="}" && --d===0) return src.slice(start,i+1);
  }
  throw new Error(`unclosed ${name}`);
}

const CAP = Number((src.match(/var TRIALS_REQUEST_MAX = (\d+);/) || [])[1]);
if(!CAP) throw new Error("could not read TRIALS_REQUEST_MAX from index.html");

const ctx = { GUIDELINES: guides.specialties, LANDMARK_PMIDS: index, TRIALS_REQUEST_MAX: CAP,
              console: { info(){}, warn(){} } };
vm.createContext(ctx);
vm.runInContext(["normTrialName","resolveTrials","trialNamedDistinctly","rankTrialsForRequest",
                 "namedTrialsFromResponse","getGuidelinesForTopic"].map(fnSrc).join("\n")
  + `\nthis.normTrialName=normTrialName; this.resolveTrials=resolveTrials;`
  + `this.trialNamedDistinctly=trialNamedDistinctly; this.rankTrialsForRequest=rankTrialsForRequest;`
  + `this.namedTrialsFromResponse=namedTrialsFromResponse; this.getGuidelinesForTopic=getGuidelinesForTopic;`, ctx);
const { resolveTrials, trialNamedDistinctly, rankTrialsForRequest, namedTrialsFromResponse, getGuidelinesForTopic } = ctx;

const select = (topic, rag) => {
  const glRef = getGuidelinesForTopic(topic);
  const resolved = resolveTrials(glRef ? glRef.trials : [], index).resolved;
  return { resolved, ...rankTrialsForRequest(resolved, topic, rag || []) };
};
const names = (list) => list.map(t => t.name);

// ── the flagship, end to end from the real corpus ───────────────────────────────────────────────────
const pe = select("Pulmonary embolism risk stratification");
ok(names(pe.request).includes("PEITHO"),
   "PE: PEITHO reaches the request — the trial whose arms came back reversed in two evals");
ok(pe.request.find(t => t.name === "PEITHO").pmid === "24716681",
   "…pointing at the paper that actually contains 2.6% tenecteplase vs 5.6% placebo");

// ── HFrEF: 33 resolvable against a cap of 12, so ordering decides ───────────────────────────────────
const hf = select("Heart failure with reduced ejection fraction");
ok(hf.resolved.length > CAP, `HFrEF resolves more trials than one request carries (${hf.resolved.length} > ${CAP})`);
for (const t of ["PARADIGM-HF", "DAPA-HF", "EMPEROR-Reduced"]) {
  ok(names(hf.request).includes(t), `HFrEF: ${t} survives the cut`);
}
ok(hf.droppedForLimit.length === hf.resolved.length - hf.request.length,
   "every trial that does not fit is reported, not silently discarded");

// ── tier 2 lifts a trial that curated order buried ──────────────────────────────────────────────────
// COAPT sits at curated position 14 — outside the cap. Retrieval finding it must be enough to promote it.
const coapt = "30280640";   // verified against landmark_pmids.json, not remembered
ok(!names(select("Heart failure with reduced ejection fraction").request).includes("COAPT"),
   "COAPT is outside the cap on curated order alone");
const withRag = select("Heart failure with reduced ejection fraction",
  [{ pmid: coapt }, { pmid: "00000001" }, { pmid: "00000002" }]);
ok(names(withRag.request).includes("COAPT"),
   "…and is promoted once its PMID appears in the retrieved evidence");
ok(names(withRag.request)[0] === "COAPT",
   "…to the top, because retrieval rank orders tier 2");

// TIER 2 IS ORDERED BY RETRIEVAL RANK, not merely gathered. Added because a mutation that flattened the
// within-tier ordering (every tier-2 trial scored 0) SURVIVED the assertion above: with only one trial in
// the RAG set there was nothing for the ordering to get wrong. Two, in a deliberate order, is the
// smallest case that can fail.
const fourier = "28304224";   // curated #19, further down than COAPT at #14
const twoInRag = select("Heart failure with reduced ejection fraction",
  [{ pmid: fourier }, { pmid: coapt }]);
ok(names(twoInRag.request).slice(0, 2).join(",") === "FOURIER,COAPT",
   "two retrieved trials keep RETRIEVAL order, not curated order (FOURIER is curated-later but ranked first)");
const reversed = select("Heart failure with reduced ejection fraction",
  [{ pmid: coapt }, { pmid: fourier }]);
ok(names(reversed.request).slice(0, 2).join(",") === "COAPT,FOURIER",
   "…and reversing the retrieval order reverses the request order");

// ── tier 3 is the only tier that survives a retrieval outage ────────────────────────────────────────
const noRag = select("Heart failure with reduced ejection fraction", []);
const nullRag = select("Heart failure with reduced ejection fraction", null);
ok(JSON.stringify(names(noRag.request)) === JSON.stringify(names(nullRag.request)),
   "an empty and an absent RAG result behave identically");
ok(JSON.stringify(names(noRag.request)) === JSON.stringify(names(noRag.resolved).slice(0, CAP)),
   "with no retrieval the request is exactly curated order — deterministic, never empty");

// ── the ordinary-word collision ─────────────────────────────────────────────────────────────────────
ok(!trialNamedDistinctly("IMPACT", "Impact of heart failure on quality of life"),
   "\"Impact of heart failure\" does NOT promote the IMPACT trial");
ok(!trialNamedDistinctly("HOPE", "Hope and coping in advanced illness"), "\"Hope\" as a word does not promote HOPE");
ok(!trialNamedDistinctly("DELIVER", "How to deliver bad news"), "\"deliver\" as a verb does not promote DELIVER");
ok(!trialNamedDistinctly("POINT", "Point of care ultrasound"), "\"Point of care\" does not promote POINT");
ok(trialNamedDistinctly("IMPACT", "IMPACT in COPD"), "an ALL-CAPS mention does promote it");
ok(trialNamedDistinctly("IMPACT", "the impact trial in COPD"), "\"impact trial\" promotes it whatever the case");
ok(trialNamedDistinctly("DAPA-HF", "what did dapa-hf show"), "a hyphenated name is distinctive at any case");
ok(trialNamedDistinctly("AKIKI-2", "akiki-2 timing"), "so is a numbered one");
ok(!trialNamedDistinctly("HOPE", "HOPELESS prognosis"), "matching respects word boundaries");

// ── THE SAFETY PROPERTY: evidence, not intention, decides what is named ─────────────────────────────
const requested = [
  { name: "PEITHO", pmid: "24716681", year: 2014 },
  { name: "PROSEVA", pmid: "23688302", year: 2013 },
  { name: "MISSING", pmid: "11111111", year: 2000 },
];
const response = {
  trials: [
    { pmid: "24716681", title: "Fibrinolysis…", journal: "NEJM", year: 2014, abstract: "…2.6% … 5.6% …" },
    { pmid: "23688302", title: "Prone positioning…", journal: "NEJM", year: 2013, abstract: "   " },
  ],
  missing: ["11111111"],
};
const out = namedTrialsFromResponse(requested, response);
ok(names(out.named).join(",") === "PEITHO",
   "only the trial with a real abstract is named");
ok(names(out.unsupported).sort().join(",") === "MISSING,PROSEVA",
   "a trial that did not come back AND one that came back blank are BOTH unsupported");
ok(out.named[0].abstract.includes("2.6%") && out.named[0].abstract.includes("5.6%"),
   "the named trial carries the abstract text, not just its identity");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ TRIAL SELECTION OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
