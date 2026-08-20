// REFINE REFERENCE SURVIVAL — run: node test_refine_ref_survival.mjs
//
// Jenni pasted reviewer feedback into Refine on a saved alcoholic hepatitis talk and got:
//   "That would have dropped a reference (7 → 0). Kept your original."
// The completeness guard was right to refuse, but the 7 → 0 was not the model deleting references. It
// was pruneFakeReferences deleting all of them AFTER the merge, and the advice to "apply the
// corrections one at a time" could never have worked, because every piece provokes the same rewrite.
//
// THE MECHANISM, which is only visible when three things line up:
//   1. Opening a talk from the library leaves S.ragChunks EMPTY — it is populated during generation, or
//      by an explicit retrySources(), and by nothing else. So isRetrieved is false for every reference.
//   2. Pasted reviewer feedback asks for prose to be REWRITTEN, and a rewritten section frequently comes
//      back without its [N] markers. So isCited goes false too.
//   3. The remaining survival tests — the source name appearing verbatim in prose, user upload,
//      src_verified — are all normally false for references written at generation time.
// Every test fails, so every reference is deleted. On a freshly generated talk this never fires, because
// S.ragChunks is still full. It only bites the exact workflow Jenni is running: refine a SAVED talk.
import { readFileSync } from "fs";
import vm from "node:vm";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

// NOTE: the brace counter below tracks quote state, so a lone apostrophe in a `//` comment inside a
// lifted function ("they'd be pruned") opens a string that never closes and the extractor runs off the
// end of the file. That has broken suites here three times. I tried stripping `//` comments before
// counting and it ate the `//` inside regex literals like /https?:\/\//, which is worse. The durable
// fix is the note now sitting in pruneFakeReferences telling the next editor not to type one.
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

// Executed, not regex-matched: the defect is in a boolean, and no pattern over the file would see it.
function build(ragChunks){
  const ctx = { S: { ragChunks: ragChunks || [] }, JSON, String, Object, Array, RegExp, console: { warn(){} } };
  vm.createContext(ctx);
  // _assignConfidence is STUBBED, deliberately, and this is the one place a stub is right here: it runs
  // AFTER the filter under test and only decorates each surviving reference with a confidence label.
  // Lifting it would drag in _confidenceOf and _safeUrl, and _safeUrl contains a regex literal that the
  // brace-counting extractor cannot parse. The thing under test — which references survive — is the real
  // function, unmodified.
  ctx._assignConfidence = function(){};
  vm.runInContext(fnSrc("_existingRefIds") + "\n" + fnSrc("pruneFakeReferences")
    + "\nthis.prune = pruneFakeReferences; this.ids = _existingRefIds;", ctx);
  return ctx;
}

// A saved talk as it actually arrives from the library: real references, and the [N] markers GONE from
// the prose because the refine rewrote the section that carried them.
const savedTalkAfterRewrite = () => ({
  title: "Alcoholic Hepatitis",
  sections: [{ heading: "Pathophysiology",
    points: ["Ethanol oxidation generates acetaldehyde and reactive oxygen species.",
             "Kupffer-cell TLR4 activation releases TNF-alpha."] }],
  references: [1,2,3,4,5,6,7].map(i => ({ id: i, source: `Source ${i}`, year: 2024, pmid: `1000000${i}` })),
});

const { prune, ids } = build([]);        // saved talk → ragChunks empty, which is the whole trap

// ── the bug, reproduced ─────────────────────────────────────────────────────────────────────────────
const unprotected = prune(savedTalkAfterRewrite());
ok(unprotected.references.length === 0,
   "REPRODUCTION: with no protection, a chip-less rewrite of a saved talk prunes all 7 references to 0");

