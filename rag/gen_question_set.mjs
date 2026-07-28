#!/usr/bin/env node
/**
 * QUESTION-GENERATION EVALUATION (NOT an answer-accuracy evaluation)
 *
 * LABEL THIS CORRECTLY. Codex, 2026-07-28: this harness generates NEW questions and checks whether each
 * question's `correct_letter` matches the option the SAME model flagged correct. That is JSON/key
 * consistency — it is NOT independent clinical correctness, and it is NOT the ability to answer external
 * questions. A model that confidently keys its own wrong answer scores 10/10 here. Only physician
 * grading of Part 2 establishes correctness.
 *
 *   node rag/gen_question_set.mjs                    # 10 questions, difficulty 4
 *   node rag/gen_question_set.mjs --n 20 --difficulty 5
 *   node rag/gen_question_set.mjs --dry              # show the plan, spend nothing
 *
 * WHAT THIS TESTS, AND WHAT IT DOES NOT.
 * It does NOT test whether Chalk Talk can *answer* board questions — the app has no answer mode, and
 * feeding it questions would measure claude-opus-5, not this product. It tests the thing the product
 * actually claims: **when Chalk Talk writes a question, is the keyed answer correct?** A wrong key is a
 * serious defect, because a resident would learn the wrong thing and be confident about it.
 *
 * NO COPYRIGHTED ITEMS ARE USED OR PRODUCED. Every question is written fresh from the ABIM blueprint by
 * the app's own BOARDS_PROMPT, extracted live from index.html so it cannot drift from production. Do not
 * paste real ABIM, MKSAP, UWorld or AMBOSS items into this or any other AI tool.
 *
 * OUTPUT: rag/runs/question-set-<timestamp>.md, in two parts —
 *   Part 1  the questions ALONE, so you can answer them blind first.
 *   Part 2  the answer key, explanation and a grading line per question.
 * Answering blind before looking is worth the extra two minutes: it is the difference between grading a
 * question and being led by it.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import vm from "vm";
import "./loadenv.mjs";

const ARGV = process.argv.slice(2);
const argVal = (k, d) => { const i = ARGV.indexOf(k); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };
const N = Math.max(1, parseInt(argVal("--n", "10"), 10));
const DIFFICULTY = parseInt(argVal("--difficulty", "4"), 10);
const DRY = ARGV.includes("--dry");
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = argVal("--model", "claude-opus-5");

if (!DRY && !KEY) { console.error("✖ ANTHROPIC_API_KEY not set:  node rag/setkey.mjs ANTHROPIC_API_KEY"); process.exit(1); }

// Spread across the blueprint so one weak specialty cannot hide behind nine strong ones.
const TOPICS = [
  ["Cardiovascular",            "Acute decompensated heart failure"],
  ["Pulmonary",                 "Acute exacerbation of asthma"],
  ["Gastroenterology",          "Upper GI bleeding"],
  ["Endocrinology",             "Thyroid storm"],
  ["Infectious Disease",        "Infective endocarditis"],
  ["Hematology",                "Immune thrombocytopenia"],
  ["Nephrology",                "Hyponatremia"],
  ["Rheumatology",              "Giant cell arteritis"],
  ["Neurology",                 "Acute ischemic stroke"],
  ["General Internal Medicine", "Perioperative cardiac risk assessment"],
  ["Oncology",                  "Febrile neutropenia"],
  ["Geriatrics",                "Delirium in the hospitalized older adult"],
  ["Allergy/Immunology",        "Anaphylaxis"],
  ["Psychiatry",                "Serotonin syndrome"],
  ["Critical Care",             "Septic shock resuscitation"],
].slice(0, N);

// ── the REAL prompt, lifted from index.html so this can never drift from production ──
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
const BOARDS_PROMPT = varString("BOARDS_PROMPT");
const BUILD = (html.match(/BUILD_ID = "([^"]+)"/) || [])[1] || "?";

console.log(`Chalk Talk build : ${BUILD}`);
console.log(`Writer           : ${MODEL}`);
console.log(`Prompt           : BOARDS_PROMPT (${BOARDS_PROMPT.length} chars, extracted live)`);
console.log(`Questions        : ${TOPICS.length} at difficulty ${DIFFICULTY}\n`);

if (DRY) {
  TOPICS.forEach(([cat, t], i) => console.log(`  ${String(i + 1).padStart(2)}. ${cat.padEnd(28)} ${t}`));
  console.log("\n✔ DRY RUN — prompt loads. Re-run without --dry to generate.");
  process.exit(0);
}

async function callClaude(system, user, maxTok = 8000) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTok, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}
const parse = (raw) => JSON.parse(raw.replace(/^[^{]*/, "").replace(/[^}]*$/, ""));

