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

// ── 1 · NO DEPTH CONTROL IS RENDERED ANYWHERE ────────────────────────────────
// _flipDepthTo is only ever reached from a click, so removing every button removes the leak entirely.
ok(!/id="depthToggleBtnConcise"/.test(code), "the outline-row depth toggle is gone");
ok(!/id="depthToggleBtnDetailed"/.test(code), "…both halves of it");
ok(!/segBtn\("flipDepthBtn"/.test(code), "…and the Edit-panel depth control is gone too");
ok(!/id="editSettingsBtn"/.test(code),
   "the Edit settings button is hidden — everything in it was a regeneration wearing the clothes of a setting");

// ── 2 · THE ONLY REMAINING WAY TO REGENERATE ASKS FIRST ──────────────────────
ok(/id="rebuildToLatestBtn"/.test(code), "Refine offers an explicit 'Update to the latest version'");
const btn = code.slice(code.indexOf('id="rebuildToLatestBtn"') - 200, code.indexOf('id="rebuildToLatestBtn"') + 900);
ok(/about a minute/.test(btn), "…stating how long it takes");
ok(/uses one of your free talks/.test(btn), "…and that it costs a credit on the free tier");
ok(/freeTierActive\(\)/.test(btn), "…with that clause omitted for BYOK, where it is not true");

const handler = code.slice(code.indexOf("_rbl.onclick"), code.indexOf("_rbl.onclick") + 900);
ok(/window\.confirm\(/.test(handler), "…and it CONFIRMS before spending anything");
ok(/stays until the new one is ready/.test(handler),
   "…telling the user their current talk survives until the rebuild lands");
ok(handler.indexOf("window.confirm") < handler.indexOf("rebuildLesson()"),
   "…with the confirm strictly before the rebuild call");

// ── 3 · THE MECHANISM SURVIVES, ONLY THE SILENT ENTRY POINTS ARE GONE ────────
ok(/function _flipDepthTo\(/.test(code),
   "_flipDepthTo still exists, so cached depth variants remain usable if the feature returns");
ok(/function rebuildLesson\(/.test(code), "rebuildLesson still exists and is what the new button calls");

console.log("\n" + (failures === 0 ? "✔ NO HIDDEN REGENERATION" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
