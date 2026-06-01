#!/usr/bin/env node
/**
 * Chalk Talk — ABIM coverage audit
 * For each subspecialty in rag/abim_topics.json:
 *   embed → match_chunks → count unique docs → classify gap status
 * Saves JSON snapshot for diffing over time.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error("Missing required env vars.");
  process.exit(1);
}

const topicsByName = JSON.parse(readFileSync("rag/abim_topics.json", "utf8"));
const SUBSPECIALTIES = Object.keys(topicsByName);

const MIN_SIMILARITY = 0.40;
const MATCH_COUNT = 25;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function embed(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text, dimensions: 1536 }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  return (await res.json()).data[0].embedding;
}

async function auditTopic(name) {
  let emb;
  try { emb = await embed(name); }
  catch (e) { return { name, error: "embed_failed", message: e.message }; }

  const { data, error } = await sb.rpc("match_chunks", {
    query_embedding: emb,
    match_count: MATCH_COUNT,
    min_similarity: MIN_SIMILARITY,
  });
  if (error) return { name, error: "rpc_failed", message: error.message };

  const chunks = data || [];
  const uniqueDocs = new Set();
  const tiers = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let landmarks = 0, totalSim = 0, topSim = 0;
  for (const c of chunks) {
    uniqueDocs.add(c.document_id);
    if (c.source_tier) tiers[c.source_tier] = (tiers[c.source_tier] || 0) + 1;
    if (c.is_landmark_trial) landmarks++;
    totalSim += c.similarity || 0;
    if ((c.similarity || 0) > topSim) topSim = c.similarity;
  }
  return {
    name,
    unique_docs: uniqueDocs.size,
    chunks: chunks.length,
    avg_similarity: chunks.length ? +(totalSim / chunks.length).toFixed(3) : null,
    top_similarity: chunks.length ? +topSim.toFixed(3) : null,
    landmark_chunks: landmarks,
    tier_breakdown: tiers,
  };
}

function classify(uniqueDocs) {
  if (uniqueDocs === 0) return "GAP";
  if (uniqueDocs <= 2) return "thin";
  if (uniqueDocs <= 7) return "good";
  return "excellent";
}

async function main() {
  console.log(`Auditing ${SUBSPECIALTIES.length} ABIM subspecialties via semantic retrieval`);
  console.log(`Threshold: similarity ≥ ${MIN_SIMILARITY}, match_count=${MATCH_COUNT}\n`);

  const results = [];
  for (let i = 0; i < SUBSPECIALTIES.length; i++) {
    const name = SUBSPECIALTIES[i];
    const r = await auditTopic(name);
    r.status = r.error ? "error" : classify(r.unique_docs);
    results.push(r);
    const simStr = r.avg_similarity ? `sim ${r.avg_similarity}` : "—";
    const statusPad = r.status.toUpperCase().padEnd(10);
    console.log(`[${String(i+1).padStart(3)}/${SUBSPECIALTIES.length}] ${name.padEnd(50).slice(0,50)} ${String(r.unique_docs||0).padStart(2)} docs · ${simStr.padEnd(8)} → ${statusPad}`);
  }

  const summary = {
    excellent: results.filter(r => r.status === "excellent").length,
    good:      results.filter(r => r.status === "good").length,
    thin:      results.filter(r => r.status === "thin").length,
    GAP:       results.filter(r => r.status === "GAP").length,
    errored:   results.filter(r => r.status === "error").length,
  };

  console.log(`\n═══════════ COVERAGE SUMMARY ═══════════`);
  console.log(`Excellent (8+ docs):  ${String(summary.excellent).padStart(3)}  ${barChart(summary.excellent, SUBSPECIALTIES.length)}`);
  console.log(`Good (3-7 docs):      ${String(summary.good).padStart(3)}  ${barChart(summary.good, SUBSPECIALTIES.length)}`);
  console.log(`Thin (1-2 docs):      ${String(summary.thin).padStart(3)}  ${barChart(summary.thin, SUBSPECIALTIES.length)}`);
  console.log(`GAP (0 docs):         ${String(summary.GAP).padStart(3)}  ${barChart(summary.GAP, SUBSPECIALTIES.length)}`);
  if (summary.errored) console.log(`Errored:              ${summary.errored}`);

  const today = new Date().toISOString().slice(0, 10);
  const ts = Date.now();
  const filename = `rag/coverage_audit_${today}_${ts}.json`;
  writeFileSync(filename, JSON.stringify({ generated_at: new Date().toISOString(), summary, results }, null, 2));
  console.log(`\nSaved snapshot → ${filename}`);

  const gaps = results.filter(r => r.status === "GAP").map(r => r.name);
  if (gaps.length > 0) {
    console.log(`\nTop GAP subspecialties (zero retrievable coverage):`);
    gaps.slice(0, 20).forEach(g => console.log(`  - ${g}`));
    if (gaps.length > 20) console.log(`  ... and ${gaps.length - 20} more`);
  }
}

function barChart(n, max) {
  const width = 40;
  const filled = Math.round((n / max) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
