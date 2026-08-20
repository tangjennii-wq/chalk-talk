// OVERFLOW MENU — run: node test_overflow_menu.mjs
//
// The ⋮ menu had ten items and three of them were the same action wearing different labels.
//
//   Copy link · Share · Make private · Export PDF · Save as image · Print overview ·
//   Print slides (as image) · Print visual · Delete talk
//
// "Share" opened a modal that ALSO contained copy-link and make-private, so two of the three privacy
// rows led to each other. And "Print overview" called exportTalkPDF — the SAME function as "Export PDF",
// one label away from itself.
//
// Two principles, both Jenni's: a talk is public or private, and "share" is not a third state; and
// printing is implied by having the file. The menu now states the state and offers its opposite.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

// ── the privacy toggle ──────────────────────────────────────────────────────────────────────────────
ok(/id="capMakePublicBtn">⭐ Make public/.test(html), "a private talk offers Make public…");
ok(/id="capMakePrivateBtn">🔒 Make private/.test(html), "…and a public talk offers Make private");
const pub = html.indexOf('id="capMakePublicBtn"'), priv = html.indexOf('id="capMakePrivateBtn"');
ok(pub > -1 && priv > -1 && priv < pub,
   "…in opposite branches of if(_isPub), so exactly one shows at a time");
ok(/if\(_isPub\)\{/.test(html), "…branched on the talk's actual public state, not on a guess");

// Copy link only where a link exists.
const copyIdx = html.indexOf('id="capCopyLinkBtn"');
ok(copyIdx > priv && copyIdx < pub,
   "Copy link sits in the PUBLIC branch only — a private talk has no link to copy");
// Exactly ONE Copy link row. Position alone passed when a second copy was added to the private branch.
ok((html.match(/id="capCopyLinkBtn"/g) || []).length === 1,
   "…and appears exactly once, so it cannot also be offered where there is no link");

// ── Share is gone entirely ──────────────────────────────────────────────────────────────────────────
ok(!/id="capShareBtn">/.test(html),
   "the Share item is gone — it opened a modal containing the two actions now in the menu");

// ── print items are gone, and Export PDF / Save as image remain ─────────────────────────────────────
ok(!/id="printOverviewBtn">/.test(html), "Print overview is gone…");
ok(!/id="printSlidesBtn">/.test(html), "…as is Print slides…");
ok(!/id="printVisualBtn">/.test(html), "…and Print visual");
ok(/id="pdfTalkBtn">📄 Export PDF/.test(html), "Export PDF stays — it is how you print");
ok(/id="pngTalkBtn">📸 Save as image/.test(html), "…and Save as image");

// The reason Print overview was redundant, asserted so nobody re-adds it thinking it did something else.
ok(/prO\.onclick=function\(\)\{S\.overflowOpen=false;render\(\);setTimeout\(exportTalkPDF,50\)\}/.test(html),
   "the old Print overview handler called exportTalkPDF — the SAME function as Export PDF");

// ── the asymmetry in confirms is deliberate ─────────────────────────────────────────────────────────
// Making private breaks links other people hold. Making public is reversible in one tap from the same
// menu, and confirming reversible actions trains people to dismiss dialogs.
// Bounded by the NEXT handler, not by a character count — a 700-char window from capMPub ran straight
// into capMP and picked up its confirm(), failing on correct code. Same fixed-window trap as everywhere
// else in this repo; use a real boundary.
const iPub = html.indexOf('capMPub.onclick'), iPriv = html.indexOf('capMP.onclick');
const mkPub = html.slice(iPub, iPriv);
const mkPriv = html.slice(iPriv, html.indexOf("// Share modal handlers", iPriv));
ok(mkPub.length > 200 && mkPriv.length > 200, "sanity: both handlers were located by real boundaries");
ok(!/confirm\(/.test(mkPub), "making public does NOT confirm — it is reversible from the same menu");
ok(/confirm\(/.test(mkPriv), "making private DOES confirm — it breaks links other people may hold");
ok(/cloudSetTalkPublic\(S\.loadedTalkId, true\)/.test(mkPub), "make public actually writes is_public true");
ok(/cloudSetTalkPublic\(S\.loadedTalkId, false\)/.test(mkPriv), "…and make private writes it false");
ok(/cloudSetTalkFeatured\(S\.loadedTalkId, false\)/.test(mkPriv),
   "…and unfeatures too, so a private talk cannot stay on the profile");
ok(/if\(!data\)\{ alert\("Couldn't update sharing/.test(mkPub),
   "a failed publish tells the user rather than silently doing nothing");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ OVERFLOW MENU OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
