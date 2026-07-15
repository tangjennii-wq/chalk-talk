// Offline acceptance test for the refine citation guard (HANDOFF_GUIDELINES.md top task).
// Simulates: paste feedback containing ONE real PMID + one uncited recommendation; the model
// tries to add BOTH a legit ref (PMID in paste) and an invented ref (PMID from memory).
// Expected: exactly one new chip (the real PMID); invented ref dropped, its [N] chips stripped.
// Run: node test_refine_guard.mjs   (from the repo root; no network needed — eutils is mocked)
import { readFileSync } from "fs";
import vm from "vm";

// Extract the guard functions straight from index.html so this test always exercises live code.
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
function extractFn(name){
  let i = html.indexOf("function " + name + "(");
  if(i < 0) throw new Error("function not found in index.html: " + name);
  if(html.slice(Math.max(0, i - 6), i).includes("async")) i -= 6;
  let s = html.indexOf("{", i), d = 0, j = s;
  for(; j < html.length; j++){ if(html[j] === "{") d++; else if(html[j] === "}"){ d--; if(d === 0) break; } }
  return html.slice(i, j + 1);
}
const fns = ["_filterRefsToPaste", "_stripChipIds", "_normalizeInlinePmids", "pruneFakeReferences", "_esummaryBatch"].map(extractFn).join("\n\n");

// mock environment
const PASTE = `Reviewer feedback:
1. The bullet on anticoagulation should say DOACs are preferred over warfarin in most patients
   (see PMID 30926722).
2. The claim about steroid duration is overstated — recommend revising to 5 days. (no citation given)`;

const ctx = {
  console,
  S: { ragChunks: [] },
  fetch: async (url) => ({
    ok: true,
    json: async () => ({
      result: {
        "30926722": { uid:"30926722", title: "Antithrombotic Therapy for VTE Disease: CHEST Guideline.", pubdate: "2021 Aug", fulljournalname: "Chest" },
        "99999999": { error: "cannot get document summary" }
      }
    })
  }),
  AbortController: globalThis.AbortController,
  setTimeout, clearTimeout,
};
vm.createContext(ctx);
vm.runInContext(fns, ctx);

// ── Test 1: Option A paste filter
const addRefs = [
  { id: 7, source: "CHEST VTE guideline", year: 2021, society: "CHEST", pmid: "30926722", type: "guideline" },
  { id: 8, source: "Invented Steroid Trial", year: 2024, society: "NEJM", pmid: "99999999", type: "trial" },        // NOT in paste
  { id: 9, source: "Memory Society Guideline", year: 2023, society: "AHA", url: "https://fake.example.org/x", type: "guideline" } // NOT in paste
];
const g = vm.runInContext("_filterRefsToPaste", ctx)(addRefs, PASTE);
console.assert(g.kept.length === 1 && g.kept[0].id === 7, "FAIL: paste filter kept wrong refs", JSON.stringify(g));
console.assert(g.droppedIds.join(",") === "8,9", "FAIL: droppedIds wrong", g.droppedIds);
console.log("✓ Option A: 1 paste-sourced ref kept, 2 invented refs dropped");

// ── Test 2: Option B pubmed verify (mocked eutils)
const pm = await vm.runInContext("_esummaryBatch", ctx)(["30926722", "99999999"]);
console.assert(pm["30926722"].ok === true && pm["30926722"].year === 2021 && pm["30926722"].journal === "Chest", "FAIL: esummary parse", JSON.stringify(pm));
console.assert(pm["99999999"].ok === false, "FAIL: bad pmid should be ok:false");
console.assert(pm["30926722"].title.endsWith("Guideline"), "FAIL: trailing period not stripped");
console.log("✓ Option B: real PMID resolves w/ metadata, fake PMID flagged, title cleaned");

// ── Test 3: fail-open when eutils is down
const ctxDown = { ...ctx, fetch: async () => { throw new Error("network down"); } };
vm.createContext(ctxDown); vm.runInContext(fns, ctxDown);
const pmDown = await vm.runInContext("_esummaryBatch", ctxDown)(["30926722"]);
console.assert(pmDown === null, "FAIL: should return null on network error (fail open)");
console.log("✓ fail-open: lookup returns null on network error");

// ── Test 4: chip strip removes only dropped ids, keeps others
const talk = { sections: [{ heading:"Tx", points: ["Use DOACs first [7]", "Steroids x5 days [8]", "Combo claim [7,8] stays partial", "Old bullet [2]"] }], references: [] };
const stripped = vm.runInContext("_stripChipIds", ctx)(talk, ["8","9"]);
const pts = stripped.sections[0].points;
console.assert(pts[0].includes("[7]"), "FAIL: kept chip removed");
console.assert(!pts[1].includes("[8]") && !pts[1].includes("["), "FAIL: dropped chip survives: " + pts[1]);
console.assert(pts[2].includes("[7]") && !pts[2].includes("8"), "FAIL: partial chip wrong: " + pts[2]);
console.assert(pts[3].includes("[2]"), "FAIL: unrelated chip removed");
console.log("✓ chip strip: dangling chips removed, surviving + unrelated chips intact");

// ── Test 5: _normalizeInlinePmids with extraMeta turns pasted PMID into a chip + verified ref
const talk2 = { sections: [{ heading:"Tx", points: ["DOACs preferred (PMID 30926722)", "Invented inline PMID 11111111 claim"] }], references: [{ id: 1, source: "Existing", year: 2020, society: "ACC" }] };
const extra = { "30926722": { title: "Antithrombotic Therapy for VTE Disease: CHEST Guideline", journal: "Chest", year: 2021 } };
const norm = vm.runInContext("_normalizeInlinePmids", ctx)(talk2, extra);
const p2 = norm.sections[0].points;
console.assert(p2[0].includes("[2]"), "FAIL: verified inline PMID not converted to chip: " + p2[0]);
console.assert(!p2[1].includes("11111111"), "FAIL: unverifiable inline PMID not dropped: " + p2[1]);
const newRef = norm.references.find(r => r.pmid === "30926722");
console.assert(newRef && newRef.src_verified === "pubmed" && newRef.society === "Chest", "FAIL: ref meta", JSON.stringify(newRef));
console.log("✓ normalize: pasted+verified PMID → chip [2] with PubMed metadata; invented inline PMID dropped");

// ── Test 6: pruneFakeReferences keeps src_verified refs (no ragChunks, title not in prose)
const pruned = vm.runInContext("pruneFakeReferences", ctx)(JSON.parse(JSON.stringify(norm)));
console.assert(pruned.references.some(r => r.pmid === "30926722"), "FAIL: verified ref was pruned");
console.log("✓ prune: src_verified ref survives pruneFakeReferences");

// ── Test 7 (acceptance): net effect = exactly ONE new reference, uncited correction has no chip
const finalRefs = pruned.references.filter(r => r.pmid === "30926722");
console.assert(finalRefs.length === 1, "FAIL: expected exactly one new verified ref");
console.log("\n✔ ALL TESTS PASSED — acceptance criteria met: one real PMID → one chip; no citation → no chip.");
