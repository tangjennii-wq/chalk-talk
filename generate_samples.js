#!/usr/bin/env node
/**
 * generate_samples.js — Chalk Talk demo-mode sample generator
 *
 * Generates ~10 pre-baked chalk talks using the same two-step flow the live
 * app uses (Sonnet drafts → Haiku peer-reviews & corrects), then embeds them
 * into index.html so users can browse samples without an API key.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node generate_samples.js
 *
 * Optional flags:
 *   --only=hyponatremia,hfref     Regenerate just specific topic slugs
 *   --no-embed                    Write samples.json but don't touch index.html
 *   --dry                         Print what would be generated, no API calls
 *
 * Notes:
 *  • Requires Node 18+ (for built-in fetch)
 *  • LECTURE_PROMPT and BOARDS_PROMPT below are kept verbatim in sync with
 *    index.html — if you edit prompts in the app, mirror them here too.
 *  • SAMPLES is replaced inside index.html via a marker comment. Don't
 *    remove the `// __SAMPLES_MARKER__` comment in the HTML.
 */

const fs = require("fs");
const path = require("path");

// ─── CONFIG ────────────────────────────────────────────────────────────────
const MODEL_MAIN = "claude-opus-4-6";
const MODEL_CRITIC = "claude-haiku-4-5-20251001";
const HTML_PATH = path.join(__dirname, "index.html");
const JSON_PATH = path.join(__dirname, "samples.json");

// ─── TOPIC SEED LIST ───────────────────────────────────────────────────────
// 27 samples total: 15 Lecture (dual-version concise + detailed) + 12 Boards (single).
// See sample_regen_plan.md for the rationale behind each pick.
const SEEDS = [
  // ===== EXISTING LECTURE SAMPLES — REGENERATED WITH DUAL-VERSION =====
  { slug: "tma",                topic: "Thrombotic Microangiopathy (TTP vs HUS vs aHUS vs DIC vs HELLP)", style: "lecture", specialty: "Heme/Onc" },
  { slug: "portal-htn",         topic: "Portal Hypertension in Cirrhosis",                               style: "lecture", specialty: "GI/Hepatology" },
  { slug: "hfref",              topic: "HFrEF: 4-pillar GDMT",                                            style: "lecture", specialty: "Cardiovascular" },
  { slug: "nephrotic",          topic: "Nephrotic Syndrome",                                              style: "lecture", specialty: "Nephrology" },
  { slug: "copd",                topic: "COPD exacerbation & GOLD",                                       style: "lecture", specialty: "Pulmonary" },
  { slug: "gout",                topic: "Gout: acute & chronic urate lowering",                           style: "lecture", specialty: "Rheumatology" },
  { slug: "aortic-stenosis",    topic: "Aortic Stenosis: severity grading and TAVR vs SAVR",             style: "lecture", specialty: "Cardiovascular" },
  { slug: "angina",              topic: "Stable Angina: workup and revascularization decision",          style: "lecture", specialty: "Cardiovascular" },
  { slug: "hyponatremia",       topic: "Hyponatremia: SIADH pathophysiology & Furst ratio",              style: "lecture", specialty: "Nephrology" },

  // ===== NEW ONCOLOGY LECTURE SAMPLES =====
  { slug: "tls",                topic: "Tumor Lysis Syndrome: recognition, prevention, rasburicase vs allopurinol", style: "lecture", specialty: "Heme/Onc" },
  { slug: "ici-toxicities",     topic: "Immune Checkpoint Inhibitor Toxicities: irAEs across organ systems",        style: "lecture", specialty: "Heme/Onc" },

  // ===== GAP-FILLER LECTURE SAMPLES =====
  { slug: "sjs-dress",          topic: "SJS / TEN / DRESS: severe cutaneous adverse reactions",          style: "lecture", specialty: "Allergy/Immuno" },
  { slug: "skin-cancer-basics", topic: "Skin Cancer Basics: BCC, SCC, melanoma — recognition and referral", style: "lecture", specialty: "Dermatology" },
  { slug: "ssri-side-effects",  topic: "SSRI Side Effects + Serotonin Syndrome",                         style: "lecture", specialty: "Psychiatry" },
  { slug: "polypharmacy",       topic: "Polypharmacy + Deprescribing in older adults (Beers, STOPP/START)", style: "lecture", specialty: "Geriatrics" },

  // ===== BOARDS SAMPLES (single-version) =====
  { slug: "afib-boards",         topic: "Atrial Fibrillation: rate vs rhythm control",                    style: "boards", specialty: "Cardiovascular" },
  { slug: "hocm-boards",         topic: "HOCM with syncope — ICD indication and SCD risk stratification", style: "boards", specialty: "Cardiovascular" },
  { slug: "cdiff-boards",        topic: "Recurrent C. difficile infection — fidaxomicin vs FMT (2024 IDSA)", style: "boards", specialty: "ID" },
  { slug: "dka-hhs-boards",      topic: "DKA vs HHS management priorities",                               style: "boards", specialty: "Endocrinology" },
  { slug: "pancreatitis-boards", topic: "Acute pancreatitis severity — when to escalate to ICU",          style: "boards", specialty: "GI/Hepatology" },
  { slug: "ltbi-hiv-boards",     topic: "Latent TB treatment in HIV patient on ART (drug interactions)",  style: "boards", specialty: "ID" },
  { slug: "itp-pregnancy-boards",topic: "ITP first-line treatment in pregnancy",                          style: "boards", specialty: "Heme/Onc" },
  { slug: "stroke-wakeup-boards",topic: "Wake-up stroke thrombolysis window (DAWN/DEFUSE)",               style: "boards", specialty: "Neurology" },
  { slug: "gout-anticoag-boards",topic: "Gout flare during anticoagulation — treatment choice",           style: "boards", specialty: "Rheumatology" },
  { slug: "hbv-reactivation-boards", topic: "Hepatitis B reactivation prophylaxis before chemo",          style: "boards", specialty: "GI/Hepatology" },
  { slug: "asthma-mgso4-boards", topic: "Asthma exacerbation — when to escalate to MgSO4",                style: "boards", specialty: "Pulmonary" },
  { slug: "subclinical-hypo-boards", topic: "Subclinical hypothyroidism — when to treat",                 style: "boards", specialty: "Endocrinology" },
];

