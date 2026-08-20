// ROUTING COVERAGE — run: node test_routing_coverage.mjs
//
// EVERY topic in the catalogue must reach guideline grounding, and reach the RIGHT specialty.
//
// This exists because 107 of 768 topics — 14% of the app — were being drafted with no guideline context
// at all, silently, for as long as the category names had existed. getGuidelinesForTopic returned null
// and generation carried on; an ungrounded talk looks exactly like a grounded one until a number in it
// happens to be wrong. The defects were found ONE CARD AT A TIME through physician review, which is the
// slowest possible way to learn about a bug that a loop can enumerate in 30 milliseconds.
//
// The cause was substring guessing over human-written display names: the fallback tested
// cat.indexOf("GI") and cat.indexOf("ID") against categories actually named "Gastroenterology" and
// "Infectious Disease". Four more categories had no branch at all.
//
// WHY THERE IS NO CATCH-ALL, and why this suite forbids one. Routing an unmapped category to a generic
// or nearest-guess specialty would trade a VISIBLE absence of grounding for confident WRONG grounding —
// a talk citing nephrology guidance at an ENT topic reads perfectly plausible and is far harder to
// catch than one citing nothing. Missing grounding must stay loud. Topics that genuinely have no
// specialty go in the allowlist below, by name, and nowhere else.
import { readFileSync } from "fs";
import vm from "node:vm";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;

// ── lift the real function, the real table, and the real catalogue ──────────────────────────────────
function fnSrc(name){
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error("missing " + name);
  const open = html.indexOf("{", start);
  let d = 0, q = null, e = false;
  for (let i = open; i < html.length; i++) { const c = html[i];
    if (q) { if (e) e = false; else if (c === "\\") e = true; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === "{") d++; else if (c === "}" && --d === 0) return html.slice(start, i + 1);
  }
  throw new Error("unclosed " + name);
}
function objSrc(name){
  const at = html.indexOf(`var ${name} = {`);
  if (at < 0) throw new Error("missing " + name);
  return html.slice(at, html.indexOf("};", at) + 2);
}
// The REAL catalogue, not a stub. A stub here would test the stub.
const tAt = html.indexOf("var TOPICS"), tEq = html.indexOf("=", tAt);
let depth = 0, i = html.indexOf("{", tEq); const tStart = i;
for (; i < html.length; i++) { if (html[i] === "{") depth++; else if (html[i] === "}" && --depth === 0) break; }
const TOPICS = (0, eval)("(" + html.slice(tStart, i + 1) + ")");

const ctx = { GUIDELINES: G, TOPICS, String, Object, console: { warn(){} } };
vm.createContext(ctx);
function arrSrc(name){
  const at = html.indexOf(`var ${name} = [`);
  if (at < 0) throw new Error("missing " + name);
  return html.slice(at, html.indexOf("];", at) + 2);
}
vm.runInContext(arrSrc("COMPOUND_ROUTES") + "\n" + objSrc("TOPIC_CATEGORY_SPECIALTY") + "\n"
  + fnSrc("getGuidelinesForTopic")
  + "\nthis.route = getGuidelinesForTopic; this.MAP = TOPIC_CATEGORY_SPECIALTY; this.COMPOUND = COMPOUND_ROUTES;", ctx);
const { route, MAP, COMPOUND } = ctx;

// ── EXPECTED mapping, declared HERE and independently ───────────────────────────────────────────────
// Deliberately not read from the app. Comparing the app to itself would pass with every value wrong;
// this is the assertion that a topic reaches the CORRECT specialty rather than merely some guideline.
const EXPECTED = {
  "Allergy and Immunology": "Allergy/Immuno",
  "Cardiovascular Disease": "Cardiovascular",
  "Dermatology": "Dermatology",
  "Endocrinology, Diabetes, Metabolism": "Endocrinology",
  "Gastroenterology": "GI/Hepatology",
  "Geriatric Syndromes": "Geriatrics",
  "Hematology": "Heme/Onc",
  "Infectious Disease": "ID",
  "Medical Oncology": "Oncology",
  "Miscellaneous": "Miscellaneous",
  "Nephrology and Urology": "Nephrology",
  "Neurology": "Neurology",
  "Obstetrics and Gynecology": "Women's Health",
  "Ophthalmology": "Ophthalmology",
  "Otolaryngology and Dental": "Otolaryngology",
  "Psychiatry": "Psychiatry",
  "Pulmonary Disease": "Pulmonary",
  "Rheumatology and Orthopedics": "Rheumatology",
};

