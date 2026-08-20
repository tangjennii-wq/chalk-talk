// UPDATES EXPLAINER — run: node test_updates_info.mjs
//
// Jenni asked for an ⓘ next to Updates "so user knows what it does ... including for saved", and in the
// same sentence guessed that pressing Updates again undoes it. It does not. That wrong guess, from the
// person who commissioned the feature, is the reason this panel exists and is why the undo paragraph is
// asserted here by content and not merely by presence.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

// ── the affordance sits next to Updates ─────────────────────────────────────────────────────────────
const iUpdates = html.indexOf('<span class="hide-mobile-text">Updates</span>');
const iInfoBtn = html.indexOf('id="updatesInfoBtn"');
ok(iUpdates > -1, "sanity: the Updates button renders");
ok(iInfoBtn > -1, "the ⓘ button renders");
ok(iInfoBtn > iUpdates && iInfoBtn - iUpdates < 600,
   "…immediately to the right of Updates, not somewhere else in the toolbar");
ok(/id="updatesInfoBtn"[^>]*aria-label="What does Updates do\?"/.test(html),
   "…with an aria-label, so it is not an unlabelled glyph to a screen reader");
ok(/id="updatesInfoBtn"[^>]*aria-expanded="'\+\(S\.updatesInfoOpen\?"true":"false"\)/.test(html),
   "…and aria-expanded tracks the panel, so the state is announced rather than only drawn");

// ── DRAWN ICONS, NOT EMOJI (Jenni 2026-08-19) ───────────────────────────────────────────────────────
// Updates showed ⚠️ when the topic was fast-moving and 🔎 otherwise. Two problems. A hazard triangle
// reads as "something is wrong with this talk" when it means "this field moves quickly, worth a look" —
// alarm where the intent was invitation. And swapping the GLYPH to carry state means the button changes
// shape as well as meaning, so the toolbar looks different depending on the topic.
//
// The magnifier is now constant and the fast-moving signal is carried by COLOUR alone, which is the
// quieter channel and the one that does not change the button's silhouette.
ok(/: SEARCH_ICON\)/.test(html), "Updates always shows the magnifier…");
// Scoped to the Updates button markup, not the whole file — the comment above it names the old glyph,
// and a whole-file match would fail on prose describing the fix. (Fifth time this session.)
const _ub = html.indexOf('h+=\'<button class="checkUpdatesBtn"');
const updBtn = html.slice(_ub, html.indexOf("</button>';", _ub) + 11);
ok(updBtn.length > 100, "sanity: the Updates button markup was located");
// Asserted STRUCTURALLY. Matching the ⚠ character missed a mutant that wrote the JS escape "\\u26a0"
// instead of the literal glyph — same defect either way, invisible to a character match. What must be
// true is that the icon slot has no _ucFast branch at all.
ok(!/_ucFast \?/.test(updBtn),
   "…and the icon slot has NO fast-moving branch — the glyph cannot change with state, whatever it is");
ok(!/\u26a0/.test(updBtn) && !/u26a0/.test(updBtn),
   "…and no hazard triangle by either spelling, literal or escaped");
ok(/_ucFast && !S\.updateCheck \? ' style="color:#7a5b1a"'/.test(html),
   "…while the fast-moving signal survives as colour, so the silhouette stays constant");
ok(/var SEARCH_ICON = SVG_OPEN/.test(html),
   "the magnifier is an inline SVG in the shared family, not an emoji that renders per-platform");

// The ⓘ was the circled-i CHARACTER, which is a font glyph and therefore a different weight and size on
// every platform. Drawn now, and deliberately a size smaller than its neighbours.
ok(/var INFO_ICON   = '<svg width="13" height="13"/.test(html),
   "the info mark is drawn at 13px — smaller than the 14px controls, because it explains one rather than being one");
ok(!/\\u24D8/.test(html), "…and the circled-i character is gone");
ok(/aria-label="What does Updates do\?" title="What does Updates do\?">' \+ INFO_ICON/.test(html),
   "…and it keeps its accessible name, which now carries the whole meaning");

