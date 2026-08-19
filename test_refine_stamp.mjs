// REFINE STAMP — run: node test_refine_stamp.mjs
//
// Jenni is reviewing the library one talk at a time. Nothing recorded that a talk had been through a
// refine, so on talk seven there was no way to tell which of the first six were done. This stamps the
// moment a refine writes the talk back, and shows it quietly on the title row of the OPENED talk only.
//
// The load-bearing property is what does NOT stamp. If loading a talk, or the citation audit, or an undo
// set the mark, then every talk would carry one and the signal — absence — would be destroyed.
import { readFileSync } from "fs";
import vm from "node:vm";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

function fnSrc(name){
  let start = html.indexOf(`function ${name}(`);
  if(start < 0) throw new Error(`missing ${name}`);
  if(html.slice(Math.max(0,start-6), start) === "async ") start -= 6;
  const open = html.indexOf("{", start);
  let d=0,q=null,e=false;
  for(let i=open;i<html.length;i++){ const c=html[i];
    if(q){ if(e) e=false; else if(c==="\\") e=true; else if(c===q) q=null; continue; }
    if(c==='"'||c==="'"||c==="`"){ q=c; continue; }
    if(c==="{") d++; else if(c==="}" && --d===0) return html.slice(start,i+1);
  }
  throw new Error(`unclosed ${name}`);
}

const ctx = { Date, isNaN };
vm.createContext(ctx);
vm.runInContext(`${fnSrc("markRefined")}\n${fnSrc("refinedStampText")}\n`
  + "this.mark = markRefined; this.text = refinedStampText;", ctx);
const { mark, text } = ctx;

// ── the stamp itself ────────────────────────────────────────────────────────────────────────────────
const t = { title: "DKA" };
ok(t._refinedAt === undefined, "a talk starts with NO stamp — absence is what marks it as not yet done");
mark(t);
ok(typeof t._refinedAt === "string" && !isNaN(Date.parse(t._refinedAt)),
   "a refine stamps a parseable ISO timestamp");
ok(t._refineCount === 1, "…and counts it");
mark(t);
ok(t._refineCount === 2, "…and counts a second pass, so a talk worked twice is visible as such");

ok(mark(null) === null && mark(undefined) === undefined, "a missing talk is returned untouched, not thrown on");
ok(mark("nope") === "nope", "…and so is a non-object");

// ── the copy ────────────────────────────────────────────────────────────────────────────────────────
// Jenni's words: faint grey "last updated 9/16/2026", sitting next to the Lecture pill. Lowercase, a
// numeric date, and the same shape today as it is next month — it shares a line with the title, so a
// stamp that changes width (a time today, a month name later) would shove the title's ellipsis around.
const now = new Date();
const todayText = text(now.toISOString());
ok(/^last updated /.test(todayText), "the copy is lowercase 'last updated', not 'Refined'");
ok(!/today/i.test(todayText) && !/:/.test(todayText),
   "…and a refine done today shows the DATE, not a time — the width must not change through the day");
ok(/^last updated \d{1,2}\/\d{1,2}\/\d{4}$/.test(todayText),
   `…in numeric M/D/YYYY form, as asked (got "${todayText}")`);
const old = new Date(now.getTime() - 9 * 86400000);
const oldText = text(old.toISOString());
ok(/^last updated \d{1,2}\/\d{1,2}\/\d{4}$/.test(oldText), "an older refine takes exactly the same form");
ok(oldText !== todayText, "…but is a different date, so the two are distinguishable");
ok(!/[A-Za-z]/.test(oldText.replace("last updated ", "")),
   "…and never a month name — the date part is digits and slashes only ('Sep 16' is wider than '9/16/2026')");
ok(text("") === "" && text(null) === "" && text("banana") === "",
   "a missing or unparseable stamp renders nothing rather than 'last updated Invalid Date'");

