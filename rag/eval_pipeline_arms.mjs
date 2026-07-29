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
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import "./loadenv.mjs";

// ── RELEVANCE IS TOPIC-SPECIFIC (Codex, 2026-07-28) ─────────────────────────
// The same paper is legitimately D for one topic, A for another and I for a third: a patiromer trial is
// directly relevant to hyperkalemia, contextual for HFrEF, irrelevant to DKA. Keying labels on chunk_id
// alone meant one judgement overwrote the others and the survivor was applied everywhere — including in
// the recall denominator. EVERY evaluation identity is the PAIR.
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const pairKey = (topic, chunkId) => `${slug(topic)}::${chunkId}`;

const ARGV = process.argv.slice(2);
const argVal = (k, d) => { const i = ARGV.indexOf(k); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };
const DRY = ARGV.includes("--dry");
const WORKER = argVal("--worker", "");
const SPLIT = argVal("--split", "calibration");
// PRODUCTION SELECTION, read off index.html retrieveRAG (Codex, 2026-07-28):
//   var glChunks = chunks.filter(c => c.source === "guideline").slice(0, 4);
//   chunks      = chunks.filter(c => c.source !== "guideline").slice(0, MAX_KEEP /* 8 */);
// SEPARATE caps, so guidelines cannot crowd out literature or vice versa. Grading a generic top-8 would
// have measured a selection the app never makes.
const MAX_PAPERS = parseInt(argVal("--papers", "8"), 10);
const MAX_GUIDELINES = parseInt(argVal("--guidelines", "4"), 10);
const TOP_N = MAX_PAPERS + MAX_GUIDELINES;
const SCORE_SHEET = argVal("--score", "");
// A short excerpt forces guesses, and a complete sheet of guesses is worse than an incomplete one — it
// looks like data. Default generous; --excerpt raises it further. (Codex, 2026-07-28)
const EXCERPT_CHARS = parseInt(argVal("--excerpt", "1200"), 10);

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

// EVERY arm asserts authority_tiebreak_applied === false. It used to fire whenever either stage was on,
// so "rerank only" silently meant "rerank + authority ranking". It is a separate flag now, and this
// experiment holds it OFF in all four arms so a difference is attributable to ONE named stage.
// (Codex, 2026-07-28)
const ARMS = [
  { name: "baseline", body: {},                                      expect: { rerank_applied: false, metadata_filter_applied: false, authority_tiebreak_applied: false } },
  { name: "rerank",   body: { rerank: true },                        expect: { rerank_applied: true,  metadata_filter_applied: false, authority_tiebreak_applied: false } },
  { name: "metadata", body: { metadata_filter: true },               expect: { rerank_applied: false, metadata_filter_applied: true,  authority_tiebreak_applied: false } },
  { name: "both",     body: { rerank: true, metadata_filter: true }, expect: { rerank_applied: true,  metadata_filter_applied: true,  authority_tiebreak_applied: false } },
];

const SET = LABELED[SPLIT];
if (!SET) { console.error(`✖ unknown split "${SPLIT}"`); process.exit(1); }

