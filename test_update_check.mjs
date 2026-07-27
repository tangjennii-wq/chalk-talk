// BEHAVIOURAL tests for "Check for updates". Run: node test_update_check.mjs
//
// Drafting no longer searches the web — it sat on the critical path of every generation, and its results
// were absorbed into the draft invisibly, so nobody could see what search had changed or where it came
// from. Recency moved here: an explicit action, on a finished talk, whose proposals the user reviews.
//
// The safety claim under test: a proposed reference is a MODEL-SUPPLIED CITATION, which is precisely the
// thing this app treats as untrusted everywhere else. So it must be verified against PubMed — existence
// AND identity — before it can be added, must fail CLOSED when PubMed is unreachable, and must never
// rewrite the teaching text.
import { readFileSync } from "fs";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
function block(re) { const m = html.match(re); if (!m) throw new Error("not found: " + re); const i = m.index, e = /\n\};?/.exec(html.slice(i)); return html.slice(i, i + e.index + e[0].length); }
const line = (re) => { const m = html.match(re); if (!m) throw new Error("line not found: " + re); return m[0]; };

// ── sandbox with the real verification path; _esummaryBatch is the injectable seam ──
function build(esummary) {
  const ctx = { console: { warn() {}, info() {} }, S: { topic: "HIT" }, JSON, String, Number, Math, Array, Object, Date, parseInt, RegExp, setTimeout };
  vm.createContext(ctx);
  vm.runInContext([
    line(/^var FAST_MOVING_RE = .*$/m),
    block(/^function talkIsFastMoving\(/m),
    block(/^function _titleRoughlyMatches\(/m),
    "async function _esummaryBatch(ids){ return (" + esummary + ")(ids); }",
    block(/^async function _verifyProposedUpdates\(/m),
    block(/^function applySelectedUpdates\(/m),
  ].join("\n"), ctx);
  return ctx;
}
const REAL = {
  "37845198": { ok: true, year: 2023, title: "Antithrombotic therapy for heparin-induced thrombocytopenia", journal: "Blood Advances" },
  "36000001": { ok: true, year: 2024, title: "A completely unrelated paper about renal transplantation", journal: "AJT" },
};
const okBatch = (ids) => { const o = {}; ids.forEach((i) => { o[i] = REAL[i] || { ok: false }; }); return o; };

// ── 1) a real, correctly-identified PMID is VERIFIED ───────────────────────────
{
  const ctx = build("(ids)=>{const o={};ids.forEach(i=>o[i]=(" + JSON.stringify(REAL) + ")[i]||{ok:false});return o;}");
  const verify = vm.runInContext("_verifyProposedUpdates", ctx);
  const items = await verify([{ title: "Antithrombotic therapy for heparin-induced thrombocytopenia", pmid: "37845198", year: 2023 }]);
  ok(items[0]._verified === true, "a real PMID whose title matches is VERIFIED");
  ok(items[0].journal === "Blood Advances", "PubMed's metadata REPLACES the model's claim (we trust the registry, not the model)");
  ok(items[0].year === 2023, "…including the year");
}

// ── 2) THE FABRICATION CASES — each must be refused ────────────────────────────
{
  const ctx = build("(ids)=>{const o={};ids.forEach(i=>o[i]=(" + JSON.stringify(REAL) + ")[i]||{ok:false});return o;}");
  const verify = vm.runInContext("_verifyProposedUpdates", ctx);

  const nonexistent = await verify([{ title: "Some plausible-sounding trial", pmid: "99999999", year: 2026 }]);
  ok(nonexistent[0]._verified === false, "a PMID that does not resolve is REFUSED");
  ok(/does not resolve/.test(nonexistent[0]._why), "…and the reason says so plainly");

  // the dangerous one: a REAL identifier attached to a DIFFERENT paper
  const mismatched = await verify([{ title: "Landmark trial of anticoagulation in HIT", pmid: "36000001", year: 2024 }]);
  ok(mismatched[0]._verified === false, "a REAL PMID pointing at a DIFFERENT paper is REFUSED (identity, not just existence)");
  ok(/different paper/.test(mismatched[0]._why), "…and the reason names what the PMID actually is");

  const noPmid = await verify([{ title: "2026 guideline update", year: 2026 }]);
  ok(noPmid[0]._verified === false, "a proposal with no identifier at all is REFUSED");
}

// ── 3) FAILS CLOSED when PubMed itself is unreachable ──────────────────────────
{
  const ctx = build("()=>null");   // _esummaryBatch returns null on lookup failure
  const verify = vm.runInContext("_verifyProposedUpdates", ctx);
  const items = await verify([{ title: "Antithrombotic therapy for heparin-induced thrombocytopenia", pmid: "37845198" }]);
  ok(items[0]._verified === false, "PubMed unreachable → nothing is offered (fails CLOSED, unlike the drug check)");
  ok(/unreachable/.test(items[0]._why), "…and the user is told why rather than shown a silent empty list");
}

// ── 4) title matching is fuzzy enough to be usable, strict enough to be useful ──
{
  const ctx = build("()=>({})");
  const match = vm.runInContext("_titleRoughlyMatches", ctx);
  ok(match("Antithrombotic therapy for HIT", "Antithrombotic therapy for heparin-induced thrombocytopenia"),
     "a shortened but genuine title still matches (no false rejection on abbreviation)");
  ok(match("DOACs in Heparin-Induced Thrombocytopenia.", "DOACs in heparin induced thrombocytopenia"),
     "punctuation and case differences don't matter");
  ok(!match("Anticoagulation in atrial fibrillation", "A completely unrelated paper about renal transplantation"),
     "two genuinely different papers do NOT match");
  ok(!match("", "Something"), "an empty claimed title never matches");
}

// ── 5) applying adds REFERENCES ONLY — the teaching text is untouched ──────────
{
  const ctx = build("()=>({})");
  const talk = {
    title: "HIT", sections: [{ heading: "Physiology", points: ["4T score drives pretest probability"] }],
    summary_points: ["Stop all heparin"], references: [{ id: 1, source: "ASH 2018", year: 2018 }],
  };
  const before = JSON.stringify(talk.sections) + JSON.stringify(talk.summary_points);
  ctx.S.talk = talk;
  ctx.S.updateCheck = { status: "done", items: [
    { title: "Newer HIT guidance", journal: "Blood Adv", year: 2024, pmid: "37845198", _verified: true, _selected: true },
    { title: "Not selected", pmid: "36000001", _verified: true, _selected: false },
    { title: "Unverified thing", pmid: "99999999", _verified: false, _selected: true },
  ] };
  ctx.render = () => {};
  vm.runInContext("applySelectedUpdates()", ctx);

  ok(talk.references.length === 2, "exactly the SELECTED, VERIFIED item is added");
  ok(talk.references[1].pmid === "37845198", "…the right one");
  ok(talk.references[1].confidence === "pmid_verified", "…marked as verified provenance, not asserted");
  ok(/pubmed\.ncbi\.nlm\.nih\.gov\/37845198/.test(talk.references[1].url), "…with a real PubMed URL built from the verified id");
  ok(talk.references[1].added_by_update_check === true, "…and flagged as coming from the update check, not the original draft");
  ok(JSON.stringify(talk.sections) + JSON.stringify(talk.summary_points) === before,
     "THE TEACHING TEXT IS BYTE-IDENTICAL — an update check proposes evidence, it does not rewrite medicine");
  ok(talk._updateChecked && /^\d{4}-\d{2}-\d{2}$/.test(talk._updateChecked), "the talk records WHEN it was last checked");
  ok(ctx.S.updateCheck === null, "the proposal list is cleared after applying");
  ok(/was not changed/.test(ctx.S.savedFlash || ""), "the confirmation says the text was not changed");
}
{
  // an UNVERIFIED item can never be applied, even if somehow selected
  const ctx = build("()=>({})");
  ctx.S.talk = { title: "T", references: [] };
  ctx.S.updateCheck = { status: "done", items: [{ title: "Fabricated", pmid: "99999999", _verified: false, _selected: true }] };
  ctx.render = () => {};
  vm.runInContext("applySelectedUpdates()", ctx);
  ok(ctx.S.talk.references.length === 0, "a selected-but-UNVERIFIED proposal is still refused at apply time");
}

// ── 6) fast-moving topics get the check surfaced, stable ones don't ────────────
{
  const ctx = build("()=>({})");
  const fast = vm.runInContext("talkIsFastMoving", ctx);
  for (const t of ["Infective endocarditis", "Pneumocystis prophylaxis in HIV", "Checkpoint inhibitor toxicity",
                   "Influenza vaccination in adults", "DOACs for VTE", "CAR-T cytokine release syndrome"]) {
    ctx.S.topic = "";
    ok(fast({ title: t }), `flagged fast-moving: ${t}`);
  }
  for (const t of ["Hyponatremia and SIADH", "Acid-base physiology", "Murmur examination"]) {
    ctx.S.topic = "";
    ok(!fast({ title: t }), `NOT flagged (stable): ${t}`);
  }
}

// ── 7) wiring: talk-scoped, search-restricted, and honest about what it discards ──
ok(/S\.updateCheck=null;/.test(block(/^function _clearTalkScoped\(/m)),
   "update proposals are cleared by _clearTalkScoped() — one talk's results can never show on another");
{
  const fn = block(/^async function checkForUpdates\(/m);
  ok(/S\.talk !== _target \|\| _uid !== S\.genId/.test(fn), "a late result is dropped if the user moved to another talk");
  ok(/allowed_domains: ALLOWED_SEARCH_DOMAINS/.test(fn), "the search is restricted to the society/journal allowlist");
  ok(/writeAllowedModels\(/.test(fn), "the update check only uses BENCHMARK-CLEARED models");
  ok(/_verifyProposedUpdates\(items\)/.test(fn), "every proposal goes through verification before display");
  ok(/slice\(0, 8\)/.test(fn), "the number of proposals is bounded");
}
ok(/discarded — could not be verified/.test(html),
   "refused proposals are SHOWN with their reason — hiding them would hide how often the model invents citations");
ok(/Your teaching text is never rewritten/.test(html), "the UI states plainly that applying does not change the talk");

console.log("\n" + (failures === 0 ? "✔ UPDATE CHECK TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
