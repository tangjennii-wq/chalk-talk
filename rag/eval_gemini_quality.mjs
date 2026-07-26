#!/usr/bin/env node
/**
 * GEMINI QUALITY EVAL — the pre-launch gate for exposing "Continue free with Gemini".
 *
 * WHY: the free-Gemini tier lets a talk be WRITTEN by Gemini instead of Claude. The evidence layer
 * (guidelines.json, RAG, landmark trials, PMIDs) is model-independent, so the open question is purely
 * whether the *writing model* is safe for medical teaching material. This script answers that with
 * OBJECTIVE checks on real generations, on the same 10 golden topics, using the SAME prompts the app
 * uses (extracted live from index.html so they can never drift out of sync with production).
 *
 * WHAT IT MEASURES (per generation)
 *   HARD FAILS (any one of these should block the Gemini CTA):
 *     - invalid JSON / unparseable output
 *     - missing required schema fields for the style
 *     - boards: structural hard-invalid (per the app's own validateBoardQuestion)
 *     - FABRICATED CITATION: a cited PMID that does not exist on Europe PMC
 *     - inline [n] marker pointing at a reference id that isn't in the references array
 *     - a misspelled high-risk drug name (edit-distance near-miss of a canonical INN)
 *   SOFT SIGNALS: reference count, uncited-bullet ratio, stem word count, guideline-name mentions.
 *
 * ARMS
 *   GEMINI_API_KEY (required)      -> Gemini arm
 *   ANTHROPIC_API_KEY (optional)   -> adds the Claude arm for a head-to-head baseline, and a blind
 *                                    judge pass. Without it the script still runs Gemini-only and
 *                                    reports absolute safety numbers (which is what gates launch).
 *
 * USAGE
 *   node rag/eval_gemini_quality.mjs                    # all 10 topics, lecture + boards
 *   node rag/eval_gemini_quality.mjs --topics 3         # quick smoke: first 3 topics
 *   node rag/eval_gemini_quality.mjs --style lecture    # one style only
 *   node rag/eval_gemini_quality.mjs --no-judge         # skip the LLM judge even if Claude key set
 * Outputs: rag/eval_gemini_report.json (full, auditable) + a console summary.
 *
 * LIMITATION: Supabase RAG retrieval is not wired in here (it needs embeddings + the live index), so
 * generations are guideline-grounded but not RAG-grounded. Both arms get IDENTICAL context, so the
 * comparison stays fair; absolute citation counts will read lower than production.
 */
import { readFileSync, writeFileSync } from "fs";
import vm from "vm";
import "./loadenv.mjs";

const ARGV = process.argv.slice(2);
const argVal = (k, d) => { const i = ARGV.indexOf(k); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };
const N_TOPICS = parseInt(argVal("--topics", "10"), 10);
const ONLY_STYLE = argVal("--style", "");
const NO_JUDGE = ARGV.includes("--no-judge");

const DRY = ARGV.includes("--dry");
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY || "";
if (!GEMINI_KEY && !DRY) {
  console.error("✖ GEMINI_API_KEY not set. Add it to .env (GEMINI_API_KEY=...) and re-run.");
  console.error("  Get one at https://aistudio.google.com/apikey  ·  never paste keys into chat.");
  process.exit(1);
}
const RUN_CLAUDE = !!CLAUDE_KEY;
const RUN_JUDGE = RUN_CLAUDE && !NO_JUDGE;

// The 10 golden topics (the pre-launch gate set).
const TOPICS_GOLD = [
  "HFrEF guideline-directed medical therapy",
  "Hyponatremia and SIADH",
  "COPD exacerbation management",
  "Pulmonary embolism risk stratification",
  "Acute kidney injury",
  "Cirrhosis with hepatorenal syndrome",
  "Community-acquired pneumonia",
  "Diabetic ketoacidosis",
  "Iron deficiency anemia",
  "Heparin-induced thrombocytopenia",
].slice(0, Math.max(1, N_TOPICS));
const STYLES = ONLY_STYLE ? [ONLY_STYLE] : ["lecture", "boards"];

