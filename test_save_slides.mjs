// SAVE SLIDES TO LIBRARY — run: node test_save_slides.mjs
//
// The Slides view could be EXPORTED to a file but never SAVED. So the artefact most likely to be reused
// in teaching — the slide poster — was the one you had to regenerate or dig out of Downloads, while
// AI-generated images got a library slot.
//
// The interesting risk here is duplication, not the feature. saveCurrentVisualToLibrary already carried
// the hard part: cloud vs local vs save-as-new, and a ROLLBACK that pulls the visual back out of memory
// when the write fails — without which the in-memory array reads as saved and a reload loses it (that
// was a real bug, Codex #2). Writing a second copy of that for slides would be a second place to forget
// the rollback. So slides go through the SAME path, and this suite asserts there is only one.
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

// ── ONE persistence path, used by both ──────────────────────────────────────────────────────────────
const persist = fnSrc("persistVisualToLibrary");
const saveImg = fnSrc("saveCurrentVisualToLibrary");
const saveSlides = fnSrc("saveSlidesToLibrary");
ok(/persistVisualToLibrary\(/.test(saveImg), "the AI-image path delegates to persistVisualToLibrary…");
ok(/persistVisualToLibrary\(/.test(saveSlides), "…and so does the slides path");
ok(/_rollback/.test(persist), "…which is where the rollback lives");
ok(!/_rollback/.test(saveSlides) && !/_rollback/.test(saveImg),
   "…and neither caller reimplements it — one rollback, not two");
ok(!/cloudUpdateTalk/.test(saveSlides),
   "…nor its own cloud write, which is how the two would drift apart");
ok(/S\.talk\.savedVisuals\.push\(visual\)/.test(persist),
   "the shared path is what pushes into savedVisuals");

// The rollback must still actually work — the reason it exists is a bug that shipped once.
ok(/var i=S\.talk\.savedVisuals\.indexOf\(visual\); if\(i>=0\) S\.talk\.savedVisuals\.splice\(i,1\)/.test(persist),
   "rollback removes the exact visual it pushed, so a failed write cannot read as saved");

// ── slides capture: same source and same encoding as the export, so saved == exported ───────────────
ok(/getElementById\("slidesCapture"\)/.test(saveSlides), "slides are captured from #slidesCapture…");
ok(/getElementById\("slidesCapture"\)/.test(fnSrc("exportSlidesImage")),
   "…the same element the export uses, so what is saved is what you would have downloaded");
ok(/toDataURL\("image\/jpeg", 0\.92\)/.test(saveSlides),
   "…at JPEG 0.92, matching the export — PNG would be 5-10x larger inside talk_json");
ok(/if\(!window\.html2canvas\)/.test(saveSlides),
   "…and it checks html2canvas has finished loading rather than throwing on a cold click");
ok(/if\(!target\)\{ alert\("Open the Slides tab first\."\)/.test(saveSlides),
   "…and says what to do if the Slides tab is not open");
ok(/if\(!b64\)\{/.test(saveSlides), "…and handles an empty capture instead of saving a blank visual");

// ── the entry is TAGGED, or the badge has nothing to read ───────────────────────────────────────────
ok(/kind: "slides"/.test(saveSlides), "a saved slide poster is tagged kind:slides");
ok(/mode: "slides"/.test(saveSlides), "…and mode:slides, so older readers that only know mode still see it");

// ── the badge counts them separately ────────────────────────────────────────────────────────────────
const card = html.slice(html.indexOf("// 📊 for slide posters"), html.indexOf("// 📊 for slide posters") + 1200);
ok(/v\.kind === "slides" \|\| v\.mode === "slides"/.test(card),
   "the library card counts slides by either tag…");
ok(/_nImgs = visuals\.length - _nSlides/.test(card), "…and images as the remainder, so nothing is double-counted");
ok(/if\(_nImgs > 0\)/.test(card) && /if\(_nSlides > 0\)/.test(card),
   "…showing each badge only when that kind is present, rather than a '0'");
// Either spelling. The badge is written as the surrogate escape \\uD83D\\uDCCA rather than the literal
// glyph, and a character-only match missed it — the third time this session a test failed on correct
// code because a glyph can be spelled two ways in a source file.
ok(/(?:📊|\\uD83D\\uDCCA) '\+_nSlides/.test(card), "…with 📊 for slides, literal or escaped");
ok(/🖼 '\+_nImgs/.test(card), "…and 🖼 kept for generated images");

// ── the button, and which order ─────────────────────────────────────────────────────────────────────
ok(/id="saveSlidesLibBtn"/.test(html), "the Slides tab has a Save-to-library button…");
const iLib = html.indexOf('id="saveSlidesLibBtn"'), iDl = html.indexOf('id="saveSlidesImgBtn"');
ok(iLib > -1 && iDl > -1 && iLib < iDl,
   "…placed BEFORE the download button, because keeping it with the talk is the commoner intent");
ok(/id="saveSlidesImgBtn"/.test(html), "…and downloading is still available");
ok(/slb\.onclick=function\(\)\{ saveSlidesToLibrary\(\); \}/.test(html), "…and it is wired");
ok(/sib\.onclick=exportSlidesImage/.test(html), "…without disturbing the existing export handler");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ SAVE SLIDES OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