// ── it is a popover, not a tooltip ──────────────────────────────────────────────────────────────────
// Half the beta is on a phone and title= tooltips do not exist there.
ok(/if\(S\.updatesInfoOpen\)\{/.test(html), "the panel is state-driven, so a tap opens it");
ok(html.includes('class="info-pop"'), "…and renders as a real panel");
ok(/\.info-pop\{position:absolute/.test(html),
   "…absolutely positioned inside cap-actions, so it anchors to the button and not the viewport");
ok(/\.info-pop\{[^}]*max-width:calc\(100vw - 32px\)/.test(html),
   "…and cannot exceed the viewport on a phone");
ok(/id="updatesInfoPop"[^>]*role="dialog"/.test(html), "…announced as a dialog");

// ── the content answers BOTH of Jenni's questions ───────────────────────────────────────────────────
const pop = html.slice(html.indexOf('if(S.updatesInfoOpen){'), html.indexOf('if(S.updatesInfoOpen){') + 2600);
ok(/newest source this talk already cites/.test(pop),
   "it says WHAT is searched — forward from this talk's own newest source");
ok(/PubMed/.test(pop) && /title has to match/.test(pop),
   "…that suggestions are PubMed-verified by PMID AND title, which is what the code actually does");
ok(/References only/.test(pop) && /teaching text is never rewritten/.test(pop),
   "…and that it only adds references, never rewriting the talk — the load-bearing reassurance");

// "including for saved" — her words. This is the paragraph she asked for by name.
ok(/already saved/.test(pop) && /unsaved again/.test(pop) && /Save/.test(pop),
   "it answers what happens to a SAVED talk: it goes unsaved and must be saved again");

// THE CORRECTION. She guessed Updates-again undoes. It re-runs the search.
ok(/Undo/.test(pop), "it names Undo as the way to reverse it");
ok(/not this button/.test(pop) || /Pressing Updates again/.test(pop),
   "…and explicitly says pressing Updates again is NOT undo — the misconception it exists to kill");
ok(/discards the current results and runs a fresh search/.test(pop),
   "…saying what the second press actually does instead");

// ── the claims are TRUE of the code, not just written ────────────────────────────────────────────────
// A panel that describes behaviour the code does not have is worse than no panel.
const apply = html.slice(html.indexOf("function applySelectedUpdates()"),
                         html.indexOf("function applySelectedUpdates()") + 2400);
ok(/t\.references\.push\(/.test(apply), "code check: applying really does push into references…");
ok(!/t\.sections\s*=/.test(apply) && !/t\.title\s*=/.test(apply),
   "…and really does not touch the teaching text, so the panel's promise holds");
// Anchored to the start of the line: `/S\.talkIsSaved = false;/` alone still matched after the line was
// commented out, so the mutation that broke the panel's promise survived.
ok(/^\s*S\.talkIsSaved = false;/m.test(apply),
   "code check: applying really does mark the talk unsaved, as the saved-talk paragraph claims");
ok(/pushTalkHistory\(/.test(apply),
   "code check: applying really does push an undo snapshot, so ↩ Undo really can reverse it");
const checkFn = html.slice(html.indexOf("async function checkForUpdates()"),
                           html.indexOf("async function checkForUpdates()") + 1800);
ok(/S\.updateCheck = \{ status: "running"/.test(checkFn),
   "code check: a second press really does re-run the search rather than undoing");
ok(/newest/.test(checkFn) && /Math\.max/.test(checkFn),
   "code check: the search really is anchored to the newest cited year");

// ── dismissal: ONE body.onclick, shared ─────────────────────────────────────────────────────────────
// document.body.onclick is a property. Two assignments and only the last popover closes on an outside
// click — the other one is stuck open with no way out on a phone, where there is no Escape key.
// There are three assignment SITES in the file: the library card menu (a different screen), this one,
// and a dead account-menu branch further down the same bind() pass. "Further down the same pass" is the
// dangerous one — it would overwrite this handler on every render. It is safe only because nothing sets
// accountMenuOpen true any more, so that branch never arms. That is a fact about the code, not a
// convention, so it is asserted: revive that menu and this test tells you to unify the handler first.
ok(!/accountMenuOpen\s*=\s*true/.test(html),
   "the account-menu body.onclick branch is dead (nothing sets accountMenuOpen true), so it cannot overwrite this one");
const mine = html.indexOf("if(S.overflowOpen||S.updatesInfoOpen){document.body.onclick");
ok(mine > -1, "sanity: the shared handler is present");
// Line-based, and it checks the assignment's OWN guard. A 240-char lookback was too generous: it
// exempted an injected handler simply because the dead account-menu branch happened to sit above it.
const lineOf = (i) => html.slice(html.lastIndexOf("\n", i) + 1, html.indexOf("\n", i));
const after = [];
for (let i = html.indexOf("document.body.onclick", mine + 60); i > -1;
     i = html.indexOf("document.body.onclick", i + 1)) after.push(i);
const strays = after.filter(i => {
  const line = lineOf(i);
  if (/accountMenuOpen/.test(line)) return false;          // the dead branch, guarded on its own line
  if (/\}\}else\{document\.body\.onclick=null\}/.test(line)) return false;  // this handler's own reset
  return true;
});
ok(strays.length === 0,
   `nothing new binds body.onclick later in this pass (${strays.length} stray assignment(s)) — a later one would silently replace this handler on every render`);
ok(/if\(S\.overflowOpen\|\|S\.updatesInfoOpen\)\{document\.body\.onclick/.test(html),
   "…and that one handler is armed when EITHER popover is open");
ok(/S\.updatesInfoOpen&&!e\.target\.closest\("\.info-pop"\)/.test(html),
   "…and closes the explainer on a click outside it");
ok(/S\.overflowOpen&&!e\.target\.closest\("\.overflow-menu"\)/.test(html),
   "…without having broken the overflow menu's own dismissal");
ok(/updatesInfoBtn"\);if\(uib\)uib\.onclick=function\(e\)\{e\.stopPropagation\(\)/.test(html),
   "the ⓘ stops propagation, so opening it does not immediately hit the outside-click closer");

// The two popovers are mutually exclusive — they occupy the same corner.
ok(/S\.overflowOpen=!S\.overflowOpen;S\.updatesInfoOpen=false/.test(html),
   "opening the ⋮ menu closes the explainer — they share the same corner");
ok(/S\.updatesInfoOpen=!S\.updatesInfoOpen;S\.overflowOpen=false/.test(html),
   "…and opening the explainer closes the ⋮ menu");
ok(/S\.updatesInfoOpen=false; S\.updateCheck=null; checkForUpdates\(\)/.test(html),
   "starting a check closes the panel, so it is not covering the results it explains");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ UPDATES EXPLAINER OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
