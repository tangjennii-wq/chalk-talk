#!/usr/bin/env node
/**
 * RERANK COMPARISON — facet recall, bare-topic precision.
 *
 *   node rag/eval_rerank.mjs --dry            # show the labeled set, spend nothing
 *   node rag/eval_rerank.mjs                  # CALIBRATION split only
 *   node rag/eval_rerank.mjs --split held_out # only after a decision is made on calibration
 *
 * WHY THIS EXISTS. The 2026-07-28 diagnostic showed the bare-topic query separates covered from
 * uncovered topics (DKA 0.378 · hyperCa 0.445 · hyperK 0.495 · HFrEF 0.567) while the facet expansion
 * inflates every topic into 0.51–0.61 regardless. The tempting move was a bare-query cutoff at 0.45–0.50.
 *
 * Codex, 2026-07-28, and he is right: **do not.** A bare-query GATE would reject a niche topic even when
 * a treatment facet finds excellent evidence. The better architecture keeps both properties:
 *
 *     facets DISCOVER candidates (recall)  →  the bare topic RERANKS them (precision)
 *
 * And a hard constraint that falls out of the same data: **never compare raw scores produced against
 * different facet queries.** Cosine against "X treatment, management and guideline recommendations" and
 * cosine against "X" are not the same quantity. Pooling them is what makes an off-topic valvular
 * guideline outrank everything DKA has.
 *
 * THE PROOF THAT COSINE ALONE CANNOT WORK. For the HFrEF control, the single highest-scoring chunk
 * anywhere was the 2020 ACC/AHA **valvular** heart disease guideline at 0.612 — higher than any chunk
 * DKA produced from any facet. No global threshold separates that from real coverage. So the final gate
 * needs relevance, not just similarity.
 *
 * WHAT THIS SCRIPT DOES AND DOES NOT DO. It produces the comparison DATA. It does not pick a threshold,
 * and it must not be used to pick one from the calibration split alone — reserve `--split held_out`.
 *
 * Three rankings, same candidate union, scored against physician-labellable output:
 *   1. FACET     — current behaviour: pooled facet scores, take the top N
 *   2. RERANK    — re-embed each candidate against the BARE topic, rank by that alone
 *   3. RERANK+E  — rerank, then require an entity/alias match in title or text
 *
 * Read-only. Touches no corpus, no app code.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import "./loadenv.mjs";

const ARGV = process.argv.slice(2);
const argVal = (k, d) => { const i = ARGV.indexOf(k); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };
const DRY = ARGV.includes("--dry");
const SPLIT = argVal("--split", "calibration");
const TOP_N = parseInt(argVal("--top", "8"), 10);   // production keeps 8

const SUPABASE_URL = process.env.SUPABASE_URL, SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY, OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!DRY && (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY)) {
  console.error("✖ Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY (both the service-role and OpenAI keys are flagged for rotation).");
  process.exit(1);
}

/**
 * LABELED SET. Three coverage classes, spread across specialties so one weak area cannot dominate.
 * `expect` is a PRIOR to be checked, never an input to scoring — it says what we believe the corpus
 * holds, and the run either confirms it or does not.
 *   covered — the corpus should have real, on-topic evidence
 *   thin    — some adjacent evidence, probably not the topic itself
 *   absent  — believed to have nothing on-topic
 * CALIBRATION vs HELD_OUT is fixed here on purpose so it cannot be chosen after seeing results.
 */
const LABELED = {
  calibration: [
    { topic: "heart failure with reduced ejection fraction", specialty: "Cardiology",   expect: "covered" },
    { topic: "atrial fibrillation stroke prevention",        specialty: "Cardiology",   expect: "covered" },
    { topic: "chronic kidney disease progression",           specialty: "Nephrology",   expect: "covered" },
    { topic: "type 2 diabetes glycemic control",             specialty: "Endocrine",    expect: "covered" },
    { topic: "hyperkalemia",                                 specialty: "Nephrology",   expect: "thin"    },
    { topic: "hypercalcemia of malignancy",                  specialty: "Endocrine",    expect: "thin"    },
    { topic: "community-acquired pneumonia",                 specialty: "ID",           expect: "thin"    },
    { topic: "diabetic ketoacidosis",                        specialty: "Endocrine",    expect: "absent"  },
    // CORRECTED 2026-07-28: these three DO have guideline entries (AASLD Ascites/SBP 2021; Endocrine
    // Society adrenal-adjacent; ATA Hyperthyroidism & Thyrotoxicosis 2016). I labelled them "absent"
    // while my own inventory said otherwise. They are thin — guideline present, no landmark trials —
    // and "expect" must describe the INGESTED database, not the trial list alone. (Codex, 2026-07-28)
    { topic: "spontaneous bacterial peritonitis",            specialty: "GI/Hepatology",expect: "thin"    },
    { topic: "adrenal crisis",                               specialty: "Endocrine",    expect: "thin"    },
    { topic: "thyroid storm",                                specialty: "Endocrine",    expect: "thin"    },
    { topic: "bullous pemphigoid",                           specialty: "Dermatology",  expect: "absent"  },
  ],
  held_out: [
    { topic: "acute ischemic stroke thrombolysis",           specialty: "Neurology",    expect: "covered" },
    { topic: "venous thromboembolism anticoagulation",       specialty: "Hematology",   expect: "covered" },
    { topic: "giant cell arteritis",                         specialty: "Rheumatology", expect: "thin"    },
    { topic: "immune thrombocytopenia",                      specialty: "Hematology",   expect: "thin"    },
    { topic: "status epilepticus",                           specialty: "Neurology",    expect: "absent"  },
    { topic: "thyrotoxic periodic paralysis",                specialty: "Endocrine",    expect: "absent"  },
    { topic: "cardiac tamponade",                            specialty: "Cardiology",   expect: "absent"  },
    { topic: "anaphylaxis",                                  specialty: "Allergy",      expect: "absent"  },
  ],
};

