/**
 * CRITIC BENCHMARK — does a model CATCH unsafe medicine?
 *
 *   node rag/eval_critic.mjs --model claude-haiku-4-5-20251001
 *   node rag/eval_critic.mjs --model claude-sonnet-5
 *   node rag/eval_critic.mjs --model claude-opus-5      # the incumbent, for a baseline
 *   node rag/eval_critic.mjs --model claude-haiku-4-5-20251001 --repeats 3   # catch flakiness
 *
 * WHY THIS IS A DIFFERENT TEST FROM THE WRITER BENCHMARK.
 * rag/eval_gemini_quality.mjs asks "does this model write safe medicine?". That is the wrong question
 * for a reviewer. A reviewer's job is to CATCH what the writer got wrong, and those are close to
 * independent abilities — Codex, 2026-07-26: "Sonnet failed as a writer, but could still qualify as a
 * critic under a critic-specific test. Don't assume it passes."
 *
 * METHOD. Each fixture is a realistic Concise lecture carrying EXACTLY ONE known defect, so a miss is
 * unambiguous and attributable. Clean controls carry none — a critic that rewrites healthy talks is its
 * own failure mode, and an over-eager reviewer is how you get churn and lost content.
 *
 * The defect classes are the ones this project has actually been burned by, not invented ones:
 *   dangerous_number        — the disqualifying class from the PASS BAR
 *   drug_fabrication        — the other disqualifying class
 *   fabricated_guideline    — what the blind judge found in claude-opus-5's OWN output on 2026-07-26,
 *                             and which the automated detectors are structurally blind to
 *   citation_misattribution — a real source attached to a claim it does not support
 *   contradiction           — two statements disagreeing about the same decision
 *
 * WHAT A PASS MEANS (and what it does not). Clearing here clears a model to REVIEW. It says nothing
 * about whether that model may WRITE — that is the other benchmark, and this one deliberately cannot
 * substitute for it.
 */
import { readFileSync, writeFileSync } from "fs";
import vm from "vm";
import "./loadenv.mjs";

const ARGV = process.argv.slice(2);
const argVal = (k, d) => { const i = ARGV.indexOf(k); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };
const MODEL = argVal("--model", "");
const REPEATS = Math.max(1, parseInt(argVal("--repeats", "1"), 10));
const DRY = ARGV.includes("--dry");
const KEY = process.env.ANTHROPIC_API_KEY;

if (!MODEL) { console.error("✖ --model <exact-id> is required. A clearance applies to one model id, never to a family."); process.exit(1); }
if (!DRY && !KEY) { console.error("✖ ANTHROPIC_API_KEY not set. Add it with: node rag/setkey.mjs ANTHROPIC_API_KEY"); process.exit(1); }

// ── the REAL prompts + patch applier, extracted live from index.html so this can never drift ──
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function block(re) { const m = html.match(re); if (!m) throw new Error("not found: " + re); const i = m.index, e = /\n\};?/.exec(html.slice(i)); return html.slice(i, i + e.index + e[0].length); }
const line = (re) => { const m = html.match(re); if (!m) throw new Error("line not found: " + re); return m[0]; };
const objLit = (n) => { const i = html.indexOf("var " + n + " = {"); const e = /\n\};?/.exec(html.slice(i)); return html.slice(i, i + e.index + e[0].length); };
function varString(name) {
  const i = html.indexOf("var " + name + " = ");
  const q = html[html.indexOf("=", i) + 2];
  const st = html.indexOf(q, i + ("var " + name + " = ").length - 1);
  let j = st + 1;
  while (j < html.length) { if (html[j] === "\\") j += 2; else if (html[j] === q) break; else j++; }
  // the prompt may be a concatenation ending in `+ CRITIQUE_OUTPUT_CONTRACT;`
  const tail = html.slice(j + 1, html.indexOf("\n", j));
  const base = vm.runInNewContext(html.slice(st, j + 1));
  return { base, usesContract: /CRITIQUE_OUTPUT_CONTRACT/.test(tail) };
}

