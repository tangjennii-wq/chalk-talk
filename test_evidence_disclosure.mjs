// EVIDENCE DISCLOSURE — run: node test_evidence_disclosure.mjs
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────
// A talk on diuretics in heart failure was generated during a retrieval outage and rendered exactly
// like a grounded one. /retrieve had 502'd (Postgres 57014); retrieveRAG returned {text:"",chunks:[]},
// which is the SAME shape it returns for a topic the corpus genuinely does not cover, so nothing
// downstream could tell "we couldn't look" from "we looked and found nothing".
//
// The rule: FAIL OPEN FOR GENERATION, FAIL CLOSED FOR PROVENANCE. The talk may be written; it may never
// be labelled grounded. And for medical content the disclosure must stay attached to the SAVED talk,
// not evaporate on refresh.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const grab = (name) => {
  const start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("not found: " + name);
  let depth = 0;
  for (let j = html.indexOf("{", start); j < html.length; j++) {
    if (html[j] === "{") depth++;
    else if (html[j] === "}") { depth--; if (depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error("unbalanced: " + name);
};

// ── 1 · THE CHIP BUILDER, EXECUTED ───────────────────────────────────────────
// _provenanceChips returns [] unless the talk was reviewed, and calls two helpers we stub: this test is
// about the GROUNDING chip, not about writer labelling.
const ctx = {};
new Function("ctx",
  "function writerLabel(x){return 'Claude Opus';}" +
  "function talkHasUnverifiedWriter(x){return false;}" +
  grab("_provenanceChips") + "ctx.f=_provenanceChips;")(ctx);
const chipsFor = (t) => ctx.f(
  Object.assign({ _reviewStatus: "reviewed", _writtenBy: "claude-opus-5" }, t), false).join(" · ");

const GROUNDED = /found to cite from|guidelines on hand/i;

{
  const broke = ["retrieval_timeout", "retrieval_error"];
  for (const st of broke) {
    const s = chipsFor({ _ragStatus: st, _ragCount: 0, _guidelinesLoaded: true });
    ok(!GROUNDED.test(s), `${st}: no grounding claim even though guidelines loaded — "${s}"`);
    ok(/unavailable/i.test(s), `${st}: says retrieval was UNAVAILABLE, not merely absent`);
  }
}

{
  // The distinction Codex asked for: an outage and an empty library are different clinical statements.
  const empty = chipsFor({ _ragStatus: "no_relevant_sources", _ragCount: 0, _guidelinesLoaded: false });
  ok(/no directly relevant sources/i.test(empty), `no_relevant_sources reads as an empty search — "${empty}"`);
  ok(!/unavailable/i.test(empty), "…and does NOT claim an outage");

  const out = chipsFor({ _ragStatus: "retrieval_timeout", _ragCount: 0, _guidelinesLoaded: false });
  ok(out !== empty, "the two zeroes render differently");
}

{
  const good = chipsFor({ _ragStatus: "ok", _ragCount: 6, _guidelinesLoaded: true });
  ok(/6 papers found to cite from/.test(good), `a real retrieval still gets its chip — "${good}"`);
}

{
  // Talks saved before this field existed. Absence must not be read as success.
  const legacy = chipsFor({ _ragStatus: null, _ragCount: 0, _guidelinesLoaded: false });
  ok(!GROUNDED.test(legacy), "a pre-2026-07-31 talk with no sources claims no grounding");
}

// ── 2 · THE INVARIANT, ACROSS THE WHOLE STATE SPACE ──────────────────────────
// Enumerated rather than argued: no combination may produce a grounding claim while retrieval broke.
{
  let violations = 0;
  for (const st of ["retrieval_timeout", "retrieval_error"])
    for (const rc of [0, 1, 5])
      for (const gl of [true, false]) {
        const s = chipsFor({ _ragStatus: st, _ragCount: rc, _guidelinesLoaded: gl });
        if (GROUNDED.test(s)) { violations++; console.log(`   violated: ${st} rc=${rc} gl=${gl} -> ${s}`); }
      }
  ok(violations === 0, "NO state claims grounding while retrieval was unavailable (12 combinations)");
}

// ── 3 · retrieveRAG NAMES EVERY OUTCOME ──────────────────────────────────────
// The original defect was one return shape for four different situations.
{
  const src = grab("retrieveRAG");
  const returns = src.match(/return \{[^}]*\}/g) || [];
  const statusless = returns.filter(r => !/status:/.test(r));
  ok(statusless.length === 0,
     `every return from retrieveRAG carries a status (${statusless.length} without: ${statusless.map(r=>r.slice(0,40)).join(" | ")})`);
  ok(/"ok"/.test(src) && /"no_relevant_sources"/.test(src)
     && /"retrieval_timeout"/.test(src) && /"retrieval_error"/.test(src),
     "…and all four states are reachable from it");
  ok(/\(chunks\.length \|\| glChunks\.length\) \? "ok"/.test(src),
     'ok is asserted only when something was actually retrieved');
}

// ── 4 · IT SURVIVES SAVE, RESUME AND REFINE ──────────────────────────────────
// The medical requirement: the disclosure is a property of the talk, not of this page view.
{
  const code = html.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  ok((code.match(/ragStatus:/g) || []).length >= 3,
     "ragStatus is written into provenance on every persistence path");
  // Was a literal match on `talk._ragStatus = o.ragStatus || null;`. That line became the ratchet in
  // section 8, so assert the PROPERTY — the stamped value derives from the persisted o.ragStatus —
  // rather than a spelling that a correct change is free to alter.
  ok(/_nextRag\s*=\s*o\.ragStatus \|\| null/.test(code) && /talk\._ragStatus = /.test(code),
     "…and read back when a saved talk is rehydrated");
  ok(/S\.ragStatus = ragResult\.status/.test(code),
     "…captured from the retrieval result rather than re-derived later");

  // RESUME. Found by a live reconnect test on 2026-07-31: closing the tab mid-generation and reopening
  // produced a talk with _ragStatus === null, because the resume path stamped provenance from the
  // stored job handle and the handle never carried the status. The evidence digest survived the reload;
  // the DISCLOSURE did not. A retrieval outage plus a reconnect would have silently dropped the warning.
  // The RECEIPT was added to this same record on 2026-07-31, so `at: Date.now()` no longer sits on the
  // adjacent line. Assert the two properties separately rather than pinning their adjacency.
  ok(/ragStatus: S\.ragStatus \|\| null/.test(code) && /receipt: S\.genReceipt \|\| null/.test(code),
     "the job handle persists ragStatus at submit, so it survives a reload");
  ok(/ragStatus: \(stored && stored\.ragStatus\) \|\| null/.test(code),
     "…and the resume path stamps it back onto the reconnected talk");
}

// ── 5 · RETRY SOURCES IS FREE, AND DOES NOT REWRITE THE TALK ─────────────────
{
  const src = grab("retrySources");
  ok(!/consume|receipt|freeTier|X-CT-Meter/i.test(src),
     "retrySources touches NO quota path — no consume, no receipt, no meter");
  ok(!/callAnthropic|generate\(|buildSystemPrompt|_callOpenAIText/.test(src),
     "…and makes no model call, so it cannot rewrite medical content");
  ok(/retrieveRAG\(/.test(src), "…it re-runs retrieval");
  ok(/_ragStatus = "sources_added_after_generation"/.test(src) && /_ragCount = papers/.test(src),
     "…and records sources_added_after_generation, NOT ok");
  ok(!/_ragStatus = "ok"/.test(src),
     "retrySources NEVER sets ok — later retrieval did not ground the drafting process");
  ok(/writeSavedTalks\(/.test(src), "…persisting it so the correction survives a refresh");
  ok(/if\(t\.id\)/.test(src), "…but only for an already-saved talk, never creating a library entry");

  // The notice offers the retry only when retrieval BROKE — re-running a healthy empty search would
  // just reprint the same answer.
  ok(/_rsBroke\s*=\s*\(t\._ragStatus === "retrieval_timeout" \|\| t\._ragStatus === "retrieval_error"\)/.test(html),
     "the retry is offered for outages, not for an empty library");
  ok(/Verify clinical numbers and recommendations/.test(html),
     "the high-risk notice tells the reader to verify numbers against primary guidance");
}

// ── 6 · NO RETROSPECTIVE GROUNDING ───────────────────────────────────────────
// Codex, 2026-07-31: finding papers after the fact does not make the draft grounded. The talk was
// written without them. Later sources may SUPPORT individual claims — a different assertion, and one
// that needs a semantic claim-to-source audit before any grounding label may change.
{
  const after = chipsFor({ _ragStatus: "sources_added_after_generation", _ragCount: 5, _guidelinesLoaded: true });
  ok(!GROUNDED.test(after), `a post-hoc retry does NOT earn the grounded chip — "${after}"`);
  ok(/after drafting/i.test(after), "…it says the sources were added after drafting");
  ok(/not used to write this talk/i.test(after), "…and that they did not inform the writing");

  const during = chipsFor({ _ragStatus: "ok", _ragCount: 5, _guidelinesLoaded: true });
  ok(GROUNDED.test(during), "…while a genuinely grounded talk still reads as grounded");
  ok(during !== after, "the two are distinguishable to a reader");

  // The state must also persist as itself, not be normalised to "ok" on the way to storage.
  const rs = grab("retrySources");
  ok(/_all\[_i\]\.ragStatus = "sources_added_after_generation"/.test(rs),
     "the persisted value is the honest one, not ok");
}

// ── 7 · THE CORRECTION REACHES OTHER DEVICES ─────────────────────────────────
// Local-only persistence meant a second device kept showing the outage banner forever.
{
  const rs = grab("retrySources");
  ok(/cloudUpdateTalk\(S\.loadedTalkId\)/.test(rs),
     "retrySources updates the CLOUD row, not just localStorage");
  ok(rs.indexOf("writeSavedTalks(") < rs.indexOf("cloudUpdateTalk("),
     "…local first, then cloud — the synchronous path cannot be lost to a network failure");
  ok(/if\(!_cok\) console\.warn/.test(rs) || /cloud provenance update failed/.test(rs),
     "…and a failed cloud write is reported rather than silently assumed");

  // cloudUpdateTalk serialises the whole talk object, which is what carries _ragStatus.
  const cu = grab("cloudUpdateTalk");
  ok(/talk_json: t/.test(cu), "cloudUpdateTalk persists the whole talk object (carrying _ragStatus)");
}

// ── 8 · REFINE CANNOT LAUNDER THE POST-DRAFTING LABEL ────────────────────────
// Codex, 2026-07-31: a talk marked sources_added_after_generation, then refined USING those sources,
// must not become grounded-during-generation. The text the reader already has was drafted without them.
{
  const sctx = {};
  new Function("ctx",
    "var S={genProvider:'claude'};" +
    "function talkWriterModels(o){return (o._writerModels||[]).filter(Boolean).concat(o._writerModel?[o._writerModel]:[]);}" +
    grab("_stampProvenance") + "ctx.f=_stampProvenance;")(sctx);
  const stamp = sctx.f;

  // The exact sequence: outage -> retry attaches sources -> user refines, retrieval now healthy.
  const t = { _ragStatus: "sources_added_after_generation" };
  stamp(t, { ragStatus: "ok", ragCount: 5, writerModel: "claude-opus-5" });
  ok(t._ragStatus === "sources_added_after_generation",
     `refine does NOT upgrade the post-drafting label (got ${t._ragStatus})`);

  const after = chipsFor({ _ragStatus: t._ragStatus, _ragCount: 5, _guidelinesLoaded: true });
  ok(!GROUNDED.test(after), "…and the reader still sees the post-drafting wording, not a grounding claim");

  // The ratchet must not freeze everything: a talk genuinely grounded at draft time still reads as such,
  // and a later outage must still be able to report itself.
  const fresh = {};
  stamp(fresh, { ragStatus: "ok", ragCount: 5 });
  ok(fresh._ragStatus === "ok", "a normally-grounded talk is unaffected by the ratchet");

  const broke = { _ragStatus: "sources_added_after_generation" };
  stamp(broke, { ragStatus: "retrieval_timeout", ragCount: 0 });
  ok(broke._ragStatus === "retrieval_timeout",
     "…and a later outage is still reportable — the ratchet blocks only the upgrade to ok");

  const legacy = { _ragStatus: null };
  stamp(legacy, { ragStatus: "ok", ragCount: 3 });
  ok(legacy._ragStatus === "ok", "a talk with no prior status is not penalised");
}

console.log("\n" + (failures === 0 ? "✔ EVIDENCE DISCLOSURE OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
