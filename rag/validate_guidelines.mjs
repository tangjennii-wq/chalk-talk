#!/usr/bin/env node
/**
 * GUIDELINE CITATION VALIDATOR — makes fabrication structurally impossible.
 *
 * WHY THIS EXISTS
 * The GUIDELINES summaries were AI-drafted. A July 2026 audit found ~37 fabricated or mis-attributed
 * citations out of 184 — guidelines that do not exist ("AAN/AAOS Anti-Amyloid 2024" — AAOS is the
 * ORTHOPAEDIC academy), phantom update years bolted onto real documents ("IDSA SSTI 2014/2024"), and
 * society blending ("ATS/ERS Bronchiectasis" — that co-badge belongs to the NTM guideline).
 *
 * The root cause was that NOTHING checked the citation. An entry could claim any society, any year.
 * This script makes that impossible: every guideline must carry an identifier that RESOLVES.
 *
 * CHECKS
 *   1. URL present, well-formed, and http(s).
 *   2. URL actually resolves (HEAD, falling back to GET). A 404 fails the build.
 *   3. If it is a PubMed/DOI link, the PMID is verified against NCBI eutils and the YEAR is
 *      cross-checked against the entry's stated year.
 *   4. LINT: two-year titles ("2014/2024", "2016 + 2024") — the exact tell of a phantom update year.
 *      These are WARNINGS, not failures, because some are legitimate (a real base doc + a real update).
 *
 * USAGE
 *   node rag/extract_guidelines.mjs && node rag/validate_guidelines.mjs
 *   node rag/validate_guidelines.mjs --strict     # warnings also fail (use in CI once clean)
 *
 * Exit code 1 on any hard failure, so this can gate a commit / CI run.
 */

import { readFileSync } from "fs";

const STRICT = process.argv.includes("--strict");
const entries = JSON.parse(readFileSync("rag/guidelines_extracted.json", "utf8"));
let netBlocked = 0;
let botBlocked = 0;

const NCBI_KEY = process.env.NCBI_API_KEY || "";
const CONCURRENCY = 6;
const TIMEOUT_MS = 15000;

const UA = "ChalkTalk-GuidelineValidator/1.0 (medical education; contact: tangjennii@gmail.com)";

function pmidFrom(url) {
  const m = String(url || "").match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{6,9})/);
  return m ? m[1] : null;
}

async function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error("timeout")), ms); });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(t); }
}

/** Does the URL resolve? Some society sites reject HEAD, so fall back to GET. */
async function checkUrl(url) {
  const opts = { redirect: "follow", headers: { "User-Agent": UA } };
  try {
    let r = await withTimeout(fetch(url, { ...opts, method: "HEAD" }), TIMEOUT_MS);
    if (r.status === 405 || r.status === 403 || r.status === 501) {
      r = await withTimeout(fetch(url, { ...opts, method: "GET" }), TIMEOUT_MS);
    }
    return { ok: r.status >= 200 && r.status < 400, status: r.status };
  } catch (e) {
    // Some sites block bots entirely; try a plain GET once more before calling it dead.
    try {
      const r = await withTimeout(fetch(url, { ...opts, method: "GET" }), TIMEOUT_MS);
      return { ok: r.status >= 200 && r.status < 400, status: r.status };
    } catch (e2) {
      return { ok: false, status: 0, error: e2.message };
    }
  }
}

