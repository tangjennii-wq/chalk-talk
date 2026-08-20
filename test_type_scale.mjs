// TYPE SCALE — run: node test_type_scale.mjs
//
// Jenni: "make chalk talk a little more subtle ... and our title too large of a font", pointing at a
// site built on small type, wide tracking and a lot of air.
//
// The specific problem was that the WORDMARK and the LECTURE TITLE were both 28px/700 Georgia with
// negative tracking. Two competing headlines, and display-poster styling on what is really a document
// heading — the title out-weighed the teaching text underneath it, which is the content people came for.
//
// Sizes are asserted as a HIERARCHY rather than as magic numbers: what must hold is that each level
// steps down from the one above it. Someone retuning the scale can move every value, and this still
// catches the wordmark and the title colliding again.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

const px = (re, label) => {
  const m = html.match(re);
  if (!m) { ok(false, `sanity: ${label} font-size not found`); return NaN; }
  return parseFloat(m[1]);
};
const heroSize   = px(/\.hero-title \{[\s\S]{0,600}?font-size: (\d+(?:\.\d+)?)px/, "wordmark");
const titleSize  = px(/\.tk-lessontitle h1\{[^}]*font-size:(\d+(?:\.\d+)?)px/, "lecture title");
const secSize    = px(/\.tk-titlebar \.tk-title\{[^}]*font-size:(\d+(?:\.\d+)?)px/, "section heading");
const labelSize  = px(/\.outline-head\{[^}]*font-size:(\d+(?:\.\d+)?)px/, "outline label");

ok(titleSize <= 23, `the lecture title came down from 28px (now ${titleSize}px) — the thing Jenni called out`);
ok(heroSize <= 22, `the wordmark came down too (now ${heroSize}px)…`);
ok(heroSize !== titleSize,
   `…and is no longer the SAME size as the lecture title (${heroSize} vs ${titleSize}) — two headlines competing was the actual defect`);
ok(titleSize > secSize, `the lecture title still outranks a section heading (${titleSize} > ${secSize})`);
ok(secSize > labelSize, `…and a section heading still outranks the outline label (${secSize} > ${labelSize})`);

// ── NEGATIVE TRACKING IS THE POSTER LOOK. It is what made these read as loud rather than large. ──────
const heroBlock = html.slice(html.indexOf(".hero-title {"), html.indexOf(".hero-title {") + 700);
const titleBlock = html.slice(html.indexOf(".tk-lessontitle h1{"), html.indexOf(".tk-lessontitle h1{") + 240);
const track = (block, re) => parseFloat((block.match(re) || [0, "0"])[1]);
ok(track(heroBlock, /letter-spacing: (-?\d*\.?\d+)em/) >= 0,
   "the wordmark no longer uses negative tracking — small caps-ish type needs air, not compression");
ok(track(titleBlock, /letter-spacing:(-?\d*\.?\d+)em/) > -0.01,
   "…and the lecture title's tracking is close to neutral rather than tightened like a headline");

// ── weight: 700 serif at size is the loudest possible setting ───────────────────────────────────────
ok(/\.tk-lessontitle h1\{[^}]*font-weight:600/.test(html), "the lecture title is 600, not 700");
ok(/\.hero-title \{[\s\S]{0,600}?font-weight: 600/.test(html), "…and so is the wordmark");

// ── the section label: light caps with air, not bold caps ───────────────────────────────────────────
const labelBlock = html.slice(html.indexOf(".outline-head{"), html.indexOf(".outline-head{") + 260);
ok(track(labelBlock, /letter-spacing:(\d*\.?\d+)em/) >= 0.14,
   "LESSON OUTLINE gained tracking — wide light caps is the cheapest move toward the reference");
ok(/font-weight:600/.test(labelBlock) && !/font-weight:700/.test(labelBlock),
   "…and dropped from 700 to 600, so it reads as a label rather than a toolbar");

// ── the mobile override must not undo the desktop change ────────────────────────────────────────────
// A !important rule in a media query is exactly how a type pass silently fails on phones.
const mob = html.match(/\.hero-title \{ font-size: (\d+(?:\.\d+)?)px !important; \}/);
ok(!!mob, "sanity: the mobile wordmark override still exists");
ok(mob && parseFloat(mob[1]) <= heroSize,
   `the mobile override (${mob && mob[1]}px) is not LARGER than the desktop size (${heroSize}px)`);

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ TYPE SCALE OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
