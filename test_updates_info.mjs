// CAPSULE EXPLAINER — run: node test_updates_info.mjs
//
// Filename kept deliberately: this began as the Updates ⓘ and the git history is worth more than a tidy
// name. What it covers has widened. On 2026-08-20 Jenni moved the mark to the upper-right corner of
// "New talk" and asked it to explain "new talk generation, what updates, save, kebab actions are and
// ability to undo" — the whole bar, not one button of it.
//
// Two misconceptions are the reason this panel exists, and both are asserted by CONTENT, not presence:
//   1. that pressing Updates a second time undoes it (it re-runs the search) — Jenni's own guess;
//   2. that New talk edits the talk you are on (it clears the screen and the next generation costs).
// A panel is only worth having if what it says is TRUE OF THE CODE, so every claim it makes is checked
// against the implementation further down this file.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

// ── THE MARK SITS ON "New talk", NOT ON UPDATES ────────────────────────────────────────────────────
const iReset   = html.indexOf('id="resetBtn"');
const iInfoBtn = html.indexOf('id="capsuleInfoBtn"');
const iActions = html.indexOf(`h+='<div class="cap-actions"`);
const iUpdates = html.indexOf('<span class="hide-mobile-text">Updates</span>');
ok(iReset > -1 && iActions > -1, "sanity: the capsule's New talk button and actions row both render");
ok(iInfoBtn > -1, "the ⓘ button renders");
ok(iInfoBtn > iReset && iInfoBtn < iActions,
   "…between New talk and the actions row — i.e. anchored to New talk, not parked beside Updates");
ok(iUpdates > iActions,
   "sanity: Updates is in the actions row, so 'before cap-actions' really does mean 'not next to Updates'");
// The corner placement is what makes it read as a mark ON the pill rather than a sixth control beside it.
ok(/id="capsuleInfoBtn" class="info-i info-i-corner"/.test(html),
   "…wearing info-i-corner, the class that lifts it to the pill's top-right rather than centring it");
ok(/\.tk-capsule \.cap-meta-info\{[^}]*align-items:flex-start/.test(html),
   "…and its row is top-aligned, which is what puts it at the UPPER right and not the middle right");
ok(/id="capsuleInfoBtn"[^>]*aria-label="How this bar works"/.test(html),
   "…with an accessible name describing the WHOLE bar, since that is now its subject");
ok(!/aria-label="What does Updates do\?"/.test(html),
   "…and the old Updates-only name is gone, not left behind to contradict the panel");
ok(/id="capsuleInfoBtn"[^>]*aria-expanded="'\+\(S\.capsuleInfoOpen\?"true":"false"\)/.test(html),
   "…and aria-expanded tracks the panel, so the state is announced rather than only drawn");
// cap-meta's base class ellipsises text with overflow:hidden. Hosting an absolutely-positioned panel in
// it clips the panel to a sliver — the variant must turn that off AND become the positioning context.
ok(/\.tk-capsule \.cap-meta-info\{[^}]*overflow:visible/.test(html),
   "the host row is overflow:visible — the base cap-meta clips to an ellipsis and would shave the panel");
ok(/\.tk-capsule \.cap-meta-info\{[^}]*position:relative/.test(html),
   "…and is the positioning context, so the panel anchors to the button and not the viewport");

// ── DRAWN ICONS, NOT EMOJI (Jenni 2026-08-19) ───────────────────────────────────────────────────────
// Updates showed ⚠️ when the topic was fast-moving and 🔎 otherwise. A hazard triangle reads as
// "something is wrong with this talk" when it means "this field moves quickly" — alarm where the intent
// was invitation. And swapping the GLYPH to carry state changes the button's silhouette with the topic.
ok(/: SEARCH_ICON\)/.test(html), "Updates always shows the magnifier…");
const _ub = html.indexOf('h+=\'<button class="checkUpdatesBtn"');
const updBtn = html.slice(_ub, html.indexOf("</button>';", _ub) + 11);
ok(updBtn.length > 100, "sanity: the Updates button markup was located");
// Asserted STRUCTURALLY. Matching the ⚠ character missed a mutant that wrote the JS escape "\\u26a0"
// instead of the literal glyph — same defect either way, invisible to a character match.
ok(!/_ucFast \?/.test(updBtn),
   "…and the icon slot has NO fast-moving branch — the glyph cannot change with state, whatever it is");
ok(!/⚠/.test(updBtn) && !/u26a0/.test(updBtn),
   "…and no hazard triangle by either spelling, literal or escaped");