/**
 * ENTITY ALIASES — A RETRIEVAL FEATURE, NOT A RELEVANCE SCORE. (Codex, 2026-07-28)
 *
 * My first version scored strategies by counting alias hits. That was self-defeating: several aliases
 * are broad enough to admit the EXACT D-1 false positives.
 *   "potassium"       → a heart-failure trial mentioning potassium passes as hyperkalemia evidence
 *   "denosumab"       → a bone-metastasis paper passes as hypercalcemia evidence
 *   "bisphosphonate"  → same
 *   "anticoagulation" → any anticoagulation paper passes as AF stroke-prevention evidence
 *   "egfr"            → almost any nephrology paper passes as CKD-progression evidence
 * Scoring with those would have declared the failures we are trying to measure a success. They are
 * MARKED below and reported as a feature, never summed into a verdict.
 *
 * Relevance is established by BLINDED PHYSICIAN LABELS (see the emitted labeling sheet), and the primary
 * comparison is precision@8 over those labels.
 */
const ALIASES = {
  "diabetic ketoacidosis": ["ketoacidosis", "dka", "hyperglycemic crisis", "hyperglycaemic crisis", "hyperosmolar", "hhs", "beta-hydroxybutyrate"],
  "hypercalcemia of malignancy": ["hypercalcemia", "hypercalcaemia", "pthrp", "bisphosphonate" /* OVER-BROAD */, "zoledronic", "denosumab" /* OVER-BROAD */, "calcitonin"],
  "hyperkalemia": ["hyperkalemia", "hyperkalaemia", "potassium" /* OVER-BROAD */, "patiromer", "zirconium cyclosilicate", "polystyrene sulfonate"],
  "heart failure with reduced ejection fraction": ["heart failure", "hfref", "systolic heart failure", "ejection fraction"],
  "atrial fibrillation stroke prevention": ["atrial fibrillation", "afib", "anticoagulation" /* OVER-BROAD */, "cha2ds2"],
  "chronic kidney disease progression": ["chronic kidney disease", "ckd", "egfr" /* OVER-BROAD */, "albuminuria", "proteinuria"],
  "type 2 diabetes glycemic control": ["type 2 diabetes", "hba1c", "glycemic", "glycaemic"],
  "community-acquired pneumonia": ["pneumonia", "cap ", "curb-65", "community-acquired"],
  "spontaneous bacterial peritonitis": ["peritonitis", "sbp", "ascites", "ascitic"],
  "adrenal crisis": ["adrenal crisis", "adrenal insufficiency", "hydrocortisone", "addisonian"],
  "thyroid storm": ["thyroid storm", "thyrotoxic", "thyrotoxicosis"],
  "bullous pemphigoid": ["pemphigoid", "bullous"],
  "acute ischemic stroke thrombolysis": ["stroke", "thrombolysis", "alteplase", "tenecteplase", "thrombectomy"],
  "venous thromboembolism anticoagulation": ["venous thromboembolism", "vte", "pulmonary embolism", "deep vein"],
  "giant cell arteritis": ["giant cell arteritis", "temporal arteritis", "polymyalgia"],
  "immune thrombocytopenia": ["immune thrombocytopenia", "itp", "thrombocytopenia"],
  "status epilepticus": ["status epilepticus", "seizure", "benzodiazepine", "levetiracetam"],
  "thyrotoxic periodic paralysis": ["periodic paralysis", "thyrotoxic"],
  "cardiac tamponade": ["tamponade", "pericardial", "pericardiocentesis"],
  "anaphylaxis": ["anaphylaxis", "anaphylactic", "epinephrine"],
};