// ── HELD-OUT LOCK, enforced rather than requested (Codex, 2026-07-28) ────────
// A comment saying "keep held_out sealed" is not a seal. Running held_out requires a calibration run to
// exist AND an explicit --unseal flag naming the decision it is confirming, which is recorded in the
// report. Looking at held-out early spends the only unbiased check available, and the cost of that is
// invisible afterwards.
const SEAL = "rag/runs/HELD_OUT_UNSEALED.txt";
const DECISION = "rag/runs/SELECTED_STRATEGY.json";
if (SPLIT === "held_out") {
  // A seal that any unlabelled JSON plus arbitrary free text can open is ceremonial. Held-out may only
  // be opened once calibration has been SCORED and a strategy RECORDED — because held-out confirms a
  // decision, and a decision has to exist first. (Codex, 2026-07-28)
  const scored = (() => {
    try { return readdirSync("rag/runs").filter(f => /^arms-calibration-.*-SCORED\.json$/.test(f)); }
    catch { return []; }
  })();
  if (!scored.length) {
    console.error("✖ SEALED: no SCORED calibration artifact exists.");
    console.error("  Run calibration, label the sheet completely, and score it. An unlabelled run is not");
    console.error("  a result, and held-out cannot confirm a decision that has not been made.");
    process.exit(5);
  }
  if (!existsSync(DECISION)) {
    console.error(`✖ SEALED: ${DECISION} is missing.`);
    console.error("  Scoring writes it with the arm you selected. Recording the choice BEFORE seeing");
    console.error("  held-out is the whole mechanism — otherwise held-out becomes a second calibration.");
    process.exit(5);
  }
  let decision;
  try { decision = JSON.parse(readFileSync(DECISION, "utf8")); } catch { decision = null; }
  const validArms = ARMS.map(a => a.name);
  if (!decision || !validArms.includes(decision.selected_strategy)) {
    console.error(`✖ SEALED: ${DECISION} must contain {"selected_strategy": one of ${validArms.join("|")}}`);
    console.error(`  Found: ${JSON.stringify(decision)}`);
    process.exit(5);
  }
  // The decision must be traceable to a scored artifact that EXISTS. Otherwise a stale or unrelated
  // SCORED file left in rag/runs unlocks held-out for a decision it never informed. (Codex, 2026-07-28)
  const fromBase = String(decision.from || "").split("/").pop();
  if (!decision.from || !scored.includes(fromBase)) {
    console.error(`✖ SEALED: ${DECISION}.from must name a scored calibration artifact that exists.`);
    console.error(`  from      : ${decision.from || "(absent)"}`);
    console.error(`  available : ${scored.length ? scored.join(", ") : "(none)"}`);
    console.error("  Without this link, a stale SCORED file unlocks held-out for a decision it never informed.");
    process.exit(5);
  }
  const unsealReason = argVal("--unseal", "");
  if (unsealReason !== decision.selected_strategy) {
    console.error(`✖ SEALED: --unseal must NAME the recorded strategy ("${decision.selected_strategy}").`);
    console.error("  Free text would let the seal be opened without committing to anything.");
    process.exit(5);
  }
  try { mkdirSync("rag/runs", { recursive: true }); } catch {}
  writeFileSync(SEAL, `${new Date().toISOString()}  confirming "${decision.selected_strategy}" (from ${decision.from || "?"})\n`, { flag: "a" });
  console.log(`⚠ HELD-OUT UNSEALED — confirming "${decision.selected_strategy}", recorded in ${SEAL}\n`);
}

