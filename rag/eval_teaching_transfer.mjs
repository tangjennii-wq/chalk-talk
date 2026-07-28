#!/usr/bin/env node
/**
 * TEACHING-TRANSFER TEST — does a Chalk Talk teach the concept well enough to answer a NEW question?
 *
 *   node rag/eval_teaching_transfer.mjs --dry        # plan only, spends nothing
 *   node rag/eval_teaching_transfer.mjs             # full run, 10 questions x 3 arms
 *   node rag/eval_teaching_transfer.mjs --only 3,7  # just those question ids
 *
 * THE QUESTION THIS ANSWERS. Not "can Chalk Talk answer board questions" — it has no answer mode, and
 * feeding it questions would measure claude-opus-5 rather than this product. It answers: **if a learner
 * reads only the Chalk Talk, can they get a question they have never seen right?** That is the outcome
 * that matters for a teaching tool, and the one a reviewer will ask for.
 *
 * WHY THREE ARMS. A model reader already knows internal medicine, so simply handing it the talk and the
 * question proves nothing — it would answer correctly from its own knowledge and the talk would get the
 * credit. Two controls close that hole:
 *
 *   CLOSED     no material at all. The reader's baseline. If it gets an item right here, the talk cannot
 *              claim credit for that item.
 *   TALK       the Chalk Talk only, under a strict closed-book instruction: answer ONLY from the talk,
 *              and quote the sentence that supports the answer. If the talk does not contain it, the
 *              reader must return NOT_IN_TALK rather than fall back on what it knows.
 *   DECOY      a Chalk Talk on an UNRELATED topic, same instruction. This is the sharp control: if the
 *              reader answers correctly while holding an irrelevant talk, it is using prior knowledge and
 *              ignoring the instruction — which invalidates the TALK arm for that item.
 *
 * The supporting quote is then checked MECHANICALLY against the talk text. A quote that is not verbatim
 * in the talk means the reader confabulated support, and that item is marked UNSUPPORTED regardless of
 * whether the letter was right. This is the part that makes the result trustworthy rather than flattering.
 *
 * THE READER IS DELIBERATELY A WEAKER MODEL than the writer (default claude-haiku-4-5). A strong reader
 * ceilings out and hides the teaching effect; a learner-proxy leaves room to measure it.
 *
 * LEAKAGE. The talk generator receives the `topic` string ONLY — never a stem, a choice, or a key. The
 * questions live in rag/teaching_transfer_questions.json and are read solely by the grading arms.
 *
 * KNOWN LIMITATION, STATED UP FRONT. This harness generates talks from the app's real LECTURE_PROMPT plus
 * the local guidelines.json, but it does NOT replicate the Worker's PubMed retrieval. So the per-row
 * "retrieved sources / topic-relevant count" that Jenni asked for is NOT produced here — gather that from
 * the app itself. What is produced is the teaching-transfer measurement and the reference list each talk
 * emitted.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import vm from "vm";
import "./loadenv.mjs";

const ARGV = process.argv.slice(2);
const argVal = (k, d) => { const i = ARGV.indexOf(k); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };
const DRY = ARGV.includes("--dry");
const WRITER = argVal("--writer", "claude-opus-5");
const READER = argVal("--reader", "claude-haiku-4-5-20251001");
const ONLY = argVal("--only", "").split(",").map(s => parseInt(s, 10)).filter(Boolean);
const KEY = process.env.ANTHROPIC_API_KEY;
if (!DRY && !KEY) { console.error("✖ ANTHROPIC_API_KEY not set:  node rag/setkey.mjs ANTHROPIC_API_KEY"); process.exit(1); }

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function varString(name) {
  const i = html.indexOf("var " + name + " = ");
  if (i < 0) throw new Error("not found: " + name);
  const q = html[html.indexOf("=", i) + 2];
  const st = html.indexOf(q, i + ("var " + name + " = ").length - 1);
  let j = st + 1;
  while (j < html.length) { if (html[j] === "\\") j += 2; else if (html[j] === q) break; else j++; }
  return vm.runInNewContext(html.slice(st, j + 1));
}
const LECTURE_PROMPT = varString("LECTURE_PROMPT");
const BUILD = (html.match(/BUILD_ID = "([^"]+)"/) || [])[1] || "?";

const QF = JSON.parse(readFileSync(new URL("./teaching_transfer_questions.json", import.meta.url), "utf8"));
let QS = QF.questions;
if (ONLY.length) QS = QS.filter(q => ONLY.includes(q.id));

console.log(`Build   : ${BUILD}`);
console.log(`Writer  : ${WRITER}   (generates the talks)`);
console.log(`Reader  : ${READER}   (the learner proxy — deliberately weaker than the writer)`);
console.log(`Items   : ${QS.length}   Arms: CLOSED (no material) · TALK · DECOY (unrelated talk)\n`);
if (DRY) {
  QS.forEach(q => console.log(`  ${String(q.id).padStart(2)}. ${q.topic.padEnd(52)} key ${q.key}`));
  console.log("\n✔ DRY RUN — prompts and questions load. Re-run without --dry.");
  process.exit(0);
}

async function call(model, system, user, maxTok = 8000) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTok, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  return (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}
const parse = (raw) => JSON.parse(raw.replace(/^[^{]*/, "").replace(/[^}]*$/, ""));

