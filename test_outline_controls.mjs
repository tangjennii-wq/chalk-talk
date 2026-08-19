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

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ OUTLINE CONTROLS OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
