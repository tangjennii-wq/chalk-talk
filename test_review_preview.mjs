// The streaming preview must SURVIVE the review phase and be RETIRED at every exit.
// Run: node test_review_preview.mjs
//
// Measured by Jenni 2026-07-26 on a real generation: reasoning 5s · drafting 6-42s · review 42-70s.
// The preview was cleared the instant drafting finished, so the talk the user had just watched appear
// vanished and was replaced by a bare spinner for the entire 28-second review. The render layer already
// had a "reviewing" state for the preview (green border, "REVIEWING" label) — it was simply unreachable,
// because the data behind it was deleted one line after the draft arrived.
//
// The safety line this walks: an unreviewed draft must never be presented AS A FINISHED TALK. A labelled,
// read-only preview during generation is not that — it is the same content already on screen a moment
// earlier, and there is no Save or Share affordance while S.loading. But the moment generation ENDS by
// any route other than success, the preview must go: a withheld draft especially must not linger looking
// like a talk that passed.
import { readFileSync } from "fs";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const CLEAR = /S\.streamingTitle\s*=\s*""/;

// ── 1) the preview is NOT cleared when the draft lands ─────────────────────────
{
  const g = html.slice(html.indexOf("async function generate(){"));
  const i = g.indexOf("var mainResult = await callAPIWithFallback(sys, uc, maxTok, mainModels, mainOpts);");
  ok(i > 0, "found the synchronous draft call");
  const after = g.slice(i, i + 700);
  ok(!CLEAR.test(after), "the sync path does NOT wipe the preview the moment the draft arrives");
  ok(/KEEP THE PREVIEW UP THROUGH THE REVIEW/.test(after), "…and says why, so nobody re-adds the clear");

  const ai = g.indexOf("_draftWebSearched = !!(_res && _res.webSearched)");
  const afterAsync = g.slice(ai, ai + 700);
  ok(!CLEAR.test(afterAsync), "the async/Worker path does NOT wipe it either");
}

// ── 2) it IS retired at every exit ─────────────────────────────────────────────
{
  ok((html.match(/preview retired/g) || []).length === 2,
     "both success paths retire the preview as the real talk goes on screen");
  ok((html.match(/WITHHELD: the preview must not linger/g) || []).length === 2,
     "both WITHHOLD paths retire it — an unreviewed draft must not sit there looking like a finished talk");

  // the retire must happen BEFORE S.talk is assigned, or one render frame shows both
  for (const anchor of ["  S.citationAuditPending = true;", "    S.citationAuditPending = true;"]) {
    const i = html.indexOf(anchor);
    if (i < 0) continue;
    const win = html.slice(i, i + 400);
    const iClear = win.indexOf("preview retired");
    const iTalk = win.indexOf("S.talk = finalTalk");
    ok(iClear > 0 && iTalk > 0 && iClear < iTalk, "the preview is retired BEFORE S.talk is assigned (no frame showing both)");
  }
  // and on withhold, before the render that draws the withhold card
  const wi = html.indexOf("WITHHELD: the preview must not linger");
  const wwin = html.slice(wi, wi + 400);
  ok(wwin.indexOf("_saveReviewPending()") > 0, "the withhold clear sits with the withhold bookkeeping");
}

// ── 3) the render layer's "reviewing" state is now reachable ───────────────────
{
  ok(/var _reviewing = \(S\.genPhase === "reviewing"\)/.test(html), "the render layer tracks the reviewing phase");
  const i = html.indexOf("var _hasStreamPreview");
  const win = html.slice(i, i + 900);
  ok(/if\s*\(_hasStreamPreview\)/.test(win), "the preview renders when there is preview data");
  ok(/if\(_reviewing\)/.test(win), "…and carries a REVIEWING label when the review is running");
  // the whole point: this branch was dead because the data was gone before genPhase flipped
  ok(/S\.genPhase = .*reviewing/.test(html) || /genPhase = \(stage === "critique"\)/.test(html),
     "genPhase actually reaches 'reviewing' during a generation");
}

// ── 4) a preview is never mistakable for a saved talk ──────────────────────────
{
  // anchor on the RENDER of the CTA, not the CSS rule of the same name
  const i = html.indexOf(`h+='<div class="compose-cta">`);
  ok(i > 0, "found the compose CTA render");
  const win = html.slice(i, i + 500);
  ok(/if\(S\.loading\)\{/.test(win), "while generating, the CTA is in its loading state…");
  // the Cancel button lives further down the same S.loading branch — widen the window rather than
  // assert a distance that a future edit would silently break
  const branch = html.slice(i, html.indexOf("} else if(GUIDELINES_STATE", i));
  ok(/cancelGenBtn/.test(branch), "…which offers Cancel — there is no Save or Share beside a preview");
  ok(!/id="saveBtn"|id="shareBtn"/.test(branch), "…and no Save/Share button is rendered in the generating state");
}

console.log("\n" + (failures === 0 ? "✔ REVIEW PREVIEW TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
