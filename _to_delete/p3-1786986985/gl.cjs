const fs=require("fs");
const g=JSON.parse(fs.readFileSync("guidelines.json","utf8"));
let n=0;
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
function find(sp, re){
  const hit=(g.specialties[sp].guidelines||[]).filter(x=>re.test(x.name||""));
  must(hit.length===1, sp+" :: expected 1 match for "+re+", got "+hit.length);
  return hit[0];
}
function setName(e,to,msg){ must(e.name!==to,"no-op: "+msg); e.name=to; n++; }
function repKeys(e,from,to,msg){ must(String(e.keys).includes(from),"keys anchor: "+msg); e.keys=e.keys.replace(from,to); n++; }

// 1 · KDIGO AKI — "in review" is stale: public comment closed 11 May 2026, still unpublished.
setName(find("Nephrology",/^KDIGO 2012 AKI/),
  "KDIGO 2012 AKI (2026 AKI/AKD update drafted Mar 2026; public comment closed 11 May 2026, NOT yet published - the 2012 guideline is still the one in force)",
  "kdigo name");

// 2 · SSC 2026 — the steroid trigger here is the 2021 wording. SSC 2026 DROPPED the "ongoing vasopressor
// requirement" qualifier; the recommendation is now simply IV corticosteroids for septic shock. An entry
// labelled 2026 that carries the 2021 threshold is the worst case for this corpus, because the review
// stage is told to make the talk match it.
repKeys(find("ID",/^Surviving Sepsis Campaign 2026/),
  "Steroids (hydrocortisone) for shock refractory to fluids and pressors.",
  "Steroids: SSC 2026 SIMPLIFIED this - it now suggests IV corticosteroids for adults with septic shock, "
  + "WITHOUT the 2021 qualifier of an ongoing vasopressor requirement. Do not state a refractory-shock or "
  + "vasopressor-dose threshold as a 2026 criterion; 2026 sets no quantitative refractory-shock threshold. "
  + "(The only 'refractory' framing in the 2026 document is the methylene blue statement, where it says the "
  + "evidence is insufficient.)",
  "ssc steroids");

// 3 · Yellow Book — the parenthetical is flatly false. IDSA has a 2006 travel-medicine guideline; it is
// ARCHIVED, which is a different claim and the one that is true.
setName(find("ID",/^CDC Yellow Book 2026/),
  "CDC Yellow Book 2026 + WHO Malaria Guidelines (IDSA's 2006 travel-medicine guideline is ARCHIVED and unmaintained - there is no CURRENT IDSA travel guideline)",
  "yellow book name");

// 4 · NCCN Breast — not modular. One guideline (id 1419) covering DCIS/invasive/metastatic in internal
// sections. The PATIENT versions are split by stage, which is the likely origin of the belief.
setName(find("Oncology",/^NCCN Breast Cancer/),
  "NCCN Breast Cancer (ONE guideline covering DCIS/invasive/metastatic in internal sections - the patient-facing versions are split by stage, the clinician one is not; versioned continuously, cite the version you used)",
  "nccn breast name");

// 5 · NCCN Prostate — v3.2026 shipped in 2025 and has been superseded; v5.2026 is out.
setName(find("Oncology",/^NCCN Prostate/),
  "NCCN Prostate v5.2026 (verified Aug 2026; NCCN reissues several times a year, so treat any pinned version as a floor, not the current one)",
  "nccn prostate name");

// 6 · axSpA — the 2026 update is out as a press release + guideline summary, not merely announced.
setName(find("Rheumatology",/^ASAS-EULAR 2022/),
  "ASAS-EULAR 2022 / ACR-SAA-SPARTAN 2026 Axial Spondyloarthritis (2026 update RELEASED 24 Jun 2026)",
  "axspa name");
repKeys(find("Rheumatology",/^ASAS-EULAR 2022/),
  "Full manuscript was not yet peer-reviewed and journal-published at announcement, so cite the 2026 update as announced-not-yet-published and prefer it over the 2019 ACR positions.",
  "Released 24 Jun 2026 as an ACR press release plus a downloadable guideline summary; the peer-reviewed "
  + "manuscript may still be pending, so cite it as 'ACR/SAA/SPARTAN 2026 (guideline summary)' and prefer it "
  + "over the 2019 ACR positions. Verified Aug 2026.",
  "axspa keys");

// 7 · AAD atopic dermatitis — the newest component is the 2026 first-ever pediatric guideline, so the
// year field should not still read 2025.
{ const e=find("Dermatology",/^AAD Atopic Dermatitis/); must(e.year===2025,"aad year"); e.year=2026; n++;
  setName(e,"AAD Atopic Dermatitis - 2023 base + 2025 adult focused update + 2026 first-ever pediatric guidelines (prevention + management)","aad name"); }

// 8 · ACOG endometriosis — it is a DIAGNOSIS guideline. Named as it was, a talk could present it as
// treatment guidance it does not contain.
setName(find("Women's Health",/^ACOG Endometriosis/),
  "ACOG Diagnosis of Endometriosis - Clinical Practice Guideline No. 11 (2026; scope is evaluation/diagnosis, NOT comprehensive treatment)",
  "acog name");

fs.writeFileSync("guidelines.json", JSON.stringify(g,null,2)+"\n");
console.log(n+" field edits applied across 8 entries");