// ── the fix ─────────────────────────────────────────────────────────────────────────────────────────
const before = savedTalkAfterRewrite();
const protectedIds = ids(before);
ok(Object.keys(protectedIds).length === 7, "the pre-refine reference ids are captured (7)");
const kept = prune(savedTalkAfterRewrite(), protectedIds);
ok(kept.references.length === 7,
   "…and with them protected, all 7 survive a rewrite that dropped every [N] marker");
ok(kept.references.map(r => r.id).join(",") === "1,2,3,4,5,6,7", "…in order, unmodified");

// ── the pruner must still do its job on what the model ADDED ────────────────────────────────────────
// This is the whole reason the function exists. Protection is scoped to ids that already existed.
const withInvented = savedTalkAfterRewrite();
withInvented.references.push({ id: 99, source: "Invented Journal of Nothing", year: 2025, pmid: "99999999" });
const pruned = prune(withInvented, protectedIds);
ok(!pruned.references.some(r => r.id === 99),
   "a reference the model INVENTED during the refine is still pruned — protection covers only pre-existing ids");
ok(pruned.references.length === 7, "…and the seven real ones are untouched");

// ── generation is unaffected: no protection passed, behaviour identical to before ───────────────────
const fresh = savedTalkAfterRewrite();
ok(prune(fresh).references.length === 0,
   "called with no protectedIds — the generate path — the pruner behaves exactly as it did");
// And a genuinely cited reference survives with no protection at all, as always.
const cited = savedTalkAfterRewrite();
cited.sections[0].points[0] = "Ethanol oxidation generates acetaldehyde [1].";
ok(prune(cited).references.length === 1, "…still keeping a reference that IS cited by a [N] marker");
// The retrieved-chunk route still works too.
const ragCtx = build([{ pmid: "10000003" }]);
ok(ragCtx.prune(savedTalkAfterRewrite()).references.length === 1,
   "…and one that is in S.ragChunks, which is why this never fires on a freshly generated talk");

// ── all four refine paths are wired, not just the one that was reported ─────────────────────────────
// weave/proofread was the reported failure; restructure, compress and expand run the same pruner after
// the same kind of rewrite and each has its own "dropped a reference" guard, so all four were exposed.
const wired = (html.match(/pruneFakeReferences\([a-z]+, _protectRefIds\)/g) || []).length;
ok(wired === 4, `all four refine paths pass the protected ids (${wired}/4)`);
const captured = (html.match(/var _protectRefIds = _existingRefIds\(S\.talk\)/g) || []).length;
ok(captured === 4, `…and each captures them from S.talk BEFORE the model call (${captured}/4)`);
for (const fn of ["weaveFeedbackTalk", "restructureTalk", "compressTalk", "expandTalk"]) {
  const body = fnSrc(fn);
  const iCap = body.indexOf("_protectRefIds = _existingRefIds");
  const iCall = body.search(/await callAPI/);
  ok(iCap > -1 && (iCall === -1 || iCap < iCall),
     `${fn}: captures the ids before it calls the model, not after`);
}
// The generate path must NOT protect — that would defeat the pruner entirely.
ok(!/finalTalk = pruneFakeReferences\(finalTalk, /.test(html) && !/draftTalk = pruneFakeReferences\(draftTalk, /.test(html),
   "the GENERATE path passes no protection — invented references are still pruned where invention happens");

// ── the guard message no longer gives advice that cannot work ───────────────────────────────────────
// BOTH guard messages, not just the reported one. The reference guard and the completeness guard gave
// the same impossible advice, and an unscoped grep is what surfaced the second — the first version of
// this assertion failed on a message I had not noticed existed.
ok(!/Try applying the corrections one at a time/.test(html),
   "neither guard still says 'apply the corrections one at a time' — the failure was never about paste size");
ok((html.match(/will not help/g) || []).length === 2,
   "…and both guards say so, so the next person does not spend an afternoon splitting a paste");
ok(/reply naming the single correction you most want applied/.test(html),
   "…and both offer something that actually works instead");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ REFINE REF SURVIVAL OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