ok(/_ucFast && !S\.updateCheck \? ' style="color:#7a5b1a"'/.test(html),
   "…while the fast-moving signal survives as colour, so the silhouette stays constant");
ok(/var SEARCH_ICON = SVG_OPEN/.test(html),
   "the magnifier is an inline SVG in the shared family, not an emoji that renders per-platform");
ok(/var INFO_ICON   = '<svg width="13" height="13"/.test(html),
   "the info mark is drawn at 13px — smaller than the 14px controls, because it explains them rather than being one");
ok(!/\\u24D8/.test(html), "…and the circled-i character is gone");

// ── SCROLLED: UPDATES GOES, THE EXPLAINER STAYS ────────────────────────────────────────────────────
// Undo, Save changes, ⋮ are the mid-read three. Updates is not mid-read work — it fires a search, takes
// ~a minute and returns a panel to review. Its ⓘ USED to hide with it, correctly, because an explainer
// for an off-screen control is clutter. That reasoning expired the moment the mark moved: it now
// explains New talk / Save / ⋮ / Undo, all of which stay on screen. So it stays too.
const scrolled = html.slice(html.indexOf("SCROLLED = THE URGENT THREE ONLY"),
                            html.indexOf("SCROLLED = THE URGENT THREE ONLY") + 1600);
