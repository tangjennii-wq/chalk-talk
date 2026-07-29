#!/usr/bin/env node
/**
 * FOUR-ARM PIPELINE MEASUREMENT — drives the REAL Worker, not a reimplementation.
 *
 *   node rag/eval_pipeline_arms.mjs --worker http://127.0.0.1:8787 --dry
 *   node rag/eval_pipeline_arms.mjs --worker http://127.0.0.1:8787
 *   node rag/eval_pipeline_arms.mjs --worker <url> --score rag/runs/<sheet>-FILLED.md
 *
 * WHY IT CALLS THE WORKER. The previous evaluator did its own embedding and its own ranking, so it
 * measured a reimplementation. Whatever it concluded would have been a fact about the evaluator. This
 * sends the same topic through the deployed `/retrieve` endpoint four times with different flags, so the
 * thing measured is the thing that ships. (Codex, 2026-07-28)
 *
 * ARMS
 *   baseline   { }                                        both flags absent
 *   rerank     { rerank: true }                            stage 1 only
 *   metadata   { metadata_filter: true }                   stage 2 only
 *   both       { rerank: true, metadata_filter: true }     stages 1+2
 *
 * IT ABORTS RATHER THAN GUESSES. Every arm is REJECTED unless the response proves what actually ran:
 *   baseline  rerank_applied === false && metadata_filter_applied === false
 *   rerank    rerank_applied === true
 *   metadata  metadata_filter_applied === true
 *   both      both true
 * A Worker that predates these stages returns responses with no such fields at all, so the run aborts
 * instead of silently measuring the old deployment four times and reporting a null result as a finding.
 * That specific confusion — an instrument reporting its own failure as data — has happened four times on
 * this project in two days.
 *
 * RELEVANCE COMES FROM A BLINDED PHYSICIAN, NOT FROM THIS SCRIPT. It emits ONE labeling sheet: the union
 * of every candidate any arm returned, deduplicated, in random order, with no arm attribution and no
 * scores. Attribution is restored from the JSON at scoring time.
 *
 * Read-only against the corpus. Writes only its own report files.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import "./loadenv.mjs";

const ARGV = process.argv.slice(2);
const argVal = (k, d) => { const i = ARGV.indexOf(k); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };
const DRY = ARGV.includes("--dry");
const WORKER = argVal("--worker", "");
const SPLIT = argVal("--split", "calibration");
const TOP_N = parseInt(argVal("--top", "8"), 10);
const SCORE_SHEET = argVal("--score", "");

if (!WORKER && !SCORE_SHEET) {
  console.error("✖ --worker <url> is required. Use a LOCAL worker (`npx wrangler dev`) or a dedicated");
  console.error("  staging Worker serving this branch. Do not point this at production.");
  process.exit(1);
}

// ── the labeled set, and the seal on held_out ────────────────────────────────
const LABELED = {
  calibration: [
    ["heart failure with reduced ejection fraction", "Cardiology",    "covered"],
    ["atrial fibrillation stroke prevention",        "Cardiology",    "covered"],
    ["chronic kidney disease progression",           "Nephrology",    "covered"],
    ["type 2 diabetes glycemic control",             "Endocrine",     "covered"],
    ["hyperkalemia",                                 "Nephrology",    "thin"],
    ["hypercalcemia of malignancy",                  "Endocrine",     "thin"],
    ["community-acquired pneumonia",                 "ID",            "thin"],
    ["spontaneous bacterial peritonitis",            "GI/Hepatology", "thin"],
    ["adrenal crisis",                               "Endocrine",     "thin"],
    ["thyroid storm",                                "Endocrine",     "thin"],
    ["diabetic ketoacidosis",                        "Endocrine",     "absent"],
    ["bullous pemphigoid",                           "Dermatology",   "absent"],
  ],
  held_out: [
    ["acute ischemic stroke thrombolysis",           "Neurology",     "covered"],
    ["venous thromboembolism anticoagulation",       "Hematology",    "covered"],
    ["giant cell arteritis",                         "Rheumatology",  "thin"],
    ["immune thrombocytopenia",                      "Hematology",    "thin"],
    ["status epilepticus",                           "Neurology",     "absent"],
    ["thyrotoxic periodic paralysis",                "Endocrine",     "absent"],
    ["cardiac tamponade",                            "Cardiology",    "absent"],
    ["anaphylaxis",                                  "Allergy",       "absent"],
  ],
};

// production's five facets, read from the app so this cannot drift
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const facets = (t) => [
  t,
  t + " pathophysiology and mechanism",
  t + " diagnosis, workup and diagnostic testing",
  t + " treatment, management and guideline recommendations",
  t + " outcomes, prognosis, mortality and landmark trials",
];
const MATCH_COUNT = 24;   // production value

const ARMS = [
  { name: "baseline", body: {},                                          expect: { rerank_applied: false, metadata_filter_applied: false } },
  { name: "rerank",   body: { rerank: true },                            expect: { rerank_applied: true } },
  { name: "metadata", body: { metadata_filter: true },                   expect: { metadata_filter_applied: true } },
  { name: "both",     body: { rerank: true, metadata_filter: true },     expect: { rerank_applied: true, metadata_filter_applied: true } },
];

const SET = LABELED[SPLIT];
if (!SET) { console.error(`✖ unknown split "${SPLIT}"`); process.exit(1); }

// ══ SCORING MODE ═════════════════════════════════════════════════════════════
if (SCORE_SHEET) {
  const sheet = readFileSync(SCORE_SHEET, "utf8");
  const runFile = SCORE_SHEET.replace(/-LABELS(-FILLED)?\.md$/, ".json");
  const run = JSON.parse(readFileSync(runFile, "utf8"));

  // labels: lines like "12. `D`  Some title"
  const labels = new Map();
  let topic = null;
  for (const line of sheet.split("\n")) {
    const h = line.match(/^##\s+(.+)$/); if (h) { topic = h[1].trim(); continue; }
    const m = line.match(/^\s*\d+\.\s+`([DAI_ ]*)`\s+(.+?)(?:\s+\(PMID.*)?$/);
    if (m && topic) {
      const v = m[1].trim().toUpperCase();
      if (v === "D" || v === "A" || v === "I") labels.set(topic + "||" + m[2].trim(), v);
    }
  }
  if (!labels.size) { console.error("✖ no labels found — fill the ___ slots with D, A or I"); process.exit(1); }
  console.log(`Loaded ${labels.size} labels from ${SCORE_SHEET}\n`);

  const tally = {};
  for (const a of ARMS) tally[a.name] = { p_at_n: [], direct: 0, kept: 0, unlabelled: 0 };
  let unionDirect = 0;

  for (const t of run.topics) {
    const seen = new Set();
    for (const a of ARMS) {
      const items = (t.arms[a.name] || {}).items || [];
      let direct = 0, labelled = 0;
      for (const it of items) {
        const L = labels.get(t.topic + "||" + it.title);
        if (!L) { tally[a.name].unlabelled++; continue; }
        labelled++;
        if (L === "D") direct++;
        if (!seen.has(it.title)) { seen.add(it.title); if (L === "D") unionDirect++; }
      }
      tally[a.name].kept += items.length;
      tally[a.name].direct += direct;
      if (labelled) tally[a.name].p_at_n.push(direct / labelled);
    }
  }

  console.log("═".repeat(78));
  console.log(`RESULT · ${run.split} split · top-${run.top_n} · ${run.topics.length} topics`);
  console.log("═".repeat(78));
  console.log("arm".padEnd(12), "precision@N".padEnd(14), "direct".padEnd(9), "kept".padEnd(7), "recall vs union");
  for (const a of ARMS) {
    const x = tally[a.name];
    const p = x.p_at_n.length ? (x.p_at_n.reduce((s, v) => s + v, 0) / x.p_at_n.length) : NaN;
    const recall = unionDirect ? (x.direct / unionDirect) : NaN;
    console.log(a.name.padEnd(12), (isNaN(p) ? "—" : p.toFixed(3)).padEnd(14),
                String(x.direct).padEnd(9), String(x.kept).padEnd(7), isNaN(recall) ? "—" : recall.toFixed(3));
    if (x.unlabelled) console.log(`  ⚠ ${x.unlabelled} item(s) had no label — precision is over the LABELLED subset only`);
  }
  console.log("\n  precision@N counts DIRECTLY RELEVANT over labelled items in each arm's kept set.");
  console.log("  recall is against the union of directly-relevant sources ANY arm found — so an arm that");
  console.log("  raises precision by discarding good sources shows it here as lost recall.");
  console.log("\n  A LOWER kept count on an `absent` topic is a SUCCESS, not a regression.");
  process.exit(0);
}

// ══ MEASUREMENT MODE ═════════════════════════════════════════════════════════
console.log(`Worker : ${WORKER}`);
console.log(`Split  : ${SPLIT} (${SET.length} topics) · top-${TOP_N} · ${ARMS.length} arms\n`);
if (DRY) {
  for (const [t, s, e] of SET) console.log(`  ${e.padEnd(8)} ${s.padEnd(14)} ${t}`);
  console.log("\n✔ DRY RUN — nothing sent. Re-run without --dry.");
  process.exit(0);
}

async function retrieve(topic, armBody) {
  const res = await fetch(WORKER.replace(/\/$/, "") + "/retrieve", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": "http://localhost:8000" },
    body: JSON.stringify({ query: topic, queries: facets(topic), match_count: MATCH_COUNT, ...armBody }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

const report = { worker: WORKER, split: SPLIT, top_n: TOP_N, when: new Date().toISOString(), topics: [] };

for (const [topic, specialty, expect] of SET) {
  process.stdout.write(`${topic.padEnd(46)} `);
  const arms = {};
  for (const a of ARMS) {
    let r;
    try { r = await retrieve(topic, a.body); }
    catch (e) { console.log(`\n✖ ${a.name}: ${e.message}`); process.exit(2); }

    // ── PROVE the Worker actually has these stages ──────────────────────────
    if (!("rerank_applied" in r) || !("metadata_filter_applied" in r)) {
      console.log("");
      console.error("✖ ABORTING: the response has no rerank_applied / metadata_filter_applied fields.");
      console.error("  This Worker predates the pipeline stages — you are almost certainly pointed at the");
      console.error("  OLD DEPLOYED Worker, and every arm would have returned identical baseline results.");
      console.error("  Measuring that and reporting it as 'the stages did not help' is exactly the class of");
      console.error("  mistake this abort exists to prevent. Point --worker at a build of THIS branch.");
      process.exit(3);
    }
    for (const [k, want] of Object.entries(a.expect)) {
      if (r[k] !== want) {
        console.log("");
        console.error(`✖ ABORTING: arm "${a.name}" expected ${k}=${want} but the Worker reported ${r[k]}.`);
        if (a.name.includes("rerank") && r.rerank_applied === false) {
          console.error("  rerank_applied:false with rerank requested means the RPC threw and it fell back.");
          console.error("  Most likely score_candidate_chunks is not present in this Worker's database —");
          console.error("  apply supabase/migrations/add_score_candidate_chunks.sql there first.");
        }
        process.exit(4);
      }
    }

    const items = (r.chunks || []).slice(0, TOP_N).map(c => ({
      title: String(c.title || c.source || "(untitled)").slice(0, 110),
      pmid: c.pmid || null, doi: c.doi || null,
      publication_type: c.publication_type || null, source: c.source || null,
      source_tier: c.source_tier ?? null, is_landmark_trial: !!c.is_landmark_trial,
      matched_facet: c.matched_query || null,
      facet_score: c.ranked_score ?? null, bare_similarity: c.bare_similarity ?? null,
    }));
    arms[a.name] = {
      kept: items.length, items,
      rerank_applied: r.rerank_applied, metadata_filter_applied: r.metadata_filter_applied,
      dropped_by_metadata: r.dropped_by_metadata || [],
      no_eligible_local_sources: !!r.no_eligible_local_sources,
    };
  }
  report.topics.push({ topic, specialty, expect, arms });
  console.log(ARMS.map(a => `${a.name.slice(0,4)} ${String(arms[a.name].kept).padStart(2)}`).join(" · ") +
              (arms.both.no_eligible_local_sources ? "   [no eligible local sources]" : ""));
}

// ── ONE blinded sheet over the union of all arms ─────────────────────────────
try { mkdirSync("rag/runs", { recursive: true }); } catch {}
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const out = `rag/runs/arms-${SPLIT}-${stamp}.json`;
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

let sheet = `# Blinded relevance labeling — ${SPLIT}, ${stamp}\n\n`;
sheet += `Label each source ONCE for its topic. Which arm selected it, and every score, are hidden —\n`;
sheet += `attribution is restored from the JSON when scoring.\n\n`;
sheet += `- **D** directly relevant — supports diagnosis, treatment, mechanism, prognosis or a guideline\n`;
sheet += `  recommendation **for this topic**. Only D counts as topic grounding.\n`;
sheet += `- **A** adjacent/contextual — same disease area, does not address this topic\n`;
sheet += `- **I** irrelevant\n\n`;
sheet += `Replace each \`___\` with D, A or I, then:\n\n`;
sheet += `    node rag/eval_pipeline_arms.mjs --score ${out.replace(/\.json$/, "-LABELS.md")}\n\n---\n\n`;
for (const t of report.topics) {
  const seen = new Map();
  for (const a of ARMS) for (const it of t.arms[a.name].items) if (!seen.has(it.title)) seen.set(it.title, it);
  const items = [...seen.values()];
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  sheet += `## ${t.topic}\n\n`;
  items.forEach((it, i) => { sheet += `${String(i + 1).padStart(2)}. \`___\`  ${it.title}${it.pmid ? `  (PMID ${it.pmid})` : ""}\n`; });
  sheet += `\n`;
}
const sheetPath = out.replace(/\.json$/, "-LABELS.md");
writeFileSync(sheetPath, sheet);

console.log(`\n-> ${out}`);
console.log(`-> ${sheetPath}   ← label this, then re-run with --score`);
console.log(`\nHeld-out topics stay SEALED until the strategy is chosen on calibration.`);