// ─── PROMPTS (mirror of LECTURE_PROMPT / BOARDS_PROMPT in index.html) ──────
const LECTURE_PROMPT = 'You are a senior Internal Medicine educator (general IM across all subspecialties: cardiology, pulmonary, GI/hepatology, endocrine, ID, heme/onc, rheum, neuro, nephrology, critical care, allergy, derm, psych, geriatrics, palliative). Identify the relevant specialty from the topic and teach from that field. Default to general IM reasoning unless a specialty is explicitly stated; do NOT default to nephrology.\n\nINTERNAL REASONING PROCESS (think through this BEFORE writing the JSON, do not include in output):\n1. What is the precise mechanism at the cellular/molecular level?\n2. What is the organ-level physiology that follows from that mechanism?\n3. What is the pathophysiology — how does the disease disrupt normal physiology?\n4. What clinical findings logically follow from the pathophysiology?\n5. What is the workup strategy and why does each test answer a specific question?\n6. What is the current first-line treatment per the relevant society guideline, AND what is the mechanism by which it works?\n7. What landmark trials established this approach?\n8. Verify each step is internally consistent — does the treatment section logically follow from the mechanism section? Are there any contradictions?\n\nOnly after completing this reasoning, write the chalk talk. The physiology section MUST be deep and mechanistic, not superficial. Every clinical recommendation MUST trace back to a mechanistic rationale.\n\n10-min chalk talk. Physiology FIRST and DEEP. CRITICAL: When GUIDELINE REFERENCE CONTEXT is provided below, you MUST anchor your treatment recommendations and board tips to those specific guideline recommendations and cite the specific guideline name and year (e.g., "per KDIGO 2024" or "per 2022 AHA/ACC/HFSA"). Also cite the landmark trials listed. If the user has uploaded reference documents, use those as PRIMARY sources. If web search is available and the topic involves recent treatment standards, search for the most current guideline recommendations before writing.\n\nInclude treatment per the guideline society appropriate to the topic (AHA/ACC cardio, ATS/ERS pulm, ACG/AASLD GI/liver, ADA endo, IDSA ID, ASH heme, ASCO/NCCN onc, ACR rheum, AAN neuro, KDIGO nephro, SCCM ICU, AAAAI allergy, AAD derm, APA psych, AGS geriatrics, ACOG/NAMS women\'s health, USPSTF prevention, AAHPM palliative). 3-4 sections.\n\nVMC QUADRANTS (visual_memory_card): top_left = MECHANISM (cellular/molecular driver, 1 line); top_right = FINDINGS (key clinical/lab features, 1 line); bottom_left = WORKUP (the diagnostic move that locks it in, 1 line); bottom_right = TREATMENT (the first-line intervention with mechanism, 1 line). center = leave empty (deprecated). Each <=8 words. These exact 4 categories - do not deviate. ALL FOUR QUADRANTS ARE REQUIRED — never leave any blank.\nSUMMARY_POINTS (REQUIRED): 4-6 high-yield take-home statements that a resident should remember after this 10-min talk. Each 1-2 sentences. Cover mechanism, key finding, first-line treatment, and the most common pitfall. NEVER return an empty summary_points array.\nONLY JSON:\n{"title":"","subtitle":"","guideline_sources":[""],"references":[{"id":1,"source":"","year":2024,"society":"","url":"","type":"guideline"}],"sections":[{"heading":"","minutes":"2-3 min","points":[""],"teaching_pearl":"","board_tip":""}],"summary_points":[""],"visual_memory_card":{"top_left":"","top_right":"","bottom_left":"","bottom_right":"","center":""}}';

const BOARDS_PROMPT = 'You are an ABIM board-question writer for general Internal Medicine (all subspecialties). Match the question to whatever specialty the topic belongs to; do NOT default to nephrology unless the topic is clearly renal.\n\nINTERNAL REASONING PROCESS (think through this BEFORE writing the JSON, do not include in output):\n1. What is the highest-yield, board-relevant teaching point on this topic?\n2. What clinical scenario would discriminate someone who knows the concept from someone who doesn\'t?\n3. What are the classic distractors that test common misconceptions or competing diagnoses?\n4. What is the unambiguously correct answer per current guidelines, and why is it correct?\n5. For each wrong answer, what specific reasoning error or knowledge gap would lead to picking it?\n6. Is there ANY ambiguity in the answer? If yes, revise so the correct answer is unambiguously best.\n\nOnly after completing this reasoning, write the question. The vignette MUST be clinically realistic. The correct answer MUST be clearly best per current guidelines, not just defensible.\n\nCRITICAL: When GUIDELINE REFERENCE CONTEXT is provided below, anchor the correct answer, explanation, and board pearls to those specific guideline recommendations. Cite guideline name and year in the explanation. UWorld/AMBOSS-style vignette with stem, 5 choices A-E (one correct), explanation, why wrong answers wrong, 5 board pearls, teaching points.\n\nVMC QUADRANTS (visual_memory_card): top_left = VIGNETTE KEY (the discriminating clue in the stem, <=8 words); top_right = MECHANISM (1-line pathophys behind the answer); bottom_left = PEARL (the high-yield take-home); bottom_right = PITFALL (the most common wrong-answer trap). center = leave empty (deprecated). Each <=8 words. These exact 4 categories - do not deviate.\nBOARD PEARLS REQUIREMENT: Each of the 5 board_pearls MUST be a high-yield fact directly tied to THIS specific clinical scenario (not generic disease facts). Cover, in order: (1) the mechanism behind the correct answer, (2) a specific guideline/year recommendation that supports the correct answer, (3) a discriminating feature that separates the correct answer from the most popular distractor, (4) a related landmark trial or named criterion the question tests, (5) the most common wrong-answer trap and why the trap is incorrect. Pearls should make a resident MORE LIKELY to get the next variant of this question right.\nEXPLANATION REQUIREMENTS: The explanation field must be \u2264 300 words, concise, and explicitly DERIVED from the relevant society guideline (KDIGO, AHA/ACC, ADA, IDSA, etc.) \u2014 not a paraphrase of common knowledge. Quote or directly reference the specific guideline statement that supports the answer (for example: per KDIGO 2024, RASi should be continued unless eGFR drops by greater than 30 percent from baseline). No filler. Lead with the guideline-derived rationale, then briefly explain why this clinical scenario satisfies that recommendation. wrong_explanations.why fields each \u2264 60 words.\nABIM CLASSIFICATION (REQUIRED for boards): Output an abim_classification object identifying which ABIM Internal Medicine Blueprint section this question maps to. Categories include: Cardiovascular, Pulmonary, Gastroenterology/Hepatology, Endocrinology, Infectious Disease, Hematology, Oncology, Nephrology, Rheumatology, Neurology, Allergy/Immunology, Dermatology, Psychiatry, Geriatrics, General Internal Medicine. Subcategories follow the standard blueprint nomenclature (e.g., Sodium & Water; Coronary Artery Disease; Heart Failure; Obstructive Lung Disease; Hepatology; Diabetes; Sepsis & Bloodstream Infection). specific_topic = the most precise topic name (for example: Hyponatremia: SIADH & Furst ratio). blueprint_weight = the approximate percent weight on the ABIM IM exam (for example: 6%, 14%, 9%). If unsure, leave blueprint_weight blank rather than guessing.\nSTEM STRUCTURE (UWorld / ABIM style, MANDATORY):\n1. Open with demographic + presentation: A [age]-year-old [man / woman / patient] [comes to the physician / is admitted / presents] [because of / with] [chief complaint].\n2. Describe symptom pattern with QUANTITATIVE detail: frequency (per day, per week, per month), duration, character (dull, sharp, crampy), severity, location, timing, and exacerbating or relieving factors.\n3. Include pertinent positives AND key pertinent negatives explicitly (e.g., He also describes occasional nausea but denies any vomiting, diarrhea, black stools, blood in the stool, or weight loss).\n4. Medical / social / family history when relevant. Quantify alcohol and tobacco (e.g., 8-10 beers over the weekends; 1 pack per day for 30 years).\n5. Vital signs with specific numbers (BP, HR, T, RR, SpO2) when relevant. Include BMI when relevant.\n6. Physical examination: specific findings, or state Physical examination is unremarkable.\n7. Laboratory studies: specific numeric values WITH UNITS (e.g., Fasting blood glucose is 127 mg/dL; serum sodium 132 mEq/L; creatinine 1.4 mg/dL).\n8. Imaging or other studies with specific findings when relevant (e.g., Abdominal x-ray shows focal calcifications anterior to the spine; Upper GI endoscopy reveals gastric varices in the fundus).\n9. End with: Which of the following is the most likely [diagnosis / next step in management / initial test / cause / treatment / explanation for these findings]?\n\nDISTRACTOR DESIGN:\n- 5 choices, single best answer.\n- Each choice 2 to 8 words. Parallel grammatical structure across choices (e.g., all are diagnoses, OR all are treatments, OR all are tests \u2014 do not mix categories within one question).\n- All 5 must be plausible alternatives in this clinical context. Avoid obvious throwaway distractors.\n- Mix common misdiagnoses, alternative treatments, and related conditions. Use specific named entities (drug names, diagnoses, named criteria) \u2014 not categories.\n- NO all of the above, NO none of the above, NO vague options.\n\nEXAMPLE STEM (style reference only \u2014 do not copy content):\nA 46-year-old man comes to the physician because of recurrent abdominal discomfort. He describes episodes of moderate, dull, epigastric pain lasting 2-3 days that have occurred 1-2 times per month over the last 2 years. He also describes occasional nausea but denies any vomiting, diarrhea, black stools, blood in the stool, abdominal distention, or weight loss. He takes ibuprofen for chronic low back pain. He drinks 8-10 beers over the weekends and frequently throughout the week. His vital signs are within normal limits and his BMI is 28 kg/m2. Physical examination is unremarkable. Fasting blood glucose is 127 mg/dL. Abdominal x-ray shows focal calcifications anterior to the spine over the epigastric area. Upper GI endoscopy reveals a normal esophagus, gastric varices in the fundus of the stomach, and a normal duodenum. Which of the following is the most likely diagnosis?\nExample choices: 1. Alcoholic liver cirrhosis  2. Gastroparesis  3. Helicobacter pylori infection  4. Non-ulcer dyspepsia  5. Splenic vein thrombosis\nONLY JSON:\n{"title":"","subtitle":"","guideline_sources":[""],"references":[{"id":1,"source":"","year":2024,"society":"","url":"","type":"guideline"}],"question":{"stem":"","choices":[{"letter":"A","text":"","correct":false},{"letter":"B","text":"","correct":true},{"letter":"C","text":"","correct":false},{"letter":"D","text":"","correct":false},{"letter":"E","text":"","correct":false}],"correct_letter":"B","explanation":"","wrong_explanations":[{"letter":"A","why":""},{"letter":"C","why":""},{"letter":"D","why":""},{"letter":"E","why":""}]},"abim_classification":{"category":"","subcategory":"","specific_topic":"","blueprint_weight":""},"board_pearls":["","","","",""],"teaching_points":["","",""],"summary_points":[""],"visual_memory_card":{"top_left":"","top_right":"","bottom_left":"","bottom_right":"","center":""}}';

