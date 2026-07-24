// Trust-but-verify test: verifyModelPmids() promotes real un-retrieved model PMIDs to pubmed-verified
// and DROPS fabricated ones — with a mocked PubMed (no network). Extracts live code from index.html.
// Run: node test_pubmed_verify.mjs
import { readFileSync } from "fs";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
function ok(c, m){ console.log((c?"✓":"✗ FAIL")+" — "+m); if(!c) failures++; }

function extractFn(name){
  let i = html.indexOf("function " + name + "(");
  if(i < 0) throw new Error("fn not found: " + name);
  if(html.slice(Math.max(0,i-6), i).includes("async")) i -= 6;
  let s = html.indexOf("{", i), d = 0, j = s;
  for(; j < html.length; j++){ if(html[j]==="{") d++; else if(html[j]==="}"){ d--; if(d===0) break; } }
  return html.slice(i, j+1);
}
function extractConst(name){ const m = html.match(new RegExp("var\\s+"+name+"\\s*=.*?;","s")); if(!m) throw new Error("const "+name); return m[0]; }

const fns = ["_safeUrl","_refTypeFor","_confidenceOf","_assignConfidence","_stripChipIds","_esummaryBatch","verifyModelPmids"].map(extractFn).join("\n\n");

// mocked PubMed: 30926722 real, 99999999 not found
function makeCtx(fetchImpl){
  const ctx = { console, S: { ragChunks: [{ pmid:"12345678", text:"abs", title:"Retrieved paper" }], pubmedDropped:0 },
    fetch: fetchImpl, AbortController: globalThis.AbortController, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(extractConst("_CONF_RANK") + "\n\n" + fns, ctx);
  return ctx;
}
const goodFetch = async () => ({ ok:true, json: async () => ({ result: {
  "30926722": { uid:"30926722", title:"Antithrombotic Therapy for VTE: CHEST Guideline.", pubdate:"2021 Aug", fulljournalname:"Chest" },
  "99999999": { error:"cannot get document summary" }
}})});

function baseTalk(){
  return { sections:[{ heading:"Tx", points:["Use DOACs first [1]", "Steroids x5 days [2]", "Retrieved-backed claim [3]"] }],
    references:[
      { id:1, pmid:"30926722", source:"model's guess title", year:2019, society:"NEJM" },   // real, un-retrieved → promote
      { id:2, pmid:"99999999", source:"Invented Trial", year:2024, society:"NEJM" },          // fabricated → drop
      { id:3, pmid:"12345678", source:"Retrieved paper", year:2020, society:"ACC" }           // retrieved → skip
    ] };
}

// ── 1) happy path: promote real, drop fabricated, skip retrieved ─────────────
const ctx = makeCtx(goodFetch);
const out = await vm.runInContext("verifyModelPmids", ctx)(baseTalk());
const r1 = out.references.find(r=>r.id===1);
const r2 = out.references.find(r=>r.id===2);
const r3 = out.references.find(r=>r.id===3);
ok(r1 && r1.src_verified === "pubmed", "real un-retrieved PMID promoted to src_verified:pubmed");
ok(r1 && /CHEST Guideline/.test(r1.source) && r1.year === 2021 && r1.society === "Chest", "promoted ref gets canonical PubMed title/journal/year");
ok(r1 && r1.url === "https://pubmed.ncbi.nlm.nih.gov/30926722/", "promoted ref gets the PubMed URL");
ok(!r2, "fabricated PMID (not found on PubMed) is dropped from references");
ok(!/\[2\]/.test(out.sections[0].points[1]), "dropped ref's [2] chip is stripped from the body");
ok(r3 && !r3.src_verified, "already-retrieved PMID is left untouched (not re-verified)");
ok(/\[1\]/.test(out.sections[0].points[0]) && /\[3\]/.test(out.sections[0].points[2]), "surviving chips [1] and [3] are intact");
ok((out.references||[]).some(r=>r.id===1 && r.confidence==="high"), "promoted ref is now HIGH confidence (renders as a trusted chip)");

// ── 2) fail-open: network error must NOT drop or promote anything ────────────
const ctxDown = makeCtx(async () => { throw new Error("network down"); });
const out2 = await vm.runInContext("verifyModelPmids", ctxDown)(baseTalk());
ok(out2.references.length === 3, "network failure → nothing dropped (fail open)");
ok(!out2.references.find(r=>r.id===1).src_verified, "network failure → nothing promoted (fail open)");

// ── 3) source guards: the prompt conflict fix + wiring ───────────────────────
ok(/an uncited key point is fully acceptable/.test(html), "BOARDS KEY POINT no longer force-cites (uncited is acceptable)");
ok(!/not a list\. End it with an inline citation marker like \[1\]\./.test(html), "removed the unconditional 'End it with [1]' KEY POINT mandate");
ok((html.match(/verifyCitations\(await verifyModelPmids\(/g)||[]).length >= 3, "verifyModelPmids runs before verifyCitations in all audit paths");

console.log("\n" + (failures === 0 ? "✔ PUBMED-VERIFY TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