const results = [];
for (let i = 0; i < TOPICS.length; i++) {
  const [cat, topic] = TOPICS[i];
  process.stdout.write(`[${i + 1}/${TOPICS.length}] ${topic} … `);
  const t0 = Date.now();
  try {
    const raw = await callClaude(BOARDS_PROMPT, `TOPIC: ${topic}\nTARGET DIFFICULTY LEVEL: ${DIFFICULTY}`);
    const t = parse(raw);
    const q = t.question || {};
    const choices = (q.choices || []).map(c => ({ letter: c.letter, text: c.text, correct: !!c.correct }));
    const keyedByFlag = (choices.find(c => c.correct) || {}).letter;
    results.push({
      cat, topic, title: t.title, key_point: t.key_point,
      stem: q.stem, choices, correct_letter: q.correct_letter, keyedByFlag,
      explanation: q.explanation, wrong: q.wrong_explanations || [],
      difficulty: q.difficulty_level, guideline_sources: t.guideline_sources || [],
      refs: (t.references || []).map(r => `${r.source}${r.year ? " (" + r.year + ")" : ""}`),
      // internal consistency: correct_letter must match the choice flagged correct:true
      key_consistent: keyedByFlag === q.correct_letter,
      secs: Math.round((Date.now() - t0) / 1000),
    });
    const last = results[results.length - 1];
    console.log(`✓ ${last.secs}s · keyed ${last.correct_letter}${last.key_consistent ? "" : "  ⚠ KEY MISMATCH"}`);
  } catch (e) {
    results.push({ cat, topic, error: e.message });
    console.log(`✖ ${String(e.message).slice(0, 70)}`);
  }
}

// ── grading sheet ─────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const ok = results.filter(r => !r.error);
const mismatched = ok.filter(r => !r.key_consistent);

let md = `# Chalk Talk question set — for physician grading\n\n`;
md += `Generated ${new Date().toISOString().slice(0, 10)} · build **${BUILD}** · writer **${MODEL}** · difficulty **${DIFFICULTY}**\n\n`;
md += `**What this measures:** QUESTION GENERATION, not answer accuracy. The automated part checks only\n`;
md += `that correct_letter matches the option the SAME model flagged correct — JSON/key consistency, NOT\n`;
md += `clinical correctness. A confidently wrong key scores 10/10. **Only your grading below establishes\n`;
md += `whether the answers are right.** This is also not a test of whether the app can ANSWER questions:\n`;
md += `it has no answer mode, and that would measure the model rather than the product.\n\n`;
md += `All items are original, written from the ABIM blueprint. No copyrighted items used.\n\n`;
md += `**How to grade:** answer Part 1 blind, then open Part 2. Two minutes of discipline buys a real result.\n\n`;
if (mismatched.length) {
  md += `> ⚠ **${mismatched.length} question(s) have an internal key mismatch** — \`correct_letter\` disagrees with the\n`;
  md += `> choice flagged \`correct:true\`. That is a mechanical defect, independent of clinical correctness: ${mismatched.map(m => m.topic).join(", ")}.\n\n`;
} else {
  md += `Internal key consistency: **${ok.length}/${ok.length}** — \`correct_letter\` matches the flagged choice in every item.\n\n`;
}
md += `---\n\n# Part 1 · Questions\n\n`;
ok.forEach((r, i) => {
  md += `### Q${i + 1} · ${r.cat}\n\n${r.stem}\n\n`;
  r.choices.forEach(c => { md += `- **${c.letter}.** ${c.text}\n`; });
  md += `\nYour answer: \`___\`\n\n---\n\n`;
});

md += `\n# Part 2 · Answer key and grading\n\n`;
ok.forEach((r, i) => {
  md += `### Q${i + 1} · ${r.topic}\n\n`;
  md += `**Keyed answer: ${r.correct_letter}** — ${(r.choices.find(c => c.letter === r.correct_letter) || {}).text || "?"}\n\n`;
  md += `${r.explanation}\n\n`;
  if (r.key_point) md += `*Key point:* ${r.key_point}\n\n`;
  if (r.wrong.length) { md += `<details><summary>Why the others are wrong</summary>\n\n`;
    r.wrong.forEach(w => { md += `- **${w.letter}** — ${w.why}\n`; }); md += `\n</details>\n\n`; }
  if (r.guideline_sources.length) md += `*Guidelines cited:* ${r.guideline_sources.join("; ")}\n\n`;
  md += `| | |\n|---|---|\n`;
  md += `| Keyed answer correct? | ☐ yes ☐ no ☐ ambiguous |\n`;
  md += `| Explanation accurate? | ☐ yes ☐ no |\n`;
  md += `| Guideline attribution correct? | ☐ yes ☐ no ☐ none made |\n`;
  md += `| Would you show a resident? | ☐ yes ☐ no |\n`;
  md += `| Notes | |\n\n---\n\n`;
});
md += `## Tally\n\n- Keyed answers correct: ___ / ${ok.length}\n- Explanations accurate: ___ / ${ok.length}\n`;
md += `- Guideline attributions correct: ___ / ${ok.length}\n- Would show a resident: ___ / ${ok.length}\n\n`;
md += `**Any wrong key is a blocking defect** — a resident would learn the wrong thing and be confident about it.\n`;

try { mkdirSync("rag/runs", { recursive: true }); } catch {}
const out = `rag/runs/question-set-${stamp}.md`;
writeFileSync(out, md);
writeFileSync(out.replace(/\.md$/, ".json"), JSON.stringify({ build: BUILD, model: MODEL, difficulty: DIFFICULTY, results }, null, 2) + "\n");

console.log(`\n${ok.length}/${results.length} generated · internal key mismatches: ${mismatched.length}`);
console.log(`\n-> ${out}`);
console.log(`   (raw JSON beside it)\n`);
console.log(`Answer Part 1 blind before opening Part 2.`);