// The six that were unmapped and cost 107 topics their grounding. Named individually so that removing
// any one of them fails HERE with its own line, rather than as a count that someone adjusts.
const THE_SIX = ["Infectious Disease", "Gastroenterology", "Ophthalmology",
                 "Obstetrics and Gynecology", "Otolaryngology and Dental", "Miscellaneous"];

// ── ALLOWLIST: topics that may route to null, BY NAME. Never a pattern, never a prefix. ─────────────
// Empty on purpose. If a topic genuinely has no specialty, add it here with a reason and it becomes a
// deliberate, reviewed exception instead of a silent gap.
const MAY_BE_UNGROUNDED = new Set([]);

// ── 1. every category is mapped, to the right specialty, and the specialty exists ───────────────────
const cats = Object.keys(TOPICS);
ok(cats.length === Object.keys(EXPECTED).length,
   `every catalogue category is accounted for (${cats.length} in TOPICS, ${Object.keys(EXPECTED).length} expected)`);
const unmapped = cats.filter(c => !MAP[c]);
ok(unmapped.length === 0, `every category has a routing entry${unmapped.length ? " — MISSING: " + unmapped.join(", ") : ""}`);
const wrong = cats.filter(c => EXPECTED[c] && MAP[c] !== EXPECTED[c]).map(c => `${c} -> ${MAP[c]} (expected ${EXPECTED[c]})`);
ok(wrong.length === 0, `every category maps to the CORRECT specialty${wrong.length ? " — WRONG: " + wrong.join("; ") : ""}`);
const ghost = Object.values(MAP).filter(v => !G[v]);
ok(ghost.length === 0, `every mapped specialty exists in guidelines.json${ghost.length ? " — GHOST: " + ghost.join(", ") : ""}`);
for (const c of THE_SIX) ok(MAP[c] === EXPECTED[c], `the previously-unmapped "${c}" routes to ${EXPECTED[c]}`);

// ── 2. ALL 768 topics, executed, with the full failing list printed ─────────────────────────────────
const all = [];
for (const cat of cats) for (const sub of Object.keys(TOPICS[cat].topics || {}))
  for (const t of TOPICS[cat].topics[sub]) all.push({ topic: t, cat });
ok(all.length > 700, `the whole catalogue is under test (${all.length} topics)`);

const nulls = [], miscat = [];
for (const { topic, cat } of all) {
  if (MAY_BE_UNGROUNDED.has(topic)) continue;
  const r = route(topic);
  if (!r) { nulls.push(`${cat} :: ${topic}`); continue; }
  if (!r.specialties.includes(EXPECTED[cat])) miscat.push(`${cat} :: ${topic} -> [${r.specialties.join(", ")}]`);
}
if (nulls.length) { console.log(`\n  UNGROUNDED (${nulls.length}):`); nulls.forEach(x => console.log("    " + x)); console.log(); }
ok(nulls.length === 0, `no catalogue topic routes to null (${nulls.length} ungrounded)`);
if (miscat.length) { console.log(`\n  WRONG SPECIALTY (${miscat.length}):`); miscat.forEach(x => console.log("    " + x)); console.log(); }
ok(miscat.length === 0, `every topic reaches its own specialty, not merely some guideline (${miscat.length} misrouted)`);

// ── 3. capitalisation variants ──────────────────────────────────────────────────────────────────────
// Topics arrive title-cased from the picker and free-typed from the compose box; the catalogue stores
// sentence case. A case-sensitive === here is what made "Acute Pericarditis" miss its own entry.
const caseFails = [];
for (const { topic, cat } of all) {
  if (MAY_BE_UNGROUNDED.has(topic)) continue;
  for (const v of [topic.toLowerCase(), topic.toUpperCase(),
                   topic.replace(/\b\w/g, ch => ch.toUpperCase())]) {
    const r = route(v);
    if (!r || !r.specialties.includes(EXPECTED[cat])) caseFails.push(`${cat} :: "${v}"`);
  }
}
if (caseFails.length) { console.log(`\n  CASE FAILURES (${caseFails.length}):`); caseFails.slice(0, 40).forEach(x => console.log("    " + x)); console.log(); }
ok(caseFails.length === 0, `routing survives lower, UPPER and Title case for all ${all.length} topics (${caseFails.length} failures)`);

