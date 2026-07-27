// BEHAVIOURAL tests for the repair/retry paths and provenance stamping.
// Codex 2026-07-26: asserting that a retry loop EXISTS is not the same as asserting its reconstructed
// request still carries the evidence. These tests EXECUTE the real functions from index.html against
// stubbed transports and inspect what would actually have been sent / stamped.
// Run: node test_retry_evidence.mjs
import { readFileSync } from "fs";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

// Slice a whole function by its real end (a column-0 "\n}"), never by a magic character count —
// a fixed-length window silently stops covering the tail of the function as soon as anyone adds a line.
function fnBody(name){
  const i = html.indexOf(name);
  if(i < 0) throw new Error("not found: " + name);
  const e = /\n\}/.exec(html.slice(i));
  return html.slice(i, e ? i + e.index + 2 : html.length);
}

function fnSrc(name) {
  const i = html.indexOf("function " + name + "(");
  if (i < 0) throw new Error("fn not found: " + name);
  let s = html.indexOf("{", i), d = 0;
  for (let j = s; j < html.length; j++) { if (html[j] === "{") d++; else if (html[j] === "}") { d--; if (d === 0) return html.slice(i, j + 1); } }
  throw new Error("unbalanced: " + name);
}
const lineOf = (re) => { const m = html.match(re); if (!m) throw new Error("line not found: " + re); return m[0]; };
// fixJSON contains a literal "}" inside a comment, so brace counting truncates it (this has bitten twice).
// Terminate on a column-0 "\n}" instead, like test_parse_strict.mjs does.
function blockSrc(name) {
  const i = html.indexOf("function " + name + "(");
  if (i < 0) throw new Error("fn not found: " + name);
  const e = /\n\};?/.exec(html.slice(i));
  return html.slice(i, i + e.index + e[0].length);
}

// ── 1) _appendNoteToContent: the retry must not stringify away the evidence ─────
// The bug: `uc + note` where uc is a content-parts ARRAY. JS coerces it to
// "[object Object],[object Object]" — topic, guideline context, landmark trials, retrieved sources and
// every uploaded PDF vanish, and the talk that comes back is still labelled "Grounded in guidelines".
{
  const ctx = { console: { warn() {}, info() {} } };
  vm.createContext(ctx);
  vm.runInContext(blockSrc("_appendNoteToContent") + "\n" + fnSrc("_contentToText"), ctx);
  const append = vm.runInContext("_appendNoteToContent", ctx);
  const toText = vm.runInContext("_contentToText", ctx);

  const NOTE = "\n\nIMPORTANT: your previous response was not usable.";
  const uc = [
    { type: "text", text: 'Create content on: "Hyponatremia and SIADH"\n\nGUIDELINE CONTEXT: correct Na by <8 mEq/L/24h\n\nLANDMARK TRIALS: SALT-1/SALT-2\n\nRETRIEVED SOURCES: PMID 16849702' },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQK" } },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
  ];
  const out = append(uc, NOTE);

  // the actual defect, stated as a test
  ok(Array.isArray(out), "the retry body stays a content-parts ARRAY (never coerced to a string)");
  ok(!/\[object Object\]/.test(JSON.stringify(out)), "no part was stringified to [object Object]");
  ok(String(uc + NOTE).includes("[object Object]"), "…and the naive `uc + note` really does produce [object Object] (this is what was shipped)");

  const text = toText(out);
  for (const ev of ["Hyponatremia and SIADH", "correct Na by <8 mEq/L/24h", "SALT-1/SALT-2", "PMID 16849702"]) {
    ok(text.includes(ev), `retry request still carries evidence: "${ev.slice(0, 34)}"`);
  }
  ok(text.includes("not usable"), "…and it carries the corrective instruction");
  const docs = out.filter((p) => p.type === "document" || p.type === "image");
  ok(docs.length === 2, `all ${2} uploaded reference part(s) survive the retry (got ${docs.length})`);
  ok(docs[0].source.data === "JVBERi0xLjQK", "uploaded PDF bytes are unchanged, not re-encoded");

  // must not mutate: the loop reuses uc across attempts
  ok(uc.length === 3 && !/not usable/.test(uc[0].text), "the original request body is NOT mutated (a 2nd attempt must not double-append)");
  ok(out !== uc, "a new array is returned");

  // degenerate inputs
  ok(append("plain string", NOTE) === "plain string" + NOTE, "a plain-string body still concatenates normally");
  ok(append(uc, "") === uc, "an empty note is a no-op");
  const noText = append([{ type: "document", source: { type: "base64", data: "x" } }], NOTE);
  ok(noText.length === 2 && noText[1].type === "text", "a body with no text part gets the note added as its own part");
}

// ── 2) the retry actually CALLS it — execute the loop, capture the request ──────
// Extract the bounded-retry block from generate() and run it with a stub transport, so this test fails
// if someone reverts to `uc + _fixNote` or drops the helper.
{
  const g = html.slice(html.indexOf("async function generate(){"));
  const start = g.indexOf("var draftTalk = null, _draftParseErr = null;");
  const end = g.indexOf("if (!draftTalk) throw (_draftParseErr");
  const loop = g.slice(start, end) + "if (!draftTalk) throw (_draftParseErr || new Error('unusable draft'));";
  ok(start > 0 && end > start, "located the bounded retry block inside generate()");

  const sent = [];
  const ctx = {
    console: { warn() {}, info() {} },
    S: { style: "lecture", genCancelled: false, genId: 7 },
    _myGenId: 7,
    sys: "SYSTEM", maxTok: 16384, mainModels: ["claude-opus-5"], mainOpts: { meterKind: "talk" },
    render: () => {},
    JSON, Error, String, Array,
    async callAPIWithFallback(sys, content, maxTok, models, opts) {
      sent.push({ sys, content, maxTok, models, opts });
      // 2nd attempt returns a complete lecture talk
      return { txt: JSON.stringify({ title: "T", summary_points: ["a"], visual_memory_card: { center: "c" }, sections: [{ heading: "h", points: ["p"] }] }), modelUsed: "claude-opus-5" };
    },
  };
  vm.createContext(ctx);
  vm.runInContext([
    blockSrc("_appendNoteToContent"), fnSrc("_contentToText"), blockSrc("fixJSON"),
    lineOf(/^var _BOARD_TOPLEVEL_FIELDS = .*$/m), blockSrc("_hoistMisplacedBoardFields"),
    lineOf(/^var _REQUIRED_LECTURE_FIELDS = .*$/m), lineOf(/^var _REQUIRED_BOARDS_FIELDS  = .*$/m),
    blockSrc("_missingTalkFields"), blockSrc("parseTalkStrict"),
    // the first draft is truncated mid-sections → parseTalkStrict throws → retry
    'var txt = \'{"title":"T","summary_points":["a"],"sections":[{"heading":"h"\';',
    'var uc = [{type:"text",text:"Create content on: \\"Hyponatremia\\"\\n\\nGUIDELINE CONTEXT: correct Na by <8 mEq/L/24h"},{type:"document",source:{type:"base64",data:"PDFBYTES"}}];',
    'var _draftModel = "claude-opus-5";',
    "globalThis.__run = async function(){ " + loop + " return draftTalk; };",
  ].join("\n"), ctx);

  const talk = await vm.runInContext("__run()", ctx);
  ok(!!talk && talk.title === "T", "an unparseable first draft is rescued by the single retry");
  ok(sent.length === 1, `exactly ONE retry call was made (got ${sent.length}) — the bound is the safety property`);

  const body = sent[0].content;
  ok(Array.isArray(body), "the retry was sent a content-parts array, not a coerced string");
  ok(!JSON.stringify(body).includes("[object Object]"), "the retry request contains no [object Object]");
  const txt = vm.runInContext("_contentToText", ctx)(body);
  ok(txt.includes("Hyponatremia"), "the retry still states the TOPIC");
  ok(txt.includes("correct Na by <8 mEq/L/24h"), "the retry still carries the GUIDELINE ground truth");
  ok(JSON.stringify(body).includes("PDFBYTES"), "the retry still carries the user's UPLOADED document");
  ok(/missing required top-level fields|unbalanced brace/.test(txt), "the retry names what was wrong with the previous response");
  ok(sent[0].maxTok === 16384 && sent[0].models[0] === "claude-opus-5", "the retry reuses the same token budget and gated model chain");
  ok(sent[0].opts && sent[0].opts.meterKind === "talk", "the retry keeps the metering tag (still one talk)");
}

// ── 3) provenance is stamped from ONE helper, and covers every contributing model ─
{
  const ctx = { S: { genProvider: "claude" }, String, Array };
  vm.createContext(ctx);
  vm.runInContext([
    lineOf(/^var WRITER_BENCHMARK_CLEARED = \{[\s\S]*?^\};/m) || "",
    fnSrc("writerIsBenchmarked"), fnSrc("writerModelKnown"),
    blockSrc("talkWriterModels"), blockSrc("talkHasUnverifiedWriter"), blockSrc("_stampProvenance"),
  ].join("\n"), ctx);
  const stamp = vm.runInContext("_stampProvenance", ctx);
  const unver = vm.runInContext("talkHasUnverifiedWriter", ctx);
  const models = vm.runInContext("talkWriterModels", ctx);

  const t1 = stamp({ title: "T" }, { writerModel: "claude-opus-5", ragCount: 4, guidelinesLoaded: true, webSearched: true });
  ok(t1._reviewStatus === "reviewed", "stamp sets _reviewStatus (without it _provenanceChips() renders NOTHING)");
  ok(t1._writerModel === "claude-opus-5", "stamp records the exact drafting model id");
  ok(t1._ragCount === 4 && t1._guidelinesLoaded === true && t1._webSearched === true, "stamp carries grounding + search provenance");
  ok(t1._citationsVerified === false, "citations start UNverified (only the audit may set that true)");
  ok(!unver(t1), "a cleared drafter produces no warning");

  // a critic rewrite by an UNCLEARED model must warn, even though the drafter was cleared
  const t2 = stamp({ title: "T" }, { writerModel: "claude-opus-5", writerModels: ["claude-opus-5", "claude-sonnet-5"] });
  ok(models(t2).length === 2, "both contributing models are recorded");
  ok(unver(t2), "an UNCLEARED critic rewrite triggers the unverified warning even when the drafter was cleared");
  ok(t2._writerModel === "claude-opus-5", "the drafter remains the primary label");

  // legacy talks must not be accused
  ok(!unver({ title: "T" }), "a legacy talk with no recorded model is NOT accused");
  ok(!unver(stamp({ title: "T" }, {})), "an unknown model is treated as unknown, not as failed");
  // dedupe: draft and critic are usually the same model
  const t3 = stamp({ title: "T" }, { writerModel: "claude-opus-5", writerModels: ["claude-opus-5", "claude-opus-5"] });
  ok(models(t3).length === 1, "the same model contributing twice is recorded once");
}

