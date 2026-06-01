#!/usr/bin/env node
// =============================================================================
// rag/ingest_extracted_chunks.mjs
// -----------------------------------------------------------------------------
// Consumes JSON output produced by the `guideline-researcher` sub-agent,
// embeds each chunk's `content` with OpenAI, and inserts rows into the
// existing `documents` table in Supabase.
//
// PUBLIC-DOMAIN ONLY. This script is the bulk-ingest path. It refuses to run
// on anything not on the public-domain allowlist (CDC, USPSTF, NIH/NHLBI/NCI,
// FDA DailyMed, MedlinePlus, WHO, NICE). Privately copyrighted guidelines
// (KDIGO/AHA/ACC/IDSA/ADA/ATS/CHEST/AASLD/ASCO/ACR/AAN/etc.) must go through
// the v2 per-user upload path (see v2_user_upload_spec.md), NOT this script.
//
// Expected input JSON (one file per guideline, produced by the sub-agent):
//   [
//     {
//       "id": "uspstf-statin-primary-prevention-2022-rec-1",
//       "source": "USPSTF",
//       "source_url": "https://www.uspreventiveservicestaskforce.org/...",
//       "title": "Statin Use for the Primary Prevention of CVD in Adults",
//       "year": 2022,
//       "section": "Recommendation",
//       "content": "The USPSTF recommends that adults aged 40 to 75 years...",
//       "recommendation_grade": "B",
//       "topic_tags": ["primary prevention","cardiovascular","statin","lipids"],
//       "teaching_angle": "Use for primary-prevention statin decisions in ...",
//       "confidence": "high",
//       "limitations": "Does not address adults >75 without prior CVD events."
//     },
//     ...
//   ]
//
// Usage:
//   node rag/ingest_extracted_chunks.mjs rag/extracted/uspstf_statin_2022.json
//   node rag/ingest_extracted_chunks.mjs rag/extracted/        # all .json files in dir
//
// Environment:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// ---------- config -----------------------------------------------------------
const PUBLIC_DOMAIN_SOURCES = new Set([
  // US federal -> public domain by default
  "CDC", "USPSTF", "NIH", "NHLBI", "NCI", "NIDDK", "NIAID", "NIMH",
  "FDA", "DAILYMED", "MEDLINEPLUS", "AHRQ", "VA", "DOD",
  // Intergovernmental
  "WHO",        // CC-BY-IGO 3.0 — attribution required, captured via source field
  // UK Crown copyright with free-reuse for non-commercial education
  "NICE",
]);

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIM = 1536;
const BATCH = 16;

// ---------- env --------------------------------------------------------------
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  console.error("Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY");
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------- helpers ----------------------------------------------------------
function loadInputs(arg) {
  const stat = fs.statSync(arg);
  if (stat.isFile()) return [arg];
  if (stat.isDirectory()) {
    return fs.readdirSync(arg)
      .filter(f => f.endsWith(".json"))
      .map(f => path.join(arg, f));
  }
  throw new Error(`Not a file or dir: ${arg}`);
}

function assertPublicDomain(chunk, filename) {
  const src = String(chunk.source || "").toUpperCase().trim();
  if (!PUBLIC_DOMAIN_SOURCES.has(src)) {
    throw new Error(
      `REFUSED: chunk in ${filename} has source="${chunk.source}", which is not on the public-domain allowlist. ` +
      `Privately copyrighted guidelines must go through the v2 per-user upload path. ` +
      `Allowed: ${[...PUBLIC_DOMAIN_SOURCES].join(", ")}`
    );
  }
}

async function embed(texts) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenAI embed failed ${r.status}: ${t}`);
  }
  const j = await r.json();
  return j.data.map(d => d.embedding);
}

// Map sub-agent grades to numeric quality boost (used at retrieval time
// alongside source_tier; we just store the grade string and let the
// existing composite ranking do its thing).
function normalizeGrade(g) {
  if (!g) return null;
  return String(g).trim().toUpperCase().slice(0, 8);
}

// ---------- core -------------------------------------------------------------
async function ingestFile(filepath) {
  console.log(`\n→ ${filepath}`);
  const raw = fs.readFileSync(filepath, "utf8");
  let chunks;
  try {
    chunks = JSON.parse(raw);
  } catch (e) {
    console.error(`  ✗ JSON parse error: ${e.message}`);
    return { inserted: 0, skipped: 0, errors: 1 };
  }
  if (!Array.isArray(chunks)) {
    console.error("  ✗ Expected top-level JSON array.");
    return { inserted: 0, skipped: 0, errors: 1 };
  }

  // Hard guard — refuses to ingest anything off the public-domain allowlist.
  for (const c of chunks) assertPublicDomain(c, filepath);

  let inserted = 0, skipped = 0, errors = 0;

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    let embeddings;
    try {
      embeddings = await embed(batch.map(c => c.content));
    } catch (e) {
      console.error(`  ✗ embed batch ${i}: ${e.message}`);
      errors += batch.length;
      continue;
    }

    for (let k = 0; k < batch.length; k++) {
      const c = batch[k];
      const emb = embeddings[k];
      if (!emb || emb.length !== EMBED_DIM) {
        console.error(`  ✗ bad embedding dim for ${c.id}`);
        errors++; continue;
      }

      // --- documents row -------------------------------------------------
      // One "document" per guideline section. We key dedupe on the
      // sub-agent's stable `id` via the synthetic pmcid slot (string),
      // since pmid is numeric-only in our schema.
      const docRow = {
        pmid: null,
        pmcid: `guideline:${c.id}`,                    // dedupe key
        title: c.title || c.section || c.id,
        journal: c.source,                              // e.g. "USPSTF"
        year: c.year || null,
        source: "guideline",                            // taxonomy bucket
        source_tier: 1,                                 // guidelines = tier 1
        is_landmark_trial: false,
        rcr: null,
        citation_count: null,
        url: c.source_url || null,
        meta: {
          guideline_source: c.source,
          section: c.section || null,
          recommendation_grade: normalizeGrade(c.recommendation_grade),
          topic_tags: c.topic_tags || [],
          teaching_angle: c.teaching_angle || null,
          confidence: c.confidence || null,
          limitations: c.limitations || null,
          extracted_by: "guideline-researcher-subagent",
          ingest_script: "ingest_extracted_chunks.mjs",
        },
      };

      const { data: doc, error: docErr } = await supa
        .from("documents")
        .upsert(docRow, { onConflict: "pmcid" })
        .select("id")
        .single();

      if (docErr) {
        console.error(`  ✗ upsert doc ${c.id}: ${docErr.message}`);
        errors++; continue;
      }

      // --- chunk row -----------------------------------------------------
      // Treat each extracted guideline section as a single chunk. The
      // sub-agent has already done semantic chunking for us.
      const chunkRow = {
        document_id: doc.id,
        chunk_index: 0,
        section: c.section || "Recommendation",
        content: c.content,
        embedding: emb,
        meta: {
          recommendation_grade: docRow.meta.recommendation_grade,
          topic_tags: docRow.meta.topic_tags,
          teaching_angle: docRow.meta.teaching_angle,
        },
      };

      // Replace any prior chunks for this doc so re-ingest is idempotent.
      await supa.from("document_chunks").delete().eq("document_id", doc.id);

      const { error: chErr } = await supa
        .from("document_chunks")
        .insert(chunkRow);

      if (chErr) {
        console.error(`  ✗ insert chunk ${c.id}: ${chErr.message}`);
        errors++; continue;
      }

      inserted++;
    }
    process.stdout.write(`  …${Math.min(i + BATCH, chunks.length)}/${chunks.length}\r`);
  }

  console.log(`  ✓ ${inserted} inserted, ${skipped} skipped, ${errors} errors`);
  return { inserted, skipped, errors };
}

// ---------- main -------------------------------------------------------------
const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node rag/ingest_extracted_chunks.mjs <file-or-dir>");
  process.exit(1);
}

const files = loadInputs(arg);
console.log(`Found ${files.length} JSON file(s).`);

let totals = { inserted: 0, skipped: 0, errors: 0 };
for (const f of files) {
  const r = await ingestFile(f);
  totals.inserted += r.inserted;
  totals.skipped += r.skipped;
  totals.errors += r.errors;
}

console.log(`\n═══ DONE ═══`);
console.log(`  inserted: ${totals.inserted}`);
console.log(`  skipped:  ${totals.skipped}`);
console.log(`  errors:   ${totals.errors}`);