const CRITIQUE_SYSTEM = "You are a senior board-certified Internal Medicine attending acting as a peer reviewer for a chalk talk. Review for: (1) factual errors in physiology or pharmacology, (2) outdated treatment recommendations vs current major society guidelines (KDIGO/AHA/ACC/ATS/ACG/AASLD/ADA/IDSA/ASH/ASCO/ACR/AAN/SCCM/AAAAI/AAD/APA/AGS/ACOG/USPSTF/AAHPM), (3) internal contradictions, (4) wrong landmark trial attributions, (5) shallow physiology. Do NOT flag stylistic preferences.\n\nReturn ONLY ONE of these two JSON formats (no other text):\n\nIF the talk is accurate and needs no changes:\n{\"verdict\":\"clean\"}\n\nIF you find substantive accuracy issues, return the FULL corrected chalk talk in the EXACT same JSON schema as the draft, with all your fixes applied. Do NOT include a verdict field in this case — just return the corrected talk JSON directly.";

// ─── GUIDELINE CONTEXT (lightweight, per specialty) ────────────────────────
const GUIDELINE_CONTEXT = {
  "Nephrology": {
    text: "[KDIGO Guidelines]\n• KDIGO 2024 CKD Evaluation & Management: Risk-stratification with eGFRcr-cys and ACR. RASi + SGLT2i + finerenone backbone for proteinuric CKD (DAPA-CKD, EMPA-KIDNEY, FIDELIO/FIGARO). GLP-1 RA per FLOW. Statins per SHARP. KFRE for individualized risk.\n• Hyponatremia: SIADH is euvolemic with low serum osm + inappropriately concentrated urine + UNa>30. Furst formula (urine [Na+K] / serum Na) predicts response to fluid restriction; >1 won't respond. Correct ≤8 mEq/24h to avoid ODS. DDAVP clamp for overcorrection.",
    sources: ["KDIGO 2024 CKD Evaluation & Management","KDIGO 2024 Blood Pressure in CKD","KDIGO 2022 Diabetes in CKD"],
    trials: ["DAPA-CKD","EMPA-KIDNEY","FIDELIO-DKD","FIGARO-DKD","FLOW","SPRINT","SHARP"]
  },
  "Cardiovascular": {
    text: "[AHA/ACC Guidelines]\n• 2022 AHA/ACC/HFSA HF: HFrEF four-pillar GDMT — ARNi (or ACEi/ARB), beta-blocker, MRA, SGLT2i — start together, titrate fast. HFpEF benefits from SGLT2i (EMPEROR-Preserved, DELIVER). IV iron (AFFIRM-AHF). ICD/CRT per EF + QRS.\n• 2023 ACC/AHA AFib: CHA₂DS₂-VASc → DOAC > warfarin. EAST-AFNET 4 supports early rhythm control; CASTLE-AF / CABANA support ablation in symptomatic AF + HFrEF.\n• 2025 AHA/ACC HTN: target <130/80; resistant HTN → spironolactone (PATHWAY-2).\n• 2025 ACC/AHA ACS: unified STEMI/NSTEMI; early invasive for high-risk NSTEMI; DAPT individualized; colchicine (COLCOT, LoDoCo2) as anti-inflammatory secondary prevention.",
    sources: ["2022 AHA/ACC/HFSA Heart Failure","2023 ACC/AHA Atrial Fibrillation","2025 AHA/ACC Hypertension","2025 ACC/AHA ACS"],
    trials: ["PARADIGM-HF","DAPA-HF","EMPEROR-Reduced","EMPEROR-Preserved","DELIVER","AFFIRM-AHF","EAST-AFNET 4","CASTLE-AF","CABANA","PATHWAY-2","COLCOT","LoDoCo2"]
  },
  "Pulmonary": {
    text: "[ATS / GOLD Guidelines]\n• GOLD 2024 COPD: ABE assessment groups (replaces ABCD). Exacerbation management: bronchodilators + systemic steroids (5d prednisone 40mg per REDUCE), antibiotics if 2 of 3 cardinal sx (Anthonisen criteria) or mechanical ventilation. NIV first-line for hypercapnic respiratory failure (per Brochard et al). Long-term: LAMA + LABA, add ICS if blood eos ≥300 or freq exacerbations. Pulm rehab. Long-term O2 if SpO2≤88% (NOTT/MRC).",
    sources: ["GOLD 2024 COPD"],
    trials: ["NOTT","MRC","REDUCE","IMPACT","ETHOS"]
  },
  "GI/Hepatology": {
    text: "[AASLD Guidelines]\n• AASLD 2021 Cirrhosis & 2024 Ascites/AKI: Variceal bleed → octreotide + ceftriaxone (SBP prophylaxis) + EVL. Refractory ascites → TIPS (per recent EASL/AASLD). Hepatorenal syndrome-AKI: albumin + terlipressin (CONFIRM trial). HE: lactulose ± rifaximin. SBP: cefotaxime + albumin (Sort trial). HCC screening with US ± AFP q6mo. MELD-Na for transplant priority.",
    sources: ["AASLD 2021 Cirrhosis","AASLD 2024 Ascites & HRS"],
    trials: ["CONFIRM","Sort"]
  },
  "Endocrinology": {
    text: "[ADA Guidelines]\n• ADA 2024 Standards of Care: Metformin baseline (unless contraindicated). Layer SGLT2i for ASCVD/HF/CKD regardless of A1c (EMPA-REG, CANVAS, DAPA-CKD, EMPEROR-Reduced). GLP-1 RA for ASCVD/obesity (LEADER, REWIND, SUSTAIN-6, SELECT). Statins for ASCVD risk. ACEi/ARB for albuminuria. A1c <7% individualized; less stringent for elderly/comorbid.",
    sources: ["ADA 2024 Standards of Care","KDIGO 2022 Diabetes in CKD"],
    trials: ["EMPA-REG","CANVAS","LEADER","REWIND","SUSTAIN-6","SELECT","FLOW"]
  },
  "ID": {
    text: "[SCCM / IDSA Guidelines]\n• Surviving Sepsis Campaign 2021: Hour-1 bundle — lactate, blood cultures BEFORE antibiotics, broad-spectrum antibiotics within 1h, 30 mL/kg crystalloid for hypotension/lactate≥4, vasopressors (norepinephrine first-line) for MAP<65 after fluids. Source control. Reassess fluid status (passive leg raise, dynamic indices). Balanced crystalloids preferred (SMART, BaSICS). De-escalate antibiotics by 48-72h.",
    sources: ["Surviving Sepsis Campaign 2021"],
    trials: ["ARISE","ProCESS","ProMISe","SMART","BaSICS","ANDROMEDA-SHOCK"]
  },
  "Heme/Onc": {
    text: "[ASH Guidelines]\n• ASH 2020 VTE Treatment: DOAC first-line for most acute DVT/PE (apixaban, rivaroxaban — no lead-in heparin needed; dabigatran/edoxaban require lead-in). LMWH if cancer-associated (CARAVAGGIO, HOKUSAI-CANCER show DOACs noninferior). Warfarin still for severe renal disease, mechanical valves, APS. Provoked VTE → 3 months. Unprovoked → indefinite if low bleed risk. Massive PE → systemic thrombolysis or catheter-directed.",
    sources: ["ASH 2020 VTE Treatment","ESC 2019 PE"],
    trials: ["AMPLIFY","EINSTEIN","RE-COVER","HOKUSAI-VTE","CARAVAGGIO","HOKUSAI-CANCER","PEITHO"]
  },
  "Rheumatology": {
    text: "[ACR Guidelines]\n• ACR 2020 Gout: Acute → NSAID, colchicine, or steroid (any of these; combine for severe). Chronic urate-lowering with allopurinol first-line, target uric acid <6 (or <5 if tophi). Treat-to-target. Start ULT during acute flare with anti-inflammatory prophylaxis (3-6 mo). HLA-B*5801 screening in high-risk populations (Asian) before allopurinol. Febuxostat alternative if allopurinol fails (CARES caution re CV mortality).",
    sources: ["ACR 2020 Gout"],
    trials: ["CARES","CONFIRMS"]
  },
  "Neurology": {
    text: "[AHA/ASA Guidelines]\n• AHA/ASA 2019/2021 Acute Ischemic Stroke: IV alteplase (or tenecteplase per recent updates) within 4.5h of LKW for eligible patients. Mechanical thrombectomy within 24h for LVO with favorable imaging (DAWN, DEFUSE 3 extended window). BP <185/110 for tPA eligibility, <180/105 post-tPA. Dual antiplatelet (DAPT) ≤21d for minor stroke/TIA per CHANCE/POINT (≤24h start). Statin, ACEi for secondary prevention.",
    sources: ["AHA/ASA 2019 AIS","AHA/ASA 2021 Stroke Prevention"],
    trials: ["NINDS","ECASS III","DAWN","DEFUSE 3","CHANCE","POINT","EXTEND","SWIFT-PRIME"]
  }
};

