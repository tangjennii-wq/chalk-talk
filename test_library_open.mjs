// OPENING FROM THE LIBRARY — run: node test_library_open.mjs
//
// Two reports, one afternoon, and both are the same mistake in different clothes: the library said one
// thing and the talk view said another.
//
//   "when im in visuals in library and open link it goes to overview - go straight to visual whether its
//    slides or image"  — the Visuals-tab open ALREADY jumped to the Visual tab. But "visual" is the
//    GENERATED IMAGE tab, and it hydrates only entries whose mode matches the current image provider
//    ("ai"/"openai"). A saved slide poster carries mode "slides", so it matched nothing and the tab read
//    "No visual attached to this talk" — for a talk the library had just listed as having one.
//
//   "drag and drop in boards not applied to all ?s"  — those cards are samples, which have no cloud row
//    to persist an order against, so they genuinely cannot be reordered. The defect was that nothing SAID
//    so: the handle was omitted, which both hid the reason and shifted those titles left of every other
//    card, making a correct state look broken. Second report of this exact shape.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const fnSrc = (name) => {
  const i = html.indexOf("function " + name + "(");
  if (i < 0) return "";
  let d = 0, started = false;
  for (let j = i; j < html.length; j++) {
    if (html[j] === "{") { d++; started = true; }
    else if (html[j] === "}") { d--; if (started && d === 0) return html.slice(i, j + 1); }
  }
  return "";
};

// ── LANDING TAB: DECIDED FROM THE ARTEFACT, NOT FROM THE TAB NAME ──────────────────────────────────
const pick = fnSrc("_artefactTabFor");
ok(pick.length > 40, "_artefactTabFor exists — the choice is a function, not an inline guess");
ok(/kind === "slides" \|\| v\.mode === "slides"/.test(fnSrc("_isSlidesVisual")),
   "a slides artefact is recognised by EITHER field — it is written with both, and one alone would miss it");
ok(/_isSlidesVisual\(vis\[i\]\) \? "slides" : "visual"/.test(pick),
   "…and a slides artefact lands on the Slides tab while an image lands on Visual");
// Newest-first. A talk with an old image and new slides should open on what was saved last.
ok(/for\(var i = vis\.length - 1; i >= 0; i--\)/.test(pick),
   "…scanning newest-first, so the most recently saved artefact decides");
ok(/vis\[i\] && vis\[i\]\.imgB64/.test(pick),
   "…and skipping entries with no image data, which would otherwise decide the tab and then render nothing");
ok(/return "visual";/.test(pick),
   "…defaulting to the image tab, since a cloud card carries only a has_visuals boolean and no array");

// It has to be CALLED, after the talk is known. _clearTalkScoped runs before S.talk is assigned, so the
// decision cannot be made there — that is precisely why the original version could only say "visual".
const clear = fnSrc("_clearTalkScoped");
ok(/S\.tab = \(S\.libTab === "visuals"\) \? "visual" : "overview";/.test(clear),
   "sanity: the coarse choice still happens in _clearTalkScoped…");
const callIdx = html.indexOf('if(S.libTab === "visuals") S.tab = _artefactTabFor(S.talk);');
ok(callIdx > -1, "…and is refined once the talk is loaded");
const talkAssign = html.lastIndexOf("S.talk=entry.talk", callIdx);
ok(talkAssign > -1 && talkAssign < callIdx,
   "…AFTER S.talk is assigned — called any earlier it would inspect the previous talk, or null");
const renderIdx = html.indexOf("render();window.scrollTo(0,0);", callIdx);
ok(renderIdx > -1 && renderIdx - callIdx < 120,
   "…and before the render, so the correct tab is the first thing drawn rather than a visible flip");
ok(/if\(S\.libTab === "visuals"\)/.test(html.slice(callIdx - 40, callIdx + 60)),
   "…and only for a Visuals-tab open — opening from Lectures or Boards still lands on Overview");

// ── A SLIDE POSTER IS NOT A VISUAL AID ─────────────────────────────────────────────────────────────
// The owner branch excluded slides only BY ACCIDENT — "slides" never equals an image provider — and the
// shared branch did not exclude them at all, so a viewer could be shown a screenshot of the Slides tab
// captioned "Generated with Nano Banana Pro". Both are explicit now, and both are asserted, because the
// accidental exclusion would survive any refactor that changed how providers are named.
const hyd = html.slice(html.indexOf("var _cands = S.talk.savedVisuals, _lv = null;"),
                       html.indexOf("if(_lv && _lv.imgB64) S.dg ="));
ok(hyd.length > 100, "sanity: the visual-tab hydration block was located");
ok((hyd.match(/!_isSlidesVisual\(/g) || []).length === 2,
   "BOTH hydration branches — owner and shared viewer — exclude a slides poster explicitly");
ok(/S\.sharedTalk\)\{ for\(/.test(hyd),
   "…the shared branch is a scan now, not a blind take-the-last, which is what let a poster through");
ok(/\(_cands\[_hi\]\.mode\|\|"ai"\)===S\.dgMode/.test(hyd),
   "…while the owner branch still matches the selected provider, so switching provider is not undone");

// ── THE FIXED-POSITION MARKER ──────────────────────────────────────────────────────────────────────
const card = html.slice(html.indexOf("var _reorderable = !isSample"), html.indexOf("var _reorderable = !isSample") + 3000);
ok(/var _reorderable = !isSample && !isShowcase && x\._id && !String\(x\._id\)\.startsWith\("t_"\)/.test(card),
   "sanity: reorderability is unchanged — this fix explains the rule, it does not relax it");
ok(/class="libDragFixed"/.test(card), "a non-reorderable card renders a marker instead of nothing…");
ok(/libDragFixed[^>]*opacity:0\.28/.test(card),
   "…dimmed, so it reads as unavailable rather than as a control that ignores you");
ok(/libDragFixed[^>]*aria-hidden="true"/.test(card),
   "…and hidden from screen readers, since it is a spacer carrying a tooltip, not an actionable control");
ok(/_whyFixed = \(isSample \|\| isShowcase\)/.test(card),
   "…with the reason chosen per case rather than one vague line covering three different situations");
ok(/Sample talks keep a fixed order/.test(card) && /save your own copy/.test(card),
   "…telling a sample's owner what they can do about it");
ok(/Saved on this device only/.test(card) && /sign in/.test(card),
   "…and telling a device-only save the actual remedy, which is different");
// The alignment half. Without a same-width span the titles jump left and the correct state looks broken.
ok(/libDragFixed[^>]*padding:2px 4px/.test(card) && /libDragHandle[^>]*padding:2px 4px/.test(card),
   "…and it occupies the same width as the real handle, so rows stay aligned");

// ── AND IT MUST NOT BECOME DRAGGABLE ───────────────────────────────────────────────────────────────
// The whole point is that these cannot be reordered. A marker that Sortable picks up would be worse than
// the missing handle: it would look like it worked and then silently fail to persist.
const sortable = html.slice(html.indexOf("function bindLibraryReorder()"),
                            html.indexOf("function bindLibraryReorder()") + 2000);
ok(/handle: "\.libDragHandle"/.test(sortable),
   "Sortable's handle is still .libDragHandle, so the dimmed marker can never start a drag");
ok(/draggable: '\.libCard\[data-reorderable="1"\]'/.test(sortable),
   "…and only reorderable cards are draggable at all, which is the second, independent guard");
ok(!/libDragFixed/.test(sortable), "…and Sortable knows nothing about the marker");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ LIBRARY OPEN OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