// ── 3b. NO SPECIALTY ARRIVES FROM A MATCH INSIDE A LONGER WORD ─────────────────────────────────────
// The assertions above only check that the RIGHT specialty is present. They cannot see a WRONG one
// riding along — and once the catalogue is unioned in, every topic has its correct specialty even when
// a keyword also matched garbage. Reverting to bare indexOf() survived the entire mutation pass because
// of exactly that blind spot.
//
// This is general rather than a list of canaries: pull the real keyword table, find every place a
// keyword appears INSIDE a longer word in a real topic, and assert that specialty is not in the result
// unless something legitimate also put it there. "tens" inside "hyperTENSive" must never make a
// hypertensive emergency talk cite dermatology guidelines.
const fnBody = fnSrc("getGuidelinesForTopic");
const kwStart = fnBody.indexOf("var kwMap = {");
const kwMap = (0, eval)("(" + fnBody.slice(fnBody.indexOf("{", kwStart), fnBody.indexOf("};", kwStart) + 1) + ")");
ok(Object.keys(kwMap).length > 10, `sanity: the real keyword table was lifted (${Object.keys(kwMap).length} specialties)`);

// EXPLICIT EXCEPTIONS, BY EXACT TRIPLE. Medical terms compound in ways ordinary words do not:
// poly-MYOSITIS and dermato-MYOSITIS genuinely ARE myositis, so a mid-word match there is medically
// correct rather than a collision. That is a real exception and it is listed by name — the rule is not
// loosened to "allow mid-word matches over 6 characters" or any similar heuristic, which would let
// hyperTENSive back in. Each line is a claim someone reviewed.
const ACCEPTED_MID_WORD = new Set([
  'Polymyositis & dermatomyositis|Rheumatology|myositis',   // polymyositis IS myositis; correct grounding
]);

const midWord = [];
for (const { topic, cat } of all) {
  const t = topic.toLowerCase();
  for (const spec of Object.keys(kwMap)) {
    if (spec === EXPECTED[cat]) continue;             // its own category may legitimately supply it
    for (const kw of kwMap[spec]) {
      const at = t.indexOf(kw);
      if (at < 0) continue;
      const boundary = at === 0 || /[^a-z0-9]/.test(t[at - 1]);
      if (boundary) continue;                          // a real word match, fine
      // kw appears only inside a longer word here. If the route still carries that specialty, the
      // grounding came from a substring collision.
      const r = route(topic);
      if (r && r.specialties.includes(spec) && !kwMap[spec].some(k => {
        const i2 = t.indexOf(k); return i2 >= 0 && (i2 === 0 || /[^a-z0-9]/.test(t[i2 - 1]));
      })) {
        const key = `${topic}|${spec}|${kw}`;
        if (!ACCEPTED_MID_WORD.has(key)) midWord.push(`${key}  (keyword inside a longer word)`);
      }
    }
  }
}
if (midWord.length) { console.log(`\n  SUBSTRING COLLISIONS (${midWord.length}):`); midWord.slice(0, 30).forEach(x => console.log("    " + x)); console.log(); }
ok(midWord.length === 0,
   `no specialty is assigned from a keyword matched inside a longer word (${midWord.length} collisions)`);

// The three that were live in production, asserted by name so the regression reads plainly.
for (const [topic, forbidden] of [["Hypertensive urgency & emergency", "Dermatology"],
                                  ["Stable angina pectoris", "Psychiatry"],
                                  ["Conduction defects (AV blocks)", "Psychiatry"]]) {
  const r = route(topic);
  ok(!!r && !r.specialties.includes(forbidden),
     `"${topic}" no longer grounds on ${forbidden}`);
}

// Exceptions must stay live and stay small — a stale entry is a silent bypass.
for (const key of ACCEPTED_MID_WORD) {
  const [t] = key.split("|");
  ok(all.some(x => x.topic === t), `mid-word exception "${t}" still exists in the catalogue`);
}
ok(ACCEPTED_MID_WORD.size <= 5, `the mid-word exception list stays short (${ACCEPTED_MID_WORD.size}) — it is not a loophole`);