ok(/body\.scrolled-past-capsule[^{]*\.checkUpdatesBtn\{display:none/.test(scrolled),
   "scrolled hides the Updates button…");
ok(!/scrolled-past-capsule[^\n]*#capsuleInfoBtn[^\n]*display:\s*none/.test(html),
   "…and the ⓘ is NOT hidden with it — it rides with New talk, which survives scrolling");
ok(!/scrolled-past-capsule[^\n]*cap-meta-info[^\n]*display:\s*none/.test(html),
   "…nor is its whole row hidden, which would be the same defect one level up");
// Scoped to the CAPSULE, not global — Updates must still exist at the top of the page.
ok(/\.tk-capsule \.cap-actions \.checkUpdatesBtn/.test(scrolled),
   "…scoped to .tk-capsule .cap-actions, so this is a scrolled-state rule and not a delete");
ok(!/scrolled-past-capsule[^{]*#undoEditBtn\{display:none/.test(html), "Undo survives scrolling");
ok(!/scrolled-past-capsule[^{]*#overflowBtn\{display:none/.test(html), "…the ⋮ survives");
// The display:none has to be matched ACROSS the brace — `[^{]*` cannot reach it, so the first version of
// this assertion passed while a rule hiding Save sat in the file.
ok(!/scrolled-past-capsule[^\n]*\.cap-save[^\n]*display:\s*none/.test(html),
   "…and Save is never hidden while scrolled — that would be the dangerous version of this change");
ok(/body\.scrolled-past-capsule[^\n]*\.cap-save-unsaved \.hide-mobile-text\{display:inline !important\}/.test(html),
   "…and an UNSAVED talk still keeps the word 'Save' while scrolled — the one label that must not collapse");

// ── IT IS A POPOVER, AND IT OPENS ON THE CORRECT SIDE ──────────────────────────────────────────────
// Half the beta is on a phone and title= tooltips do not exist there.
ok(/if\(S\.capsuleInfoOpen\)\{/.test(html), "the panel is state-driven, so a tap opens it");
ok(/class="info-pop info-pop-left"/.test(html), "…and renders as a real panel, left-anchored");
ok(/\.info-pop\{position:absolute/.test(html),
   "…absolutely positioned, so it anchors to its button and not the viewport");
ok(/\.info-pop\{[^}]*max-width:calc\(100vw - 32px\)/.test(html),
   "…and cannot exceed the viewport on a phone");
ok(/id="capsuleInfoPop"[^>]*role="dialog"/.test(html), "…announced as a dialog");
// SOURCE ORDER IS THE WHOLE FIX. `.info-pop` and `.info-pop-left` are both single-class selectors, so
// specificity ties and the LATER rule wins. Written above the base, `.info-pop{right:0}` simply beat it
// and the panel still flew to the right-hand edge, off a button on the left. Nothing about the markup
// would have looked wrong. Asserted by position, because that is the only thing that was ever wrong.
ok(html.indexOf(".info-pop-left{") > html.indexOf(".info-pop{position:absolute"),
   "the left-anchor rule sits AFTER the base rule — equal specificity means source order decides right:0");
ok(/\.info-pop-left\{right:auto;left:0\}/.test(html),
   "…and it clears right as well as setting left, or the panel is pinned to both edges and stretches");

// ── THE PANEL COVERS ALL FIVE THINGS SHE NAMED ─────────────────────────────────────────────────────
const _ps = html.indexOf("if(S.capsuleInfoOpen){");
const pop = html.slice(_ps, html.indexOf("h+='</div>';", _ps) + 12);
ok(pop.length > 800, "sanity: the panel body was located");

// 1. NEW TALK — the cost misconception. New talk and Refine look alike and are not.
ok(/New talk/.test(pop) && /spends a credit/.test(pop),
   "it says New talk costs a credit — the distinction from Refine that nothing else on screen makes");
ok(/does not edit the talk you are on/.test(pop) && /Refine/.test(pop),
   "…and points at Refine as the free way to change THIS talk, which is the actual question behind it");
ok(/unsaved, New talk asks before it clears/.test(pop),
   "…and says the unsaved talk is protected by a confirm, so the button is not frightening");

// 2. UPDATES — unchanged in substance, folded in.
ok(/newest source this talk already cites/.test(pop),
   "it says WHAT Updates searches — forward from this talk's own newest source");
ok(/PubMed/.test(pop) && /title has to match/.test(pop),
   "…that suggestions are PubMed-verified by PMID AND title, which is what the code actually does");
ok(/References only/.test(pop) && /teaching text is never rewritten/.test(pop),
   "…and that it only adds references, never rewriting the talk — the load-bearing reassurance");

// 3. SAVE — "including for saved", her words, from the first version of this panel.
ok(/Saved/.test(pop) && /Save changes/.test(pop),
   "it explains BOTH save states, since the bar shows one word or the other and they mean opposite things");
ok(/those changes are lost/.test(pop),
   "…and says plainly what leaving with unsaved changes costs");

// 4. THE KEBAB — what is behind it, so it is not a mystery dot.
ok(/PDF/.test(pop) && /image/.test(pop), "the ⋮ paragraph names the exports…");
ok(/Make public/.test(pop) && /Make private/.test(pop), "…the publish toggle…");
ok(/copy the link/.test(pop) && /delete/.test(pop), "…copy link and delete");
ok(/private also takes it off your profile/.test(pop),
   "…and the consequence of going private, which is the one that surprises people");

// 5. UNDO — and THE CORRECTION. She guessed Updates-again undoes. It re-runs the search.
ok(/Undo/.test(pop) && /reverses the last change/.test(pop), "it names Undo as the way to reverse things");
ok(/only thing that reverses them/.test(pop) && /does not undo/.test(pop),
   "…and explicitly says pressing Updates again is NOT undo — the misconception it exists to kill");
ok(/discards the current results and runs a fresh search/.test(pop),
   "…saying what the second press actually does instead");

// ── EVERY CLAIM IS TRUE OF THE CODE ────────────────────────────────────────────────────────────────
// A panel that describes behaviour the code does not have is worse than no panel at all.
const apply = html.slice(html.indexOf("function applySelectedUpdates()"),
                         html.indexOf("function applySelectedUpdates()") + 2400);
ok(/t\.references\.push\(/.test(apply), "code check: applying really does push into references…");
ok(!/t\.sections\s*=/.test(apply) && !/t\.title\s*=/.test(apply),
   "…and really does not touch the teaching text, so the panel's promise holds");
// Anchored to the start of the line: `/S\.talkIsSaved = false;/` alone still matched after the line was
// commented out, so the mutation that broke the panel's promise survived.
ok(/^\s*S\.talkIsSaved = false;/m.test(apply),
   "code check: applying really does mark the talk unsaved, as the Save paragraph claims");
ok(/pushTalkHistory\(/.test(apply),
   "code check: applying really does push an undo snapshot, so ↩ Undo really can reverse it");
const checkFn = html.slice(html.indexOf("async function checkForUpdates()"),
                           html.indexOf("async function checkForUpdates()") + 1800);
ok(/S\.updateCheck = \{ status: "running"/.test(checkFn),
   "code check: a second press really does re-run the search rather than undoing");
ok(/newest/.test(checkFn) && /Math\.max/.test(checkFn),
   "code check: the search really is anchored to the newest cited year");
// The New talk claims. Both halves: it resets, and it guards an unsaved talk first.
const reset = html.slice(html.indexOf("function safeResetAll()"),
                         html.indexOf("function safeResetAll()") + 400);
ok(/!S\.talkIsSaved/.test(reset) && /confirm\(/.test(reset),
   "code check: New talk really does confirm before discarding an unsaved talk");
ok(/resetAll\(\);/.test(reset) && /rb\.onclick=safeResetAll/.test(html),
   "code check: New talk really is a reset, not an edit of the current talk");
// The kebab claims, each against the button that would have to exist.
const menu = html.slice(html.indexOf('h+=\'<div class="overflow-menu"'),
                        html.indexOf('h+=\'<div class="overflow-menu"') + 6000);
ok(/id="pdfTalkBtn"/.test(menu), "code check: Export PDF really is in the ⋮ menu");
ok(/id="pngTalkBtn"/.test(menu), "code check: Save as image really is in the ⋮ menu");
ok(/id="capMakePublicBtn"/.test(menu) && /id="capMakePrivateBtn"/.test(menu),
   "code check: both halves of the publish toggle really are there");
ok(/id="capCopyLinkBtn"/.test(menu), "code check: Copy link really is there");
ok(/id="deleteTalkBtn"/.test(menu), "code check: Delete really is there");
// "private also takes it off your profile" — the unfeature is the claim, and it is easy to lose.
ok(/is_featured\s*:\s*false/.test(html),
   "code check: going private really does unfeature, so the profile claim holds");

// ── DISMISSAL: ONE body.onclick, SHARED ────────────────────────────────────────────────────────────
// document.body.onclick is a property. Two assignments and only the last popover closes on an outside
// click — the other is stuck open with no way out on a phone, where there is no Escape key.
ok(!/accountMenuOpen\s*=\s*true/.test(html),
   "the account-menu body.onclick branch is dead (nothing sets accountMenuOpen true), so it cannot overwrite this one");
const mine = html.indexOf("if(S.overflowOpen||S.capsuleInfoOpen){document.body.onclick");
ok(mine > -1, "sanity: the shared handler is present");
// Line-based, and it checks the assignment's OWN guard. A 240-char lookback was too generous: it
// exempted an injected handler simply because the dead account-menu branch happened to sit above it.
const lineOf = (i) => html.slice(html.lastIndexOf("\n", i) + 1, html.indexOf("\n", i));
const after = [];
for (let i = html.indexOf("document.body.onclick", mine + 60); i > -1;
     i = html.indexOf("document.body.onclick", i + 1)) after.push(i);
const strays = after.filter(i => {
  const line = lineOf(i);
  if (/accountMenuOpen/.test(line)) return false;
  if (/\}\}else\{document\.body\.onclick=null\}/.test(line)) return false;
  return true;
});
ok(strays.length === 0,
   `nothing new binds body.onclick later in this pass (${strays.length} stray assignment(s)) — a later one would silently replace this handler on every render`);
ok(/S\.capsuleInfoOpen&&!e\.target\.closest\("\.info-pop"\)/.test(html),
   "…and it closes the explainer on a click outside it");
ok(/S\.overflowOpen&&!e\.target\.closest\("\.overflow-menu"\)/.test(html),
   "…without having broken the overflow menu's own dismissal");
ok(/capsuleInfoBtn"\);if\(uib\)uib\.onclick=function\(e\)\{e\.stopPropagation\(\)/.test(html),
   "the ⓘ stops propagation, so opening it does not immediately hit the outside-click closer");
// They no longer share a corner, but they still must not stack: the panel is wide and the menu is modal
// in feel, and two open popovers on one bar is noise whatever the geometry.
ok(/S\.overflowOpen=!S\.overflowOpen;S\.capsuleInfoOpen=false/.test(html),
   "opening the ⋮ menu closes the explainer");
ok(/S\.capsuleInfoOpen=!S\.capsuleInfoOpen;S\.overflowOpen=false/.test(html),
   "…and opening the explainer closes the ⋮ menu");
ok(/S\.capsuleInfoOpen=false; S\.updateCheck=null; checkForUpdates\(\)/.test(html),
   "starting a check closes the panel, so it is not covering the results it explains");

// ── NOTHING IS LEFT BEHIND UNDER THE OLD NAME ──────────────────────────────────────────────────────
// A half-rename leaves a handler bound to an id that no longer renders: the button draws and does nothing.
ok(!/updatesInfoBtn/.test(html) && !/updatesInfoOpen/.test(html) && !/updatesInfoPop/.test(html),
   "no updatesInfo* identifier survives the rename — a stray one binds a handler to an id that never renders");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ CAPSULE EXPLAINER OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
