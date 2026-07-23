// Guideline JSON-source test (migration gate + ongoing regression guard).
//
// One-time migration gate (2026-07): before the embedded GUIDELINES object was removed from index.html,
// this test proved guidelines.json produced BYTE-IDENTICAL data and getGuidelinesForTopic() context to
// the embed across representative + cross-specialty topics. That gate PASSED, so the embed was removed.
//
// Ongoing: guidelines.json is the single source of truth. This test (a) validates its structure, (b) runs
// the LIVE getGuidelinesForTopic() over it for representative topics and checks routing + non-empty
// context + society headers, and (c) if the pre-migration embed is still reachable via git, re-runs the
// strict old-vs-new equivalence. Run: node test_guidelines_source.mjs
import { readFileSync } from "fs";
import { execSync } from "child_process";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
function ok(cond, msg){ console.log((cond ? "✓" : "✗ FAIL") + " — " + msg); if(!cond) failures++; }

function sliceBalanced(src, startIdx){
  const objStart = src.indexOf("{", startIdx);
  let d = 0;
  for(let i = objStart; i < src.length; i++){
    const c = src[i];
    if(c === "\""){ i++; while(i < src.length && src[i] !== "\""){ if(src[i] === "\\") i++; i++; } continue; }
    if(c === "{") d++; else if(c === "}"){ d--; if(d === 0) return src.slice(objStart, i + 1); }
  }
  throw new Error("unbalanced");
}
function grabVarObject(src, name){ return Function("return (" + sliceBalanced(src, src.indexOf("var " + name)) + ")")(); }
function grabFnSource(src, name){
  const i = src.indexOf("function " + name + "(");
  let s = src.indexOf("{", i), d = 0;
  for(let j = s; j < src.length; j++){ if(src[j] === "{") d++; else if(src[j] === "}"){ d--; if(d === 0) return src.slice(i, j + 1); } }
  throw new Error("fn not found: " + name);
}

const fromJson = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;

// ---- 1) structure integrity -------------------------------------------------
ok(fromJson && typeof fromJson === "object" && Object.keys(fromJson).length >= 20, "guidelines.json has the specialties map (" + Object.keys(fromJson).length + ")");
let structOk = true, ng = 0, nt = 0, nc = 0;
for(const spec of Object.keys(fromJson)){
  const s = fromJson[spec];
  if(!s.society || !Array.isArray(s.guidelines)) structOk = false;
  ng += (s.guidelines||[]).length; nt += (s.trials||[]).length; nc += (s.conferences||[]).length;
}
ok(structOk, "every specialty has a society label + guidelines[] array");
ok(ng >= 150 && nt >= 100 && nc >= 40, "carries guidelines/trials/conferences (" + ng + "/" + nt + "/" + nc + ")");

// ---- 2) LIVE getGuidelinesForTopic over the json source ---------------------
const TOPICS = grabVarObject(html, "TOPICS");
const ctx = { GUIDELINES: fromJson, TOPICS, console };
vm.createContext(ctx);
vm.runInContext(grabFnSource(html, "getGuidelinesForTopic"), ctx);
const run = vm.runInContext("getGuidelinesForTopic", ctx);

const cases = [
  ["HFrEF with GDMT", ["Cardiovascular"]],
  ["type 2 diabetes with CKD", ["Nephrology", "Endocrinology"]],
  ["pulmonary embolism risk stratification", ["Pulmonary"]],
  ["community acquired pneumonia", ["Pulmonary", "ID"]],
  ["cirrhosis with hepatorenal syndrome", ["GI/Hepatology"]],
  ["heparin induced thrombocytopenia (HIT)", ["Heme/Onc"]],
  ["ANCA vasculitis", ["Rheumatology"]]
];
cases.forEach(([topic, expectSpecs]) => {
  const r = run(topic);
  const routed = r && r.specialties && expectSpecs.every(s => r.specialties.includes(s));
  const rich = r && r.context && r.context.length > 100 && /Guidelines\]/.test(r.context) && r.sources.length > 0;
  ok(routed && rich, "\"" + topic + "\" routes to [" + expectSpecs.join(",") + "] with non-empty guideline context");
});

// tamper sanity: a changed summary must change the context
const tampered = JSON.parse(JSON.stringify(fromJson));
tampered.Nephrology.guidelines[0].keys += " XX";
ctx.GUIDELINES = fromJson; const base = run("CKD and GDMT");
ctx.GUIDELINES = tampered; const tamp = run("CKD and GDMT");
ctx.GUIDELINES = fromJson;
ok(JSON.stringify(base) !== JSON.stringify(tamp), "sanity: a tampered source changes the context");

// ---- 3) best-effort strict equivalence vs the pre-migration embed -----------
try {
  const base = execSync("git merge-base HEAD main", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  const oldHtml = execSync("git show " + base + ":index.html", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if(oldHtml.includes("var GUIDELINES = {")){
    const embedded = grabVarObject(oldHtml, "GUIDELINES");
    ok(JSON.stringify(embedded) === JSON.stringify(fromJson), "STRICT: guidelines.json byte-identical to the pre-migration embedded GUIDELINES");
    let ctxSame = true;
    cases.forEach(([topic]) => {
      ctx.GUIDELINES = embedded; const a = run(topic);
      ctx.GUIDELINES = fromJson; const b = run(topic);
      if(JSON.stringify(a) !== JSON.stringify(b)) ctxSame = false;
    });
    ctx.GUIDELINES = fromJson;
    ok(ctxSame, "STRICT: context identical (pre-migration embed vs json) across all topics");
  } else {
    console.log("• (embed already removed at merge-base — strict old-vs-new check skipped; gate passed at migration time)");
  }
} catch(e) {
  console.log("• (git not available for strict equivalence — skipped: " + e.message.split("\n")[0] + ")");
}

console.log("\n" + (failures === 0 ? "✔ GUIDELINE SOURCE TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
