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
  const ctx = { console: { warn() {}, info() {} }, S: { topic: "HIT" }, JSON, String, Number, Math, Array, Object, Date, parseInt, RegExp, setTimeout,
    pushTalkHistory() {}, render() {} };
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
  ok(talk.references[1].src_verified === "pubmed",
     "…carrying src_verified, the field pruneFakeReferences actually honours (see 5b — this was Codex's bug #2)");
  ok(talk.references[1].confidence === "high", "…and confidence:'high' so it isn't hidden as low-confidence");
  ok(/pubmed\.ncbi\.nlm\.nih\.gov\/37845198/.test(talk.references[1].url), "…with a real PubMed URL built from the verified id");
  ok(talk.references[1].added_by_update_check === true, "…and flagged as coming from the update check, not the original draft");
  ok(JSON.stringify(talk.sections) + JSON.stringify(talk.summary_points) === before,
     "THE TEACHING TEXT IS BYTE-IDENTICAL — an update check proposes evidence, it does not rewrite medicine");
  ok(talk._updateChecked && /^\d{4}-\d{2}-\d{2}$/.test(talk._updateChecked), "the talk records WHEN it was last checked");
  ok(ctx.S.updateCheck === null, "the proposal list is cleared after applying");
  ok(/was not changed/.test(ctx.S.savedFlash || ""), "the confirmation says the text was not changed");
  ok(ctx.S.talkIsSaved === false, "…and the talk is marked unsaved (Codex bug #1)");
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