// Flatten a talk to the prose a learner would actually read.
function talkToProse(t) {
  const out = [t.title, t.subtitle, ""];
  (t.summary_points || []).forEach(p => out.push("• " + p));
  (t.sections || []).forEach(s => {
    out.push("", "## " + s.heading);
    (s.points || []).forEach(p => out.push("• " + p));
    if (s.mechanism) out.push("Why this works: " + s.mechanism);
    if (s.teaching_pearl) out.push("Teaching pearl: " + s.teaching_pearl);
    if (s.board_tip) out.push("Board tip: " + s.board_tip);
  });
  (t.references || []).forEach(r => out.push(`[${r.id}] ${r.source}${r.year ? " (" + r.year + ")" : ""}`));
  return out.filter(Boolean).join("\n");
}

const READER_SYS =
  "You are an internal medicine resident answering a single multiple-choice question.\n\n" +
  "STRICT CLOSED-BOOK RULE. Answer using ONLY the teaching material provided in this message. Do NOT use " +
  "anything you already know about medicine. If the provided material does not contain what you need to " +
  "choose an answer, you MUST return letter \"NOT_IN_TALK\" — that is a correct and expected outcome, not " +
  "a failure. Guessing from prior knowledge invalidates this experiment.\n\n" +
  "You must also return `support`: a VERBATIM sentence copied exactly from the material that justifies " +
  "your choice. Do not paraphrase it, do not compose it — copy it character for character. If you cannot " +
  "find such a sentence, return \"NOT_IN_TALK\" as your letter and \"\" as support.\n\n" +
  "Reply with ONLY JSON: {\"letter\":\"A\"|\"B\"|\"C\"|\"D\"|\"E\"|\"NOT_IN_TALK\",\"support\":\"\",\"reasoning\":\"\"}";

const CLOSED_SYS =
  "You are an internal medicine resident answering a single multiple-choice question from your own " +
  "knowledge. No material is provided. Answer to the best of your ability.\n\n" +
  "Reply with ONLY JSON: {\"letter\":\"A\"|\"B\"|\"C\"|\"D\"|\"E\",\"reasoning\":\"\"}";

const qBlock = (q) => `QUESTION\n${q.stem}\n\n` + Object.entries(q.choices).map(([l, t]) => `${l}. ${t}`).join("\n");
const norm = (s) => String(s || "").toLowerCase().replace(/[‘’“”]/g, "'").replace(/[^a-z0-9]+/g, " ").trim();

const rows = [];
const talks = {};

// ── phase 1 · generate one talk per topic (topic string ONLY — no stem, no choices, no key) ──
console.log("── generating talks (topic only; no question ever reaches the writer) ──");
for (const q of QS) {
  process.stdout.write(`  [${q.id}] ${q.topic} … `);
  const t0 = Date.now();
  try {
    const raw = await call(WRITER, LECTURE_PROMPT, `TOPIC: ${q.topic}`, 16000);
    const talk = parse(raw);
    talks[q.id] = { talk, prose: talkToProse(talk), secs: Math.round((Date.now() - t0) / 1000) };
    console.log(`✓ ${talks[q.id].secs}s · ${(talk.sections || []).length} sections · ${(talk.references || []).length} refs`);
  } catch (e) {
    talks[q.id] = { error: e.message };
    console.log(`✖ ${String(e.message).slice(0, 60)}`);
  }
}

