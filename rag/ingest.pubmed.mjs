#!/usr/bin/env node
/**
 * Chalk Talk — PubMed ingestion with quality signals
 * Adds: NIH iCite RCR + citation count + landmark trial detection
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

const TOPICS = [
  { query: "acute kidney injury", tier: 3 },
];

const PER_TOPIC_LIMIT  = 20;
const YEARS_BACK       = 7;
const REQUEST_DELAY_MS = NCBI_KEY ? 110 : 350;
const EMBEDDING_MODEL  = "text-embedding-3-small";
const EMBEDDING_DIM    = 1536;

// Landmark IM trials — starter list. Expand by editing this array.
const LANDMARK_TRIALS = [
  // Cards
  "SPRINT", "ACCORD", "ALLHAT", "ONTARGET", "HOPE", "EMPA-REG", "DECLARE",
  "EMPA-KIDNEY", "DAPA-CKD", "DAPA-HF", "EMPEROR-REDUCED", "EMPEROR-PRESERVED",
  "PARADIGM-HF", "PIONEER-HF", "GALACTIC-HF", "VICTORIA", "FINEARTS-HF",
  "PARTNER", "SURTAVI", "ARISTOTLE", "RE-LY", "ROCKET AF", "ENGAGE AF",
  "AFFIRM", "RACE", "CABANA", "STICH", "ISCHEMIA", "COMPASS",
  "DAWN", "DEFUSE-3", "MR CLEAN", "EXTEND-IA",
  // Nephro
  "CREDENCE", "FLOW", "FIDELIO-DKD", "FIGARO-DKD", "EVOQUE", "CONFIDENCE",
  "ARTEMIS-IGAN", "PROTECT", "DUPRO", "STOP-IgAN",
  // ID
  "REMAP-CAP", "RECOVERY", "ACTT-1", "PETAL", "SAILS",
  // Pulm / CC
  "PROSEVA", "ROSE", "CESAR", "EOLIA", "ARDS Network", "ARMA",
  "ADRENAL", "APROCCHSS", "SMART", "BaSICS", "ANDROMEDA-SHOCK",
  "PEPTIC", "SUP-ICU", "CITRIS-ALI",
  // GI / Hep
  "TEMSO", "STELLAR", "PIVOTAL", "ASTRA",
  // Heme/Onc
  "RESONATE", "MURANO", "CLL14", "ALCYONE", "MAIA",
  "CHECKMATE", "KEYNOTE", "IMPOWER", "PACIFIC",
  // Endo
  "DCCT", "EDIC", "UKPDS", "ADVANCE", "LEADER", "REWIND",
  "SUSTAIN", "STEP", "SELECT", "SURMOUNT", "PIONEER",
  // Rheum
  "ORAL", "FINCH", "CONTAIN",
  // Allergy
  "HELP", "PALISADE", "POSEIDON", "OUtMATCH",
  // Palliative
  "TEMEL",
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
  if (!res.ok) throw new Error(`E-utilities ${path} failed: ${res.status} ${await res.text()}`);
  return res;
}

async function searchPmids(query, limit) {
  const minYear = new Date().getFullYear() - YEARS_BACK;
  const fullQuery = `(${query}) AND ((review[Publication Type]) OR (meta-analysis[Publication Type]) OR (systematic review[Publication Type])) AND ("${minYear}"[Date - Publication] : "3000"[Date - Publication])`;
  const res = await eutilsFetch("esearch.fcgi", {
    db: "pubmed", term: fullQuery, retmode: "json", retmax: String(limit), sort: "relevance",
  });
  const data = await res.json();
  return data?.esearchresult?.idlist || [];
}

async function fetchAbstracts(pmids) {
  if (pmids.length === 0) return [];
  const res = await eutilsFetch("efetch.fcgi", {
    db: "pubmed", id: pmids.join(","), retmode: "xml",
  });
  const xml = await res.text();
  return parsePubmedXml(xml);
}

function parsePubmedXml(xml) {
  const out = [];
  const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let m;
  while ((m = articleRegex.exec(xml)) !== null) {
    const block = m[1];
    out.push({
      pmid:     pick(block, /<PMID[^>]*>([^<]+)<\/PMID>/),
      title:    cleanText(pick(block, /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)),
      journal:  cleanText(pick(block, /<Journal>[\s\S]*?<Title>([^<]+)<\/Title>/)),
      year:     parseInt(pick(block, /<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/) || "0") || null,
      doi:      pick(block, /<ArticleId IdType="doi">([^<]+)<\/ArticleId>/),
      pmcid:    pick(block, /<ArticleId IdType="pmc">([^<]+)<\/ArticleId>/),
      pubtypes: pickAll(block, /<PublicationType[^>]*>([^<]+)<\/PublicationType>/g),
      mesh:     pickAll(block, /<DescriptorName[^>]*>([^<]+)<\/DescriptorName>/g),
      authors:  pickAll(block, /<Author[^>]*>[\s\S]*?<LastName>([^<]+)<\/LastName>[\s\S]*?<Initials>([^<]+)<\/Initials>[\s\S]*?<\/Author>/g, true)
                  .map(parts => `${parts[0]} ${parts[1]}`).join(", "),
      abstract: cleanText(joinAbstractParts(block)),
    });
  }
  return out;
}
function pick(s, re) { const x = re.exec(s); return x ? x[1].trim() : ""; }
function pickAll(s, re, captureAll = false) {
  const out = []; let m;
  while ((m = re.exec(s)) !== null) out.push(captureAll ? m.slice(1) : m[1]);
  return out;
}
function cleanText(s) {
  return (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s+/g, " ").trim();
}
function joinAbstractParts(block) {
  const labelRe = /<AbstractText(?:\s+Label="([^"]+)")?[^>]*>([\s\S]*?)<\/AbstractText>/g;
  const parts = []; let m;
  while ((m = labelRe.exec(block)) !== null) parts.push((m[1] ? `${m[1]}: ` : "") + m[2]);
  return parts.join("\n\n");
}

function tierForPubtypes(pubtypes) {
  const set = new Set((pubtypes || []).map(p => p.toLowerCase()));
  if (set.has("guideline") || set.has("practice guideline")) return 1;
  if (set.has("meta-analysis") || set.has("systematic review")) return 2;
  if (set.has("review")) return 3;
  return 4;
}

async function fetchICite(pmids) {
  if (pmids.length === 0) return {};
  const url = `https://icite.od.nih.gov/api/pubs?pmids=${pmids.join(",")}`;
  await sleep(100);
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`iCite failed: ${res.status}`);
    return {};
  }
  const data = await res.json();
  const map = {};
  for (const r of (data.data || [])) {
    map[String(r.pmid)] = {
      rcr: r.relative_citation_ratio || null,
      citation_count: r.citation_count || null,
    };
  }
  return map;
}

function detectLandmarkTrial(title, abstract) {
  const text = ((title || "") + " " + (abstract || "")).toLowerCase();
  for (const trial of LANDMARK_TRIALS) {
    const re = new RegExp(`\\b${trial.replace(/[-/]/g, "[-/\\s]?").toLowerCase()}\\b`, "i");
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
  if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

function approxTokens(text) { return Math.ceil((text || "").length / 4); }

async function ingestTopic({ query, tier: defaultTier }) {
  console.log(`\n── Topic: "${query}" ────────────────────────────────`);
  const pmids = await searchPmids(query, PER_TOPIC_LIMIT);
  console.log(`  ESearch: ${pmids.length} PMIDs`);
  if (pmids.length === 0) return { inserted: 0, skipped: 0 };

  const records = await fetchAbstracts(pmids);
  console.log(`  EFetch:  ${records.length} abstracts`);

  const iciteMap = await fetchICite(records.map(r => r.pmid).filter(Boolean));
  console.log(`  iCite:   ${Object.keys(iciteMap).length} RCR scores`);

  let inserted = 0, skipped = 0;
  for (const r of records) {
    if (!r.abstract || r.abstract.length < 50) { skipped++; console.log(`    skip ${r.pmid}: no abstract`); continue; }

    const tier = tierForPubtypes(r.pubtypes) || defaultTier;
    const pubtype = (r.pubtypes && r.pubtypes[0]) || null;
    const icite = iciteMap[r.pmid] || {};
    const isLandmark = detectLandmarkTrial(r.title, r.abstract);

    const docPayload = {
      source: "pubmed",
      license: "public_domain",
      source_tier: tier,
      title: r.title || "(untitled)",
      authors: r.authors || null,
      journal: r.journal || null,
      year: r.year || null,
      published_date: r.year ? `${r.year}-01-01` : null,
      publication_type: pubtype,
      pmid: r.pmid,
      pmcid: r.pmcid || null,
      doi: r.doi || null,
      url: `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`,
      abstract: r.abstract,
      mesh_terms: r.mesh && r.mesh.length ? r.mesh.slice(0, 30) : null,
      rcr: icite.rcr,
      citation_count: icite.citation_count,
      is_landmark_trial: isLandmark,
      raw_metadata: { pubtypes: r.pubtypes, source_query: query },
      updated_at: new Date().toISOString(),
    };

    const { data: upsertedDoc, error: docErr } = await sb
      .from("documents").upsert(docPayload, { onConflict: "pmid" }).select("id").single();

    if (docErr) { console.log(`    FAIL ${r.pmid}: ${docErr.message}`); skipped++; continue; }

    let embedding;
    try { embedding = await embed(`${r.title}\n\n${r.abstract}`); }
    catch (err) { console.log(`    FAIL ${r.pmid} embed: ${err.message}`); skipped++; continue; }

    await sb.from("document_chunks").delete().eq("document_id", upsertedDoc.id);
    const { error: chunkErr } = await sb.from("document_chunks").insert({
      document_id: upsertedDoc.id,
      chunk_index: 0,
      section: "abstract",
      text: r.abstract,
      tokens: approxTokens(r.abstract),
      embedding,
    });
    if (chunkErr) { console.log(`    FAIL ${r.pmid} chunk: ${chunkErr.message}`); skipped++; continue; }

    inserted++;
    const flags = [];
    if (isLandmark) flags.push("★LANDMARK");
    if (icite.rcr) flags.push(`RCR=${icite.rcr.toFixed(2)}`);
    if (icite.citation_count) flags.push(`cites=${icite.citation_count}`);
    console.log(`    ok   ${r.pmid} [tier ${tier}${flags.length ? " " + flags.join(" ") : ""}] — ${r.title.slice(0, 60)}`);
  }
  return { inserted, skipped };
}

async function main() {
  console.log(`Chalk Talk RAG ingest v2 (with quality signals) — ${TOPICS.length} topic(s)`);
  console.log(`Embedding: ${EMBEDDING_MODEL} (${EMBEDDING_DIM}-dim) | Rate: ${NCBI_KEY ? "10/s" : "3/s"}`);
  console.log(`Landmark trial list: ${LANDMARK_TRIALS.length} trials`);

  let totalIn = 0, totalSkip = 0;
  for (const topic of TOPICS) {
    const { inserted, skipped } = await ingestTopic(topic);
    totalIn += inserted; totalSkip += skipped;
  }
  console.log(`\nDone. Inserted/updated: ${totalIn}, skipped: ${totalSkip}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });