// AUTO-PROOFREAD ON A LONG PASTE — run: node test_auto_proofread.mjs
//
// The composer SUGGESTED proofread on a big paste and left the tap to the user. Paste a review, press
// send without noticing the hint, and it went to the surgical editor — which is tuned for short
// commands and misreads a document. The hint existed to prevent exactly the failure it kept allowing.
//
// The interesting part is the CONDITION, not the automation. Length alone is not intent. A long paste
// containing an instruction ("add these bullets", "shorten section 3", "split this") is a command and
// must keep its own path. Only a long paste with NO explicit verb is treated as a document written
// ABOUT the talk — which is what reviewer feedback is. Get that wrong and you have silently hijacked
// every long additive request in the app.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

const block = html.slice(html.indexOf("// AUTO-ARM ON A LONG PASTE"),
                         html.indexOf("await applyProofreadFeedback(msg, _proofreadWasAuto);") + 60);
ok(block.length > 300, "sanity: the auto-arm block was located");

// ── every exclusion must be present; each one is a whole class of request ───────────────────────────
ok(/_autoProofread = _isLargePaste/.test(block), "auto-arm starts from the large-paste signal…");
for (const [label, guard] of [
  ["additive requests",     "!_isAdditiveSignal"],
  ["surgical edits",        "!isSurgicalEditIntent(msg)"],
  ["compression requests",  "!isCompressionIntent(msg)"],
  ["expansion requests",    "!isExpansionIntent(msg)"],
  ["restructure requests",  "!isRestructureIntent(msg)"],
]) ok(block.includes(guard), `…and does NOT fire on ${label} — a long command is still a command`);

// The intent detectors have to actually exist, or the guards are decoration.
for (const fn of ["isAdditiveIntent", "isSurgicalEditIntent", "isCompressionIntent",
                  "isExpansionIntent", "isRestructureIntent", "isProofreadFeedback"])
  ok(new RegExp(`function ${fn}\\(`).test(html), `${fn} exists, so the guard is real`);

// ── it feeds the same path, not a parallel one ──────────────────────────────────────────────────────
ok(/_applyProofread = \(S\._applyProofreadMode === true\) \|\| isProofreadFeedback\(msg\) \|\| _autoProofread/.test(block),
   "auto-arm ORs into the existing proofread condition rather than branching separately");
ok(/await applyProofreadFeedback\(msg, _proofreadWasAuto\)/.test(block),
   "…and calls the same function, with a flag saying whether the app chose");

// ── the note fires ONLY when the app chose ──────────────────────────────────────────────────────────
// An explicit toggle or a recognised feedback paste needs no announcement. A silent change of behaviour
// does — that is the whole point of telling her.
ok(/_proofreadWasAuto = _autoProofread && \(S\._applyProofreadMode !== true\) && !isProofreadFeedback\(msg\)/.test(block),
   "the note flag excludes the explicit toggle AND an already-recognised feedback paste");
ok(/wasAuto \? "🩺 That looked like reviewer feedback rather than an instruction/.test(html),
   "…and the summary says so when it fired");
ok(/every other bullet, section and citation was left alone/.test(html),
   "…stating what was NOT touched, which is the reassurance that matters after an automatic decision");
ok(/async function applyProofreadFeedback\(userMsg, wasAuto\)/.test(html),
   "applyProofreadFeedback takes the flag");
ok(/var _autoNote = wasAuto \? /.test(html) && /_autoNote\+"✓ Applied "/.test(html),
   "…and prepends the note to the existing applied-corrections summary rather than replacing it");

// ── the hint now describes what happens, instead of asking for a tap ────────────────────────────────
ok(!/tap <b>🩺 Apply proofread<\/b>/.test(html),
   "the hint no longer asks for a tap that is no longer required");
ok(/Send will read it as <b>reviewer feedback<\/b>/.test(html), "…it states what Send will do…");
ok(/If you meant it as new content, say what to do with it/.test(html),
   "…and tells her how to opt out, which is the escape hatch for the one case this gets wrong");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ AUTO-PROOFREAD OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
