// The benchmark harness is the instrument that decides which models are allowed to write medical
// content. An instrument that reports a PASS when it could not actually measure anything is worse than
// no instrument, so these tests cover the harness itself. Run: node test_eval_harness.mjs
//
// Defect this suite exists for (found 2026-07-26): both verifiers fail OPEN by design — a flaky NLM
// endpoint must not fail a good talk. But the summary then printed "fabricated citations 0 · drug
// misspellings 0" and the gate printed "✔ SAFETY GATE PASSED", identically to a run where every
// citation had been confirmed real. Fabrication detection IS the gate; an unreachable verifier must
// yield INCONCLUSIVE, never PASSED.
import { readFileSync } from "fs";
import vm from "vm";

const src = readFileSync(new URL("./rag/eval_gemini_quality.mjs", import.meta.url), "utf8");
let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

function fnSrc(name) {
  const i = src.indexOf("async function " + name + "(") >= 0
    ? src.indexOf("async function " + name + "(")
    : src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("fn not found: " + name);
  let s = src.indexOf("{", i), d = 0;
  for (let j = s; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}") { d--; if (d === 0) return src.slice(i, j + 1); } }
  throw new Error("unbalanced: " + name);
}

// ── 1) BEHAVIOURAL: an unreachable RxNorm must be counted, not silently swallowed ──
{
  const ctx = {
    console: { log() {}, warn() {} },
    // every RxNorm lookup fails, exactly as it does from a sandbox with no NLM egress
    fetch: async () => { throw new Error("getaddrinfo EAI_AGAIN rxnav.nlm.nih.gov"); },
    Map, Set, encodeURIComponent, Promise, Date, setTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext([
    "const rxCache = new Map();",
    "let rxNext = 0;",   // module-scope throttle cursor rxnormKnows() closes over
    fnSrc("rxnormKnows"),
    fnSrc("verifyDrugFlags"),
  ].join("\n"), ctx);
  const verify = vm.runInContext("verifyDrugFlags", ctx);

  // a local near-miss (we already suspect it) and a drug-shaped unknown (only RxNorm could judge it)
  const cands = [
    { found: "apixiban", closest: "apixaban", distance: 1 },
    { found: "vericigat", closest: "(not in local list — needs RxNorm check)", distance: null, needsCheck: true },
  ];
  const out = await verify(cands);
  ok(typeof out.unverified === "number", "verifyDrugFlags() reports HOW MANY candidates RxNorm could not adjudicate");
  ok(out.unverified === 2, `both candidates counted as unverified when RxNorm is down (got ${out.unverified})`);
  ok(out.length === 1 && out[0].found === "apixiban", "the local near-miss is still flagged (fails open, not blind)");
  ok(/RxNorm unreachable/.test(out[0].note || ""), "the flag records that it rests on the local list alone");
  ok(!out.some(o => o.needsCheck), "a drug-shaped UNKNOWN is not flagged on suspicion alone (no false accusation)");
}

// ── 2) the per-row soft counters exist and are summed ───────────────────────────
ok(/soft\.uncheckable_pmids = uncheckable/.test(src), "rows record uncheckable_pmids (PMIDs never confirmed to exist)");
ok(/if \(bad\.unverified\) soft\.unverified_drug_candidates = bad\.unverified;/.test(src),
   "rows record unverified_drug_candidates");
ok(/uncheckable_pmids: unchkPmid/.test(src) && /unverified_drug_candidates: unchkDrug/.test(src),
   "the summary aggregates BOTH not-verified counts across all rows");
ok(/NOT VERIFIED/.test(src), 'the printed summary labels the zeros as "unknown", not "clean"');

// ── 3) THE GATE MUST NOT PASS ON UNVERIFIED EVIDENCE ───────────────────────────
{
  const iGuard = src.indexOf("if (g.uncheckable_pmids > 0 || g.unverified_drug_candidates > 0) {");
  const iPass = src.indexOf("✔ SAFETY GATE PASSED");
  ok(iGuard > 0, "the gate checks whether the verifiers actually ran");
  ok(iPass > 0 && iGuard < iPass, "that check runs BEFORE the PASSED line can print (order is the whole safety property)");
  const guard = src.slice(iGuard, iPass);
  ok(/GATE INCONCLUSIVE/.test(guard), "an unmeasured run is INCONCLUSIVE");
  ok(/process\.exit\(2\)/.test(guard), "it exits 2 (distinct from 0 pass / 1 hard fail) so CI can tell them apart");
  ok(/CANNOT clear a writer/.test(guard), "the message states the consequence: this run cannot clear a writer");
  ok(/ebi\.ac\.uk/.test(guard) && /rxnav\.nlm\.nih\.gov/.test(guard), "it names the hosts that must be reachable");
}

// ── 4) reference-only mode: rerun production routing with no rival arm ─────────
ok(/--no-candidate/.test(src) && /--reference-only/.test(src), "--no-candidate / --reference-only exists");
ok(/const RUN_CANDIDATE = !NO_CANDIDATE;/.test(src), "the candidate arm is switchable");
ok(/const RUN_JUDGE = RUN_CLAUDE && RUN_CANDIDATE && !NO_JUDGE;/.test(src),
   "the A/B judge is disabled with one arm (nothing to compare)");
ok(/const geminiP = !RUN_CANDIDATE \? Promise\.resolve\(null\) :/.test(src),
   "reference-only spends NOTHING on a candidate generation");
ok(/NO_CANDIDATE && !CLAUDE_KEY/.test(src), "reference-only requires ANTHROPIC_API_KEY (it is the only arm)");
{
  // the gate must follow the arm under test, or a reference-only run would grade a null candidate
  ok(/const GATED_ARM = RUN_CANDIDATE \? "gemini" : "claude";/.test(src), "the gate targets the arm actually under test");
  ok(/const g = RUN_CANDIDATE \? summary\.gemini : summary\.claude;/.test(src),
     "reference-only applies the ABSOLUTE criteria to the reference model itself (Codex: no automatic pass)");
  ok(/r\[GATED_ARM\]\?\.hard/.test(src), "the hard-fail list is read from the arm under test");
}

// ── 5) the prompts must still be extracted live, never copied ──────────────────
ok(/extractVarString\("LECTURE_PROMPT"\)/.test(src) && /extractVarString\("BOARDS_PROMPT"\)/.test(src),
   "prompts are extracted from index.html at run time, so a prompt change is always what gets benchmarked");
ok(!/ONLY JSON:\{"title"/.test(src), "the harness holds no hardcoded copy of the schema to drift out of sync");

console.log("\n" + (failures === 0 ? "✔ EVAL HARNESS TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