const SET = LABELED[SPLIT];
if (!SET) { console.error(`✖ unknown split "${SPLIT}" — use calibration or held_out`); process.exit(1); }

console.log(`Split      : ${SPLIT} (${SET.length} topics)`);
console.log(`Top-N      : ${TOP_N}   (production keeps 8)`);
console.log(`Rankings   : FACET (current) · RERANK (bare topic) · RERANK+E (bare + entity gate)\n`);
if (DRY) {
  for (const x of SET) console.log(`  ${x.expect.padEnd(8)} ${x.specialty.padEnd(14)} ${x.topic}`);
  console.log("\n✔ DRY RUN — labeled set loads. Re-run without --dry.");
  process.exit(0);
}

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ABS_FLOOR = parseFloat((html.match(/var ABS_FLOOR = \(typeof opts\.minSim === "number"\) \? opts\.minSim : ([\d.]+)/) || [])[1] || "0.30");
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
// PRODUCTION HAS FIVE FACETS AND match_count 24. My first version used four and 20, which did not
// mirror production — and the facet I omitted is the one that explicitly asks for LANDMARK TRIALS, i.e.
// the single facet most biased toward the papers that polluted D-1. Omitting it probably UNDERSTATED the
// problem. Verified against index.html `expandedQueries`. (Codex, 2026-07-28)
const facets = (t) => [
  t,
  t + " pathophysiology and mechanism",
  t + " diagnosis, workup and diagnostic testing",
  t + " treatment, management and guideline recommendations",
  t + " outcomes, prognosis, mortality and landmark trials",
];
const PROD_MATCH_COUNT = 24;

