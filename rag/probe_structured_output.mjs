/**
 * Does schema-constrained output actually work for Chalk Talk's real schema — and can it coexist with
 * web search? Answer this BEFORE changing the request shape of the only path that writes medical content.
 *
 *   node rag/probe_structured_output.mjs            # ~6 cheap Haiku calls, a few cents
 *   node rag/probe_structured_output.mjs --model claude-opus-5   # confirm on the production writer
 *
 * Why this exists: commit 4514f7e reordered the prompt schema and added a free-text repair retry. That is
 * NOT schema-constrained output — the Anthropic request is still unconstrained, so the model can still
 * emit unbalanced JSON. Real enforcement means forced tool use: the model fills a JSON Schema and the API
 * returns a parsed object, making "invalid JSON" structurally impossible rather than merely less likely.
 *
 * The open question is the interaction with web search. Chalk Talk passes a web_search tool when the user
 * enables it, and tool_choice:{type:"tool"} forces an immediate call to the named tool — so the model
 * never gets to search. This probe measures what actually happens instead of assuming, and prints the
 * numbers needed to choose between:
 *
 *   A) Constrain only when web search is OFF; the repair retry always constrains (it has the context
 *      already and doesn't need to search). No agentic loop, small change.
 *   B) Two-turn loop: allow web_search, then force emit_chalk_talk on a follow-up turn. Correct in all
 *      cases, but callAPI() and the Worker both become multi-turn.
 *   C) Keep prompt-side only.
 *
 * It also checks the thing most likely to bite: whether a DEEP, fully-required schema (Chalk Talk's real
 * boards shape, ~30 nested required fields) is accepted and honoured, and whether output tokens go up.
 */
import "./loadenv.mjs";
import { readFileSync } from "fs";

const ARGV = process.argv.slice(2);
const argVal = (k, d) => { const i = ARGV.indexOf(k); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };
const MODEL = argVal("--model", "claude-haiku-4-5-20251001");
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("✖ ANTHROPIC_API_KEY not set. Add it with: node rag/setkey.mjs ANTHROPIC_API_KEY"); process.exit(1); }

async function call(body) {
  const t0 = Date.now();
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, ms: Date.now() - t0, json, raw: text };
}