// ── 5b) CODEX'S FOUR (2026-07-26) — each of these was a real, uncovered bug ────
{
  // (1) an added reference is an EDIT: undoable, and it makes the talk unsaved. Without this a
  // previously-saved talk kept showing "✓ Saved" while holding additions the user could lose by
  // navigating away — right after being told they were added.
  const ctx = build("()=>({})");
  const hist = [];
  ctx.pushTalkHistory = (label) => hist.push(label);
  ctx.render = () => {};
  ctx.S.talk = { title: "T", references: [{ id: 1, source: "old", year: 2018 }] };
  ctx.S.talkIsSaved = true;
  ctx.S.updateCheck = { status: "done", items: [{ title: "New", pmid: "37845198", year: 2024, journal: "J", _verified: true, _selected: true }] };
  vm.runInContext("applySelectedUpdates()", ctx);
  ok(hist.length === 1, "applying pushes ONE undo snapshot");
  ok(/reference/.test(hist[0] || ""), `…labelled for the undo button ("${hist[0]}")`);
  ok(ctx.S.talkIsSaved === false, "the talk is marked UNSAVED — it no longer matches the library copy");
  ok(/save to keep them/i.test(ctx.S.savedFlash || ""), "…and the confirmation tells the user to save");
}
{
  // (2) SURVIVES PRUNING. pruneFakeReferences keeps a ref only if it is cited by a [N] marker,
  // retrieved into ragChunks, named verbatim in the body, user-uploaded, or src_verified. An
  // update-added reference is none of the first four BY DESIGN — we never touch the teaching text —
  // so without src_verified the next refine/expand would silently delete what the user just added.
  const pctx = { console: { warn() {} }, S: { ragChunks: [] }, JSON, String, Number, Array, Object, RegExp, parseInt };
  vm.createContext(pctx);
  // pruneFakeReferences calls _assignConfidence at the end (a separate concern — it grades what SURVIVED,
  // it does not decide survival). Stub it: this test is about the keep/drop rule, not the grading.
  vm.runInContext("function _assignConfidence(t){ return t; }\n" + block(/^function pruneFakeReferences\(/m), pctx);
  const prune = vm.runInContext("pruneFakeReferences", pctx);

  const actx = build("()=>({})");
  actx.pushTalkHistory = () => {}; actx.render = () => {};
  actx.S.talk = { title: "HIT", sections: [{ heading: "Physiology", points: ["4T score first"] }], references: [] };
  actx.S.updateCheck = { status: "done", items: [{ title: "Newer HIT guidance", pmid: "37845198", year: 2024, journal: "Blood Adv", _verified: true, _selected: true }] };
  vm.runInContext("applySelectedUpdates()", actx);
  const added = actx.S.talk.references[0];
  ok(added.src_verified === "pubmed", "an update-added reference carries src_verified:'pubmed'");
  ok(added.confidence === "high", "…and confidence:'high' so it is not hidden as low-confidence");

  const pruned = prune(JSON.parse(JSON.stringify(actx.S.talk)));
  ok(pruned.references.length === 1, "IT SURVIVES pruneFakeReferences — uncited, unretrieved, unmentioned");
  ok(pruned.references[0].pmid === "37845198", "…the same reference, intact");

  // control: the OLD shape (confidence only, no src_verified) would have been deleted
  const oldShape = { title: "HIT", sections: [{ heading: "P", points: ["x"] }],
    references: [{ id: 1, source: "Newer HIT guidance", pmid: "37845198", confidence: "pmid_verified" }] };
  ok(prune(oldShape).references.length === 0,
     "…and the shape this shipped with an hour ago WOULD have been pruned away (the bug was real)");
}
{
  // (3) verification scope: we confirmed the PAPER, not the model's description of it
  ok(/AI summary · not verified against the paper/.test(html),
     "the model's what_changed/why_it_matters is labelled as an UNVERIFIED AI summary");
  ok(/✓ paper confirmed on PubMed/.test(html), "…while the identity claim says exactly what was checked");
  ok(!/>✓ verified<\/span>/.test(html), "the bare '✓ verified' beside an unverified summary is gone");
  ok(/The identifier and title are confirmed against PubMed; the summaries above are not/.test(html),
     "the apply note draws the same line");
}
{
  // (4) an absence of findings is not proof of currency
  ok(/No verified newer sources found in this check/.test(html), "the empty result is scoped to THIS CHECK");
  ok(!/Nothing newer found/.test(html), "…the old absolute claim is gone");
  ok(!/still the current ones/.test(html), "…as is 'the sources are still the current ones'");
  ok(/not proof nothing newer exists/.test(html), "…and it says so outright");
  const fn = block(/^async function checkForUpdates\(/m);
  ok(/_target\._updateChecked = new Date\(\)/.test(fn),
     "the check date is recorded even when NOTHING is added — 'we looked and found nothing' is useful");
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
// ── 8) IT MUST ASK FOR AUTHORISATION, like every other call that spends the app's key ──
// This function sent `X-CT-Meter: talk` with no receipt. The Worker's staged rollout allowed that and
// logged it, so it worked in every test and every manual check — and would have started returning 402
// on every saved talk the moment RECEIPTS_REQUIRED was set. The bug was invisible precisely because
// the enforcement it violated was not switched on yet, which is why this is asserted rather than tried.
{
  const fn = block(/^async function checkForUpdates\(/m);
  ok(/await ensureRefineAuth\(\)/.test(fn),
     "the update check asks for authorisation first — the same free, ownership-checked call every refine makes");
  const iAuth = fn.indexOf("ensureRefineAuth"), iCall = fn.indexOf("callAPIWithFallback");
  ok(iAuth > -1 && iCall > -1 && iAuth < iCall,
     "…BEFORE it spends anything, so a refusal costs nothing");
  ok(/if\(!_ra\.ok\)\{/.test(fn), "…and a refusal is handled rather than ignored");
  ok(/status: "error"/.test(fn.slice(iAuth, iCall)) && /Nothing was searched and your talk is unchanged/.test(fn),
     "…surfaced in the panel, saying nothing was searched and the talk is untouched");

  // STAGE IS THE HALF THAT WOULD STILL HAVE FAILED. A refine receipt covers refine/critique/aux and
  // deliberately NOT draft, and `meterKind: "talk"` makes the server default the stage to draft. So
  // adding the receipt without fixing the stage would have swapped 402 receipt_required for 402
  // stage_not_authorised — a different error message for the same broken button.
  ok(/stage: "aux"/.test(fn),
     "the call declares stage aux — a refine receipt covers aux, and NOT draft");
  ok(!/meterKind: "talk"/.test(fn),
     "…and is not labelled a talk: it writes no teaching content, it returns a list of candidate papers");
  ok(/meterKind: "aux"/.test(fn), "…it is labelled aux, which is also where its cost is now attributed");
}
// The server-side rule this depends on, asserted against the Worker so a change there fails HERE and not
// in production: the receipt minted for a saved talk must cover the stage this call sends.
{
  const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const budgets = worker.slice(worker.indexOf("RECEIPT_STAGE_BUDGETS"), worker.indexOf("RECEIPT_STAGE_BUDGETS") + 1200);
  const refineLine = (budgets.match(/refine:\s*\{[^}]*\}/) || [""])[0];
  ok(/aux:/.test(refineLine), "a refine receipt still budgets the aux stage — what this call spends against");
  ok(!/draft:/.test(refineLine),
     "…and still does NOT budget draft, which is why the old call was doomed once enforcement turned on");
}

ok(/discarded — could not be verified/.test(html),
   "refused proposals are SHOWN with their reason — hiding them would hide how often the model invents citations");
ok(/Your teaching text is never rewritten/.test(html), "the UI states plainly that applying does not change the talk");

console.log("\n" + (failures === 0 ? "✔ UPDATE CHECK TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