async function embed(text) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text, dimensions: 1536 }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}`);
  return (await r.json()).data[0].embedding;
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const entityHit = (topic, txt) => (ALIASES[topic] || [topic]).some(a => String(txt).toLowerCase().includes(a));

const report = { split: SPLIT, top_n: TOP_N, abs_floor: ABS_FLOOR, when: new Date().toISOString(), topics: [] };

for (const { topic, specialty, expect } of SET) {
  process.stdout.write(`${topic.padEnd(46)} `);
  let bareEmb;
  try { bareEmb = await embed(topic); } catch (e) { console.log(`✖ embed: ${e.message}`); continue; }

  // ── 1 · facets DISCOVER. Union by document, keeping which facet found it and at what score. ──
  const union = new Map();
  for (const q of facets(topic)) {
    let emb; try { emb = await embed(q); } catch { continue; }
    const { data, error } = await sb.rpc("match_chunks", { query_embedding: emb, match_count: PROD_MATCH_COUNT, min_similarity: ABS_FLOOR });
    if (error) continue;
    for (const c of data || []) {
      const k = `${c.document_id ?? ""}::${(c.title || "").slice(0, 60)}`;
      const prev = union.get(k);
      // keep the BEST facet score for reporting only — it is never compared across topics
      if (!prev || (c.similarity || 0) > prev.facet_sim) {
        union.set(k, {
          title: c.title || c.source || "(untitled)", text: (c.text || "").slice(0, 1500),
          document_id: c.document_id ?? null, tier: c.source_tier ?? null, landmark: !!c.is_landmark_trial,
          facet_sim: +(c.similarity || 0).toFixed(4), matched_facet: q,
        });
      }
    }
  }
  const cands = [...union.values()];
  if (!cands.length) { console.log("no candidates"); report.topics.push({ topic, specialty, expect, candidates: 0 }); continue; }

  // ── 2 · the BARE topic RERANKS. One embedding space, one query — scores ARE comparable. ──
  // TWO REPRESENTATIONS, reported separately. Re-embedding a TRUNCATED candidate silently changes the
  // document representation relative to what is stored, and that change could be doing the work rather
  // than the rerank. So score both and let the numbers say which. (Codex, 2026-07-28)
  //   bare_sim_full  — title + the stored chunk text as ingested
  //   bare_sim_trunc — title + first 600 chars (the cheap version)
  for (const c of cands) {
    try { c.bare_sim_full  = +dot(bareEmb, await embed(`${c.title}. ${c.text}`)).toFixed(4); }
    catch { c.bare_sim_full = null; }
    try { c.bare_sim_trunc = +dot(bareEmb, await embed(`${c.title}. ${c.text.slice(0, 600)}`)).toFixed(4); }
    catch { c.bare_sim_trunc = null; }
    c.bare_sim = c.bare_sim_full;               // full representation is the primary
    c.entity = entityHit(topic, `${c.title} ${c.text}`);
  }

  const byFacet  = [...cands].sort((a, b) => b.facet_sim - a.facet_sim).slice(0, TOP_N);
  const byRerank = [...cands].filter(c => c.bare_sim != null).sort((a, b) => b.bare_sim - a.bare_sim).slice(0, TOP_N);
  const byBoth   = [...cands].filter(c => c.bare_sim != null && c.entity).sort((a, b) => b.bare_sim - a.bare_sim).slice(0, TOP_N);

  const ent = (arr) => arr.filter(c => c.entity).length;
  const brief = (c) => ({
    title: c.title.slice(0, 90), pmid: c.pmid || null, doi: c.doi || null,
    pub_type: c.pub_type || c.source || null, tier: c.tier, landmark: c.landmark,
    matched_facet: c.matched_facet, facet_sim: c.facet_sim,
    bare_sim_full: c.bare_sim_full, bare_sim_trunc: c.bare_sim_trunc, entity_feature: c.entity,
  });
  const row = {
    topic, specialty, expect, candidates: cands.length,
    // NOTE: entity_hits is reported as a FEATURE COUNT. It is not a score and must not be read as one.
    facet:      { kept: byFacet.length,  entity_feature_hits: ent(byFacet),  items: byFacet.map(brief) },
    rerank:     { kept: byRerank.length, entity_feature_hits: ent(byRerank), items: byRerank.map(brief) },
    rerank_e:   { kept: byBoth.length,   entity_feature_hits: ent(byBoth),   items: byBoth.map(brief) },
  };
  report.topics.push(row);
  console.log(`cands ${String(cands.length).padStart(3)} · kept  FACET ${byFacet.length}  RERANK ${byRerank.length}  RERANK+E ${byBoth.length}`);
}

try { mkdirSync("rag/runs", { recursive: true }); } catch {}
const stamp = new Date().toISOString().slice(0,16).replace(/[:T]/g,"-");
const out = `rag/runs/rerank-${SPLIT}-${stamp}.json`;
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

// ── BLINDED LABELING SHEET ────────────────────────────────────────────────────
// Every candidate that any strategy kept, in RANDOM order, with NO indication of which strategy chose
// it and no scores shown. Attribution is restored from the JSON at scoring time. Showing the strategy
// or the score would tell the labeller what to think, which is the whole failure mode this guards.
let sheet = `# Blinded relevance labeling — ${SPLIT} split, ${stamp}\n\n`;
sheet += `For each source: is it **directly relevant**, **adjacent/contextual**, or **irrelevant** to the\n`;
sheet += `topic as a teaching source? Only *directly relevant* counts as topic grounding.\n\n`;
sheet += `- **D** directly relevant — supports diagnosis, treatment, mechanism, prognosis or a guideline recommendation FOR THIS TOPIC\n`;
sheet += `- **A** adjacent/contextual — same disease area, does not address this topic\n`;
sheet += `- **I** irrelevant\n\n`;
sheet += `Which strategy selected each item is deliberately hidden, and so are the scores.\n\n---\n\n`;
for (const t of report.topics) {
  const seen = new Map();
  for (const k of ["facet", "rerank", "rerank_e"]) for (const it of (t[k] ? t[k].items : [])) {
    const key = it.title; if (!seen.has(key)) seen.set(key, it);
  }
  const items = [...seen.values()];
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  sheet += `## ${t.topic}\n\n`;
  items.forEach((it, i) => { sheet += `${String(i+1).padStart(2)}. \`___\`  ${it.title}${it.pmid ? `  (PMID ${it.pmid})` : ""}\n`; });
  sheet += `\n`;
}
const sheetPath = `rag/runs/rerank-${SPLIT}-${stamp}-LABELS.md`;
writeFileSync(sheetPath, sheet);

console.log("\n" + "═".repeat(92));
console.log("THIS RUN PRODUCES NO VERDICT — that is deliberate");
console.log("═".repeat(92));
console.log("  Alias/entity hits are a retrieval FEATURE and are NOT summed into a score. Several aliases");
console.log("  (potassium, denosumab, bisphosphonate, anticoagulation, eGFR) are broad enough to admit the");
console.log("  exact D-1 false positives, so scoring by them would call the failure a success.");
console.log("");
console.log("  The comparison is PRECISION@8 over blinded physician labels:");
console.log(`     1. label every line in  ${sheetPath}`);
console.log(`     2. the JSON keeps which strategy chose what, so attribution is restored at scoring time`);
console.log("");
console.log("  Also reported per candidate: PMID/DOI, source type, tier, landmark flag, matched facet,");
console.log("  facet score, and BOTH rerank representations (full stored text vs title+600 chars) — so a");
console.log("  change in document representation cannot be mistaken for a change in ranking strategy.");
console.log("");
console.log("  Keep --split held_out SEALED until the strategy is chosen on calibration.");
console.log(`\n-> ${out}`);
console.log(`-> ${sheetPath}`);