// ── 4. NO CATCH-ALL. An unknown category must ground on NOTHING. ────────────────────────────────────
// This is the assertion that stops a future "fix" from making the suite green the wrong way: routing a
// mystery topic to a plausible specialty would pass every check above while teaching wrong guidance.
const rogue = { GUIDELINES: G, String, Object, console: { warn(){} },
  TOPICS: { "Department of Invented Medicine": { topics: { "X": ["Fictional syndrome"] } } } };
vm.createContext(rogue);
vm.runInContext(arrSrc("COMPOUND_ROUTES") + "\n" + objSrc("TOPIC_CATEGORY_SPECIALTY") + "\n"
  + fnSrc("getGuidelinesForTopic") + "\nthis.route = getGuidelinesForTopic;", rogue);
ok(rogue.route("Fictional syndrome") === null,
   "an UNMAPPED category grounds on nothing — no catch-all, because wrong grounding is worse than none");
ok(route("A topic that exists nowhere at all") === null,
   "…and so does a topic that is in no catalogue and matches no keyword");
ok(!/matched\.push\("Miscellaneous"\)\s*;?\s*\/\/\s*fallback/i.test(html) && !/\|\|\s*"Miscellaneous"/.test(html),
   "…and nothing in the source quietly defaults an unknown topic into a specialty");

// ── 4b. NARROW COMPOUND ROUTES ──────────────────────────────────────────────────────────────────────
// "PD peritonitis" routed to nothing, and the obvious fix — adding "peritonitis" to the Nephrology
// keywords — would have dragged SPONTANEOUS BACTERIAL peritonitis into Nephrology. One common query
// grounded by breaking another. Full-phrase rules ground both without either stealing the other.
for (const v of ["PD peritonitis", "PD-associated peritonitis", "pd associated peritonitis", "PD PERITONITIS"]) {
  const r = route(v);
  ok(!!r && r.specialties.includes("Nephrology"), `"${v}" reaches Nephrology`);
}
{
  const r = route("Spontaneous bacterial peritonitis");
  ok(!!r && r.specialties.includes("GI/Hepatology"), "Spontaneous bacterial peritonitis reaches GI/Hepatology…");
  ok(!!r && !r.specialties.includes("Nephrology"),
     "…and is NOT dragged into Nephrology, which a bare 'peritonitis' keyword would have done");
}
// The bare keyword must stay absent, or the rule above is decoration.
const nephKw = html.slice(html.indexOf('"Nephrology": ['), html.indexOf("]", html.indexOf('"Nephrology": [')) + 1);
ok(!/"peritonitis"/.test(nephKw), "'peritonitis' is still NOT a bare Nephrology keyword");

// AMBIGUOUS ABBREVIATIONS GET NO RULE. "sbp" is systolic blood pressure at least as often as it is
// spontaneous bacterial peritonitis; a rule on it would ground a hypertension talk on hepatology.
ok(COMPOUND.every(r => !/\\bsbp\\b/.test(String(r.re)) && String(r.re).length > 20),
   "no compound rule is a bare ambiguous abbreviation");
{
  const r = route("SBP goal in hypertension");
  ok(!r || !r.specialties.includes("GI/Hepatology"),
     "…so 'SBP goal in hypertension' is not routed to hepatology");
}
// Compound rules are ADDITIVE — they must never remove what another pass found.
ok(/matched\.indexOf\(_cr\.spec\) < 0\) matched\.push\(_cr\.spec\)/.test(html),
   "a compound match only ever ADDS a specialty, never replaces the keyword or catalogue result");

// ── 5. the allowlist stays explicit ─────────────────────────────────────────────────────────────────
ok(MAY_BE_UNGROUNDED instanceof Set, "the ungrounded allowlist is a Set of exact names, not a pattern");
for (const entry of MAY_BE_UNGROUNDED)
  ok(all.some(x => x.topic === entry), `allowlisted "${entry}" still exists in the catalogue — no stale bypasses`);

console.log(`\n${n} assertions over ${all.length} topics, `
  + (failures === 0 ? "✔ ROUTING COVERAGE OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
