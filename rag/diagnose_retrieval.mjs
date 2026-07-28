#!/usr/bin/env node
/**
 * RETRIEVAL DIAGNOSTIC — capture the ACTUAL similarity scores behind the D-1 failures.
 *
 *   node rag/diagnose_retrieval.mjs
 *   node rag/diagnose_retrieval.mjs --topic "spontaneous bacterial peritonitis"
 *
 * WHY. Codex, 2026-07-28: "Production already has an absolute similarity floor of 0.30, so B is not
 * 'add a floor'. First capture the actual scores and matched facet queries from the DKA, hypercalcemia
 * and hyperkalemia failures, then propose a calibrated relevance gate."
 *
 * He is right, and my earlier recommendation was wrong: worker.js:506 defaults min_similarity to 0.30
 * and index.html:6780 sets ABS_FLOOR = 0.30. **D-1 happened through that gate**, so the question is not
 * whether to have one but why the gate admitted DCCT for a DKA query.
 *
 * THE HYPOTHESIS THIS TESTS. Production does not embed the bare topic. retrieveRAG fans out into facet
 * sub-queries (Jenni 2026-07-10) so that mechanism / diagnosis / treatment / outcomes sections each get
 * grounding:
 *
 *     "<topic>"
 *     "<topic> pathophysiology and mechanism"
 *     "<topic> diagnosis, workup and diagnostic testing"
 *     "<topic> treatment, management and guideline recommendations"
 *     ...
 *
 * For an ACUTE topic inside a chronic disease area, the treatment facet is the problem: "diabetic
 * ketoacidosis treatment, management and guideline recommendations" is embedding-close to UKPDS and
 * ACCORD, because those genuinely ARE diabetes treatment-and-management trials. Each off-topic chunk may
 * therefore clear 0.30 honestly, on a facet the user never asked for.
 *
 * If that is what the scores show, the fix is not a higher global floor — that would starve legitimate
 * topics, which is exactly why ABS_FLOOR is low. It is per-facet gating, metadata filtering on the
 * source_tier / is_landmark_trial columns the table ALREADY carries, or reranking.
 *
 * This script only READS. It makes no change to the corpus or the app.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import "./loadenv.mjs";

const ARGV = process.argv.slice(2);
const argVal = (k, d) => { const i = ARGV.indexOf(k); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error("✖ Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OPENAI_API_KEY.");
  console.error("  NOTE: the Supabase service-role key and OpenAI key were both flagged for rotation.");
  process.exit(1);
}

// production values, read from the app so this cannot drift
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ABS_FLOOR = parseFloat((html.match(/var ABS_FLOOR = \(typeof opts\.minSim === "number"\) \? opts\.minSim : ([\d.]+)/) || [])[1] || "0.30");

const TOPICS = argVal("--topic", "") ? [argVal("--topic", "")] : [
  "diabetic ketoacidosis",              // scored 0/8 relevant in the click tests
  "hypercalcemia of malignancy",        // scored 0/8
  "hyperkalemia",                       // scored 1/8 — the only one with landmark trials present
  "heart failure with reduced ejection fraction",  // CONTROL: should be well covered
];

// the exact facet expansion production uses
const facets = (t) => [
  t,
  t + " pathophysiology and mechanism",
  t + " diagnosis, workup and diagnostic testing",
  t + " treatment, management and guideline recommendations",
];

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function embed(text) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text, dimensions: 1536 }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}`);
  return (await r.json()).data[0].embedding;
}

// Is this chunk plausibly ON TOPIC? Deliberately crude and CONSERVATIVE — it exists only to sort the
// output for human reading, never to score anything. A physician reads the titles and decides.
const onTopicRe = {
  "diabetic ketoacidosis": /ketoacid|DKA|hyperglycemic cris|HHS|hyperosmolar/i,
  "hypercalcemia of malignancy": /hypercalc|calcium|PTHrP|bisphosphonate|zoledron|denosumab|parathyroid/i,
  "hyperkalemia": /hyperkalemi|potassium|patiromer|zirconium|kayexalate|polystyrene/i,
  "heart failure with reduced ejection fraction": /heart failure|HFrEF|ejection fraction|sacubitril|SGLT2|dapagliflozin|empagliflozin/i,
};

console.log(`Production ABS_FLOOR read from index.html: ${ABS_FLOOR}\n`);
const report = { abs_floor: ABS_FLOOR, when: new Date().toISOString(), topics: {} };

for (const topic of TOPICS) {
  console.log("═".repeat(96));
  console.log(`TOPIC: ${topic}`);
  console.log("═".repeat(96));
  const re = onTopicRe[topic] || /$^/;
  report.topics[topic] = { facets: {} };

  for (const q of facets(topic)) {
    let emb;
    try { emb = await embed(q); } catch (e) { console.log(`  [embed failed] ${q}: ${e.message}`); continue; }
    const { data, error } = await sb.rpc("match_chunks", {
      query_embedding: emb, match_count: 12, min_similarity: ABS_FLOOR,
    });
    if (error) { console.log(`  [rpc failed] ${q}: ${error.message}`); continue; }
    const rows = (data || []).map(c => ({
      sim: +(c.similarity || 0).toFixed(3),
      title: (c.title || c.source || "(untitled)").slice(0, 76),
      tier: c.source_tier ?? null,
      landmark: !!c.is_landmark_trial,
      onTopic: re.test(String(c.title || "") + " " + String(c.text || "")),
    }));
    report.topics[topic].facets[q] = rows;

    const rel = rows.filter(r => r.onTopic).length;
    console.log(`\n  FACET: "${q}"`);
    console.log(`    returned ${rows.length} · plausibly on-topic ${rel}/${rows.length}` +
                (rows.length ? ` · sim ${rows[rows.length-1].sim}–${rows[0].sim}` : ""));
    for (const r of rows.slice(0, 8)) {
      console.log(`      ${r.onTopic ? "✓" : "✗"} ${String(r.sim).padEnd(6)} ${r.landmark ? "[LMK]" : "     "} ${r.tier != null ? "t"+r.tier : "  "} ${r.title}`);
    }
  }
}

try { mkdirSync("rag/runs", { recursive: true }); } catch {}
const out = `rag/runs/retrieval-diagnostic-${new Date().toISOString().slice(0,16).replace(/[:T]/g,"-")}.json`;
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

console.log("\n" + "═".repeat(96));
console.log("WHAT TO LOOK FOR");
console.log("═".repeat(96));
console.log("  1. Which FACET pulled the off-topic papers in. If it is the treatment/management facet,");
console.log("     the expansion is the mechanism and a higher global floor is the wrong lever.");
console.log("  2. The score GAP between on-topic and off-topic hits. If off-topic chunks score 0.45 while");
console.log("     on-topic ones score 0.42, no single global threshold can separate them and the answer is");
console.log("     metadata filtering or reranking, not calibration.");
console.log("  3. The CONTROL topic (HFrEF). If it scores similarly to the failures, similarity is not");
console.log("     carrying the signal we assumed it was.");
console.log("  4. Whether off-topic hits are is_landmark_trial=true. The table already has that column —");
console.log("     if the noise is overwhelmingly landmark trials on acute topics, a metadata filter is a");
console.log("     one-line change with no recall cost on chronic topics.");
console.log(`\n-> ${out}`);
