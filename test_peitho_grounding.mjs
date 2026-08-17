// THE DECISIVE REGRESSION — run: node test_peitho_grounding.mjs
//
// PEITHO's primary endpoint is 2.6% with tenecteplase versus 5.6% with placebo. Chalk Talk has stated it
// the other way round — implying lysis INCREASED events — in rag/eval_paired_2026-07-27.json and again in
// the 2026-07-26 eval. The correct sentence was in the corpus the whole time (PMID 24716681); nothing
// ever put it in front of the model, because a trial was named by acronym and never fetched.
//
// This asserts the sentence reaches BOTH prompts: the writer's, so the figure is copied rather than
// recalled, and the reviewer's, so a recalled figure can be caught. It does NOT assert the model uses it
// correctly — no offline test can. That is what the PE canary is for.
import { readFileSync } from "fs";
import vm from "node:vm";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const src     = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const index   = JSON.parse(readFileSync(new URL("./landmark_pmids.json", import.meta.url), "utf8")).trials;
const guides  = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8"));
const fixture = JSON.parse(readFileSync(new URL("./rag/fixtures/trial_evidence_peitho.json", import.meta.url), "utf8"));

// The exact clause. Both figures, both arm names, in the published order — so a future change that swaps
// the arms, drops a number, or truncates the abstract before RESULTS fails here.
const ORIENTATION = "(2.6%) in the tenecteplase group as compared with 28 of 499 (5.6%) in the placebo group";

function fnSrc(name){
  let start = src.indexOf(`function ${name}(`);
  if(start < 0) throw new Error(`missing ${name}`);
  // Keep a leading `async`. Slicing from "function" alone strips it, and the extracted source then
  // throws "await is only valid in async functions" — which looks like a bug in the code under test.
  if(src.slice(Math.max(0, start - 6), start) === "async ") start -= 6;
  const open = src.indexOf("{", start);
  let d=0,q=null,e=false;
  for(let i=open;i<src.length;i++){ const c=src[i];
    if(q){ if(e) e=false; else if(c==="\\") e=true; else if(c===q) q=null; continue; }
    if(c==='"'||c==="'"||c==="`"){ q=c; continue; }
    if(c==="{") d++; else if(c==="}" && --d===0) return src.slice(start,i+1);
  }
  throw new Error(`unclosed ${name}`);
}

let requestedPmids = null;
const ctx = {
  GUIDELINES: guides.specialties,
  LANDMARK_PMIDS: index,
  TRIALS_REQUEST_MAX: Number((src.match(/var TRIALS_REQUEST_MAX = (\d+);/) || [])[1]),
  RAG_CONFIG: { url: "https://example.invalid" },
  BOARDS_DIFFICULTY: { 4: { label: "Board-level", directive: "" } },
  boardsDifficulty: () => 4,
  writeAllowedModels: (m) => m,
  MODEL_MAIN: (src.match(/var MODEL_MAIN = "([^"]+)"/) || [])[1],
  MODEL_SONNET_FALLBACK: (src.match(/var MODEL_SONNET_FALLBACK = "([^"]+)"/) || [])[1],
  MODEL_CRITIC: (src.match(/var MODEL_CRITIC = "([^"]+)"/) || [])[1],
  LECTURE_CRITIQUE_PROMPT: "LECTURE_CRITIQUE", BOARDS_CRITIQUE_PROMPT: "BOARDS_CRITIQUE",
  console: { info(){}, warn(){} },
  // The Worker is stubbed, the DATA is real: this response is a verbatim copy of what /trials returns for
  // PMID 24716681, so the assertion is about our plumbing, not about a hand-written abstract.
  async fetch(url, opts){
    requestedPmids = JSON.parse(opts.body).pmids;
    return { ok: true, json: async () => fixture.response };
  },
};
vm.createContext(ctx);
vm.runInContext(["normTrialName","resolveTrials","trialNamedDistinctly","rankTrialsForRequest",
  "namedTrialsFromResponse","fetchTrialEvidence","trialsMentionedIn","buildTrialEvidenceBlock",
  "gatherTrialEvidence","getGuidelinesForTopic","buildCritiqueSpec"].map(fnSrc).join("\n")
  + "\nthis.gather=gatherTrialEvidence; this.spec=buildCritiqueSpec; this.gl=getGuidelinesForTopic;"
  + "this.block=buildTrialEvidenceBlock; this.mentioned=trialsMentionedIn;", ctx);

const TOPIC = "Pulmonary embolism risk stratification";
const glRef = ctx.gl(TOPIC);
const ev = await ctx.gather(TOPIC, glRef, []);

// ── the request ─────────────────────────────────────────────────────────────────────────────────────
ok(requestedPmids && requestedPmids.includes("24716681"),
   "PEITHO's PMID is actually requested from /trials for a PE topic");

// ── the WRITER prompt ───────────────────────────────────────────────────────────────────────────────
ok(ev.named.some(t => t.name === "PEITHO"), "PEITHO is named, because its abstract came back");
ok(ev.block.includes(ORIENTATION),
   "WRITER: the full orientation sentence — tenecteplase 2.6%, placebo 5.6% — is in the evidence block");
ok(/guidelineContext \+= _ev\.block;/.test(src),
   "…and that block is appended to the guideline context the draft is written from");
ok(src.indexOf('guidelineContext += "\\n═══ END GUIDELINE CONTEXT ═══";') < src.indexOf("guidelineContext += _ev.block;"),
   "…after the guideline block closes, so it is its own section rather than buried inside one");
ok(ev.pmids.includes("24716681"), "the exact grounded PMID is recorded, not just a count");

// ── the REVIEWER prompt ─────────────────────────────────────────────────────────────────────────────
const critique = ctx.spec("lecture", TOPIC, glRef, [], ev.block);
ok(critique.prefix.includes(ORIENTATION),
   "REVIEWER: the same sentence reaches the critique prefix, so a recalled figure can be contradicted");
ok(critique.prefix.indexOf("PMID: 24716681") > 0, "…attached to the PMID the talk is told to cite");

// ── the union: a trial the DRAFT names that the topic did not ───────────────────────────────────────
const draft = JSON.stringify({ title: "PE", sections: [{ points: ["PEITHO showed benefit"] }] });
ok(ctx.mentioned(draft, index).some(t => t.name === "PEITHO"),
   "a draft naming PEITHO is recognised, so the reviewer gets its paper even off-topic");

// ── the guard that stops this fix causing a new harm ────────────────────────────────────────────────
ok(/absence is not evidence that a\n *\/\/ citation is wrong/.test(src) ||
   ev.block.includes("its absence is not evidence") || ev.block.includes("Its absence is not evidence"),
   "the block tells the reviewer that a source missing from it is NOT grounds to strip a citation");

// ── no evidence, no name ────────────────────────────────────────────────────────────────────────────
ctx.fetch = async () => ({ ok: true, json: async () => ({ trials: [], missing: ["24716681"] }) });
const empty = await ctx.gather(TOPIC, glRef, []);
ok(empty.named.length === 0 && empty.block === "",
   "when /trials returns nothing, NO trial is named and no block is built");
ctx.fetch = async () => { throw new Error("network down"); };
const down = await ctx.gather(TOPIC, glRef, []);
ok(down.named.length === 0 && down.block === "",
   "a /trials outage names no trials rather than falling back to acronyms with no papers");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ PEITHO GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
