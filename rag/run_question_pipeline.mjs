#!/usr/bin/env node
// =============================================================================
// rag/run_question_pipeline.mjs
// -----------------------------------------------------------------------------
// Topic in → MCQs out, end to end.
//
//   1. Embed the topic with OpenAI.
//   2. Retrieve top-K chunks via Supabase RPC `match_chunks`.
//   3. Invoke the `question-writer` sub-agent (Anthropic API) with the chunks.
//   4. Invoke the `question-reviewer` sub-agent on each generated question +
//      its cited chunks.
//   5. Keep questions where reviewer verdict is `pass` (or `revise` if
//      --keep-revise is passed). Drop rejects.
//   6. Save the kept set to rag/question_bank/<topic-slug>.json.
//
// Usage:
//   node rag/run_question_pipeline.mjs "hyponatremia workup"
//   node rag/run_question_pipeline.mjs "CKD blood pressure targets" \
//        --count 5 --pgy junior --difficulty moderate --keep-revise
//   node rag/run_question_pipeline.mjs --batch rag/topics_to_seed.txt
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// ---------- config -----------------------------------------------------------
const EMBED_MODEL    = "text-embedding-3-small";
const WRITER_MODEL   = "claude-sonnet-4-6";          // fast, plenty good
const REVIEWER_MODEL = "claude-opus-4-6";            // skeptical pass uses Opus
const MATCH_COUNT    = 8;
const AGENTS_DIR     = ".claude/agents";
const OUT_DIR        = "rag/question_bank";

// ---------- env --------------------------------------------------------------
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY,
  ANTHROPIC_API_KEY,
} = process.env;

for (const [k, v] of Object.entries({
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY,
})) {
  if (!v) { console.error(`Missing env: ${k}`); process.exit(1); }
}

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------- CLI --------------------------------------------------------------
const args = process.argv.slice(2);
const flags = {
  count: 5,
  pgy: null,
  difficulty: null,
  keepRevise: false,
  batch: null,
};
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--count")            flags.count = parseInt(args[++i], 10);
  else if (a === "--pgy")         flags.pgy = args[++i];
  else if (a === "--difficulty")  flags.difficulty = args[++i];
  else if (a === "--keep-revise") flags.keepRevise = true;
  else if (a === "--batch")       flags.batch = args[++i];
  else                            positional.push(a);
}

const topics =
  flags.batch
    ? fs.readFileSync(flags.batch, "utf8").split("\n").map(s => s.trim()).filter(Boolean)
    : positional.length
      ? [positional.join(" ")]
      : null;

if (!topics) {
  console.error('Usage: node rag/run_question_pipeline.mjs "<topic>" [--count N] [--pgy intern|junior|senior] [--difficulty easy|moderate|hard] [--keep-revise]');
  console.error("   or: node rag/run_question_pipeline.mjs --batch rag/topics.txt");
  process.exit(1);
}

// ---------- agent loaders ----------------------------------------------------
function loadAgent(name) {
  const filepath = path.join(AGENTS_DIR, `${name}.md`);
  const raw = fs.readFileSync(filepath, "utf8");
  // Strip frontmatter ---\n...\n--- and return body as system prompt.
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`Agent ${name}: missing frontmatter at ${filepath}`);
  return m[2].trim();
}
const WRITER_SYS   = loadAgent("question-writer");
const REVIEWER_SYS = loadAgent("question-reviewer");