// ─── HELPERS ──────────────────────────────────────────────────────────────
function stripCitations(s) {
  if (!s) return s;
  return String(s)
    .replace(/<cite[^>]*>.*?<\/cite>/gs, "")
    .replace(/<\/?cite[^>]*>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function deepClean(obj) {
  if (obj == null) return obj;
  if (typeof obj === "string") return stripCitations(obj);
  if (Array.isArray(obj)) return obj.map(deepClean);
  if (typeof obj === "object") {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = deepClean(obj[k]);
    return out;
  }
  return obj;
}
function fixJSON(raw) {
  let s = (raw || "").trim();
  s = s.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  return s;
}

async function callAPI({ system, content, maxTokens, model }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY env var required");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: model || MODEL_MAIN,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }]
    })
  });
  if (!r.ok) {
    const errTxt = await r.text();
    throw new Error(`API ${r.status}: ${errTxt.slice(0, 400)}`);
  }
  const data = await r.json();
  let txt = "";
  for (const block of data.content || []) {
    if (block.type === "text") txt += block.text;
  }
  return txt;
}

// Depth hint mirrors the one in index.html's generate() so samples match what the live app produces.
function depthHintFor(depth) {
  if (depth === "concise") {
    return '\n\nDEPTH: CONCISE (~5-min summary). Keep this TIGHT. Same overall structure, but cut depth ~50%.\n- Each section: 3-4 BRIEF bullets (<=15 words each), not 5-7 long ones\n- Subtitle: <=10 words\n- Teaching pearl: 1 sentence, <=20 words\n- Board tip: 1 sentence, <=15 words\n- Visual memory card quadrants: <=8 words each\n- Summary points: <=20 words each, 4 points (REQUIRED — never empty)\nNO redundancy. No flowery language. Every word earns its place. Aim for clarity, not comprehensiveness.';
  }
  if (depth === "detailed") {
    return '\n\nDEPTH: DETAILED (full 10-min talk). Go deep. 5-7 substantive bullets per section exploring mechanism, evidence, clinical application. Teaching pearls and board tips can be 1-2 sentences with nuance. Summary points: 5-6 points, each 1-2 sentences (REQUIRED — never empty). Aim for the full 10-min chalk talk experience.';
  }
  return ""; // boards: no depth hint
}

