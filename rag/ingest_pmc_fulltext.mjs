#!/usr/bin/env node
/**
 * Chalk Talk — PMC OA full-text ingestion
 * For high-value papers (landmarks/tier 1/RCR>2) with pmcid, fetch JATS XML,
 * parse sections, chunk to ~500 tokens, embed each chunk separately.
 * Existing abstract chunks preserved; new section chunks added with chunk_index > 0.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;
const NCBI_KEY     = process.env.NCBI_API_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error("Missing required env vars.");
  process.exit(1);
}

const REQUEST_DELAY_MS = NCBI_KEY ? 110 : 350;
const TARGET_TOKENS = 500;
const MAX_CHUNKS_PER_DOC = 20;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchPmcXml(pmcid) {
  const id = String(pmcid).replace(/^PMC/i, "");
  await sleep(REQUEST_DELAY_MS);
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${id}&retmode=xml${NCBI_KEY ? `&api_key=${NCBI_KEY}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.text();
}

function cleanText(s) {
  return (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x[0-9a-f]+;/gi, " ").replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ").trim();
}
function pick(s, re) { const x = re.exec(s); return x ? x[1].trim() : ""; }
function pickAll(s, re) { const out = []; let m; while ((m = re.exec(s)) !== null) out.push(m[1]); return out; }

function parseJATS(xml) {
  const sections = [];
  // Match top-level <sec> with optional sec-type
  const secRe = /<sec\b[^>]*?(?:sec-type="([^"]*)")?[^>]*?>([\s\S]*?)<\/sec>/g;
  let m;
  while ((m = secRe.exec(xml)) !== null) {
    const type = (m[1] || "").toLowerCase() || "section";
    const body = m[2];
    const title = cleanText(pick(body, /<title[^>]*>([\s\S]*?)<\/title>/)) || type;
    const paragraphs = pickAll(body, /<p\b[^>]*>([\s\S]*?)<\/p>/g)
      .map(p => cleanText(p))
      .filter(p => p.length > 40);
    if (paragraphs.length) sections.push({ type, title, paragraphs });
  }
  return sections;
}

function chunkSections(sections, targetTokens = TARGET_TOKENS) {
  const chunks = [];
  for (const sec of sections) {
    let current = [];
    let currentTokens = 0;
    for (const p of sec.paragraphs) {
      const pTokens = Math.ceil(p.length / 4);
      if (currentTokens + pTokens > targetTokens * 1.5 && current.length > 0) {
        chunks.push({ section: sec.type, title: sec.title, text: current.join("\n\n") });
        current = [];
        currentTokens = 0;
      }
      current.push(p);
      currentTokens += pTokens;
    }
    if (current.length) chunks.push({ section: sec.type, title: sec.title, text: current.join("\n\n") });
  }
  return chunks;
}

async function embed(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text, dimensions: 1536 }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  return (await res.json()).data[0].embedding;
}

async function ingestDoc(doc) {
  // Skip if already has non-abstract chunks
  const { data: existing } = await sb
    .from("document_chunks").select("id").eq("document_id", doc.id).neq("section", "abstract").limit(1);
  if (existing && existing.length > 0) return { status: "already_done", added: 0 };

  const xml = await fetchPmcXml(doc.pmcid);
  if (!xml) return { status: "fetch_failed", added: 0 };
  if (xml.indexOf("<article") === -1) return { status: "no_article_xml", added: 0 };

  const sections = parseJATS(xml);
  if (!sections.length) return { status: "no_sections", added: 0 };

  let chunks = chunkSections(sections);
  if (!chunks.length) return { status: "no_chunks", added: 0 };
  if (chunks.length > MAX_CHUNKS_PER_DOC) chunks = chunks.slice(0, MAX_CHUNKS_PER_DOC);

  const { data: maxRow } = await sb
    .from("document_chunks").select("chunk_index").eq("document_id", doc.id)
    .order("chunk_index", { ascending: false }).limit(1);
  let nextIndex = (maxRow && maxRow[0]) ? maxRow[0].chunk_index + 1 : 1;

  let added = 0;
  for (const c of chunks) {
    let emb;
    try { emb = await embed(c.text); } catch (e) { continue; }
    const { error } = await sb.from("document_chunks").insert({
      document_id: doc.id, chunk_index: nextIndex++, section: c.section,
      text: c.text, tokens: Math.ceil(c.text.length / 4), embedding: emb,
    });
    if (!error) added++;
  }
  return { status: "ok", added };
}

async function main() {
  // High-value docs only — landmark OR tier 1 OR RCR > 2 — with a pmcid
  const { data: docs, error } = await sb
    .from("documents")
    .select("id, pmid, pmcid, title")
    .not("pmcid", "is", null)
    .or("is_landmark_trial.eq.true,source_tier.lte.2,rcr.gt.2");
  if (error) { console.error("Query failed:", error.message); process.exit(1); }
  console.log(`Found ${docs.length} high-value docs with pmcid to full-text-ingest\n`);

  let ok=0, done=0, fail=0, totalChunks=0;
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    process.stdout.write(`[${String(i+1).padStart(3)}/${docs.length}] PMC${d.pmcid} ${(d.title||'').slice(0,55).padEnd(55)} `);
    const result = await ingestDoc(d);
    if (result.status === "ok") { ok++; totalChunks += result.added; console.log(`✓ +${result.added} chunks`); }
    else if (result.status === "already_done") { done++; console.log(`(already done)`); }
    else { fail++; console.log(`✗ ${result.status}`); }
  }
  console.log(`\nDone. ok=${ok} (${totalChunks} chunks), already_done=${done}, failed=${fail}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
