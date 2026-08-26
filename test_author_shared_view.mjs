// THE AUTHOR IN SHARED VIEW — run: node test_author_shared_view.mjs
//
// Jenni opened her own published talk through its public link and found the Visual tab was a dead end:
// "No visual attached to this talk", no provider toggle, no Generate button. All of that is CORRECT for a
// visitor — shared view is read-only by design — and useless for the person who wrote the talk. The app
// already had the facts to tell them apart: sharedAuthorUserId matches S.user.id, and sharedOriginalTalkId
// points at the real library row. The Visual tab simply never asked.
//
// THE FIX IS A DOOR, NOT AN UNLOCK, and that distinction is the thing this suite protects. Enabling
// generation inside shared view would spend an image credit in a view with no Save button — the shape
// that silently created duplicate copies once before. Instead the author gets one tap back to their own
// copy, where every control already works and the save path is untouched.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const fnSrc = (name) => {
  const i = html.search(new RegExp("(?:async )?function " + name + "\\("));
  if (i < 0) return "";
  let d = 0, started = false;
  for (let j = i; j < html.length; j++) {
    if (html[j] === "{") { d++; started = true; }
    else if (html[j] === "}") { d--; if (started && d === 0) return html.slice(i, j + 1); }
  }
  return "";
};

// ── WHO COUNTS AS THE AUTHOR ───────────────────────────────────────────────────────────────────────
const own = fnSrc("_isOwnSharedTalk");
ok(own.length > 40, "_isOwnSharedTalk exists as a named predicate, not an inline condition");
ok(/S\.sharedTalk/.test(own), "…it only fires in shared view…");
ok(/S\.user && S\.sharedAuthorUserId && S\.user\.id === S\.sharedAuthorUserId/.test(own),
   "…for a signed-in viewer whose id matches the recorded author…");
// The id is what makes the door go anywhere. Without it the button would render and do nothing.
ok(/S\.sharedOriginalTalkId/.test(own),
   "…and only when the original row's id is known, so the button can never be a no-op");

// ── THE DOOR ITSELF ────────────────────────────────────────────────────────────────────────────────
ok(/id="openOwnCopyBtn"/.test(html), "the author gets a button instead of a dead end");
ok(/Open in your library to add a visual/.test(html), "…labelled with what it does, not 'switch mode'");
ok(/viewing your own talk through its public link, which is read-only/.test(html),
   "…and the reason the controls are missing is stated, since otherwise it reads as a bug");
ok(/_ooc\.onclick=function\(\)\{ _openOwnCopyFromShared\(\); \}/.test(html), "…and it is wired");

// The visitor's experience must be unchanged: a plain reader still sees the read-only line and NO button.
const visualElse = html.slice(html.indexOf("else if(_isOwnSharedTalk()){"),
                              html.indexOf("No visual attached to this talk.</div>'}") + 40);
ok(/else\{h\+='<div style="text-align:center;padding:16px[^']*No visual attached to this talk\.<\/div>'\}/.test(visualElse),
   "a viewer who is NOT the author still gets the plain read-only line…");
ok(visualElse.lastIndexOf("openOwnCopyBtn") < visualElse.indexOf("else{h+="),
   "…with no button, so nothing changed for the audience this view was built for");

// ── IT IS A DOOR, NOT AN UNLOCK ────────────────────────────────────────────────────────────────────
// The generation controls must STILL be gated on !S.sharedTalk. If a later edit loosens that gate to
// _isOwnSharedTalk(), an image credit gets spent in a view with no Save button.
ok(/if\(!S\.sharedTalk\) h\+='  <button id="dgBtn"/.test(html),
   "Regenerate is still gated on !S.sharedTalk — the author is redirected, not handed the button here");
ok(/else if\(!S\.sharedTalk\)\{h\+='<button id="dgBtn"/.test(html),
   "…and so is the first-time Generate button");
ok(!/_isOwnSharedTalk\(\)[^\n]*dgBtn/.test(html),
   "…and neither generate path has been re-gated on authorship, which would spend a credit with nowhere to save it");
ok(!/_isOwnSharedTalk\(\)[^\n]*dgModeBtn/.test(html),
   "…nor the provider toggle");

// ── THE NAVIGATION MUST ACTUALLY LAND ──────────────────────────────────────────────────────────────
const open = fnSrc("_openOwnCopyFromShared");
ok(/^async function/.test(open), "the handler is async…");
ok(/await loadSavedTalk\(id\)/.test(open),
   "…and AWAITS the load — loadSavedTalk runs _clearTalkScoped, which assigns S.tab itself");
// Order is the whole bug this would otherwise have. Setting the tab first means the load overwrites it.
const iAwait = open.indexOf("await loadSavedTalk(id)");
const iTab = open.indexOf("S.tab = wantTab");
ok(iAwait > -1 && iTab > iAwait,
   "…and sets the tab AFTER the load resolves, or you ask for Visual and land on Overview");
ok(/var wantTab = S\.tab;/.test(open) && open.indexOf("var wantTab") < iAwait,
   "…having captured the tab BEFORE the load, since the load is what clears it");
ok(/if\(!id\) return;/.test(open), "…and it bails when there is no id rather than loading nothing");

// ── AND THE ROW IT OPENS IS THE REAL ONE ───────────────────────────────────────────────────────────
// sharedOriginalTalkId is set on the shared-load path; if that ever stops being populated this door
// closes silently, so the assignment is pinned.
ok(/S\.sharedOriginalTalkId/.test(html.slice(html.indexOf("S.sharedTalk=true"), html.indexOf("S.sharedTalk=true") + 1200))
   || /sharedOriginalTalkId\s*[:=]/.test(html),
   "sharedOriginalTalkId is populated somewhere on the shared path, so the id exists to navigate with");
// loadSavedTalk is a thin try/catch wrapper; the state assignments live in _loadSavedTalkUnchecked. The
// first version of this assertion read the wrapper, found no assignment, and failed for the wrong reason.
ok(/return await _loadSavedTalkUnchecked\(id\)/.test(fnSrc("loadSavedTalk")),
   "loadSavedTalk delegates to _loadSavedTalkUnchecked, so that is where the state lands");
ok(/S\.sharedTalk=false/.test(fnSrc("_loadSavedTalkUnchecked")),
   "…which clears shared mode, so arriving at the copy really does restore the full controls");
ok(/S\.talkIsSaved *= *true/.test(fnSrc("_loadSavedTalkUnchecked")),
   "…and marks it saved, so the author lands on a talk that is not pretending to have unsaved changes");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ AUTHOR SHARED VIEW OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