// ---------- IO helpers -------------------------------------------------------
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function extractJSON(text) {
  // Sub-agents return raw JSON; tolerate the occasional ```json fence anyway.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  // Find first [ or { and trim past last matching close.
  const start = candidate.search(/[\[{]/);
  if (start < 0) throw new Error("No JSON found in response");
  const trimmed = candidate.slice(start).trim();
  // Try parse; if the model emitted array+summary back-to-back, split & parse both.
  try {
    return JSON.parse(trimmed);
  } catch {
    // Split into array and trailing summary object.
    const m = trimmed.match(/^(\[[\s\S]*\])\s*(\{[\s\S]*\})\s*$/);
    if (m) return { array: JSON.parse(m[1]), summary: JSON.parse(m[2]) };
    throw new Error("Could not parse JSON from agent response:\n" + trimmed.slice(0, 600));
  }
}

// ---------- API clients ------------------------------------------------------
async function embed(text) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!r.ok) throw new Error(`OpenAI embed ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.data[0].embedding;
}

async function anthropicCall({ system, user, model, maxTokens = 4096 }) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.content.map(b => (b.type === "text" ? b.text : "")).join("");
}

// ---------- pipeline steps ---------------------------------------------------
async function retrieve(topic) {
  const emb = await embed(topic);
  const { data, error } = await supa.rpc("match_chunks", {
    query_embedding: emb,
    match_count: MATCH_COUNT,
  });
  if (error) throw new Error(`match_chunks: ${error.message}`);
  return (data || []).map(row => ({
    id: `chunk:${row.chunk_id || row.id}`,
    title: row.title,
    pmid: row.pmid,
    source: row.source,
    source_tier: row.source_tier,
    is_landmark_trial: row.is_landmark_trial,
    section: row.section,
    similarity: row.similarity,
    content: row.content,
    // surface guideline metadata if present
    recommendation_grade: row.meta?.recommendation_grade ?? null,
    teaching_angle: row.meta?.teaching_angle ?? null,
  }));
}

async function writeQuestions(topic, chunks) {
  const userMsg = JSON.stringify({
    topic,
    target_count: flags.count,
    pgy_level: flags.pgy,
    difficulty: flags.difficulty,
    chunks,
  }, null, 2);
  const text = await anthropicCall({
    system: WRITER_SYS,
    user: userMsg,
    model: WRITER_MODEL,
    maxTokens: 6000,
  });
  const parsed = extractJSON(text);
  // Writer emits array followed by summary; handle both shapes.
  if (Array.isArray(parsed)) return { questions: parsed, summary: null };
  if (parsed.array)          return { questions: parsed.array, summary: parsed.summary };
  if (parsed.summary)        return { questions: [], summary: parsed.summary };
  return { questions: Array.isArray(parsed) ? parsed : [parsed], summary: null };
}

async function reviewQuestion(question, chunks) {
  // Reviewer needs the question plus the chunks it cited (resolved by id).
  const citedIds = new Set(question.source_refs || []);
  const citedChunks = chunks.filter(c => citedIds.has(c.id));
  const userMsg = JSON.stringify({ question, cited_chunks: citedChunks }, null, 2);
  const text = await anthropicCall({
    system: REVIEWER_SYS,
    user: userMsg,
    model: REVIEWER_MODEL,
    maxTokens: 3000,
  });
  const parsed = extractJSON(text);
  // Reviewer emits per-question object + summary; for a single question pull the first.
  if (Array.isArray(parsed))   return parsed[0];
  if (parsed.array)            return parsed.array[0];
  return parsed;
}

// ---------- orchestrate ------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });

const grandTotals = { topics: 0, drafted: 0, pass: 0, revise: 0, reject: 0, kept: 0 };

for (const topic of topics) {
  console.log(`\n══════ ${topic} ══════`);
  grandTotals.topics++;

  let chunks;
  try {
    chunks = await retrieve(topic);
  } catch (e) {
    console.error(`  ✗ retrieve: ${e.message}`);
    continue;
  }
  if (chunks.length === 0) {
    console.warn(`  ⚠ no chunks retrieved — skipping`);
    continue;
  }
  console.log(`  ✓ retrieved ${chunks.length} chunks (top similarity ${chunks[0].similarity?.toFixed(3)})`);

  let drafted;
  try {
    drafted = await writeQuestions(topic, chunks);
  } catch (e) {
    console.error(`  ✗ writer: ${e.message}`);
    continue;
  }
  console.log(`  ✓ writer drafted ${drafted.questions.length} question(s)` +
    (drafted.summary?.flags?.length ? `, flags: ${drafted.summary.flags.join("; ")}` : ""));
  grandTotals.drafted += drafted.questions.length;

  const kept = [];
  const reviewed = [];
  for (const q of drafted.questions) {
    let verdict;
    try {
      verdict = await reviewQuestion(q, chunks);
    } catch (e) {
      console.error(`    ✗ reviewer on ${q.id}: ${e.message}`);
      continue;
    }
    reviewed.push({ id: q.id, verdict: verdict?.verdict, issues: verdict?.issues || [] });
    if (verdict?.verdict === "pass") {
      grandTotals.pass++;
      kept.push({ ...q, review: verdict });
    } else if (verdict?.verdict === "revise") {
      grandTotals.revise++;
      if (flags.keepRevise) kept.push({ ...q, review: verdict });
    } else {
      grandTotals.reject++;
    }
  }
  grandTotals.kept += kept.length;

  const outPath = path.join(OUT_DIR, `${slugify(topic)}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    topic,
    generated_at: new Date().toISOString(),
    pgy_level: flags.pgy,
    difficulty: flags.difficulty,
    keep_revise: flags.keepRevise,
    chunk_count: chunks.length,
    drafted: drafted.questions.length,
    kept: kept.length,
    reviewed_summary: reviewed.map(r => ({ id: r.id, verdict: r.verdict, n_issues: r.issues.length })),
    questions: kept,
  }, null, 2));
  console.log(`  ✓ kept ${kept.length}/${drafted.questions.length} → ${outPath}`);
}

console.log(`\n═══ DONE ═══`);
console.log(`  topics:   ${grandTotals.topics}`);
console.log(`  drafted:  ${grandTotals.drafted}`);
console.log(`  pass:     ${grandTotals.pass}`);
console.log(`  revise:   ${grandTotals.revise} ${flags.keepRevise ? "(kept)" : "(dropped)"}`);
console.log(`  reject:   ${grandTotals.reject}`);
console.log(`  kept:     ${grandTotals.kept}`);