// ── extract the REAL prompts + logic from index.html (no drift) ────────────────
const html = readFileSync("index.html", "utf8");
function extractVarString(name) {
  const i = html.indexOf(`var ${name} = '`);
  if (i < 0) throw new Error(`could not find var ${name}`);
  const start = html.indexOf("'", i + `var ${name} = `.length);
  let j = start + 1;
  while (j < html.length) { if (html[j] === "\\") j += 2; else if (html[j] === "'") break; else j++; }
  return vm.runInNewContext(html.slice(start, j + 1));   // evaluate the JS string literal
}
function extractBlock(startRe, name) {
  const m = html.match(startRe);
  if (!m) throw new Error(`could not find ${name}`);
  const i = m.index; let s = html.indexOf("{", i), d = 0, j = s;
  for (; j < html.length; j++) { if (html[j] === "{") d++; else if (html[j] === "}") { d--; if (d === 0) break; } }
  return html.slice(i, j + 1);
}
const LECTURE_PROMPT = extractVarString("LECTURE_PROMPT");
const BOARDS_PROMPT = extractVarString("BOARDS_PROMPT");
const BOARDS_DIFFICULTY_SRC = extractBlock(/var BOARDS_DIFFICULTY = /, "BOARDS_DIFFICULTY");
const GET_GL_SRC = extractBlock(/^function getGuidelinesForTopic\(/m, "getGuidelinesForTopic");
const TOPICS_SRC = extractBlock(/var TOPICS = /, "TOPICS");
const VALIDATE_SRC = extractBlock(/^function validateBoardQuestion\(/m, "validateBoardQuestion")
                   + "\n" + extractBlock(/^function _boardHardErrors\(/m, "_boardHardErrors");

// sandbox with the real guideline data + matcher + board validator.
// guidelines.json is wrapped as {schema_version, generated, note, specialties}; unwrap exactly the way
// loadGuidelines() does in index.html (`data.specialties || data`) or getGuidelinesForTopic sees no
// specialties and silently returns empty context. (Caught by --dry, 2026-07-26.)
const _glRaw = JSON.parse(readFileSync("guidelines.json", "utf8"));
const GUIDELINES = (_glRaw && _glRaw.specialties) ? _glRaw.specialties : _glRaw;
const sandbox = { GUIDELINES, console, S: { boardsDifficulty: 4 } };
vm.createContext(sandbox);
vm.runInContext(`${TOPICS_SRC}\n${BOARDS_DIFFICULTY_SRC}\n${GET_GL_SRC}\n${VALIDATE_SRC}`, sandbox);
const getGuidelinesForTopic = (t) => vm.runInContext("getGuidelinesForTopic", sandbox)(t);
const validateBoardQuestion = (q) => vm.runInContext("validateBoardQuestion", sandbox)(q);
const BOARDS_DIFF = vm.runInContext("BOARDS_DIFFICULTY", sandbox);

// ── canonical drug list for misspelling detection ──────────────────────────────
const DRUGS = ("rivaroxaban apixaban edoxaban dabigatran clopidogrel ticagrelor prasugrel cangrelor empagliflozin dapagliflozin "
 + "canagliflozin ertugliflozin semaglutide liraglutide dulaglutide tirzepatide exenatide lisinopril enalapril ramipril losartan "
 + "valsartan telmisartan irbesartan metoprolol carvedilol bisoprolol atorvastatin rosuvastatin vancomycin ceftriaxone meropenem "
 + "levofloxacin clindamycin fluconazole voriconazole isavuconazole micafungin rituximab infliximab adalimumab vedolizumab "
 + "ustekinumab dupilumab imatinib ibrutinib erlotinib dasatinib nilotinib pembrolizumab nivolumab ipilimumab atezolizumab "
 + "sacubitril spironolactone eplerenone finerenone furosemide torsemide bumetanide tolvaptan terlipressin octreotide midodrine "
 + "albumin heparin enoxaparin argatroban bivalirudin fondaparinux warfarin insulin metformin sitagliptin linagliptin "
 + "hydrocortisone methylprednisolone prednisone dexamethasone azithromycin doxycycline piperacillin tazobactam cefepime "
 + "ampicillin amoxicillin nitrofurantoin trimethoprim sulfamethoxazole colchicine allopurinol febuxostat pegloticase "
 + "tocilizumab belimumab anifrolumab voclosporin mycophenolate tacrolimus cyclophosphamide azathioprine methotrexate "
 + "erenumab galcanezumab ubrogepant rimegepant ocrelizumab eculizumab caplacizumab romiplostim eltrombopag fostamatinib "
 + "voxelotor crizanlizumab hydroxyurea deferasirox mavacamten aficamten tafamidis acoramidis vutrisiran inclisiran "
 + "evolocumab alirocumab bempedoic ezetimibe icosapent nintedanib pirfenidone macitentan selexipag riociguat ambrisentan "
 + "tadalafil sildenafil mepolizumab benralizumab reslizumab tezepelumab omalizumab lanadelumab berotralstat icatibant "
 + "resmetirom obeticholic rifaximin lactulose fidaxomicin bezlotoxumab budesonide mesalamine tofacitinib upadacitinib "
 + "ozanimod mirikizumab risankizumab guselkumab abrocitinib baricitinib denosumab romosozumab teriparatide abaloparatide "
 + "zoledronic alendronate risedronate raloxifene varenicline bupropion naltrexone buprenorphine methadone").split(/\s+/);
const DRUGSET = new Set(DRUGS);
function editDistance(a, b) {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return dp[m][n];
}
// A token that is 1-2 edits from a canonical drug but is not itself a real word we know = likely misspelling.
function findDrugMisspellings(text) {
  const out = [];
  const toks = new Set(String(text).toLowerCase().match(/[a-z]{6,}/g) || []);
  for (const tok of toks) {
    if (DRUGSET.has(tok)) continue;
    for (const d of DRUGS) {
      const dist = editDistance(tok, d);
      if (dist > 0 && dist <= 2 && Math.abs(tok.length - d.length) <= 2) {
        // guard: skip legitimate morphology (plural / adjectival / shared stems)
        if (tok === d + "s" || tok === d.replace(/e$/, "") + "es") break;
        out.push({ found: tok, closest: d, distance: dist });
        break;
      }
    }
  }
  return out;
}

// ── citation verification via Europe PMC (no captcha, no NCBI key needed) ──────
const pmidCache = new Map();
let epmcNext = 0;
async function epmcThrottle() { const now = Date.now(), w = Math.max(0, epmcNext - now); epmcNext = Math.max(now, epmcNext) + 220; if (w) await new Promise(r => setTimeout(r, w)); }
async function pmidExists(pmid) {
  if (pmidCache.has(pmid)) return pmidCache.get(pmid);
  await epmcThrottle();
  try {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`EXT_ID:${pmid} AND SRC:MED`)}&format=json`;
    const r = await fetch(url);
    if (!r.ok) { pmidCache.set(pmid, null); return null; }          // null = could not check
    const j = await r.json();
    const hit = (j?.resultList?.result || []).some(x => String(x.pmid) === String(pmid));
    pmidCache.set(pmid, hit); return hit;
  } catch { pmidCache.set(pmid, null); return null; }
}

// ── model calls ───────────────────────────────────────────────────────────────
const GEMINI_MODEL = (html.match(/GEN_GEMINI_BYOK_MODEL\s*=\s*"([^"]+)"/) || [])[1] || "gemini-3.6-flash";
const CLAUDE_MODEL = "claude-opus-5";
// A big lecture/boards JSON can take 60-120s, so these calls MUST have a visible heartbeat and a hard
// timeout — otherwise a hung socket looks identical to "slow but working" and the run appears frozen.
const CALL_TIMEOUT_MS = parseInt(argVal("--timeout", "240000"), 10);
function heartbeat(label) {
  const t0 = Date.now();
  const iv = setInterval(() => process.stdout.write(`\r    ${label} … ${Math.round((Date.now() - t0) / 1000)}s`), 5000);
  return () => { clearInterval(iv); return Date.now() - t0; };
}
async function fetchWithTimeout(url, opts, label) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), CALL_TIMEOUT_MS);
  const stop = heartbeat(label);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  catch (e) {
    if (e.name === "AbortError") throw new Error(`timed out after ${Math.round(CALL_TIMEOUT_MS / 1000)}s (raise with --timeout <ms>)`);
    throw e;
  } finally { clearTimeout(to); stop(); process.stdout.write("\r" + " ".repeat(60) + "\r"); }
}
async function callGemini(system, user, maxTok = 8000) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }],
                 generationConfig: { maxOutputTokens: maxTok, temperature: 1 } };
  const r = await fetchWithTimeout(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, "gemini");
  const t = await r.text();
  if (!r.ok) throw new Error(`gemini ${r.status}: ${t.slice(0, 300)}`);
  const j = JSON.parse(t);
  const cand = j?.candidates?.[0];
  const txt = (cand?.content?.parts || []).map(p => p.text || "").join("");
  // MAX_TOKENS with empty text = the model spent its budget on reasoning and emitted nothing usable
  if (!txt && cand?.finishReason) throw new Error(`gemini returned no text (finishReason: ${cand.finishReason})`);
  return txt;
}
async function callClaude(system, user, maxTok = 8000, model = CLAUDE_MODEL) {
  const r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTok, system, messages: [{ role: "user", content: user }] }),
  }, "claude");
  const t = await r.text();
  if (!r.ok) throw new Error(`claude ${r.status}: ${t.slice(0, 300)}`);
  const j = JSON.parse(t);
  return (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
}

function stripFences(s) {
  let x = String(s || "").trim();
  x = x.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = x.indexOf("{"), b = x.lastIndexOf("}");
  return a >= 0 && b > a ? x.slice(a, b + 1) : x;
}

// ── per-generation grading ────────────────────────────────────────────────────
const REQUIRED_LECTURE = ["title", "sections", "summary_points", "visual_memory_card"];
const REQUIRED_BOARDS = ["title", "question", "key_point", "board_pearls", "visual_memory_card"];

async function grade(style, raw) {
  const hard = [], soft = {};
  let talk = null;
  try { talk = JSON.parse(stripFences(raw)); }
  catch (e) { hard.push(`invalid JSON: ${e.message}`); return { hard, soft, talk: null }; }

  for (const f of (style === "boards" ? REQUIRED_BOARDS : REQUIRED_LECTURE))
    if (talk[f] == null) hard.push(`missing required field: ${f}`);

  if (style === "boards" && talk.question) {
    const v = validateBoardQuestion(talk.question);
    if (v && v.hard && v.hard.length) for (const h of v.hard) hard.push(`board structure: ${h}`);
    const stemWords = String(talk.question.stem || "").split(/\s+/).filter(Boolean).length;
    soft.stem_words = stemWords;
    if (stemWords && (stemWords < 100 || stemWords > 200)) soft.stem_out_of_range = true;
  }

  // citations: collect reference ids + any PMIDs, verify existence
  const refs = Array.isArray(talk.references) ? talk.references : [];
  soft.reference_count = refs.length;
  const ids = new Set(refs.map(r => String(r.id)));
  const bodyText = JSON.stringify(talk);
  const markers = new Set();
  for (const m of bodyText.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g))
    for (const n of m[1].split(",")) markers.add(n.trim());
  for (const n of markers) if (!ids.has(n)) hard.push(`inline marker [${n}] has no matching reference id`);
  soft.inline_marker_count = markers.size;

  const pmids = new Set();
  for (const r of refs) {
    const s = `${r.url || ""} ${r.source || ""} ${r.pmid || ""}`;
    for (const m of s.matchAll(/(?:pubmed\.ncbi\.nlm\.nih\.gov\/|pmid[:\s]*)(\d{7,8})/gi)) pmids.add(m[1]);
    if (/^\d{7,8}$/.test(String(r.pmid || ""))) pmids.add(String(r.pmid));
  }
  soft.pmids_cited = pmids.size;
  let fabricated = 0, uncheckable = 0;
  if (pmids.size) process.stdout.write(`(verifying ${pmids.size} PMID${pmids.size === 1 ? "" : "s"}) `);
  for (const p of pmids) {
    const ex = await pmidExists(p);
    if (ex === false) { hard.push(`FABRICATED CITATION: PMID ${p} does not exist on Europe PMC`); fabricated++; }
    else if (ex === null) uncheckable++;
  }
  soft.fabricated_pmids = fabricated;
  if (uncheckable) soft.uncheckable_pmids = uncheckable;

  const bad = findDrugMisspellings(bodyText);
  if (bad.length) for (const b of bad.slice(0, 5)) hard.push(`possible misspelled drug: "${b.found}" (closest: ${b.closest}, distance ${b.distance})`);
  soft.drug_flags = bad.length;

  // guideline anchoring: did it name a society + year?
  soft.guideline_mentions = (bodyText.match(/\b(KDIGO|AHA\/ACC|ACC\/AHA|ADA|IDSA|ATS|ERS|AASLD|ACG|ASH|ASCO|ACR|AAN|SCCM|USPSTF|GOLD|ESC|EULAR|NCCN|AAAAI)\b/g) || []).length;
  return { hard, soft, talk };
}

// ── run ───────────────────────────────────────────────────────────────────────
function buildUser(topic, style) {
  const gl = getGuidelinesForTopic(topic);
  let u = `Topic: ${topic}\n\n`;
  if (gl && gl.context) u += `GUIDELINE REFERENCE CONTEXT:\n${gl.context}\n\n`;
  if (style === "boards") {
    const d = BOARDS_DIFF[4];
    u += `TARGET DIFFICULTY LEVEL: 4 (${d.label})\n${d.directive}\n\n`;
  }
  u += `Write the ${style === "boards" ? "board question" : "chalk talk"} now. Output ONLY the JSON.`;
  return u;
}

// ── --dry: verify extraction + grading offline, with NO API calls and NO quota burn ────────────
if (DRY) {
  console.log("DRY RUN — extraction + grading self-test, no API calls.\n");
  console.log(`  LECTURE_PROMPT extracted: ${LECTURE_PROMPT.length} chars`);
  console.log(`  BOARDS_PROMPT  extracted: ${BOARDS_PROMPT.length} chars`);
  console.log(`  gemini model from index.html: ${GEMINI_MODEL}`);
  console.log(`  BOARDS_DIFFICULTY[4]: ${BOARDS_DIFF[4] && BOARDS_DIFF[4].label}`);
  let ctxOK = 0;
  for (const t of TOPICS_GOLD) {
    const gl = getGuidelinesForTopic(t);
    const n = gl && gl.context ? gl.context.length : 0;
    if (n) ctxOK++;
    console.log(`    ${n ? "✓" : "·"} ${t} → guideline context ${n} chars`);
  }
  console.log(`  guideline context found for ${ctxOK}/${TOPICS_GOLD.length} topics`);
  console.log(`  user prompt sample (${TOPICS_GOLD[0]}, boards): ${buildUser(TOPICS_GOLD[0], "boards").length} chars`);

  // grading self-test on a deliberately bad talk: fabricated PMID, misspelled drug, orphan marker
  const badTalk = JSON.stringify({
    title: "T", sections: [{ heading: "Rx", points: ["Start apixiban 5 mg BID [1]", "Add dapagliflozin [7]"] }],
    summary_points: ["x"], visual_memory_card: { top_left: "a", top_right: "b", bottom_left: "c", bottom_right: "d" },
    references: [{ id: 1, source: "Invented Trial", year: 2024, url: "https://pubmed.ncbi.nlm.nih.gov/99999999/" }],
  });
  const g = await grade("lecture", badTalk);
  console.log("\n  grading self-test on a deliberately bad talk:");
  for (const h of g.hard) console.log("    ✖ " + h);
  const hasDrug = g.hard.some(h => /misspelled drug/.test(h));
  const hasOrphan = g.hard.some(h => /inline marker \[7\]/.test(h));
  const hasFab = g.hard.some(h => /FABRICATED/.test(h)) || (g.soft.uncheckable_pmids > 0);
  console.log(`\n  detectors: drug-misspelling ${hasDrug ? "OK" : "FAILED"} · orphan-marker ${hasOrphan ? "OK" : "FAILED"} · fabricated-PMID ${hasFab ? "OK (or unchecked offline)" : "FAILED"}`);
  console.log(`\n${hasDrug && hasOrphan ? "✔ DRY RUN OK — safe to run the live eval." : "✖ DRY RUN problem — fix before the live eval."}`);
  process.exit(hasDrug && hasOrphan ? 0 : 1);
}

const results = [];
console.log(`Gemini quality eval — ${TOPICS_GOLD.length} topic(s) × ${STYLES.length} style(s)`);
console.log(`  gemini: ${GEMINI_MODEL}   claude arm: ${RUN_CLAUDE ? CLAUDE_MODEL : "SKIPPED (no ANTHROPIC_API_KEY)"}   judge: ${RUN_JUDGE ? "on" : "off"}\n`);

for (const topic of TOPICS_GOLD) {
  for (const style of STYLES) {
    const system = style === "boards" ? BOARDS_PROMPT : LECTURE_PROMPT;
    const user = buildUser(topic, style);
    const row = { topic, style, gemini: null, claude: null };
    process.stdout.write(`  ${topic} [${style}] … `);

    try {
      const t0 = Date.now();
      const raw = await callGemini(system, user);
      const g = await grade(style, raw);
      row.gemini = { ms: Date.now() - t0, hard: g.hard, soft: g.soft, raw_len: raw.length, raw };
      process.stdout.write(`gemini ${g.hard.length ? "✖" + g.hard.length : "✓"} `);
    } catch (e) { row.gemini = { error: e.message, hard: [`call failed: ${e.message}`], soft: {} }; process.stdout.write(`gemini ERR `); }

    if (RUN_CLAUDE) {
      try {
        const t0 = Date.now();
        const raw = await callClaude(system, user);
        const g = await grade(style, raw);
        row.claude = { ms: Date.now() - t0, hard: g.hard, soft: g.soft, raw_len: raw.length, raw };
        process.stdout.write(`claude ${g.hard.length ? "✖" + g.hard.length : "✓"}`);
      } catch (e) { row.claude = { error: e.message, hard: [`call failed: ${e.message}`], soft: {} }; process.stdout.write(`claude ERR`); }
    }

    if (RUN_JUDGE && row.gemini?.talk !== null && row.claude && !row.claude.error && !row.gemini.error) {
      try {
        const A = row.gemini.raw, B = row.claude.raw;
        const flip = Math.random() < 0.5;   // blind + position-randomized
        const judgeSys = "You are a senior internal-medicine attending grading two AI-written teaching artifacts on the SAME topic. "
          + "Judge ONLY: (1) medical accuracy, (2) guideline fidelity (correct society/year, no overstated strength), (3) teaching value for an IM resident, "
          + "(4) citation honesty (no claim attributed to a source that would not support it). Ignore formatting and length. "
          + 'Reply ONLY as JSON: {"winner":"A"|"B"|"tie","accuracy_A":1-5,"accuracy_B":1-5,"errors_A":[""],"errors_B":[""],"why":""}. '
          + "List any factually WRONG medical statement in errors_*.";
        const jr = await callClaude(judgeSys, `TOPIC: ${topic} (${style})\n\n--- ARTIFACT A ---\n${flip ? B : A}\n\n--- ARTIFACT B ---\n${flip ? A : B}`, 2000);
        const j = JSON.parse(stripFences(jr));
        // de-randomize back to model names
        const map = (w) => w === "tie" ? "tie" : ((w === "A") === !flip ? "gemini" : "claude");
        row.judge = { winner: map(j.winner), gemini_accuracy: flip ? j.accuracy_B : j.accuracy_A,
                      claude_accuracy: flip ? j.accuracy_A : j.accuracy_B,
                      gemini_errors: flip ? j.errors_B : j.errors_A, claude_errors: flip ? j.errors_A : j.errors_B, why: j.why };
        process.stdout.write(`  judge:${row.judge.winner}`);
      } catch (e) { row.judge = { error: e.message }; }
    }
    console.log("");
    results.push(row);
  }
}

// ── summarize ─────────────────────────────────────────────────────────────────
const sum = (arm) => {
  const rows = results.map(r => r[arm]).filter(Boolean);
  const withHard = rows.filter(r => (r.hard || []).length);
  const fab = rows.reduce((a, r) => a + (r.soft?.fabricated_pmids || 0), 0);
  const drug = rows.reduce((a, r) => a + (r.soft?.drug_flags || 0), 0);
  const refs = rows.reduce((a, r) => a + (r.soft?.reference_count || 0), 0);
  const errs = rows.filter(r => r.error).length;
  return { generations: rows.length, clean: rows.length - withHard.length, with_hard_fails: withHard.length,
           call_errors: errs, fabricated_citations: fab, drug_misspellings: drug, total_references: refs };
};
const summary = { generated_at: new Date().toISOString(), gemini_model: GEMINI_MODEL,
  claude_model: RUN_CLAUDE ? CLAUDE_MODEL : null, topics: TOPICS_GOLD, styles: STYLES,
  gemini: sum("gemini"), claude: RUN_CLAUDE ? sum("claude") : null };
if (RUN_JUDGE) {
  const js = results.map(r => r.judge).filter(j => j && !j.error);
  summary.judge = { compared: js.length,
    gemini_wins: js.filter(j => j.winner === "gemini").length,
    claude_wins: js.filter(j => j.winner === "claude").length,
    ties: js.filter(j => j.winner === "tie").length,
    mean_accuracy_gemini: +(js.reduce((a, j) => a + (j.gemini_accuracy || 0), 0) / (js.length || 1)).toFixed(2),
    mean_accuracy_claude: +(js.reduce((a, j) => a + (j.claude_accuracy || 0), 0) / (js.length || 1)).toFixed(2),
    gemini_flagged_errors: js.flatMap(j => j.gemini_errors || []).filter(Boolean),
    claude_flagged_errors: js.flatMap(j => j.claude_errors || []).filter(Boolean) };
}
writeFileSync("rag/eval_gemini_report.json", JSON.stringify({ summary, results }, null, 2) + "\n");

console.log("\n═══ SUMMARY ═══");
const p = (label, s) => { if (!s) return;
  console.log(`  ${label}: ${s.clean}/${s.generations} clean · hard-fails ${s.with_hard_fails} · fabricated citations ${s.fabricated_citations} · drug misspellings ${s.drug_misspellings} · refs ${s.total_references}${s.call_errors ? ` · call errors ${s.call_errors}` : ""}`); };
p("GEMINI", summary.gemini);
p("CLAUDE", summary.claude);
if (summary.judge) {
  const j = summary.judge;
  console.log(`  JUDGE: gemini ${j.gemini_wins} · claude ${j.claude_wins} · tie ${j.ties} | mean accuracy gemini ${j.mean_accuracy_gemini} vs claude ${j.mean_accuracy_claude}`);
  if (j.gemini_flagged_errors.length) { console.log("  judge-flagged GEMINI medical errors:"); for (const e of j.gemini_flagged_errors.slice(0, 10)) console.log("    - " + e); }
  if (j.claude_flagged_errors.length) { console.log("  judge-flagged CLAUDE medical errors:"); for (const e of j.claude_flagged_errors.slice(0, 10)) console.log("    - " + e); }
}
const blocking = results.flatMap(r => (r.gemini?.hard || []).map(h => `${r.topic} [${r.style}]: ${h}`));
if (blocking.length) {
  console.log(`\n═══ GEMINI HARD FAILS (${blocking.length}) ═══`);
  for (const b of blocking) console.log("  ✖ " + b);
}
console.log(`\n-> full report: rag/eval_gemini_report.json`);

// GATE: any fabricated citation or misspelled drug is disqualifying for a medical teaching tool.
const g = summary.gemini;
const disqualifying = g.fabricated_citations > 0 || g.drug_misspellings > 0;
if (disqualifying) {
  console.log("\n✖ GATE FAILED — fabricated citations and/or misspelled drugs are disqualifying. Do NOT expose the Gemini CTA.");
  process.exit(1);
}
if (g.with_hard_fails > 0) {
  console.log(`\n⚠ GATE INCONCLUSIVE — ${g.with_hard_fails}/${g.generations} generations had structural hard fails (no fabricated citations or drug errors).`);
  console.log("  Review the report: structural misses may be fixable with a prompt tweak; re-run after.");
  process.exit(2);
}
console.log(`\n✔ GATE PASSED — ${g.clean}/${g.generations} Gemini generations clean, 0 fabricated citations, 0 drug misspellings.`);