// ── phase 2 · three arms ──
console.log("\n── reading arms ──");
for (const q of QS) {
  const T = talks[q.id];
  if (!T || T.error) { rows.push({ id: q.id, topic: q.topic, error: T ? T.error : "no talk" }); continue; }
  const row = { id: q.id, topic: q.topic, key: q.key, gen_secs: T.secs,
                refs: (T.talk.references || []).map(r => `${r.source}${r.year ? " (" + r.year + ")" : ""}`),
                guideline_sources: T.talk.guideline_sources || [] };

  // CLOSED — reader baseline, no material
  try { const a = parse(await call(READER, CLOSED_SYS, qBlock(q), 1500));
        row.closed = { letter: a.letter, correct: a.letter === q.key, reasoning: a.reasoning }; }
  catch (e) { row.closed = { error: e.message }; }

  // TALK — the real arm
  try {
    const a = parse(await call(READER, READER_SYS, `TEACHING MATERIAL\n\n${T.prose}\n\n---\n\n${qBlock(q)}`, 2000));
    const supported = a.support && norm(T.prose).includes(norm(a.support));
    row.talk = { letter: a.letter, correct: a.letter === q.key, support: a.support,
                 support_verbatim: !!supported, reasoning: a.reasoning };
  } catch (e) { row.talk = { error: e.message }; }

  // DECOY — an unrelated talk. Answering correctly here means prior knowledge leaked in.
  const other = QS.find(x => x.id !== q.id && talks[x.id] && !talks[x.id].error);
  if (other) {
    try { const a = parse(await call(READER, READER_SYS, `TEACHING MATERIAL\n\n${talks[other.id].prose}\n\n---\n\n${qBlock(q)}`, 2000));
          row.decoy = { from: other.topic, letter: a.letter, leaked: a.letter !== "NOT_IN_TALK" }; }
    catch (e) { row.decoy = { error: e.message }; }
  }

  if (q.bonus_check) row.bonus = { term: q.bonus_check, present_in_talk: new RegExp(q.bonus_check, "i").test(T.prose) };

  rows.push(row);
  const c = row.closed || {}, t = row.talk || {}, d = row.decoy || {};
  console.log(`  [${q.id}] key ${q.key} · closed ${c.letter || "?"}${c.correct ? "✓" : "✗"} · talk ${t.letter || "?"}${t.correct ? "✓" : "✗"}${t.support_verbatim ? " (quote ok)" : t.letter === "NOT_IN_TALK" ? "" : " ⚠quote not in talk"} · decoy ${d.leaked ? "LEAKED " + d.letter : "held"}`);
}

// ── report ──
const ok = rows.filter(r => !r.error);
const closedRight = ok.filter(r => r.closed && r.closed.correct).length;
const talkRight   = ok.filter(r => r.talk && r.talk.correct).length;
const talkSupported = ok.filter(r => r.talk && r.talk.correct && r.talk.support_verbatim).length;
const notInTalk   = ok.filter(r => r.talk && r.talk.letter === "NOT_IN_TALK").length;
const leaked      = ok.filter(r => r.decoy && r.decoy.leaked).length;

console.log(`\n═══ RESULT (${ok.length} items) ═══`);
console.log(`  CLOSED  (no material)   ${closedRight}/${ok.length} correct  ← the reader's own knowledge`);
console.log(`  TALK    (Chalk Talk)    ${talkRight}/${ok.length} correct, of which ${talkSupported} carry a VERBATIM supporting quote`);
console.log(`          answered NOT_IN_TALK: ${notInTalk}  ← the talk did not contain the needed teaching`);
console.log(`  DECOY   (wrong talk)    ${leaked}/${ok.length} answered anyway  ← prior knowledge leaking past the instruction`);
if (leaked > 0) {
  console.log(`\n  ⚠ ${leaked} item(s) leaked. For those items the TALK arm cannot be attributed to the talk,`);
  console.log(`    because the reader answered the same question while holding unrelated material.`);
}
console.log(`\n  The number that means something is TALK-correct-AND-verbatim-supported (${talkSupported}) measured`);
console.log(`  against CLOSED (${closedRight}). Anything else is the reader's own knowledge wearing the talk's badge.`);

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
try { mkdirSync("rag/runs", { recursive: true }); } catch {}
const out = `rag/runs/teaching-transfer-${stamp}.json`;
writeFileSync(out, JSON.stringify({ build: BUILD, writer: WRITER, reader: READER, when: new Date().toISOString(),
  summary: { items: ok.length, closed_correct: closedRight, talk_correct: talkRight,
             talk_correct_and_supported: talkSupported, not_in_talk: notInTalk, decoy_leaked: leaked },
  rows, talks: Object.fromEntries(Object.entries(talks).map(([k, v]) => [k, v.error ? v : { talk: v.talk, secs: v.secs }])) }, null, 2) + "\n");
console.log(`\n-> ${out}`);
console.log(`   Talks are saved in full, so nothing has to be regenerated to re-grade.`);
