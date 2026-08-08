// FIRST-RUN ONBOARDING — run: node test_first_run_onboarding.mjs
//
// The "How it works" panel described the PRODUCT (it drafts, you view, you refine) while the screen in
// front of the user asked for a topic, a style and optional references. Someone landing for the first time
// had to map one onto the other themselves. The four steps now mirror the four controls, in the order they
// appear, and the fourth sets an expectation for what pressing Generate actually does.
//
// The hints are deliberately plain sentences under the controls rather than coach marks or a tour: three
// controls fit on one screen, and anything modal has to be dismissed before you can use the thing it is
// pointing at.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const code = html.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");

// ── 1 · THE STEPS MIRROR THE CONTROLS, IN ORDER ──────────────────────────────
// Anchor on the numbered STEP MARKUP, not on the class name: "howit-step" also appears in the stylesheet
// far earlier in the file, so slicing from its first occurrence spanned most of the document and matched
// "Generate" and "Add references" from unrelated UI — reporting the steps as out of order when they were
// not.
const stepsStart = code.indexOf('howit-num">1<');
const howit = code.slice(stepsStart, code.indexOf("</details>", stepsStart));
const order = ["Type a topic", "Pick a style", "Add references", "Generate"];
let last = -1, sequential = true;
for (const step of order) {
  const i = howit.indexOf(step);
  ok(i > 0, `step present: "${step}"`);
  if (i < last) sequential = false;
  last = i;
}
ok(sequential, "…and they appear in the same order as the controls on screen");
ok(/close the tab and come back/.test(howit),
   "the Generate step says the work survives closing the tab, which is the app's least obvious property");
ok(/about a minute/.test(howit), "…and sets a realistic expectation for how long it takes");

// ── 2 · FIRST RUN MEANS "HAS NEVER FINISHED A TALK" ──────────────────────────
// Not "has never visited". Someone who bounced off the landing page still needs the hints; someone who
// has a talk does not. The flag is set on DELIVERY, not on starting a generation, so a failed or
// cancelled attempt does not silently turn the guidance off.
ok(/ct_generated_once/.test(code), "first-run state is keyed on having generated, not on having visited");
const mark = code.slice(code.indexOf("function markGeneratedOnce"), code.indexOf("function firstRunHint"));
ok(/setItem\("ct_generated_once"/.test(mark), "markGeneratedOnce persists the flag");
const deliveries = (code.match(/markGeneratedOnce\(\);\s*(S\.citationAuditPending|S\.talk = finalTalk)/g) || []).length;
ok(deliveries >= 3, `every delivery path marks it (${deliveries} found), so the durable path counts too`);
ok(!/markGeneratedOnce\(\);\s*(await )?(submitAsyncGeneration|callAPI)/.test(code),
   "…and no path marks it merely because a generation STARTED");

// ── 2b · THE HELPERS ARE TOP-LEVEL, NOT NESTED IN RENDER ─────────────────────
// They were originally declared INSIDE the render function. firstRunHint() worked, because render calls
// it; markGeneratedOnce() did not, because the delivery paths that call it live elsewhere — every
// generation ended in "markGeneratedOnce is not defined". A function nested in another function is not a
// global, and neither node --check nor any suite here can see the difference: the file parses, and the
// pattern-matching tests find the text regardless of where it sits.
for (const f of ["isFirstRun", "markGeneratedOnce", "firstRunHint"]) {
  ok(new RegExp("^function " + f + "\\(", "m").test(html),
     `${f} is declared at top level, reachable from every caller`);
}

// ── 3 · HINTS APPEAR ON THE COMPOSE CONTROLS ONLY ────────────────────────────
const hintSites = [...code.matchAll(/h\+=firstRunHint\("([^"]{10,120})"\);/g)];
ok(hintSites.length >= 2, `hints are attached to the compose controls (${hintSites.length})`);
for (const m of hintSites) {
  const before = code.slice(Math.max(0, m.index - 400), m.index);
  ok(/>Style<|>References/.test(before),
     `…a hint sits under a compose control, not loose in the page ("${m[1].slice(0, 40)}…")`);
  const after = code.slice(m.index, m.index + 200);
  ok(!/<ol/.test(after),
     "…and not inside a finished talk's reference list, where two of them landed on the first attempt");
}
ok(/Lecture = a 10-minute teaching talk/.test(code), "the Style hint explains the actual difference");
ok(/alongside the evidence we retrieve/.test(code), "the References hint says what uploading one does");

// ── 4 · THE HINTS GO AWAY, AND CANNOT BE A MODAL ─────────────────────────────
const hintFn = code.slice(code.indexOf("function firstRunHint"), code.indexOf("function firstRunHint") + 700);
ok(/if\(!isFirstRun\(\)\) return "";/.test(hintFn), "hints render nothing once the first talk exists");
ok(!/position:fixed|z-index/.test(hintFn), "…and are inline text, not an overlay to dismiss");

console.log("\n" + (failures === 0 ? "✔ FIRST-RUN ONBOARDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
