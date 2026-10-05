// GUIDELINE PRIMARY ROUTING — run: node test_guideline_primary_routing.mjs
//
// 2026-10-04: a statin talk came back teaching the 2018 cholesterol guideline while guidelines.json held
// the 2026 edition. The writer received every Cardiovascular entry in JSON order with nothing marking the
// one that governed the topic, so it wrote from memory. getGuidelinesForTopic now scores entries against
// the topic and labels the best match PRIMARY. This suite pins that behaviour: the lipid phrasings a
// resident would actually type must put 2026 Dyslipidemia first, and the PRIMARY line must tell the
// writer it supersedes the 2018 edition. Codex's review named the first four phrasings.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const src = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n;\n");
function grab(name) {
  const i = src.indexOf(name); if (i < 0) throw new Error("not found: " + name);
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); } }
}
const code = grab("function getGuidelinesForTopic");   // self-contained: scorer + alias tables live inside it
const GUIDELINES = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;
// The matcher consults the TOPICS picker and its category→specialty map when present; the keyword path
// alone must carry these cases, so both are stubbed empty here.
const TOPIC_CATEGORY_SPECIALTY = {}, _TOPICS = {};
const getGuidelinesForTopic = new Function("GUIDELINES", "TOPIC_CATEGORY_SPECIALTY", "_TOPICS", code + "\nreturn getGuidelinesForTopic;")(GUIDELINES, TOPIC_CATEGORY_SPECIALTY, _TOPICS);

const expect = [
  ["statin", /Dyslipidemia/], ["cholesterol", /Dyslipidemia/], ["LDL", /Dyslipidemia/], ["ASCVD prevention", /Dyslipidemia/],
  ["hyperlipidemia", /Dyslipidemia/], ["Statins and lipid management", /Dyslipidemia/], ["Lp(a)", /Dyslipidemia/],
  ["Sepsis", /Surviving Sepsis/], ["COPD exacerbation", /GOLD/], ["DKA", /Hyperglycemic Crises/],
  ["Atrial fibrillation anticoagulation", /Atrial Fibrillation/], ["Hypertension management", /Hypertension/],
];
for (const [topic, re] of expect) {
  const r = getGuidelinesForTopic(topic);
  const primary = r && r.primary || "(none)";
  ok(re.test(primary), `"${topic}" → PRIMARY is ${primary}`);
  if (r) ok(r.sources[0] === r.primary, `   …and the first 📚 chip is the primary (${r.sources[0]})`);
}

// A topic with no clear match must get NO primary rather than a coin-flip.
const hk = getGuidelinesForTopic("Hyperkalemia");
ok(!hk || !hk.primary, `"Hyperkalemia" gets no PRIMARY (got ${hk && hk.primary})`);

// The PRIMARY block carries the override sentence, and names the superseded edition when the JSON has it.
const st = getGuidelinesForTopic("statin");
ok(/\[PRIMARY GUIDELINE FOR THIS TOPIC/.test(st.context), "context opens with the PRIMARY header");
ok(/supersedes the 2018 AHA\/ACC cholesterol guideline/.test(st.context), "PRIMARY names the superseded 2018 edition from the supersedes field");
ok(/never present the earlier edition as current/.test(st.context), "PRIMARY carries the override instruction");
ok(st.context.indexOf("[PRIMARY") < st.context.indexOf("[Supporting — "), "PRIMARY precedes the supporting block");
ok(/Each entry below is the CURRENT edition/.test(st.context), "context carries the editions-are-authoritative preamble");

// The dyslipidemia entry itself carries the 2026 practice-changers the model regresses on.
const dys = GUIDELINES.Cardiovascular.guidelines.find(g => g.name === "2026 ACC/AHA Dyslipidemia");
ok(dys && dys.supersedes === "2018 AHA/ACC cholesterol guideline", "2026 Dyslipidemia has a structured supersedes field");
for (const term of ["PREVENT", "Lp(a)", "CAC >=300", "apoB", "inclisiran", "UPFRONT", "bempedoic", "LDL <55"])
  ok(dys && dys.keys.includes(term), `2026 Dyslipidemia summary mentions ${term}`);

console.log(`\n${n - failures}/${n} passed`);
process.exit(failures ? 1 : 0);
