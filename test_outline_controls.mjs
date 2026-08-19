// OUTLINE-HEAD CONTROLS — run: node test_outline_controls.mjs
//
// Three worded buttons — "↕ Reorder", "Expand all", "⧉ Copy all" — crowded the LESSON OUTLINE row and
// on a phone wrapped onto their own line. Two lose their labels; ONE KEEPS ITS LABEL DELIBERATELY.
//
// The asymmetry is the whole design and is what this suite protects: the same ⧉ glyph sits on every
// section card, so an icon-only ⧉ in the header would read as "copy this one section". Reorder and
// expand have no such collision. Making all three icon-only would be more consistent and worse.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
// Backs up TWO lines past the h+='<button, because the tooltip/aria strings are built into a local
// (_roLbl / _exLbl) declared just above the markup. Slicing from the markup alone made two assertions
// fail on correct code — the same over-tight scoping that has bitten every suite in this session.
const btn = (id) => {
  const i = html.indexOf(`id="${id}"`);
  if (i < 0) return "";
  const start = html.lastIndexOf("h+='<button", i);
  return html.slice(Math.max(0, start - 400), html.indexOf("</button>", i) + 9);
};
const reorder = btn("reorderModeBtn"), expand = btn("expandAllBtn"), copy = btn("copyAllSectionsBtn");
ok(!!reorder && !!expand && !!copy, "sanity: all three outline-head buttons render");

// ── the two that lose their words ───────────────────────────────────────────────────────────────────
ok(/REORDER_ICON/.test(reorder), "Reorder uses an icon…");
ok(!/>↕ Reorder<|'Reorder'|"Reorder"\s*\+/.test(reorder) && !/<span>Reorder<\/span>/.test(reorder),
   "…and no longer renders the word 'Reorder' at rest");
ok(/CHEVRONS_DOWN/.test(expand) && /CHEVRONS_UP/.test(expand),
   "Expand/Collapse uses DOUBLE chevrons that flip with state…");
ok(!/<span>Expand all<\/span>|<span>Collapse all<\/span>/.test(expand) && !/allExpLbl2/.test(expand),
   "…and no longer renders 'Expand all' / 'Collapse all' as text");
ok(!/allExpLbl2/.test(html), "…and the label variable it used is gone, not left dangling");

// DOUBLE, and asserted as double. Every other assertion only checked that the icons were REFERENCED,
// so swapping in a single chevron — the exact thing that reads as "this one section" — survived the
// whole mutation pass. The count is the requirement, so the count is the test.
for (const [name, dir] of [["CHEVRONS_DOWN", "down"], ["CHEVRONS_UP", "up"]]) {
  // To END OF LINE, not a fixed window: a 220-char slice from CHEVRONS_DOWN spilled into CHEVRONS_UP
  // and counted four polylines. Fixed-width windows keep producing these off-by-one-declaration bugs.
  const at = html.indexOf(`var ${name}`);
  const src = html.slice(at, html.indexOf("\n", at));
  ok((src.match(/<polyline/g) || []).length === 2,
     `${name} draws TWO chevrons (${dir}) — a single one means "this section", not "all of them"`);
}

// Direction is what the click DOES. Down = it will open everything.
ok(/S\.allExpanded\?CHEVRONS_UP:CHEVRONS_DOWN/.test(expand),
   "…pointing UP when everything is open (so the click closes) and DOWN when closed");

// ── the one that keeps its words, and why ───────────────────────────────────────────────────────────
ok(/<span>Copy all<\/span>/.test(copy), "Copy all KEEPS its label — the ⧉ alone would mean 'copy this section'");
ok(/COPY_ICON/.test(copy), "…alongside the same overlapping-squares icon as before");
// The collision that justifies it must actually exist: ⧉ really is on every section card.
const perSection = (html.match(/COPY_ICON/g) || []).length;
ok(perSection >= 2,
   `…and COPY_ICON really is reused elsewhere (${perSection} uses), which is what makes icon-only ambiguous`);

// ── an icon-only control MUST carry its name some other way ─────────────────────────────────────────
for (const [label, src] of [["Reorder", reorder], ["Expand/Collapse", expand]]) {
  ok(/aria-label="/.test(src), `${label}: has an aria-label — an icon-only button is otherwise nameless`);
  ok(/title="/.test(src), `${label}: has a title, so hovering explains it`);
}
ok(/aria-label="Copy the entire lesson outline"/.test(copy), "Copy all: named for screen readers too");
ok(/aria-pressed="/.test(reorder), "Reorder announces its pressed state, since it toggles a mode");
ok(/aria-expanded="/.test(expand), "Expand announces expanded state rather than only drawing it");

// The tooltip must say what it does, not just name the thing.
ok(/Reorder sections/.test(reorder), "Reorder's tooltip reads 'Reorder sections', as specified");
ok(/Expand all sections/.test(expand) && /Collapse all sections/.test(expand),
   "Expand's tooltip says which way the click will go");

// ── reorder is a MODE, so its exit stays worded ─────────────────────────────────────────────────────
// The outline collapses into ↑/↓ rows when active. An icon-only exit is how someone gets stuck in a
// mode they did not mean to enter — the one place a label earns its width back.
ok(/<span>Done<\/span>/.test(reorder),
   "while reorder mode is ACTIVE the button still says 'Done' in words — an icon-only exit strands people");
ok(/S\.reorderMode\?\(DONE_ICON/.test(reorder), "…with a check icon beside it");

// ── the icons are one family, and none of them is announced twice ───────────────────────────────────
for (const icon of ["REORDER_ICON", "DONE_ICON", "CHEVRONS_DOWN", "CHEVRONS_UP"]) {
  ok(new RegExp(`var ${icon}\\s*=\\s*SVG_OPEN`).test(html), `${icon} is built from the shared SVG_OPEN…`);
}
ok(/var SVG_OPEN = [^\n]*aria-hidden="true"/.test(html),
   "…which sets aria-hidden, so the svg is not read as a second nameless child of the button");
ok(/var SVG_OPEN = [^\n]*stroke-width="2"/.test(html) && /var SVG_OPEN = [^\n]*width="14"/.test(html),
   "…at the same 14px / stroke-2 weight as COPY_ICON, so the row reads as one set");

// ── SIZING, HIT AREA, AND THE STATES YOU CAN SEE ───────────────────────────────────────────────────
// Spec: 32x32 icon buttons, visible hover AND focus, minimum 40x40 on touch. Each is asserted against
// the stylesheet rather than the markup, because that is where a pseudo-class state can live at all.
// Bounded by a REAL marker — the rule that follows the block — not a character count. Bounding it at
// `indexOf("@media (pointer:coarse)")` meant deleting that block silently truncated the slice, so two
// mutations died by the wrong assertion. A guard that fails for the wrong reason is luck, not coverage.
const css = html.slice(html.indexOf(".outline-icon-btn{"), html.indexOf(".overflow-menu{position:absolute"));
ok(css.length > 400 && css.length < 4000, "sanity: the toolbar CSS block was located by its real boundaries");
ok(/\.outline-icon-btn\{[^}]*width:32px[^}]*height:32px/.test(css), "icon buttons are 32x32…");
ok(/\.outline-icon-btn\{[^}]*padding:0/.test(css), "…with no padding fighting the fixed size");

// The BUTTON grew, the GLYPH did not. A 14px icon matches the ⧉ beside it and on every section card;
// scaling it up with the button would break the row into two visual weights.
ok(/var SVG_OPEN = [^\n]*width="14"/.test(html) && /var COPY_ICON = [^\n]*width="14"/.test(html),
   "…while the glyphs stay 14px, the same as COPY_ICON, so the row reads as one set");

ok(/\.outline-icon-btn:hover,\.outline-txt-btn:hover\{[^}]*background:/.test(css),
   "hover is visible on both button kinds");
ok(/:focus-visible\{[^}]*outline:2px solid/.test(css),
   "focus is visible too — an icon-only control that only answers to hover is unusable by keyboard");
ok(/:focus-visible/.test(css) && !/\.outline-icon-btn:focus\{/.test(css),
   "…and it is :focus-visible, so a mouse click does not leave a ring behind");

// 40x40 on touch WITHOUT changing the layout.
const coarse = html.slice(html.indexOf("@media (pointer:coarse)"), html.indexOf("@media (pointer:coarse)") + 400);
ok(/min-width:40px/.test(coarse) && /min-height:40px/.test(coarse), "touch devices get a 40x40 minimum hit area…");
ok(/::before/.test(coarse) && /position:absolute/.test(coarse),
   "…via an invisible ::before, so the visible button stays 32x32 and the row does not reflow on phones");
ok(/@media \(pointer:coarse\)/.test(html),
   "…scoped to coarse pointers, so it cannot swallow neighbouring mouse clicks");

// ── NO EMOJI OR UNICODE GLYPHS IN THIS TOOLBAR ─────────────────────────────────────────────────────
// The old row used ↕ and relied on the platform to draw it. Every icon is now an inline SVG stroked
// with currentColor, so it inherits the button's colour in every state including reorder-mode-on.
// COMMENT LINES STRIPPED FIRST. The unstripped scan flagged the ↑/↓ in the comment explaining why
// reorder mode needs a worded exit — prose, not markup. Fifth time this session that a match landed in
// a comment instead of the code, and the fix is the same every time: narrow to what actually ships.
const codeOnly = (src) => src.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
for (const [label, src] of [["Reorder", reorder], ["Expand/Collapse", expand], ["Copy all", copy]]) {
  const glyphs = (codeOnly(src).match(/[\u2190-\u21FF\u2300-\u27BF\uFE0F\u{1F300}-\u{1FAFF}]/gu) || []);
  ok(glyphs.length === 0,
     `${label}: no emoji or Unicode glyph in the RENDERED markup (found ${glyphs.length}${glyphs.length ? ": " + glyphs.join(" ") : ""})`);
}
ok(/var SVG_OPEN = [^\n]*stroke="currentColor"/.test(html),
   "…and every icon strokes with currentColor, so it follows the button's colour into the filled state");

// ── THE JOIN: the buttons must actually WEAR the classes ───────────────────────────────────────────
// Two mutations survived the first pass by stripping class= from a button. Every sizing, hover, focus
// and hit-area assertion above still passed, because the stylesheet was untouched — I had tested the CSS
// and the markup separately and never that they meet. The styles are dead code without this.
ok(/id="reorderModeBtn" class="\'\+\(S\.reorderMode\?"outline-txt-btn":"outline-icon-btn"\)\+\'"/.test(reorder),
   "reorder wears outline-icon-btn at rest and outline-txt-btn while active — the class follows the shape");
ok(/id="expandAllBtn" class="outline-icon-btn"/.test(expand), "expand/collapse wears outline-icon-btn");
ok(/id="copyAllSectionsBtn" class="outline-txt-btn"/.test(copy), "Copy all wears outline-txt-btn, so it gets the same hover and focus");

// ── HANDLERS MUST NOT HAVE MOVED ───────────────────────────────────────────────────────────────────
// The whole change is presentational. If an id drifted, a control would silently stop working.
for (const id of ["reorderModeBtn", "expandAllBtn", "copyAllSectionsBtn"]) {
  ok(html.includes(`id="${id}"`), `${id} still rendered…`);
  ok(new RegExp(`getElementById\\("${id}"\\)`).test(html), `…and still bound by id, so no handler changed`);
}

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ OUTLINE CONTROLS OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