// Generate a single talk JSON. `depth` is null for boards, "concise" or "detailed" for lectures.
async function generateTalk(seed, depth) {
  const ctx = GUIDELINE_CONTEXT[seed.specialty];
  let guidelineContext = "";
  if (ctx) {
    guidelineContext = "\n\n═══ GUIDELINE REFERENCE CONTEXT (use this to anchor your recommendations) ═══\n" + ctx.text;
    if (ctx.trials && ctx.trials.length > 0) {
      guidelineContext += "\nLandmark trials to cite when relevant: " + ctx.trials.join(", ");
    }
    guidelineContext += "\n═══ END GUIDELINE CONTEXT ═══";
  }

  const userContent =
    `Create content on: "${seed.topic}"` +
    guidelineContext +
    depthHintFor(depth) +
    "\nRely on your training and the GUIDELINE REFERENCE CONTEXT above. Do not search the web." +
    "\nONLY JSON. Plain text values, no XML tags, no citation markup.";

  const system = seed.style === "boards" ? BOARDS_PROMPT : LECTURE_PROMPT;

  process.stdout.write(`  → drafting with ${MODEL_MAIN}` + (depth ? ` (${depth})` : "") + `... `);
  const draftRaw = await callAPI({ system, content: userContent, maxTokens: 4096, model: MODEL_MAIN });
  if (!draftRaw.trim()) throw new Error("Empty draft response");
  let draftTalk = JSON.parse(fixJSON(draftRaw));
  draftTalk = deepClean(draftTalk);
  process.stdout.write("ok\n");

  process.stdout.write(`  → peer review with ${MODEL_CRITIC}... `);
  let finalTalk = draftTalk;
  try {
    const critRaw = await callAPI({
      system: CRITIQUE_SYSTEM,
      content: `Topic: ${seed.topic}\n\nDraft chalk talk to review:\n${JSON.stringify(draftTalk)}`,
      maxTokens: 4096,
      model: MODEL_CRITIC
    });
    if (critRaw && critRaw.trim()) {
      let parsed = JSON.parse(fixJSON(critRaw));
      parsed = deepClean(parsed);
      if (parsed.verdict === "clean") {
        process.stdout.write("clean\n");
      } else if (parsed.title || parsed.question) {
        finalTalk = parsed;
        process.stdout.write("corrections applied\n");
      } else {
        process.stdout.write("(unparseable, keeping draft)\n");
      }
    }
  } catch (e) {
    process.stdout.write(`(failed: ${e.message.slice(0, 60)}, keeping draft)\n`);
  }
  return finalTalk;
}