// ── EVERY refine path stamps, and nothing else does ─────────────────────────────────────────────────
// There is no shared funnel: each refinement operation writes S.talk itself. Counting both sides is what
// catches a sixth operation being added later without a stamp.
const refineWrites = html.match(/S\.talk = markRefined\(/g) || [];
ok(refineWrites.length === 5,
   `all five refine write-backs stamp (found ${refineWrites.length}) — revise, restructure, expand, compress, merge`);

for (const [label, name] of [["revise","revised"],["restructure","restructured"],["expand","expanded"],
                             ["compress","compressed"],["merge","merge.talk"]]) {
  const esc = name.replace(".", "\\.");
  ok(new RegExp(`S\\.talk = markRefined\\(${esc}\\);`).test(html), `the ${label} path stamps`);
  ok(!new RegExp(`S\\.talk = ${esc};`).test(html), `…and no longer writes ${name} unstamped`);
}

// The ones that must NOT stamp. Each rewrites S.talk without the user having asked for a refinement.
for (const [label, expr] of [
  ["loading a saved talk", "S.talk = data.talk_json;"],
  ["the citation audit", "S.talk = auditedTalk;"],
  ["an undo / snapshot restore", "S.talk = snap.talk;"],
  ["the depth toggle", "S.talk = S.depthVariantsCache[newDepth];"],
]) {
  ok(html.includes(expr), `${label} still writes the talk directly…`);
  ok(!html.includes(expr.replace("S.talk = ", "S.talk = markRefined(")), `…and does NOT stamp it (${label})`);
}

// ── shown on the TITLE ROW of the opened talk, and NOT in the library ───────────────────────────────
// Position is the requirement, not just presence. Jenni asked for it "next to lecture", and the ✎ button
// holds the right edge with margin-left:auto — so the stamp has to land between the mode pill and the
// pencil. Anywhere else and either the pencil stops being right-aligned or the stamp wraps to its own row.
const titleRow = html.slice(html.indexOf('h+=\'<div class="tk-lessontitle">'),
                            html.indexOf('h+=\'<div class="tk-lessontitle">') + 1400);
ok(titleRow.includes('tk-pill-modetype'), "sanity: the title row slice contains the mode pill");
const iPill = titleRow.indexOf('🎓 Lecture');
const iStamp = titleRow.indexOf('ttl-refined');
const iPencil = titleRow.indexOf('editTitleBtn');
ok(iStamp > -1, "the stamp renders on the title row");
ok(iStamp > iPill, "…to the RIGHT of the Lecture / Boards pill, as asked");
ok(iPencil > iStamp, "…and to the LEFT of the ✎, so margin-left:auto still pins the pencil right");
ok(/t\._refinedAt\?'<span class="ttl-refined"/.test(titleRow),
   "…conditionally — a talk never refined renders nothing at all, not an empty span");
ok(/class="ttl-refined"[^']*color:var\(--ink-soft\)/.test(titleRow) &&
   /class="ttl-refined"[^']*font-size:10\.5px/.test(titleRow),
   "…faint grey and small, as asked: muted ink, 10.5px, no chip and no colour");
ok(/class="ttl-refined"[^']*white-space:nowrap/.test(titleRow),
   "…and nowrap, so '9/16/2026' cannot break across two lines inside the flex row");
ok(/class="ttl-refined"[^']*flex-shrink:0/.test(titleRow),
   "…and flex-shrink:0, so the long title truncates instead of crushing the stamp");
ok(!/<p class="ttl-refined"/.test(html),
   "the old <p> under the subtitle is gone — it was rejected for that placement");
// ── the library card dates BY the stamp (Jenni 2026-08-19) ──────────────────────────────────────────
// The original ask was "not in library", meaning: do not add a second line to a card. That still holds —
// what changed is which date the card's ONE date is. It was created_at, which never moves, so a library
// halfway through a review pass looked exactly like one that had not been started.
const card = html.slice(html.indexOf("function renderLibCard("), html.indexOf("function renderLibCard(") + 3000);
ok(/_refinedAt/.test(card), "the library card dates a talk by its last refine…");
ok(/"Updated " : "Created "/.test(card),
   "…and LABELS which it is showing — two bare dates meaning different things are worse than none");
ok(/x\.savedAt/.test(card), "…falling back to the created date for a talk never refined");
ok(!/updated_at/.test(card),
   "…and NOT the updated_at column: a trigger bumps it on publish and on reorder, so sorting the library would have redated all of it");
// Still one line, not two: the card must not grow a second date row.
const dateAssigns = card.match(/var dateStr =/g) || [];
ok(dateAssigns.length === 1, `the card still shows a single date (found ${dateAssigns.length})`);

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ REFINE STAMP OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
