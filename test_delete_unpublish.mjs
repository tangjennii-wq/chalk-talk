// DELETE UNPUBLISHES — run: node test_delete_unpublish.mjs
//
// Jenni: "when I delete a talk it then shows in the library without the drag and drop option."
// She thought seed content was reappearing. It was her own PUBLISHED talk.
//
// A published talk exists twice in the library build: her saved row, and a showcase row keyed by
// share_token. A dedupe filter suppresses the showcase twin WHILE the talk is in her library:
//
//     showcaseSamples = S.landingFeatured.filter(row => row.share_token && !savedCloudIds[row.id])
//
// getDisplayLibrary() drops soft-deleted ids, so deleting removed the id from savedCloudIds, the twin
// stopped being suppressed, and the talk returned as a badged card with NO DRAG HANDLE — showcase rows
// are deliberately not reorderable. The dedupe was working correctly; deletion removed the only thing
// holding the twin down.
//
// Underneath that was the worse half: DELETING NEVER UNPUBLISHED. A deleted talk stayed readable on her
// public profile, the week she is sharing that profile with coworkers.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

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
const del = fnSrc("softDeleteSavedTalk");

// ── the commit path unpublishes, and does it FIRST ──────────────────────────────────────────────────
ok(/is_public:false, is_featured:false/.test(del),
   "deleting clears is_public AND is_featured — a deleted talk leaves the public profile");
const iUnpub = del.indexOf("is_public:false"), iDel = del.indexOf("cloudDeleteTalk");
ok(iUnpub > -1 && iDel > -1 && iUnpub < iDel,
   "…BEFORE the row is deleted, so a half-failed delete leaves it unpublished rather than published-and-orphaned");
ok(/catch\(_e\)\{ console\.warn\("unpublish before delete failed:"/.test(del),
   "…and a failed unpublish is logged rather than aborting the delete silently");

// The cache must forget it too, or the twin outlives the row it was built from.
ok(/S\.landingFeatured = \(S\.landingFeatured \|\| \[\]\)\.filter\(function\(r\)\{ return !r \|\| r\.id !== id; \}\)/.test(del),
   "the cached showcase list is pruned on delete — otherwise the twin survives the row it came from");
const iPrune = del.indexOf("S.landingFeatured =");
ok(iPrune > iDel, "…after the delete succeeds, not before");

// Local (unsynced) talks have no cloud row and must not attempt any of this.
ok(/String\(id\)\.startsWith\("t_"\)/.test(del),
   "local t_ talks still take the localStorage path — no cloud calls for something that was never in the cloud");

// ── the undo window ─────────────────────────────────────────────────────────────────────────────────
// Unpublishing happens on COMMIT. Between the delete and the commit the talk is soft-deleted, and the
// twin would appear during that window unless the filter excludes soft-deleted ids explicitly.
ok(/if\(typeof _softDeletedIds !== "undefined" && _softDeletedIds\[row\.id\]\) return false;/.test(html),
   "the showcase filter also excludes SOFT-deleted ids, closing the undo window");
ok(/if\(savedCloudIds\[row\.id\]\) return false;/.test(html),
   "…while the original dedupe against the live library is preserved");
ok(/if\(!row \|\| !row\.share_token\) return false;/.test(html),
   "…and a row without a share_token is still not a showcase entry");

// ── the reason this was invisible: showcase rows carry no drag handle ───────────────────────────────
// That is by design and stays. It is what made a resurrected twin look like foreign seed content.
ok(/var _reorderable = !isSample && !isShowcase/.test(html),
   "showcase rows remain non-reorderable by design — which is why the twin had no drag handle");

// ── undo must not unpublish ─────────────────────────────────────────────────────────────────────────
// The undo callback runs when she takes it back. It must only clear the soft-delete flag.
const undoArm = del.slice(del.indexOf("showUndoToast"), del.indexOf("}, async function()"));
ok(/delete _softDeletedIds\[id\]; render\(\);/.test(undoArm), "undo restores the talk…");
ok(!/is_public/.test(undoArm) && !/cloudDeleteTalk/.test(undoArm),
   "…and touches neither the publish flags nor the row — undo is not a second write");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ DELETE UNPUBLISH OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