// Build the full sample record. Lecture topics produce BOTH talk_concise + talk_detailed.
// Boards topics produce a single `talk` field (no depth toggle in boards mode).
async function generateOne(seed) {
  const ctx = GUIDELINE_CONTEXT[seed.specialty];
  const base = {
    slug: seed.slug,
    topic: seed.topic,
    style: seed.style,
    specialty: seed.specialty,
    guideline_sources: ctx ? ctx.sources : [],
    generated_at: new Date().toISOString().slice(0, 10)
  };

  if (seed.style === "boards") {
    base.talk = await generateTalk(seed, null);
    return base;
  }
  // Lecture: dual-version (concise = hero, detailed = toggle target)
  base.talk_concise  = await generateTalk(seed, "concise");
  base.talk_detailed = await generateTalk(seed, "detailed");
  return base;
}

function embedIntoHTML(samples) {
  let html = fs.readFileSync(HTML_PATH, "utf8");
  const marker = "// __SAMPLES_MARKER__";
  if (!html.includes(marker)) {
    console.error(`\n⚠ Could not find ${marker} in index.html — samples written to samples.json only.`);
    return false;
  }
  const replacement = `var SAMPLES = ${JSON.stringify(samples, null, 2)}; ${marker}`;
  const re = /var SAMPLES\s*=\s*[\s\S]*?;\s*\/\/ __SAMPLES_MARKER__/;
  if (re.test(html)) {
    html = html.replace(re, replacement);
  } else {
    html = html.replace(marker, replacement);
  }
  fs.writeFileSync(HTML_PATH, html, "utf8");
  return true;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  const argOnly = args.find(a => a.startsWith("--only="));
  const onlySlugs = argOnly ? argOnly.slice(7).split(",").map(s => s.trim()) : null;
  const noEmbed = args.includes("--no-embed");
  const dry = args.includes("--dry");

  const seeds = onlySlugs ? SEEDS.filter(s => onlySlugs.includes(s.slug)) : SEEDS;
  if (seeds.length === 0) {
    console.error("No matching seeds. Available slugs:", SEEDS.map(s => s.slug).join(", "));
    process.exit(1);
  }

  console.log(`\nChalk Talk · sample generator`);
  console.log(`Topics queued: ${seeds.length}`);
  if (dry) {
    console.log("Dry run — no API calls. Topics:");
    for (const s of seeds) console.log(`  • [${s.style}] ${s.topic}`);
    process.exit(0);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("\n⚠ ANTHROPIC_API_KEY not set. Run:\n  ANTHROPIC_API_KEY=sk-ant-... node generate_samples.js\n");
    process.exit(1);
  }

  let existing = [];
  if (fs.existsSync(JSON_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(JSON_PATH, "utf8")); } catch {}
  }
  const bySlug = new Map(existing.map(s => [s.slug, s]));

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    console.log(`\n[${i + 1}/${seeds.length}] ${seed.topic} (${seed.style})`);
    try {
      const sample = await generateOne(seed);
      bySlug.set(seed.slug, sample);
      const allOrdered = SEEDS.map(s => bySlug.get(s.slug)).filter(Boolean);
      fs.writeFileSync(JSON_PATH, JSON.stringify(allOrdered, null, 2), "utf8");
      console.log(`  ✓ saved to samples.json (${allOrdered.length}/${SEEDS.length} total)`);
    } catch (e) {
      console.error(`  ✗ FAILED: ${e.message}`);
    }
  }

  const finalSamples = SEEDS.map(s => bySlug.get(s.slug)).filter(Boolean);
  console.log(`\n${finalSamples.length} sample(s) saved to ${JSON_PATH}`);

  if (!noEmbed) {
    const ok = embedIntoHTML(finalSamples);
    if (ok) console.log(`✓ Embedded into ${HTML_PATH}`);
  }

  console.log("\nReview the samples in the app:");
  console.log(`  open "${HTML_PATH}"`);
  console.log("Click 📚 Examples in the header to browse.\n");
})().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
