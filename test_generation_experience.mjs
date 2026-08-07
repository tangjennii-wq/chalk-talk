// GENERATION EXPERIENCE — run: node test_generation_experience.mjs
//
// The loading card told durable-path users "Keep this tab open · backgrounding pauses the connection."
// That is the exact opposite of what the durable path does, and it is the single most valuable thing the
// app can tell someone waiting sixty seconds on a phone. The flag that switches the message was only set
// AFTER /generate-async returned, and was never reset — so the first seconds of a durable run lied, and a
// stale true could leak into a later synchronous BYOK run and promise something that path cannot deliver.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const code = html.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");

// ── 1 · THE PROMISE FOLLOWS THE PATH, FROM THE FIRST SECOND ──────────────────
const gen = code.slice(code.indexOf("async function generate()"),
                       code.indexOf("async function generate()") + 40000);
const iReset = gen.indexOf("S.genBackgroundSafe = false;");
const iWant  = gen.indexOf("S.genBackgroundSafe = _wantAsync;");
const iSubmit = gen.indexOf("submitAsyncGeneration(");
ok(iReset >= 0, "every generation resets the background-safe promise before starting");
ok(iWant > iReset, "…then sets it from the PATH (_wantAsync)");
ok(iWant < iSubmit, `…BEFORE the request is sent, not after it returns (set @${iWant}, submit @${iSubmit})`);

// ── 2 · THE TWO MESSAGES SAY WHAT TO DO ──────────────────────────────────────
const card = code.slice(code.indexOf("h+= S.genBackgroundSafe"), code.indexOf("h+= S.genBackgroundSafe") + 900);
ok(/close this tab/.test(card), "the durable message tells the user they may close the tab");
ok(/reopening brings it back/.test(card), "…and that reopening reconnects");
ok(/runs in your browser/.test(card), "the synchronous message explains WHY the tab must stay open");
ok(!/safe to switch tabs or lock your phone.{0,40}<\/div>'\s*\n\s*:/.test(card),
   "the old vague wording is gone from the durable branch");

// ── 3 · TIMING IS STATED, AND STOPS CLAIMING 'USUAL' WHEN IT ISN'T ───────────
ok(/usually 60\\u2013?90s|usually 60–90s/.test(code), "the elapsed counter states the expected range");
ok(/taking longer than usual/.test(code),
   "…and switches to 'taking longer than usual' rather than repeating a promise it is breaking");

// ── 4 · A FAILURE SAYS WHAT TO DO ABOUT THE CREDIT ───────────────────────────
const note = code.slice(code.indexOf("function generationRecoveryNoteHTML"),
                        code.indexOf("function generationRecoveryNoteHTML") + 1200);
ok(/if\(!freeTierActive\(\)\) return "";/.test(note),
   "the recovery note is free-tier only — a BYOK failure costs the user's own API call, not a credit");
ok(/Reload this page/.test(note), "it tells the user the one action that actually helps");
ok(/does not use a credit/.test(note), "…and says a failed generation does not cost a credit");
ok(/we will put it back/.test(note), "…with a human backstop when the count still looks wrong");
ok(/h\+=generationRecoveryNoteHTML\(\);/.test(code), "…and it is actually rendered under the error");

console.log("\n" + (failures === 0 ? "✔ GENERATION EXPERIENCE OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