// ── Chalk Talk's REAL shapes, mirrored from _REQUIRED_*_FIELDS in index.html ────
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const reqOf = (name) => {
  const m = html.match(new RegExp("^var " + name + "\\s*= (\\[.*?\\]);", "m"));
  return m ? JSON.parse(m[1].replace(/'/g, '"')) : [];
};
const REQ_LECTURE = reqOf("_REQUIRED_LECTURE_FIELDS");
const REQ_BOARDS = reqOf("_REQUIRED_BOARDS_FIELDS");
console.log(`Required fields read live from index.html — lecture: ${REQ_LECTURE.join(", ")}`);
console.log(`                                              boards:  ${REQ_BOARDS.join(", ")}\n`);

const str = { type: "string" };
const strs = { type: "array", items: str };
const vmc = { type: "object", properties: { top_left: str, top_right: str, bottom_left: str, bottom_right: str, center: str }, required: ["top_left", "top_right", "bottom_left", "bottom_right", "center"] };
const refs = { type: "array", items: { type: "object", properties: { id: { type: "integer" }, source: str, year: { type: "integer" }, society: str, url: str, type: str }, required: ["id", "source", "year"] } };

const LECTURE_SCHEMA = {
  type: "object",
  properties: {
    title: str, subtitle: str, guideline_sources: strs, summary_points: strs, visual_memory_card: vmc, references: refs,
    sections: { type: "array", items: { type: "object", properties: { heading: str, minutes: str, points: strs, mechanism: str, teaching_pearl: str, board_tip: str }, required: ["heading", "minutes", "points", "mechanism", "teaching_pearl", "board_tip"] } },
  },
  required: ["title", "subtitle", "guideline_sources", "summary_points", "visual_memory_card", "references", "sections"],
};
const BOARDS_SCHEMA = {
  type: "object",
  properties: {
    title: str, subtitle: str, guideline_sources: strs, key_point: str,
    abim_classification: { type: "object", properties: { category: str, subcategory: str, specific_topic: str, blueprint_weight: str }, required: ["category", "subcategory", "specific_topic", "blueprint_weight"] },
    board_pearls: strs, teaching_points: strs, summary_points: strs, visual_memory_card: vmc, references: refs,
    question: {
      type: "object",
      properties: {
        stem: str,
        choices: { type: "array", items: { type: "object", properties: { letter: str, text: str, correct: { type: "boolean" } }, required: ["letter", "text", "correct"] } },
        correct_letter: str, explanation: str,
        wrong_explanations: { type: "array", items: { type: "object", properties: { letter: str, why: str }, required: ["letter", "why"] } },
        difficulty_level: { type: "integer" }, difficulty_label: str, difficulty_rationale: str, reasoning_steps: strs,
      },
      required: ["stem", "choices", "correct_letter", "explanation", "wrong_explanations", "difficulty_level", "difficulty_label", "difficulty_rationale", "reasoning_steps"],
    },
  },
  required: ["title", "subtitle", "guideline_sources", "key_point", "abim_classification", "board_pearls", "teaching_points", "summary_points", "visual_memory_card", "references", "question"],
};

const TOOL = (schema) => ({ name: "emit_chalk_talk", description: "Emit the finished chalk talk. Every field is required.", input_schema: schema });
const ask = (topic, style) => [{ role: "user", content: `Create a ${style === "boards" ? "board-style question" : "10-minute chalk talk"} on: ${topic}. Include every required field.` }];

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✓" : "  ✗") + " " + m); if (!c) fail++; };
const missing = (obj, req) => req.filter((k) => obj[k] === undefined || obj[k] === null || (Array.isArray(obj[k]) && !obj[k].length) || obj[k] === "");

async function constrained(label, schema, req, topic, style, extraTools = [], toolChoice = { type: "tool", name: "emit_chalk_talk" }, maxTok = 8000) {
  console.log(`\n── ${label} ──`);
  const res = await call({ model: MODEL, max_tokens: maxTok, tools: [...extraTools, TOOL(schema)], tool_choice: toolChoice, messages: ask(topic, style) });
  if (res.status !== 200) {
    ok(false, `HTTP ${res.status} — ${JSON.stringify(res.json?.error || res.raw).slice(0, 240)}`);
    return { res, talk: null };
  }
  const blocks = (res.json.content || []).map((b) => b.type);
  console.log(`  stop_reason: ${res.json.stop_reason} · blocks: ${JSON.stringify(blocks)} · ${Math.round(res.ms / 1000)}s`
    + ` · out ${res.json.usage?.output_tokens} tok`);
  const tu = (res.json.content || []).find((b) => b.type === "tool_use");
  ok(!!tu, "returned a tool_use block (the object arrives PARSED — no JSON text to repair)");
  if (!tu) return { res, talk: null };
  const miss = missing(tu.input, req);
  ok(miss.length === 0, miss.length ? `MISSING/EMPTY required fields: ${miss.join(", ")}` : `all ${req.length} required top-level fields present and non-empty`);
  ok(res.json.stop_reason !== "max_tokens", "not truncated at max_tokens (a truncated tool_use is still unusable)");
  return { res, talk: tu.input, missing: miss };
}

console.log(`Model under test: ${MODEL}`);

// 1) the basic question: does forced tool use honour the real lecture schema?
await constrained("A1 · lecture, schema-constrained, no web search", LECTURE_SCHEMA, REQ_LECTURE, "Hyponatremia and SIADH", "lecture");

// 2) the deep one — boards is where brace drift actually happened
const b = await constrained("A2 · BOARDS (deep nesting, ~30 required fields), schema-constrained", BOARDS_SCHEMA, REQ_BOARDS, "Diabetic ketoacidosis", "boards");
if (b.talk?.question) {
  ok(Array.isArray(b.talk.question.choices) && b.talk.question.choices.length >= 4, `question.choices came back as a real array (${b.talk.question.choices?.length} choices)`);
  ok(typeof b.talk.question.difficulty_level === "number", "difficulty_level is a NUMBER (schema types are enforced, not coaxed)");
  ok(b.talk.key_point !== undefined, "key_point survived — this is the exact field brace drift used to orphan");
}

// 3) THE COEXISTENCE QUESTION: forced tool + web_search in one request
console.log("\n── B · forced emit_chalk_talk + web_search in the SAME request ──");
{
  const res = await call({
    model: MODEL, max_tokens: 4000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }, TOOL(LECTURE_SCHEMA)],
    tool_choice: { type: "tool", name: "emit_chalk_talk" },
    messages: ask("2026 guideline updates in heart failure", "lecture"),
  });
  if (res.status !== 200) {
    console.log(`  → REJECTED: HTTP ${res.status} ${JSON.stringify(res.json?.error || res.raw).slice(0, 200)}`);
    console.log("  → Meaning: cannot force the schema AND offer search in one call. Option A or B, not both.");
  } else {
    const types = (res.json.content || []).map((b) => b.type);
    const searched = types.some((t) => /search/.test(t));
    console.log(`  accepted · blocks: ${JSON.stringify(types)}`);
    console.log(searched
      ? "  → It searched AND emitted. Option B may be unnecessary — verify the search results really informed the talk."
      : "  → Accepted but did NOT search: forcing the tool suppresses search, as expected. Choose A (constrain only when search is off) or B (two-turn loop).");
  }
}

