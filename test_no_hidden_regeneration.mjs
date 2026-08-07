// NO HIDDEN REGENERATION — run: node test_no_hidden_regeneration.mjs
//
// ── WHAT THIS EXISTS TO PREVENT ──────────────────────────────────────────────────────────────────────
// On 2026-08-06 three credits disappeared in a few minutes. Nothing was broken: the Concise/Detailed
// control in the talk view LOOKED like a display toggle, sitting between Reorder and Expand all. Pressing
// it when the other variant was not cached fired a full generation — a model call, about a minute, and a
// credit. Opening a talk saved as Detailed and pressing Concise to read the short version did it every
// time. The user was never told, and the app never asked.
//
// The rule this file enforces: ANY control that can start a generation must say so before it runs. A
// control that spends money silently is a bug regardless of how correct its code is.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const code = html.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
function grab(name){
  const from = html.indexOf("function " + name + "(");
  if(from < 0) throw new Error("not found: " + name);
  let depth = 0;
  for(let i=html.indexOf("{", from); i<html.length; i++){
    if(html[i] === "{") depth++;
    else if(html[i] === "}") { depth--; if(depth === 0) return html.slice(from, i+1); }
  }
  throw new Error("unbalanced: " + name);
}

// ── 1 · NO DEPTH CONTROL IS RENDERED ANYWHERE ────────────────────────────────
// _flipDepthTo is only ever reached from a click, so removing every button removes the leak entirely.
ok(!/id="depthToggleBtnConcise"/.test(code), "the outline-row depth toggle is gone");
ok(!/id="depthToggleBtnDetailed"/.test(code), "…both halves of it");
ok(!/segBtn\("flipDepthBtn"/.test(code), "…and the Edit-panel depth control is gone too");
ok(!/id="editSettingsBtn"/.test(code),
   "the Edit settings button is hidden — everything in it was a regeneration wearing the clothes of a setting");

// ── 2 · THE ONLY REMAINING WAY TO REGENERATE ASKS FIRST ──────────────────────
// SUPERSEDED. The dashed "Update to the latest version" card sat above the compose box competing with it
// — two ways to ask for a change, and the big panel drew the eye first. The capability did not go away:
// typing "update" runs the same rebuild with the same confirm and the same stated cost, and the
// placeholder now says so. What must stay true is that the rebuild asks before spending, asserted below.
ok(!/id="rebuildToLatestBtn"/.test(code), "the competing Update card is gone from the composer");
ok(/Type .update. on its own to rebuild/.test(code),
   "…and the placeholder tells the user how to trigger it instead");

// ── 3 · AN OLD TALK IS MODERNIZED, NOT RE-OUTLINED ───────────────────────────
const modernize = new Function(grab("_modernizeStructureConstraint") + ";return _modernizeStructureConstraint;")();
const constraint = modernize({ sections:[
  { heading:"Mechanism" }, { heading:"Diagnosis" }, { heading:"Treatment" }
]}, "lecture");
ok(/1\. Mechanism[\s\S]*2\. Diagnosis[\s\S]*3\. Treatment/.test(constraint),
   "the modernization contract carries the old section order and headings");
ok(/same section count, order, and headings/.test(constraint) && /Do not add, remove, merge, rename, or reorder sections/.test(constraint),
   "the model is explicitly forbidden from silently changing the teaching structure");
ok(/current society guidance/.test(constraint) && /inline \[N\] citations/.test(constraint) && /complete schema/.test(constraint),
   "the same pass requests current guidance, current citation formatting, and today's schema");
const rebuild = code.slice(code.indexOf("async function rebuildLesson"), code.indexOf("// ── Withheld-draft recovery"));
ok(/S\._generationConstraint\s*=\s*_modernizeStructureConstraint\(S\.talk, S\.style\)/.test(rebuild),
   "rebuildLesson derives the constraint from the talk being replaced");
ok(/try \{ await generate\(\); \}[\s\S]*finally \{ S\._generationConstraint = priorConstraint; \}/.test(rebuild),
   "the constraint lives for exactly one generation and is restored afterwards");
ok(/refineParts\.push\(S\._generationConstraint\.trim\(\)\)/.test(code),
   "the current generation prompt actually receives the modernization contract");

// ── 4 · THE MECHANISM SURVIVES, ONLY THE SILENT ENTRY POINTS ARE GONE ────────
ok(/function _flipDepthTo\(/.test(code),
   "_flipDepthTo still exists, so cached depth variants remain usable if the feature returns");
ok(/function rebuildLesson\(/.test(code), "rebuildLesson still exists and is what the new button calls");

// ── 4 · TYPING "UPDATE" REBUILDS — AND ONLY WHEN IT CLEARLY MEANS THAT ───────
// "Update" is an ordinary English word. Treating every message containing it as a rebuild would spend a
// credit on "update the dose to 5 mg". The matcher is executed here rather than pattern-matched, because
// what matters is which sentences it accepts.
{
  const src = code.slice(code.indexOf("var UPDATE_INTENT_RE"), code.indexOf("function isRadicalRevision"));
  const isUpdate = new Function("S", src + "; return isUpdateToLatestIntent;")({ topic: "" });

  for (const yes of ["update", "Update", "update this talk", "please update the lesson",
                     "refresh with the latest guidelines", "rebuild with new citations",
                     "regenerate this talk with the newest evidence", "update.", "re-run this lecture"]) {
    ok(isUpdate(yes) === true, `rebuilds on: "${yes}"`);
  }
  for (const no of ["update the dose to 5 mg", "update section 3 with the new target",
                    "update the aspirin bullet", "add an update about the 2025 trial and rewrite the intro",
                    "can you update the part about statins to mention the new LDL threshold and also tighten section 2",
                    "make it shorter", "update slide 4"]) {
    ok(isUpdate(no) === false, `stays a normal refine: "${no}"`);
  }
}

// ── 5 · AND IT CONFIRMS, LIKE EVERY OTHER PAID ACTION ────────────────────────
{
  // Anchor on the CALL SITE, not the definition — indexOf found "function isUpdateToLatestIntent(msg)"
  // first, so the slice covered the matcher's body, which of course contains no confirm.
  const callIdx = code.indexOf("!_isSurgicalEdit && isUpdateToLatestIntent(msg)");
  const branch = code.slice(callIdx, callIdx + 1400);
  ok(/window\.confirm\(/.test(branch), "the update intent confirms before spending");
  ok(/uses one of your free talks/.test(branch), "…stating the credit cost on the free tier");
  ok(/stays until the new one is ready/.test(branch), "…and that the current talk survives until it lands");
  ok(branch.indexOf("window.confirm") < branch.indexOf("rebuildLesson()"), "…strictly before the rebuild");
  ok(/nothing was rebuilt/.test(branch), "…and declining says so rather than failing silently");
}

console.log("\n" + (failures === 0 ? "✔ NO HIDDEN REGENERATION" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