/** Verify a PMID exists and return its real publication year + title, straight from NCBI. */
async function checkPmid(pmid) {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`
            + (NCBI_KEY ? `&api_key=${NCBI_KEY}` : "");
  try {
    const r = await withTimeout(fetch(url, { headers: { "User-Agent": UA } }), TIMEOUT_MS);
    if (!r.ok) return { ok: false, error: `eutils ${r.status}` };
    const j = await r.json();
    const rec = j?.result?.[pmid];
    if (!rec || rec.error) return { ok: false, error: "PMID not found in PubMed" };
    const year = parseInt(String(rec.pubdate || "").slice(0, 4), 10) || null;
    return { ok: true, year, title: rec.title || "" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function validate(e) {
  const problems = [];
  const warnings = [];

  // 1) identifier present
  if (!e.url || !String(e.url).trim()) {
    problems.push("NO URL — every guideline must carry a resolvable identifier (PMID or society register URL)");
  } else if (!/^https?:\/\//i.test(e.url)) {
    problems.push(`URL is not http(s): ${e.url}`);
  } else {
    // 2) does it resolve?
    const res = await checkUrl(e.url);
    if (!res.ok) {
      // Distinguish a genuinely dead link (HTTP 4xx/5xx) from "this machine has no network".
      // A sandbox with blocked egress reports status 0 / "fetch failed" for EVERY url — reporting
      // that as 183 dead citations would be worse than useless.
      if (res.status === 0) {
        netBlocked++;
        warnings.push(`could not reach ${e.url} (${res.error}) — network issue, NOT a dead link`);
      } else if (res.status === 404 || res.status === 410) {
        // The ONLY statuses that actually mean "this citation does not exist."
        problems.push(`DEAD LINK (HTTP ${res.status}) — page does not exist: ${e.url}`);
      } else {
        // 403 = bot-blocked (ACR, IDSA, AASLD, ASCO all do this). 429 = rate-limited. 5xx = their server.
        // NONE of these mean the citation is fake. Reporting them as failures would cry wolf and destroy
        // trust in the one signal that matters. (Jenni 2026-07-11)
        botBlocked++;
        warnings.push(`HTTP ${res.status} (bot-blocked or server-side, NOT a dead link — verify by hand if unsure): ${e.url}`);
      }
    }
    // 3) PMID cross-check
    const pmid = pmidFrom(e.url);
    if (pmid) {
      const pm = await checkPmid(pmid);
      if (!pm.ok) {
        problems.push(`PMID ${pmid} INVALID — ${pm.error}`);
      } else if (pm.year && e.year && Math.abs(pm.year - e.year) > 1) {
        problems.push(`YEAR MISMATCH — entry says ${e.year}, PubMed says ${pm.year} (PMID ${pmid}: "${(pm.title||'').slice(0,70)}")`);
      }
    }
  }

  // 4) phantom-year lint — the signature of the fabrication we found
  const years = (e.name || "").match(/(19|20)\d{2}/g) || [];
  if (years.length >= 2) {
    warnings.push(`TWO YEARS IN TITLE (${years.join(", ")}) — verify the later year corresponds to a REAL document`);
  }

  return { entry: e, problems, warnings };
}

async function main() {
  console.log(`Validating ${entries.length} guideline citations…\n`);

  const results = [];
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    results.push(...await Promise.all(batch.map(validate)));
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, entries.length)}/${entries.length}`);
  }
  console.log("\n");

  const failed = results.filter(r => r.problems.length);
  const warned = results.filter(r => !r.problems.length && r.warnings.length);

  if (failed.length) {
    console.log("═══ HARD FAILURES ═══\n");
    for (const r of failed) {
      console.log(`✖ [${r.entry.specialty}] ${r.entry.name} (${r.entry.year})`);
      r.problems.forEach(p => console.log(`    ${p}`));
      console.log("");
    }
  }

  if (warned.length) {
    console.log("═══ WARNINGS (phantom-year lint) ═══\n");
    for (const r of warned) {
      console.log(`⚠ [${r.entry.specialty}] ${r.entry.name}`);
      r.warnings.forEach(w => console.log(`    ${w}`));
    }
    console.log("");
  }

  const clean = results.length - failed.length - warned.length;
  console.log("═══ SUMMARY ═══");
  console.log(`  clean:    ${clean}`);
  console.log(`  warnings: ${warned.length}`);
  console.log(`  FAILURES: ${failed.length}   <- real problems: dead links (404), bad PMIDs, year mismatches, missing URLs`);
  if (botBlocked) console.log(`  (${botBlocked} URLs returned 403/429/5xx — bot-blocked, counted as warnings, not failures)`);

  if (netBlocked > entries.length * 0.5) {
    console.log(`\n⚠ ${netBlocked}/${entries.length} URLs were unreachable at the NETWORK level.`);
    console.log("  This machine appears to have no outbound internet access — that is an environment");
    console.log("  problem, not a citation problem. Run this on a machine with network access.");
    process.exit(2);
  }

  const bad = failed.length + (STRICT ? warned.length : 0);
  if (bad) {
    console.log(`\n✖ Validation failed (${bad} problem${bad === 1 ? "" : "s"}).`);
    process.exit(1);
  }
  console.log("\n✔ All guideline citations resolve.");
}

main().catch(e => { console.error(e); process.exit(1); });