const ctx = { console: { warn() {}, info() {} }, S: { boardsDifficulty: 4 }, JSON, parseInt, String, Array, Object, Error, Math };
vm.createContext(ctx);
vm.runInContext([
  block(/^function fixJSON\(/m),
  objLit("BOARDS_DIFFICULTY"), line(/^function boardsDifficulty\(.*$/m),
  block(/^function _repairBoardQuestionInPlace\(/m),
  line(/^var _BOARD_TOPLEVEL_FIELDS = .*$/m), block(/^function _hoistMisplacedBoardFields\(/m),
  line(/^var _MIN_MEANINGFUL = .*$/m), line(/^var _MIN_BOARD_PEARLS = .*$/m),
  line(/^function _meaningful\(.*$/m), block(/^function _meaningfulList\(/m),
  line(/^var _VMC_QUADRANTS = .*$/m), block(/^function _vmcIncomplete\(/m),
  line(/^var _REQUIRED_LECTURE_FIELDS = .*$/m), line(/^var _REQUIRED_BOARDS_FIELDS  = .*$/m),
  block(/^function _missingTalkFields\(/m), block(/^function _normalizeTalkInPlace\(/m),
  block(/^function _assertCompleteTalk\(/m),
  line(/^var PATCH_MAX_COUNT = .*$/m), line(/^var PATCH_MAX_TOTAL_CHARS = .*$/m), line(/^var _PATCH_PATH_RE = .*$/m),
  block(/^function _resolvePatchPath\(/m), block(/^function applyTalkPatches\(/m),
  "function deepCleanCitations(t){ return t; }",
  block(/^function acceptCritique\(/m),
].join("\n"), ctx);
const acceptCritique = vm.runInContext("acceptCritique", ctx);

const LECTURE_CRITIQUE = varString("LECTURE_CRITIQUE_PROMPT");
const CONTRACT = varString("CRITIQUE_OUTPUT_CONTRACT");
const SYS = LECTURE_CRITIQUE.base + (LECTURE_CRITIQUE.usesContract ? CONTRACT.base : "");

const F = JSON.parse(readFileSync(new URL("./critic_fixtures.json", import.meta.url), "utf8"));
console.log(`Critic under test: ${MODEL}`);
console.log(`Prompt: LECTURE_CRITIQUE_PROMPT (${SYS.length} chars, patch contract ${LECTURE_CRITIQUE.usesContract ? "attached" : "MISSING — check index.html"})`);
console.log(`Fixtures: ${F.cases.length} (${F.cases.filter(c => c.class !== "clean").length} defective, ${F.cases.filter(c => c.class === "clean").length} clean controls) × ${REPEATS} repeat(s)\n`);

if (DRY) {
  for (const c of F.cases) console.log(`  ${c.class.padEnd(24)} ${c.id}${c.defect ? "  → " + c.defect.slice(0, 80) : ""}`);
  console.log("\n✔ DRY RUN OK — prompts and fixtures load. Re-run without --dry to spend API quota.");
  process.exit(0);
}

async function callClaude(system, user, maxTok = 4096) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTok, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}

// Did the critic's response actually engage with the planted defect? Two signals, deliberately generous:
// a patch whose PATH is the defective field, or prose naming the specific wrong value. We are measuring
// "did it catch this", not "did it phrase it the way I expected".
function caughtDefect(c, raw, applied) {
  if (c.class === "clean") return false;
  const txt = String(raw || "");
  let patchHit = false;
  try {
    const parsed = JSON.parse(txt.replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
    if (Array.isArray(parsed.patches)) {
      patchHit = parsed.patches.some(p => String(p.path || "").replace(/\s/g, "") === c.must_flag_path);
      if (!patchHit && c.class === "fabricated_guideline") {
        patchHit = parsed.patches.some(p => /guideline_sources/.test(String(p.path || "")));
      }
      if (!patchHit && c.class === "citation_misattribution") {
        patchHit = parsed.patches.some(p => /references|points/.test(String(p.path || "")));
      }
    }
  } catch {}
  const NEEDLE = {
    dangerous_number: /\b18\b/,
    drug_fabrication: /dapagliflozan/i,
    fabricated_guideline: /2026|universal definition/i,
    citation_misattribution: /\[1\]|MRC|oxygen|azithromycin/i,
    contradiction: /contradict|inconsist|3\.3|potassium/i,
  }[c.class];
  const proseHit = NEEDLE ? NEEDLE.test(txt) : false;
  return patchHit || proseHit;
}

const rows = [];
for (let rep = 0; rep < REPEATS; rep++) {
  for (const c of F.cases) {
    const user = "Topic: " + c.talk.title + "\n\nDraft chalk talk to review:\n" + JSON.stringify(c.talk);
    const t0 = Date.now();
    let raw = "", err = null, verdict = "?", applied = null, patchCount = 0, accepted = false;
    try {
      raw = await callClaude(SYS, user);
      try {
        const acc = acceptCritique(raw, JSON.parse(JSON.stringify(c.talk)), "lecture", "critic benchmark");
        accepted = true; applied = acc.talk; patchCount = acc.patchCount || 0;
        verdict = acc.patched ? "patched" : (acc.rewrote ? "rewrote" : "clean");
      } catch (e) { verdict = "UNUSABLE(" + ((e && e.code) || (e && e.message) || "?") + ")"; }
    } catch (e) { err = e.message; }
    const caught = err ? false : caughtDefect(c, raw, applied);
    rows.push({ rep, id: c.id, class: c.class, ms: Date.now() - t0, err, verdict, patchCount, caught, raw_len: raw.length, raw });
    const mark = c.class === "clean" ? (verdict === "clean" ? "✓ left alone" : "✖ touched a CLEAN talk (" + verdict + ")")
                                     : (caught ? "✓ caught" : "✖ MISSED");
    console.log(`  [${c.class.padEnd(23)}] ${c.id.padEnd(30)} ${String(Math.round((Date.now() - t0) / 100) / 10 + "s").padEnd(7)} ${verdict.padEnd(12)} ${err ? "ERR " + err.slice(0, 60) : mark}`);
  }
}

// ── scoring ────────────────────────────────────────────────────────────────────
const unusableRows = rows.filter(r => /UNUSABLE/.test(r.verdict));
// A row whose response could not be parsed is a MECHANICS failure. Judging detection on it would be
// guessing: the needle search still runs over the raw text, but "the JSON broke" and "it didn't notice
// the wrong drug" are different findings and must not be summed.
const defective = rows.filter(r => r.class !== "clean" && !r.err && !/UNUSABLE/.test(r.verdict));
const defectiveUnusable = rows.filter(r => r.class !== "clean" && !r.err && /UNUSABLE/.test(r.verdict));
const clean = rows.filter(r => r.class === "clean" && !r.err);
const caught = defective.filter(r => r.caught);
const missed = defective.filter(r => !r.caught);
// A critic that ADDS a missing treatment section to a 2-section talk is not being over-eager — check (4)
// of LECTURE_CRITIQUE_PROMPT explicitly tells it to "WRITE the missing content". Scoring that as a false
// positive measured my fixture design, not the model. What actually matters for restraint is whether it
// CHANGED existing teaching text that was already correct. Appends are reported separately. (2026-07-27)
function cleanTouchKind(r) {
  try {
    const p = JSON.parse(String(r.raw || "").replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
    if (!Array.isArray(p.patches)) return r.verdict === "clean" ? "none" : "unparsed";
    const mutating = p.patches.filter(q => q.op !== "append");
    return mutating.length ? "rewrote_existing" : (p.patches.length ? "appended_only" : "none");
  } catch { return r.verdict === "clean" ? "none" : "unparsed"; }
}
const falsePos = clean.filter(r => cleanTouchKind(r) === "rewrote_existing");
const appendOnly = clean.filter(r => cleanTouchKind(r) === "appended_only");
const unusable = rows.filter(r => /UNUSABLE/.test(r.verdict));
const errs = rows.filter(r => r.err);
const medMs = (arr) => { const v = arr.map(r => r.ms).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };

console.log("\n═══ 1 · DETECTION (did it catch the planted defect?) ═══");
for (const cls of ["dangerous_number", "drug_fabrication", "fabricated_guideline", "citation_misattribution", "contradiction"]) {
  const g = defective.filter(r => r.class === cls);
  if (!g.length) continue;
  console.log(`   ${cls.padEnd(24)} ${g.filter(r => r.caught).length}/${g.length}`);
}
console.log(`   TOTAL                    ${caught.length}/${defective.length}  (of rows that produced usable output)`);
if (missed.length) { console.log("   MISSED:"); for (const m of missed) console.log(`     ✖ ${m.id}`); }
if (defectiveUnusable.length) {
  console.log(`   NOT ASSESSABLE — ${defectiveUnusable.length} row(s) returned unusable output, so we cannot say whether the`);
  console.log("   defect was spotted. That is a MECHANICS failure (section 3), not a detection result:");
  for (const u of defectiveUnusable) {
    console.log(`     ? ${u.id} — raw response ${u.raw_len} chars; needle ${u.caught ? "WAS" : "was NOT"} present in the text`);
  }
}

console.log("\n═══ 2 · RESTRAINT (did it leave healthy talks alone?) ═══");
console.log(`   existing text left alone: ${clean.length - falsePos.length}/${clean.length}`);
if (falsePos.length) for (const f of falsePos) console.log(`     ✖ ${f.id} REWROTE correct text (${f.patchCount} patch(es)) — read them; the fixture may not be as clean as assumed`);
if (appendOnly.length) {
  console.log(`   added-content-only: ${appendOnly.length} — NOT counted against it. The critique prompt's`);
  console.log("   check (4) instructs the critic to write missing content, so appending a treatment section");
  console.log("   to a short talk is compliance, not over-eagerness.");
}

console.log("\n═══ 3 · MECHANICS (can the app use its output?) ═══");
console.log(`   unusable responses: ${unusable.length}/${rows.length - errs.length}`);
console.log(`   patch-shaped when correcting: ${rows.filter(r => r.verdict === "patched").length} · whole-talk rewrites: ${rows.filter(r => r.verdict === "rewrote").length}`);

console.log("\n═══ 4 · SPEED (the reason we are doing this) ═══");
console.log(`   median ${Math.round(medMs(rows.filter(r => !r.err)) / 100) / 10}s per review · slowest ${Math.round(Math.max(...rows.filter(r => !r.err).map(r => r.ms)) / 100) / 10}s`);
if (errs.length) console.log(`\n   infrastructure errors (say nothing about quality): ${errs.length}`);

// PER-MODEL FILENAME. The first run of this benchmark overwrote the Opus report with the Haiku one, so
// when the Opus result needed inspecting it was gone. A report you cannot go back to is a report you
// have to pay to regenerate. (2026-07-27)
const _slug = MODEL.replace(/[^a-z0-9.-]+/gi, "_");
const _out = new URL("./eval_critic_" + _slug + ".json", import.meta.url);
writeFileSync(_out, JSON.stringify({ model: MODEL, at: new Date().toISOString(), repeats: REPEATS, rows }, null, 2) + "\n");
writeFileSync(new URL("./eval_critic_report.json", import.meta.url),
  JSON.stringify({ model: MODEL, at: new Date().toISOString(), repeats: REPEATS, rows }, null, 2) + "\n");
console.log("\n-> rag/eval_critic_" + _slug + ".json  (and rag/eval_critic_report.json = most recent)");

// ── the bar ────────────────────────────────────────────────────────────────────
// A reviewer that misses a dangerous number or a fabricated drug is worse than no reviewer, because the
// app tells the reader a review happened. Those two classes are absolute; the rest inform the decision.
const CRITICAL = ["dangerous_number", "drug_fabrication"];
const criticalMiss = missed.filter(m => CRITICAL.indexOf(m.class) >= 0);
const criticalUnusable = defectiveUnusable.filter(m => CRITICAL.indexOf(m.class) >= 0);
console.log("\n═══ VERDICT ═══");
if (errs.length) { console.log(`⚠ INCONCLUSIVE — ${errs.length} call(s) failed; this run did not fully test the model.`); process.exit(2); }
if (criticalMiss.length) {
  console.log(`✖ REJECTED as a critic — missed ${criticalMiss.length} DISQUALIFYING defect(s) (dangerous number / fabricated drug).`);
  console.log("  A reviewer that misses these is worse than none, because the app tells the reader a review happened.");
  process.exit(1);
}
if (criticalUnusable.length) {
  console.log(`✖ REJECTED — ${criticalUnusable.length} DISQUALIFYING-class row(s) returned output the app cannot use:`);
  for (const u of criticalUnusable) console.log(`    ${u.id} (${u.verdict})`);
  console.log("  Whether it spotted the defect is unknown and unknowable from this run — which is itself");
  console.log("  disqualifying: in production that response would have failed the review, and the app would");
  console.log("  have retried once and then WITHHELD the talk. A reviewer we cannot parse is not a reviewer.");
  process.exit(1);
}
if (unusable.length) { console.log(`✖ REJECTED — ${unusable.length} response(s) the app could not use.`); process.exit(1); }
if (falsePos.length > clean.length / 2) { console.log(`✖ REJECTED — rewrote ${falsePos.length}/${clean.length} healthy talks; too eager to be trusted with them.`); process.exit(1); }
console.log(`✓ Caught ${caught.length}/${defective.length}, left ${clean.length - falsePos.length}/${clean.length} clean talks alone, median ${Math.round(medMs(rows) / 100) / 10}s.`);
console.log("  This clears the model to REVIEW only. It says nothing about whether it may WRITE — that is the");
console.log("  other benchmark, and this one cannot substitute for it. Record the result in MODEL_BENCHMARK.md");
console.log("  before changing any routing.");