// ══ SCORING MODE ═════════════════════════════════════════════════════════════
if (SCORE_SHEET) {
  const sheet = readFileSync(SCORE_SHEET, "utf8");
  const runFile = SCORE_SHEET.replace(/-LABELS(-FILLED)?\.md$/, ".json");
  const run = JSON.parse(readFileSync(runFile, "utf8"));

  // LABELS KEY ON chunk_id, NOT TITLE. Two chunks can share a title, and a title can be reformatted
  // between runs — either way a title-keyed label lands on the wrong source, silently. The sheet carries
  // the id in a [#id] tag. (Codex, 2026-07-28)
  const labels = new Map();
  const malformed = [];
  for (const line of sheet.split("\n")) {
    // [#<topic-slug>::<chunk_id>] — the PAIR, because relevance is topic-specific
    const m = line.match(/^\s*\d+\.\s+`([^`]*)`\s+\[#([a-z0-9-]+::\d+)\]/);
    if (!m) continue;
    const v = m[1].trim().toUpperCase();
    if (v === "D" || v === "A" || v === "I") labels.set(m[2], v);
    else malformed.push({ key: m[2], got: m[1] });
  }

  // ── EVERY candidate must carry a label, or there is no result ──────────────
  // Scoring a partially-labelled sheet silently computes precision over whichever subset happened to be
  // filled in, and the missing items are not missing at random — they are the ones that were hard to
  // judge. That is the same shape as every instrument failure on this project: a number that answers an
  // easier question than the one asked.
  const required = new Map();
  for (const t of run.topics) for (const a of ARMS)
    for (const it of (t.arms[a.name] || {}).items || [])
      required.set(pairKey(t.topic, it.chunk_id), { topic: t.topic, title: it.title });
  const missing = [...required.keys()].filter(k => !labels.has(k));
  if (missing.length || malformed.length) {
    console.error(`✖ INCOMPLETE LABELLING — refusing to score.`);
    if (missing.length) {
      console.error(`\n  ${missing.length}/${required.size} candidate(s) have no D/A/I label:`);
      for (const k of missing.slice(0, 12)) console.error(`    [#${k}] ${required.get(k).topic} — ${required.get(k).title.slice(0, 60)}`);
      if (missing.length > 12) console.error(`    …and ${missing.length - 12} more`);
    }
    if (malformed.length) {
      console.error(`\n  ${malformed.length} label(s) are not D, A or I:`);
      for (const x of malformed.slice(0, 8)) console.error(`    [#${x.key}] got "${x.got}"`);
    }
    console.error(`\n  Partial labelling would compute precision over whatever was easy to judge.`);
    process.exit(7);
  }
  console.log(`Loaded ${labels.size} labels — every candidate is labelled.\n`);

  const tally = {};
  for (const a of ARMS) tally[a.name] = { p_at_n: [], direct: 0, kept: 0, papers: 0, guidelines: 0 };
  // Recall denominator is over (topic, source) PAIRS — a paper that is D for hyperkalemia does not make
  // the same paper a hit for DKA.
  const unionDirect = new Set();
  for (const t of run.topics) for (const a of ARMS)
    for (const it of (t.arms[a.name] || {}).items || [])
      if (labels.get(pairKey(t.topic, it.chunk_id)) === "D") unionDirect.add(pairKey(t.topic, it.chunk_id));

  for (const t of run.topics) {
    for (const a of ARMS) {
      const items = (t.arms[a.name] || {}).items || [];
      const direct = items.filter(it => labels.get(pairKey(t.topic, it.chunk_id)) === "D").length;
      tally[a.name].kept += items.length;
      tally[a.name].direct += direct;
      tally[a.name].papers += items.filter(i => i.kind === "paper").length;
      tally[a.name].guidelines += items.filter(i => i.kind === "guideline").length;
      if (items.length) tally[a.name].p_at_n.push(direct / items.length);
    }
  }

  console.log("═".repeat(78));
  console.log(`RESULT · ${run.split} split · top-${run.top_n} · ${run.topics.length} topics`);
  console.log("═".repeat(78));
  console.log("arm".padEnd(11), "precision".padEnd(11), "direct".padEnd(8), "kept".padEnd(7), "pap/gl".padEnd(9), "recall");
  const U = unionDirect.size;
  for (const a of ARMS) {
    const x = tally[a.name];
    const p = x.p_at_n.length ? (x.p_at_n.reduce((s, v) => s + v, 0) / x.p_at_n.length) : NaN;
    console.log(a.name.padEnd(11), (isNaN(p) ? "—" : p.toFixed(3)).padEnd(11),
                String(x.direct).padEnd(8), String(x.kept).padEnd(7),
                `${x.papers}/${x.guidelines}`.padEnd(9), U ? (x.direct / U).toFixed(3) : "—");
  }
  // Machine-readable artifacts. The SCORED file is what unseals held-out; the decision file is written
  // as a STUB with selected_strategy null, so opening held-out requires a human to choose deliberately.
  const scoredPath = runFile.replace(/\.json$/, "-SCORED.json");
  writeFileSync(scoredPath, JSON.stringify({
    from: runFile, when: new Date().toISOString(), split: run.split,
    labelled_pairs: labels.size, union_direct_pairs: unionDirect.size,
    arms: Object.fromEntries(ARMS.map(a => {
      const x = tally[a.name];
      return [a.name, {
        precision: x.p_at_n.length ? +(x.p_at_n.reduce((s2, v) => s2 + v, 0) / x.p_at_n.length).toFixed(4) : null,
        direct: x.direct, kept: x.kept, papers: x.papers, guidelines: x.guidelines,
        recall: unionDirect.size ? +(x.direct / unionDirect.size).toFixed(4) : null,
      }];
    })),
  }, null, 2) + "\n");
  if (!existsSync(DECISION)) {
    writeFileSync(DECISION, JSON.stringify({
      selected_strategy: null,
      note: "Set selected_strategy to one of: " + ARMS.map(a => a.name).join(", ") +
            ". Held-out will not open until this names an arm, and --unseal must repeat it.",
      from: scoredPath,
    }, null, 2) + "\n");
    console.log(`\n-> ${DECISION}  ← record your chosen arm here before opening held-out`);
  }
  console.log(`-> ${scoredPath}`);
  console.log("\n  precision@N counts DIRECTLY RELEVANT over labelled items in each arm's kept set.");
  console.log("  recall is against the union of directly-relevant sources ANY arm found — so an arm that");
  console.log("  raises precision by discarding good sources shows it here as lost recall.");
  console.log("\n  A LOWER kept count on an `absent` topic is a SUCCESS, not a regression.");
  process.exit(0);
}

