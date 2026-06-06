#!/usr/bin/env node
/**
 * Chalk Talk — Public-domain guideline auto-ingestion (no manual PDF download).
 *
 * Fetches USPSTF / CDC / NICE / WHO / NIH HTML pages, extracts main content,
 * chunks into ~800-token blocks, embeds via OpenAI, and inserts into Supabase
 * `documents` + `document_chunks` tables — same schema as ingest_pubmed.mjs.
 *
 * Run:
 *   cd ~/Developer/chalk-talk
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... node rag/auto_ingest_guidelines.mjs
 *
 * Cost: ~$0.01 for 30 guidelines (text-embedding-3-small).
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error("Missing env. Need: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;

// ── Guideline targets — public-domain only ──────────────────────────────────
// Each entry: {source, title, url, society, year, topic_hint, type}
// Society = used as a tier-1 boost in match_chunks(); type = "guideline"
const GUIDELINES = [
  // USPSTF
  {source:"uspstf", title:"USPSTF Statin Use for Primary CV Prevention 2022", url:"https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/statin-use-in-adults-preventive-medication", society:"USPSTF", year:2022, topic_hint:"hyperlipidemia, ASCVD prevention, primary prevention, statin", type:"guideline"},
  {source:"uspstf", title:"USPSTF Breast Cancer Screening 2024",                url:"https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/breast-cancer-screening", society:"USPSTF", year:2024, topic_hint:"breast cancer screening, mammography", type:"guideline"},
  {source:"uspstf", title:"USPSTF Lung Cancer Screening 2021",                  url:"https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/lung-cancer-screening", society:"USPSTF", year:2021, topic_hint:"lung cancer screening, LDCT", type:"guideline"},
  {source:"uspstf", title:"USPSTF Aspirin for Primary CV Prevention 2022",      url:"https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/aspirin-to-prevent-cardiovascular-disease-preventive-medication", society:"USPSTF", year:2022, topic_hint:"aspirin primary prevention ASCVD", type:"guideline"},
  {source:"uspstf", title:"USPSTF Colorectal Cancer Screening 2021",            url:"https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/colorectal-cancer-screening", society:"USPSTF", year:2021, topic_hint:"colorectal cancer screening, colonoscopy, FIT", type:"guideline"},
  {source:"uspstf", title:"USPSTF Hypertension Screening 2021",                 url:"https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/hypertension-in-adults-screening", society:"USPSTF", year:2021, topic_hint:"hypertension screening", type:"guideline"},
  {source:"uspstf", title:"USPSTF Tobacco Cessation 2021",                       url:"https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/tobacco-use-in-adults-and-pregnant-women-counseling-and-interventions", society:"USPSTF", year:2021, topic_hint:"tobacco cessation smoking counseling", type:"guideline"},
  // CDC
  {source:"cdc", title:"CDC STI Treatment Guidelines 2021",                     url:"https://www.cdc.gov/std/treatment-guidelines/default.htm", society:"CDC", year:2021, topic_hint:"STI sexually transmitted infections gonorrhea chlamydia syphilis", type:"guideline"},
  {source:"cdc", title:"CDC Adult Immunization Schedule 2025",                  url:"https://www.cdc.gov/vaccines/schedules/hcp/imz/adult.html", society:"CDC", year:2025, topic_hint:"adult immunizations vaccines ACIP", type:"guideline"},
  {source:"cdc", title:"CDC Latent TB Testing and Treatment",                   url:"https://www.cdc.gov/tb/topic/treatment/ltbi.htm", society:"CDC", year:2024, topic_hint:"latent tuberculosis LTBI 3HP 4R", type:"guideline"},
  {source:"cdc", title:"CDC C. difficile Clinician Resource",                   url:"https://www.cdc.gov/cdiff/clinicians/index.html", society:"CDC", year:2024, topic_hint:"clostridioides difficile CDI", type:"guideline"},
  {source:"cdc", title:"CDC Sepsis Clinical Tools",                              url:"https://www.cdc.gov/sepsis/clinicaltools/index.html", society:"CDC", year:2024, topic_hint:"sepsis recognition surveillance", type:"guideline"},
  // NICE
  {source:"nice", title:"NICE CKD Assessment and Management NG203",             url:"https://www.nice.org.uk/guidance/ng203", society:"NICE", year:2021, topic_hint:"chronic kidney disease CKD assessment", type:"guideline"},
  {source:"nice", title:"NICE Heart Failure NG106",                              url:"https://www.nice.org.uk/guidance/ng106", society:"NICE", year:2018, topic_hint:"heart failure management chronic HF", type:"guideline"},
  {source:"nice", title:"NICE COPD Management NG115",                            url:"https://www.nice.org.uk/guidance/ng115", society:"NICE", year:2019, topic_hint:"COPD exacerbation management", type:"guideline"},
];

const CHUNK_TOKENS = 800;
const CHUNK_OVERLAP = 100;
const CHARS_PER_TOKEN = 4;
const CHUNK_CHARS = CHUNK_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = CHUNK_OVERLAP * CHARS_PER_TOKEN;

// ── Helpers ─────────────────────────────────────────────────────────────────
function stripTags(html) {
  // Strip <script> + <style> contents entirely
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
             .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
             .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  // Strip nav/footer/header common containers
  html = html.replace(/<(nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Replace tags with spaces
  html = html.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  html = html.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
             .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&[a-z0-9#]+;/gi, " ");
  // Collapse whitespace
  return html.replace(/\s+/g, " ").trim();
}

function chunkText(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += (CHUNK_CHARS - OVERLAP_CHARS)) {
    chunks.push(text.slice(i, i + CHUNK_CHARS).trim());
    if (i + CHUNK_CHARS >= text.length) break;
  }
  return chunks.filter(c => c.length > 200); // Drop tiny tail chunks
}

async function embed(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {"Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}`},
    body: JSON.stringify({model: EMBEDDING_MODEL, input: text})
  });
  if (!res.ok) throw new Error(`OpenAI embed failed: ${res.status}`);
  return (await res.json()).data[0].embedding;
}

async function fetchPage(url) {
  const res = await fetch(url, {headers: {"User-Agent": "ChalkTalkBot/1.0 (educational/research)"}});
  if (!res.ok) throw new Error(`Fetch ${url} → ${res.status}`);
  return await res.text();
}

// ── Main loop ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`Ingesting ${GUIDELINES.length} guidelines...\n`);
  let ok = 0, skip = 0, errs = [];
  for (const g of GUIDELINES) {
    process.stdout.write(`  [${g.source}] ${g.title.slice(0, 50)}... `);
    try {
      const html = await fetchPage(g.url);
      const text = stripTags(html);
      if (text.length < 500) {
        console.log(`SKIP (too short: ${text.length} chars)`);
        skip++;
        continue;
      }
      const chunks = chunkText(text);
      if (!chunks.length) {
        console.log(`SKIP (no chunks)`);
        skip++;
        continue;
      }

      // Upsert document
      const docId = `${g.source}:${g.title.toLowerCase().replace(/\s+/g, "-").slice(0, 80)}`;
      const docPayload = {
        external_id: docId,
        title: g.title,
        source: g.source,
        society: g.society,
        year: g.year,
        url: g.url,
        type: g.type,
        topic_hint: g.topic_hint,
        n_chunks: chunks.length
      };
      const {data: doc, error: dErr} = await sb.from("documents").upsert(docPayload, {onConflict: "external_id"}).select("id").single();
      if (dErr) { errs.push({url: g.url, err: dErr.message}); console.log(`ERR doc: ${dErr.message}`); continue; }

      // Clear old chunks for this doc + insert fresh
      await sb.from("document_chunks").delete().eq("document_id", doc.id);
      for (let i = 0; i < chunks.length; i++) {
        const emb = await embed(chunks[i]);
        await sb.from("document_chunks").insert({
          document_id: doc.id,
          chunk_index: i,
          text: chunks[i],
          tokens: Math.ceil(chunks[i].length / CHARS_PER_TOKEN),
          embedding: emb
        });
      }
      console.log(`OK (${chunks.length} chunks)`);
      ok++;
    } catch (e) {
      console.log(`ERR: ${e.message}`);
      errs.push({url: g.url, err: e.message});
    }
  }
  console.log(`\n✓ Done. ${ok} ingested, ${skip} skipped, ${errs.length} errors.`);
  if (errs.length) errs.forEach(e => console.log(`  ✗ ${e.url}: ${e.err}`));
}

main().catch(e => { console.error(e); process.exit(1); });