// 4) tool_choice:auto — does it still reliably emit the tool when search is available?
console.log("\n── C · web_search + tool_choice:auto (the Option B shape, single turn) ──");
{
  const res = await call({
    model: MODEL, max_tokens: 4000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }, TOOL(LECTURE_SCHEMA)],
    tool_choice: { type: "auto" },
    messages: ask("2026 guideline updates in heart failure", "lecture"),
  });
  const types = res.status === 200 ? (res.json.content || []).map((b) => b.type) : [];
  console.log(`  HTTP ${res.status} · blocks: ${JSON.stringify(types)} · stop_reason: ${res.json?.stop_reason}`);
  const emitted = types.includes("tool_use") && (res.json.content || []).some((x) => x.name === "emit_chalk_talk");
  console.log(emitted
    ? "  → Emitted the talk tool on the first turn even with search available."
    : "  → Did NOT emit on turn 1 (searched or answered in text). Option B needs a genuine second turn — plan for it.");
}

// 5) does the Worker forward tools? (free tier goes through the proxy, so this must hold too)
console.log("\n── D · does the Cloudflare Worker forward tools/tool_choice? ──");
{
  const w = html.match(/RAG_CONFIG\s*=\s*\{[^}]*url:\s*["']([^"']+)["']/);
  const workerSrc = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  const fwd = /tool_choice/.test(workerSrc);
  console.log(`  worker.js mentions tool_choice: ${fwd ? "yes" : "NO"}`);
  console.log(fwd ? "  → check it is passed through unmodified for the free tier."
                  : "  → The Worker does NOT forward tool_choice, so free-tier users would silently get the UNCONSTRAINED shape.");
  console.log(`  (proxy url in index.html: ${w ? w[1] : "not found"})`);
  if (!fwd) fail++;
}

console.log("\n═══ WHAT TO DO WITH THIS ═══");
console.log("If A1/A2 are clean: forced tool use honours the real schema and 'invalid JSON' stops being possible");
console.log("on that path — worth adopting. B/C decide how it coexists with web search. D is a hard blocker for");
console.log("the free tier until the Worker forwards the fields. Paste this output back before any code change;");
console.log("the request shape of the only medical-writing path should not be changed on an assumption.");
process.exit(fail ? 2 : 0);