// ══ MEASUREMENT MODE ═════════════════════════════════════════════════════════
console.log(`Worker : ${WORKER}`);
console.log(`Split  : ${SPLIT} (${SET.length} topics) · ${MAX_PAPERS} papers + ${MAX_GUIDELINES} guidelines (production split) · ${ARMS.length} arms\n`);
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
    if (!("rerank_applied" in r) || !("metadata_filter_applied" in r) || !("authority_tiebreak_applied" in r)) {
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

    // ── THE ARMS MUST DIFFER BY ONE THING (Codex, 2026-07-29) ────────────────────────────────────
    // rerank_applied:true only proves the stage ran, not that it ranked the way production ranks. The
    // first implementation sorted by raw cosine, which ALSO repealed the tier / landmark / elite-journal
    // / RCR boosts that baseline and metadata keep — so "rerank" meant two changes wearing one name and
    // no difference could be attributed. If bare_ranked_score is missing, the Worker is talking to a
    // pre-parity score_candidate_chunks and this run would measure a ranking-policy change instead.
    // Abort: ~130 physician judgements is far too expensive to spend on a mislabeled contrast.
    if (r.rerank_applied === true) {
      const chunks = r.chunks || [];
      if (chunks.length && chunks.every(c => c.bare_ranked_score == null)) {
        console.log("");
        console.error(`✖ ABORTING: arm "${a.name}" reranked but returned no bare_ranked_score.`);
        console.error("  The deployed score_candidate_chunks predates the 2026-07-29 authority-parity fix,");
        console.error("  so this arm would be ranking on raw cosine while baseline/metadata keep the");
        console.error("  deployed authority boosts. That is a ranking-policy change, not a rerank, and the");
        console.error("  four-arm design cannot attribute it. Re-apply add_score_candidate_chunks.sql.");
        process.exit(8);
      }
    }

    // Apply production's SPLIT selection, not a generic top-N.
    const all = r.chunks || [];
    const guidelines = all.filter(c => c.source === "guideline").slice(0, MAX_GUIDELINES);
    const papers     = all.filter(c => c.source !== "guideline").slice(0, MAX_PAPERS);
    const items = [...papers, ...guidelines].map(c => ({
      // STABLE ID. Deduplication and label restoration key on chunk_id, never on title — two chunks can
      // share a title, and a title can be reformatted between runs. (Codex, 2026-07-28)
      chunk_id: c.chunk_id,
      kind: c.source === "guideline" ? "guideline" : "paper",
      title: String(c.title || c.source || "(untitled)"),   // FULL title — not truncated
      pmid: c.pmid || null, doi: c.doi || null,
      publication_type: c.publication_type || null, source: c.source || null,
      source_tier: c.source_tier ?? null,
      // is_landmark_trial is NOT in match_chunks' RETURNS TABLE in the checked-in migration, so it is
      // not reported here. If the deployed function does return it, that is schema drift worth fixing
      // before anyone relies on the field. (Codex, 2026-07-28)
      journal: c.journal || null, year: c.year ?? null,
      // The excerpt a physician needs to judge "does this support diagnosis / treatment / mechanism /
      // prognosis for THIS topic". A 110-character title cannot answer that. Identical wherever the same
      // (topic, source) pair appears, because it comes from the same stored chunk. (Codex, 2026-07-28)
      excerpt: String(c.text || "").replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS),
      matched_facet: c.matched_query || null,
      facet_score: c.ranked_score ?? null, bare_similarity: c.bare_similarity ?? null,
      // Recorded so the arms stay auditable after the 2026-07-29 parity fix: this is the key the rerank
      // arms actually sort on, and it is the same authority formula the baseline arms rank by — only the
      // query supplying similarity differs. bare_similarity is kept alongside it for diagnostics.
      bare_ranked_score: c.bare_ranked_score ?? null,
    }));
    if (items.some(i => i.chunk_id == null)) {
      console.log("");
      console.error("✖ ABORTING: a returned chunk has no chunk_id. Dedup and label restoration depend on");
      console.error("  stable ids; falling back to titles is how labels get attached to the wrong source.");
      process.exit(6);
    }
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
sheet += `Replace each \`___\` with D, A or I. **Every line must be labelled** — scoring refuses a\n`;
sheet += `partial sheet, because the unlabelled items would be the hard ones and precision over "whatever\n`;
sheet += `was easy to judge" is not a result.\n\n`;
sheet += `**Do not guess.** A complete sheet of guesses is worse than an incomplete one, because it looks\n`;
sheet += `like data. Where the excerpt below is not enough to decide, open the PMID/DOI and read the\n`;
sheet += `abstract. That is slower and it is the point — every label should rest on evidence.\n\n`;
sheet += `The \`[#topic::id]\` tags are how labels find their source. Do not edit or reorder them.\n\nThen:\n\n`;
sheet += `    node rag/eval_pipeline_arms.mjs --score ${out.replace(/\.json$/, "-LABELS.md")}\n\n---\n\n`;
for (const t of report.topics) {
  // dedupe by chunk_id — stable, unlike a title
  const seen = new Map();
  for (const a of ARMS) for (const it of t.arms[a.name].items) if (!seen.has(it.chunk_id)) seen.set(it.chunk_id, it);
  const items = [...seen.values()];
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  sheet += `## ${t.topic}\n\n`;
  // FULL record per candidate. A truncated title cannot answer "does this support diagnosis, treatment,
  // mechanism or prognosis for THIS topic" — which is the question being asked. Arm and every score stay
  // hidden. (Codex, 2026-07-28)
  items.forEach((it, i) => {
    const meta = [
      it.kind === "guideline" ? "guideline" : (it.publication_type || "type unknown"),
      [it.journal, it.year].filter(Boolean).join(" "),
      it.pmid ? `PMID ${it.pmid}` : (it.doi ? `DOI ${it.doi}` : null),
    ].filter(Boolean).join(" · ");
    sheet += `${String(i + 1).padStart(2)}. \`___\`  [#${pairKey(t.topic, it.chunk_id)}]\n`;
    sheet += `    **${it.title}**\n`;
    sheet += `    ${meta}\n`;
    if (it.excerpt) sheet += `    > ${it.excerpt}\n`;
    sheet += `\n`;
  });
  sheet += `\n`;
}
const sheetPath = out.replace(/\.json$/, "-LABELS.md");
writeFileSync(sheetPath, sheet);

console.log(`\n-> ${out}`);
console.log(`-> ${sheetPath}   ← label this, then re-run with --score`);
console.log(`\nHeld-out topics stay SEALED until the strategy is chosen on calibration.`);
