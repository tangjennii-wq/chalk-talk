// MOBILE LAYOUT — run: node test_mobile_layout.mjs
//
// Findings from a layout audit of the 390px viewport. Each assertion below corresponds to something a
// physician hits on a phone between patients, and two of them were bugs whose FIX COMMENT was already in
// the file — the code claimed a keyboard fix and a 16px zoom guard that neither did what they said.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

// ── 1 · THE COMPOSER CLEARS THE iOS KEYBOARD ─────────────────────────────────
// env(keyboard-inset-height) is the Chromium Virtual Keyboard API; on iOS it resolves to its 0px
// fallback, so the composer stayed pinned to a layout viewport that does not shrink and the send button
// sat under the keyboard. visualViewport is the only thing on iOS that knows.
// Strip comments first: three of the remaining mentions are the comments EXPLAINING why the API is not
// used, and a test that cannot tell a declaration from a note about a declaration will fail on its own
// documentation.
const css = html.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
ok(!/bottom:[^;]*env\(keyboard-inset-height/.test(css),
   "no rule still positions anything with the Chromium-only keyboard inset");
ok(/\.composer-bubble\{bottom:calc\(12px \+ var\(--kb, 0px\)\)/.test(html),
   "…replaced by a measured --kb offset");
ok(/visualViewport/.test(html) && /addEventListener\("resize", onChange/.test(html),
   "…which is set from visualViewport, the only API iOS updates for the keyboard");
ok(/requestAnimationFrame\(apply\)/.test(html), "…coalesced through rAF rather than written per event");
ok(/\{ passive: true \}/.test(html), "…with passive listeners, so scrolling is not blocked");

// ── 2 · NO INPUT UNDER 16px, INCLUDING IN MODALS ─────────────────────────────
// Safari zooms the viewport when a focused input is under 16px, which shifts the whole layout mid-typing.
// The old rule was scoped to .app — and renderGlobalModals appends to document.body, so every modal
// input (including the API-key field on the paywall) was uncovered.
const guard = html.slice(html.indexOf('input[type="text"], input[type="search"]'),
                         html.indexOf('input[type="text"], input[type="search"]') + 320);
ok(!/\.app input\[type="text"\]/.test(html), "the 16px rule is no longer scoped to .app");
for (const t of ["password", "number", "url"]) {
  ok(guard.includes(`input[type="${t}"]`), `…and now covers input[type=${t}]`);
}
ok(/\bselect,\s*textarea \{ font-size: 16px/.test(guard), "…plus select and textarea");

// ── 3 · THE HOME SCREEN DOES NOT SCROLL SIDEWAYS ─────────────────────────────
// .compose-cta bleeds by -16px to cancel the DESKTOP .app padding. Mobile padding is 10px, so the sticky
// bar was 402px wide in a 390px viewport.
const mobileBlock = html.slice(html.indexOf(".app { padding: 10px 10px 16px"), html.indexOf(".app { padding: 10px 10px 16px") + 600);
ok(/\.compose-cta\{margin-left:-10px !important;margin-right:-10px !important\}/.test(mobileBlock),
   "the sticky Generate bar matches the mobile gutter instead of overflowing it");

console.log("\n" + (failures === 0 ? "✔ MOBILE LAYOUT OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