// ── 4) every path that assigns S.talk goes through the stamp ────────────────────
// The resume path previously set NO provenance at all: no chips, and writerWarningHtml() keys off
// _writerModel, so the unverified-model warning could never appear on the async path — the one most
// mobile generations use.
{
  const paths = [
    ["generate()", "async function generate(){"],
    ["resumeAsyncJobIfAny()", "async function resumeAsyncJobIfAny(){"],
    ["retryReview()", "async function retryReview(){"],
  ];
  for (const [label, anchor] of paths) {
    const i = html.indexOf(anchor);
    ok(i > 0, `${label} found`);
    // slice to the next top-level function to keep the window honest
    const body = html.slice(i, html.indexOf("\n}", html.indexOf("S.talk = finalTalk", i)) + 2);
    ok(/_stampProvenance\(finalTalk/.test(body), `${label} stamps provenance before showing the talk`);
    ok(!/finalTalk\._reviewStatus = "reviewed"/.test(body), `${label} has no hand-rolled copy of the stamp (drift is how this broke)`);
  }
  ok((html.match(/function _stampProvenance\(/g) || []).length === 1, "there is exactly ONE provenance stamp in the codebase");
}

// ── 5) the resumed review must be given the evidence the DRAFT was written with ──
// resumeAsyncJobIfAny() runs after a page reload, where S.ragChunks is []. Rebuilding the reviewer's
// ground-truth block from live state handed the critic FEWER sources than produced the draft, silently.
{
  const rs = fnBody("async function resumeAsyncJobIfAny");
  ok(/ragDigest/.test(html), "the retrieved-source digest is persisted with the async job");
  ok(/stored\.ragDigest/.test(rs), "the resume path prefers the PERSISTED digest over post-reload live state");
  ok(/buildCritiqueSpec\(S\.style, S\.topic, _glRef, _resumeRag\)/.test(rs),
     "the reviewer's ground-truth context is built from the persisted evidence, not from empty S.ragChunks");
  ok(!/buildCritiqueSpec\(S\.style, S\.topic, _glRef, S\.ragChunks\)/.test(rs),
     "the old empty-after-reload S.ragChunks call is gone");
  ok(/stored\.ragCount/.test(rs), "the DRAFT's real source count is used for labeling, not the post-reload zero");
  // behavioural: the digest shape must be what buildCritiqueSpec actually reads
  {
    const ctx = { S: { }, console: { warn() {} }, JSON, String, Set,
      BOARDS_DIFFICULTY: { 4: { label: "Board-level", directive: "d" } }, boardsDifficulty: () => 4,
      LECTURE_CRITIQUE_PROMPT: "L", BOARDS_CRITIQUE_PROMPT: "B",
      writeAllowedModels: (m) => m, MODEL_MAIN: "claude-opus-5", MODEL_SONNET_FALLBACK: "s", MODEL_CRITIC: "h" };
    vm.createContext(ctx);
    vm.runInContext(blockSrc("buildCritiqueSpec"), ctx);
    const build = vm.runInContext("buildCritiqueSpec", ctx);
    const digest = [{ title: "SALT-1 tolvaptan trial", pmid: "17105757" }];
    const spec = build("lecture", "Hyponatremia", { context: "\nKDIGO: correct <8 mEq/L/24h" }, digest);
    ok(spec.prefix.includes("SALT-1 tolvaptan trial") && spec.prefix.includes("17105757"),
       "the persisted digest shape ({title,pmid}) is exactly what buildCritiqueSpec renders");
    ok(spec.prefix.includes("KDIGO: correct <8 mEq/L/24h"), "guideline ground truth is present (recomputed, not persisted)");
    const bare = build("lecture", "Hyponatremia", null, []);
    ok(!/RETRIEVED SOURCES/.test(bare.prefix), "with no evidence it doesn't fabricate a sources block");
  }
}

console.log("\n" + (failures === 0 ? "✔ RETRY-EVIDENCE + PROVENANCE TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
