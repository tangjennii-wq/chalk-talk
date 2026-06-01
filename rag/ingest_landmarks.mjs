#!/usr/bin/env node
/**
 * Chalk Talk — Landmark Trial Ingestion
 * Reads rag/landmark_trials.json and pulls the canonical paper for each trial
 * from PubMed. Marks all as is_landmark_trial=true, source_tier=1 (highest).
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

const TRIALS = JSON.parse(readFileSync("rag/landmark_trials.json", "utf8"));
const REQUEST_DELAY_MS = NCBI_KEY ? 110 : 350;
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
  if (!res.ok) throw new Error(`E-utilities ${path}: ${res.status}`);
  return res;
}

async function searchTrial(trial) {
  // Build a query: prefer the full descriptive name + year window
  const ymin = trial.year - 1, ymax = trial.year + 2;
  const q = `(${trial.full}) AND ("${ymin}"[Date - Publication] : "${ymax}"[Date - Publication])`;
  try {
    const res = await eutilsFetch("esearch.fcgi", {
      db: "pubmed", term: q, retmode: "json", retmax: "3", sort: "relevance",
    });
    const data = await res.json();
    return data?.esearchresult?.idlist || [];
  } catch (e) { return []; }
}

async function fetchAbstracts(pmids) {
  if (!pmids.length) return [];
  try {
    const res = await eutilsFetch("efetch.fcgi", {
      db: "pubmed", id: pmids.join(","), retmode: "xml",
    });
    return parsePubmedXml(await res.text());
  } catch (e) { return []; }
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
function pickAll(s, re, all=false) {
  const out=[]; let m;
  while ((m=re.exec(s))!==null) out.push(all ? m.slice(1) : m[1]);
  return out;
}
function cleanText(s) {
  return (s||"").replace(/<[^>]+>/g," ").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/\s+/g," ").trim();
}
function joinAbstract(b) {
  const re=/<AbstractText(?:\s+Label="([^"]+)")?[^>]*>([\s\S]*?)<\/AbstractText>/g;
  const parts=[]; let m;
  while ((m=re.exec(b))!==null) parts.push((m[1] ? `${m[1]}: ` : "") + m[2]);
  return parts.join("\n\n");
}

async function fetchICite(pmids) {
  if (!pmids.length) return {};
  try {
    await sleep(100);
    const res = await fetch(`https://icite.od.nih.gov/api/pubs?pmids=${pmids.join(",")}`);
    if (!res.ok) return {};
    const data = await res.json();
    const map={};
    for (const r of (data.data||[])) {
      map[String(r.pmid)] = { rcr: r.relative_citation_ratio || null, citation_count: r.citation_count || null };
    }
    return map;
  } catch (e) { return {}; }
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

async function ingestTrial(trial) {
  const pmids = await searchTrial(trial);
  if (!pmids.length) return { status: "not_found" };
  const records = await fetchAbstracts(pmids.slice(0, 1));
  if (!records.length || !records[0].abstract || records[0].abstract.length < 50) {
    return { status: "no_abstract", pmid: pmids[0] };
  }
  const r = records[0];
  const icite = await fetchICite([r.pmid]);
  const ic = icite[r.pmid] || {};

  const payload = {
    source: "pubmed",
    license: "public_domain",
    source_tier: 1,  // landmark = tier 1
    title: r.title || trial.name,
    authors: r.authors || null,
    journal: r.journal || null,
    year: r.year || trial.year,
    published_date: (r.year || trial.year) ? `${r.year || trial.year}-01-01` : null,
    publication_type: (r.pubtypes && r.pubtypes[0]) || "Clinical Trial",
    pmid: r.pmid,
    pmcid: r.pmcid || null,
    doi: r.doi || null,
    url: `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`,
    abstract: r.abstract,
    mesh_terms: r.mesh && r.mesh.length ? r.mesh.slice(0, 30) : null,
    rcr: ic.rcr,
    citation_count: ic.citation_count,
    is_landmark_trial: true,
    raw_metadata: { landmark_name: trial.name, landmark_year: trial.year, landmark_specialty: trial.specialty, pubtypes: r.pubtypes },
    updated_at: new Date().toISOString(),
  };

  const { data: doc, error: dErr } = await sb.from("documents").upsert(payload, { onConflict: "pmid" }).select("id").single();
  if (dErr) return { status: "db_error", error: dErr.message };

  let emb;
  try { emb = await embed(`${r.title}\n\n${r.abstract}`); }
  catch (e) { return { status: "embed_error", error: e.message }; }

  await sb.from("document_chunks").delete().eq("document_id", doc.id);
  const { error: cErr } = await sb.from("document_chunks").insert({
    document_id: doc.id, chunk_index: 0, section: "abstract",
    text: r.abstract, tokens: Math.ceil(r.abstract.length/4), embedding: emb,
  });
  if (cErr) return { status: "chunk_error", error: cErr.message };

  return { status: "ok", pmid: r.pmid, rcr: ic.rcr, year: r.year, title: r.title };
}

async function main() {
  console.log(`Ingesting ${TRIALS.length} landmark trials with is_landmark_trial=true, source_tier=1`);
  console.log(`Rate: ${NCBI_KEY ? "10/s" : "3/s"}\n`);
  let ok=0, miss=0, fail=0;
  for (let i = 0; i < TRIALS.length; i++) {
    const t = TRIALS[i];
    process.stdout.write(`[${String(i+1).padStart(3)}/${TRIALS.length}] ${t.name.padEnd(22)} (${t.year}) `);
    const result = await ingestTrial(t);
    if (result.status === "ok") {
      ok++;
      console.log(`✓ PMID ${result.pmid}${result.rcr ? ` RCR ${result.rcr.toFixed(1)}` : ''} — ${(result.title||'').slice(0,55)}`);
    } else if (result.status === "not_found") {
      miss++; console.log(`✗ not found in PubMed`);
    } else {
      fail++; console.log(`✗ ${result.status}: ${result.error || result.pmid || ''}`);
    }
  }
  console.log(`\nDone. ok=${ok}, not_found=${miss}, failed=${fail}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
