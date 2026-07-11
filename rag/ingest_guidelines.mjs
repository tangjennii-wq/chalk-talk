#!/usr/bin/env node
/**
 * Chalk Talk — Guideline summary ingestion into the vector store.
 *
 * WHY THIS EXISTS
 * The GUIDELINES object in index.html holds 197 society-guideline entries, each with a short
 * `keys` summary. Until now those were surfaced ONLY by keyword-matching the topic string to a
 * specialty (getGuidelinesForTopic). That had two failure modes:
 *   1. No keyword match  -> the model got ZERO guideline context, silently.
 *   2. Coarse matching   -> a nephrology topic pulled ALL 9 nephrology guidelines, relevant or not,
 *                           while a semantically-adjacent guideline in another specialty was missed.
 * Embedding each guideline summary makes them semantically retrievable, so they flow through the
 * same facet query-expansion as the PubMed abstracts and land only when actually relevant.
 *
 * COPYRIGHT
 * We embed ONLY the original telegraphic summaries authored for this project (factual content:
 * thresholds, drug names, trial names, targets — not copyrightable under Feist), plus public
 * bibliographic metadata (name, year, society, public URL). NO guideline full text, PDF, or verbatim
 * recommendation prose is ingested. This preserves the copyright position stated in index.html.
 *
 * IDEMPOTENT: deletes and re-inserts everything with source='guideline'.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... node rag/ingest_guidelines.mjs
 *
 * Regenerate rag/guidelines_extracted.json from index.html first if GUIDELINES changed:
 *   node rag/extract_guidelines.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error("Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY");
  process.exit(1);
}

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM   = 1536;
const BATCH           = 64;   // embeddings API takes an array

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const entries = JSON.parse(readFileSync("rag/guidelines_extracted.json", "utf8"));

// Society acronym from the guideline name (e.g. "KDIGO 2024 CKD..." -> "KDIGO"). Used as `journal`
// so the citation chip renders a recognizable society label.
function societyOf(name) {
  const m = String(name || "").match(/\b([A-Z][A-Z0-9]{1,}(?:\/[A-Z0-9]{2,})*)\b/);
  return m ? m[1] : null;
}

// The embedded text. Includes the guideline name + society + specialty so a topic query like
// "IgA nephropathy treatment" can reach "KDIGO 2024 Glomerular Diseases".
function chunkText(e) {
  return [
    `${e.name} (${e.year})`,
    e.specialty ? `Specialty: ${e.specialty}` : "",
    "Key recommendations (summary):",
    e.keys,
  ].filter(Boolean).join("\n");
}

async function embedBatch(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, dimensions: EMBEDDING_DIM }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function main() {
  console.log(`Guideline summaries to ingest: ${entries.length}`);
  console.log(`Embedding: ${EMBEDDING_MODEL} (${EMBEDDING_DIM}-dim)`);

  // ── Clean slate for source='guideline' (chunks first, then docs) ──
  const { data: olds, error: selErr } = await sb.from("documents").select("id").eq("source", "guideline");
  if (selErr) { console.error("select old:", selErr.message); process.exit(1); }
  if (olds && olds.length) {
    const ids = olds.map((d) => d.id);
    for (let i = 0; i < ids.length; i += 100) {
      await sb.from("document_chunks").delete().in("document_id", ids.slice(i, i + 100));
    }
    await sb.from("documents").delete().eq("source", "guideline");
    console.log(`Cleared ${ids.length} previous guideline docs.`);
  }

  let ins = 0, skip = 0;
  for (let i = 0; i < entries.length; i += BATCH) {
    const slice = entries.slice(i, i + BATCH);
    const texts = slice.map(chunkText);

    let embs;
    try { embs = await embedBatch(texts); }
    catch (e) { console.error(`embed batch @${i}: ${e.message}`); skip += slice.length; continue; }

    for (let j = 0; j < slice.length; j++) {
      const e = slice[j];
      if (!e.keys || e.keys.length < 30) { skip++; continue; }

      const payload = {
        source: "guideline",
        license: "original_summary",           // our own factual summary, not guideline text
        source_tier: 1,                        // guideline = top evidence tier
        journal_rank: 1,                       // treat societies as elite-tier sources
        title: e.name,
        authors: null,
        journal: societyOf(e.name) || e.specialty || null,
        year: e.year || null,
        published_date: e.year ? `${e.year}-01-01` : null,
        publication_type: "Practice Guideline",
        pmid: null, pmcid: null, doi: null,
        url: e.url || null,
        abstract: e.keys,
        rcr: null, citation_count: null, is_landmark_trial: false,
        raw_metadata: { specialty: e.specialty, access: e.access, kind: "guideline_summary" },
        updated_at: new Date().toISOString(),
      };

      const { data: doc, error: dErr } = await sb.from("documents").insert(payload).select("id").single();
      if (dErr) { console.error(`doc "${e.name}": ${dErr.message}`); skip++; continue; }

      const txt = texts[j];
      const { error: cErr } = await sb.from("document_chunks").insert({
        document_id: doc.id,
        chunk_index: 0,
        section: "guideline_recommendations",
        text: txt,
        tokens: Math.ceil(txt.length / 4),
        embedding: embs[j],
      });
      if (cErr) { console.error(`chunk "${e.name}": ${cErr.message}`); skip++; continue; }
      ins++;
    }
    console.log(`  ${Math.min(i + BATCH, entries.length)}/${entries.length} …`);
  }

  console.log(`\nDone. Inserted ${ins}, skipped ${skip}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
