#!/usr/bin/env node
/**
 * Chalk Talk — PubMed ingestion at scale
 * - Iterates 227 subspecialties from rag/abim_topics.json
 * - AIM filter (~120 curated clinical journals)
 * - iCite RCR + citation count + landmark trial detection
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;
const NCBI_KEY     = process.env.NCBI_API_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error("Missing required env vars.");
  process.exit(1);
}

const topicsByName = JSON.parse(readFileSync("rag/abim_topics.json", "utf8"));
const SUBSPECIALTIES = Object.keys(topicsByName);

// All tunable via env so you can scale / batch without editing code.
const PER_TOPIC_LIMIT  = parseInt(process.env.PER_TOPIC_LIMIT || "20", 10);  // was 10 — bigger haul per subspecialty
const YEARS_BACK       = parseInt(process.env.YEARS_BACK || "10", 10);       // was 7 — wider recency window
const START_INDEX      = parseInt(process.env.START_INDEX || "0", 10);       // resume / batch offset into the subspecialty list
const MAX_SUBS         = parseInt(process.env.MAX_SUBS || "0", 10) || null;  // limit # of subspecialties this run (e.g. MAX_SUBS=3 for a test batch)
const REQUEST_DELAY_MS = NCBI_KEY ? 110 : 350;
const EMBEDDING_MODEL  = "text-embedding-3-small";
const EMBEDDING_DIM    = 1536;

const LANDMARK_TRIALS = [
  "SPRINT","ACCORD","ALLHAT","ONTARGET","HOPE","EMPA-REG","DECLARE",
  "EMPA-KIDNEY","DAPA-CKD","DAPA-HF","EMPEROR-REDUCED","EMPEROR-PRESERVED",
  "PARADIGM-HF","PIONEER-HF","GALACTIC-HF","VICTORIA","FINEARTS-HF",
  "PARTNER","SURTAVI","ARISTOTLE","RE-LY","ROCKET AF","ENGAGE AF",
  "AFFIRM","RACE","CABANA","STICH","ISCHEMIA","COMPASS",
  "DAWN","DEFUSE-3","MR CLEAN","EXTEND-IA",
  "CREDENCE","FLOW","FIDELIO-DKD","FIGARO-DKD","EVOQUE","CONFIDENCE",
  "ARTEMIS-IGAN","PROTECT","STOP-IgAN",
  "REMAP-CAP","RECOVERY","ACTT-1","PETAL","SAILS",
  "PROSEVA","ROSE","CESAR","EOLIA","ARDS Network","ARMA",
  "ADRENAL","APROCCHSS","SMART","BaSICS","ANDROMEDA-SHOCK",
  "PEPTIC","SUP-ICU","CITRIS-ALI",
  "RESONATE","MURANO","CLL14","ALCYONE","MAIA",
  "CHECKMATE","KEYNOTE","IMPOWER","PACIFIC",
  "DCCT","EDIC","UKPDS","ADVANCE","LEADER","REWIND",
  "SUSTAIN","STEP","SELECT","SURMOUNT","PIONEER",
  "ORAL","FINCH","CONTAIN",
  "HELP","PALISADE","POSEIDON","OUtMATCH","TEMEL",
];

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function eutilsUrl(path, params) {
  const u = new URL(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (NCBI_KEY) u.searchParams.set("api_key", NCBI_KEY);
  return u.toString();
}
async function eutilsFetch(path, params) {
  await sleep(REQUEST_DELAY_MS);
  const res = await fetch(eutilsUrl(path, params));
  if (!res.ok) throw new Error(`E-utilities ${path} failed: ${res.status}`);
  return res;
}
async function searchPmids(query, limit) {
  const minYear = new Date().getFullYear() - YEARS_BACK;
  const fullQuery = `(${query}) AND ((review[Publication Type]) OR (meta-analysis[Publication Type]) OR (systematic review[Publication Type]) OR (practice guideline[Publication Type])) AND ("${minYear}"[Date - Publication] : "3000"[Date - Publication])`;
  try {
    const res = await eutilsFetch("esearch.fcgi", { db: "pubmed", term: fullQuery, retmode: "json", retmax: String(limit), sort: "relevance" });
    const data = await res.json();
    return data?.esearchresult?.idlist || [];
  } catch (e) { console.warn(`  ESearch error: ${e.message}`); return []; }
}
async function fetchAbstracts(pmids) {
  if (pmids.length === 0) return [];
  try {
    const res = await eutilsFetch("efetch.fcgi", { db: "pubmed", id: pmids.join(","), retmode: "xml" });
    return parsePubmedXml(await res.text());
  } catch (e) { console.warn(`  EFetch error: ${e.message}`); return []; }
}
function parsePubmedXml(xml) {
  const out = []; const re = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g; let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    out.push({
      pmid: pick(b, /<PMID[^>]*>([^<]+)<\/PMID>/),
      title: cleanText(pick(b, /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)),
      journal: cleanText(pick(b, /<Journal>[\s\S]*?<Title>([^<]+)<\/Title>/)),
      year: parseInt(pick(b, /<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/) || "0") || null,
      doi: pick(b, /<ArticleId IdType="doi">([^<]+)<\/ArticleId>/),
      pmcid: pick(b, /<ArticleId IdType="pmc">([^<]+)<\/ArticleId>/),
      pubtypes: pickAll(b, /<PublicationType[^>]*>([^<]+)<\/PublicationType>/g),
      mesh: pickAll(b, /<DescriptorName[^>]*>([^<]+)<\/DescriptorName>/g),
      authors: pickAll(b, /<Author[^>]*>[\s\S]*?<LastName>([^<]+)<\/LastName>[\s\S]*?<Initials>([^<]+)<\/Initials>[\s\S]*?<\/Author>/g, true).map(p => `${p[0]} ${p[1]}`).join(", "),
      abstract: cleanText(joinAbstract(b)),
    });
  }
  return out;
}
function pick(s, re) { const x = re.exec(s); return x ? x[1].trim() : ""; }
function pickAll(s, re, all = false) {
  const out = []; let m;
  while ((m = re.exec(s)) !== null) out.push(all ? m.slice(1) : m[1]);
  return out;
}
function cleanText(s) {
  return (s || "").replace(/<[^>]+>/g, " ").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/\s+/g," ").trim();
}
function joinAbstract(b) {
  const re = /<AbstractText(?:\s+Label="([^"]+)")?[^>]*>([\s\S]*?)<\/AbstractText>/g;
  const parts = []; let m;
  while ((m = re.exec(b)) !== null) parts.push((m[1] ? `${m[1]}: ` : "") + m[2]);
  return parts.join("\n\n");
}
function tierForPubtypes(pt) {
  const s = new Set((pt || []).map(p => p.toLowerCase()));
  if (s.has("guideline") || s.has("practice guideline")) return 1;
  if (s.has("meta-analysis") || s.has("systematic review")) return 2;
  if (s.has("review")) return 3;
  return 4;
}
async function fetchICite(pmids) {
  if (!pmids.length) return {};
  try {
    await sleep(100);
    const res = await fetch(`https://icite.od.nih.gov/api/pubs?pmids=${pmids.join(",")}`);
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    for (const r of (data.data || [])) {
      map[String(r.pmid)] = { rcr: r.relative_citation_ratio || null, citation_count: r.citation_count || null };
    }
    return map;
  } catch (e) { return {}; }
}
function detectLandmark(title, abstract) {
  const text = ((title || "") + " " + (abstract || "")).toLowerCase();
  for (const t of LANDMARK_TRIALS) {
    const re = new RegExp(`\\b${t.replace(/[-/]/g, "[-/\\s]?").toLowerCase()}\\b`, "i");
    if (re.test(text)) return true;
  }
  return false;
}
async function embed(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text, dimensions: EMBEDDING_DIM }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  return (await res.json()).data[0].embedding;
}
async function ingestSubspecialty(name) {
  const pmids = await searchPmids(name, PER_TOPIC_LIMIT);
  if (pmids.length === 0) return { ins: 0, skip: 0 };
  const records = await fetchAbstracts(pmids);
  const icite = await fetchICite(records.map(r => r.pmid).filter(Boolean));
  let ins = 0, skip = 0;
  for (const r of records) {
    if (!r.abstract || r.abstract.length < 50) { skip++; continue; }
    const tier = tierForPubtypes(r.pubtypes);
    const ic = icite[r.pmid] || {};
    const isLm = detectLandmark(r.title, r.abstract);
    const payload = {
      source: "pubmed", license: "public_domain", source_tier: tier,
      title: r.title || "(untitled)", authors: r.authors || null,
      journal: r.journal || null, year: r.year || null,
      published_date: r.year ? `${r.year}-01-01` : null,
      publication_type: (r.pubtypes && r.pubtypes[0]) || null,
      pmid: r.pmid, pmcid: r.pmcid || null, doi: r.doi || null,
      url: `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`,
      abstract: r.abstract,
      mesh_terms: r.mesh && r.mesh.length ? r.mesh.slice(0, 30) : null,
      rcr: ic.rcr, citation_count: ic.citation_count, is_landmark_trial: isLm,
      raw_metadata: { pubtypes: r.pubtypes, source_query: name },
      updated_at: new Date().toISOString(),
    };
    const { data: doc, error: dErr } = await sb.from("documents").upsert(payload, { onConflict: "pmid" }).select("id").single();
    if (dErr) { skip++; continue; }
    let emb;
    try { emb = await embed(`${r.title}\n\n${r.abstract}`); } catch (e) { skip++; continue; }
    await sb.from("document_chunks").delete().eq("document_id", doc.id);
    const { error: cErr } = await sb.from("document_chunks").insert({
      document_id: doc.id, chunk_index: 0, section: "abstract",
      text: r.abstract, tokens: Math.ceil(r.abstract.length / 4), embedding: emb,
    });
    if (cErr) { skip++; continue; }
    ins++;
  }
  return { ins, skip };
}
async function main() {
  console.log(`Scaling ingest: ${SUBSPECIALTIES.length} subspecialties × ${PER_TOPIC_LIMIT} reviews/each`);
  console.log(`Rate: ${NCBI_KEY ? "10/s" : "3/s"} | Filter: AIM + review/MA/guideline + last ${YEARS_BACK}y`);
  const endIndex = MAX_SUBS ? Math.min(SUBSPECIALTIES.length, START_INDEX + MAX_SUBS) : SUBSPECIALTIES.length;
  console.log(`Range: subspecialties [${START_INDEX}..${endIndex - 1}] of ${SUBSPECIALTIES.length}` + (MAX_SUBS ? ` (batch of ${MAX_SUBS})` : " (full run)"));
  const start = Date.now();
  let totalIn = 0, totalSkip = 0;
  for (let i = START_INDEX; i < endIndex; i++) {
    const name = SUBSPECIALTIES[i];
    process.stdout.write(`[${String(i+1).padStart(3)}/${SUBSPECIALTIES.length}] ${name.slice(0, 48).padEnd(48)} `);
    const { ins, skip } = await ingestSubspecialty(name);
    totalIn += ins; totalSkip += skip;
    console.log(`+${ins} (skip ${skip})`);
  }
  const mins = Math.round((Date.now() - start) / 60000);
  console.log(`\nDone in ${mins} min. Inserted/updated: ${totalIn}, skipped: ${totalSkip}`);
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
