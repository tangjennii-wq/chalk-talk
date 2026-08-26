// HYPEREOSINOPHILIC SYNDROME GROUNDING — run: node test_hes_grounding.mjs
//
// Corpus-silent, and worse than usual: "eosinophil" appeared nowhere in Heme/Onc, and the topic did not
// ROUTE there either — no keyword matched, so an HES talk was written with no guideline context at all.
// Both halves had to be fixed, or the entry would have been unreachable decoration (the CRRT lesson).
//
// The review that prompted this was itself out of date on its headline point. It said benralizumab's
// "regulatory status for HES is still evolving" and that the evidence is "RCT-level, not just
// supportive". Both true when written; benralizumab was FDA-approved for HES on 14 May 2026. So the
// correction to the corpus is larger than the correction the review asked for.
//
// TWO ADJACENCY TRAPS are asserted, and they are the reason this entry is long:
//   1. TEN-FOLD DOSE. Mepolizumab 300 mg and benralizumab 30 mg, both SC, both q4w, both HES, one
//      sentence apart. Nothing but explicit binding stops those swapping.
//   2. GENOTYPE. NATRON enrolled FIP1L1::PDGFRA-NEGATIVE patients. Put "benralizumab works in HES" next
//      to the imatinib paragraph unguarded and it teaches a biologic for the one patient who should get
//      imatinib — the same shape as finerenone/DAPA-CKD and MENTOR/cyclophosphamide.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;
const entry = (G["Heme/Onc"].guidelines || []).find(x => /^Hypereosinophilic Syndrome/.test(x.name));
ok(!!entry, "the HES entry exists in Heme/Onc");
const k = (entry && entry.keys) || "";
ok(/no society guideline/i.test(entry ? entry.name : "") && /NO SOCIETY GUIDELINE COVERS HES/.test(k),
   "…and says up front that no society guideline backs it, rather than implying one exists");
ok(/FDA labelling and the trial record/.test(k), "…naming what it IS built from, so the sourcing is checkable");

// ── IT MUST ROUTE, OR IT IS DECORATION ─────────────────────────────────────────────────────────────
const CR = html.slice(html.indexOf("var COMPOUND_ROUTES = ["), html.indexOf("];", html.indexOf("var COMPOUND_ROUTES = [")));
ok(/\\bhypereosinophil/.test(CR) && /spec: "Heme\/Onc"/.test(CR),
   "hypereosinophil- routes to Heme/Onc, where the entry lives");
ok(/\\beosinophilia\\b/.test(CR), "…and so does a bare 'eosinophilia'");
// NARROW ON PURPOSE. A bare "eosinophil" keyword in Heme/Onc would steal eosinophilic OESOPHAGITIS from
// its own ACG entry and eosinophilic asthma from Pulmonary. Asserted as a negative so the shortcut
// cannot be taken later.
const hoKw = html.slice(html.indexOf('"Heme/Onc": ['), html.indexOf("]", html.indexOf('"Heme/Onc": [')) + 1);
ok(!/"eosinophil"/.test(hoKw) && !/"eosinophilic"/.test(hoKw),
   "…and 'eosinophil' is NOT a bare Heme/Onc keyword, which would drag EoE and eosinophilic asthma with it");
// TESTED BY BEHAVIOUR, NOT BY READING THE SOURCE. The first version asserted that the string
// "eosinophilic" was absent from this block — and failed, because the COMMENT above the rules explains
// that eosinophilic oesophagitis must be protected. Eighth time this session that a regex matched prose
// instead of code. The rules are extracted and RUN against real topic titles instead.
const rules = [...CR.matchAll(/\{\s*re:\s*(\/[^/]+\/[a-z]*)\s*,\s*spec:\s*"([^"]+)"/g)]
  .map(m => ({ re: eval(m[1]), spec: m[2] }));
ok(rules.length >= 4, `sanity: ${rules.length} compound rules were extracted and are runnable`);
const hits = (t) => rules.filter(r => r.re.test(t.toLowerCase())).map(r => r.spec);
ok(hits("Hypereosinophilic Syndrome").includes("Heme/Onc"), "…'Hypereosinophilic Syndrome' reaches Heme/Onc…");
ok(hits("Approach to Eosinophilia").includes("Heme/Onc"), "…and so does 'Approach to Eosinophilia'…");
ok(hits("Eosinophilic Esophagitis").length === 0,
   "…while 'Eosinophilic Esophagitis' matches NO compound rule, so it keeps its ACG entry in GI");
ok(hits("Eosinophilic Granulomatosis with Polyangiitis").length === 0,
   "…and EGPA matches none, so it is not dragged out of Rheumatology");
ok(hits("Eosinophilic Asthma").length === 0, "…and eosinophilic asthma stays with Pulmonary");
// The GI entry that would have been the collateral damage must still be there.
ok((G["GI/Hepatology"].guidelines || []).some(e => /Eosinophilic Esophagitis/i.test(e.name)),
   "sanity: the ACG eosinophilic oesophagitis entry still exists to be protected");

// ── THE FIRST FORK: SECONDARY CAUSES, AND THE STRONGYLOIDES TRAP ───────────────────────────────────
ok(/>1500\/microL on two\s+occasions at least a month apart/.test(k),
   "hypereosinophilia carries its threshold AND its two-occasion requirement");
ok(/HES adds end-organ damage/.test(k), "…and HES is distinguished from it by end-organ damage");
ok(/Exclude secondary causes FIRST/.test(k), "secondary causes come first…");
ok(/strongyloides above all, because\s+steroids without ivermectin can cause hyperinfection/.test(k),
   "…with the strongyloides-before-steroids trap, which is the one that kills people");

// ── GENOTYPE DECIDES THE DRUG ──────────────────────────────────────────────────────────────────────
ok(/FIP1L1::PDGFRA/.test(k) && /imatinib-sensitive/.test(k), "PDGFRA is tied to imatinib sensitivity…");
ok(/survival approaching that of the general population/.test(k), "…with the prognosis that follows…");
ok(/Test before treating/.test(k), "…and the instruction to genotype first");
ok(/FGFR1 rearrangement \(8p11\) is the aggressive one/.test(k) && /rather than with imatinib/.test(k),
   "FGFR1 is separated out as aggressive AND as not imatinib-treated — the two facts that must travel together");
ok(/precipitate cardiogenic shock/.test(k) && /corticosteroids are given alongside\s+imatinib/.test(k),
   "the imatinib cardiac-lysis hazard is present with its mitigation, not as a bare warning");

// ── TRAP 1: THE TEN-FOLD DOSE ──────────────────────────────────────────────────────────────────────
ok(/MEPOLIZUMAB \(anti-IL-5 ligand\) is 300 mg every 4 weeks/.test(k),
   "mepolizumab's dose is bound to mepolizumab by name…");
ok(/BENRALIZUMAB \(anti-IL-5 RECEPTOR alpha[\s\S]{0,140}\) is 30 mg every 4 weeks/.test(k),
   "…and benralizumab's to benralizumab, with the receptor-vs-ligand mechanism that distinguishes them");
ok(/BIND EACH DOSE TO ITS OWN DRUG/.test(k) && /ten-fold error if crossed/.test(k),
   "…and the crossing risk is named explicitly, since both are SC q4w for the same disease");
ok(/antibody-dependent cellular cytotoxicity/.test(k),
   "…and benralizumab's depleting mechanism is given, which is why it is not interchangeable with mepolizumab");
ok(/aged 12 and over/.test(k) && /no\s+identifiable non-haematologic secondary cause/.test(k),
   "the shared label qualifier is stated once and applies to both");
ok(/approved for HES lasting 6 months or longer/.test(k),
   "…while mepolizumab's extra 6-month duration clause stays attached to mepolizumab");

// ── THE APPROVAL CORRECTION ────────────────────────────────────────────────────────────────────────
ok(/FDA-approved for HES\s+on 14 May 2026/.test(k), "benralizumab's HES approval date is stated…");
ok(/NO LONGER OFF-LABEL FOR HES/.test(k) && /a talk calling it investigational is out of date/i.test(k),
   "…and the superseded framing is named, so an older deck is recognisable as old");
ok(/NATRON \(Nature Medicine, 31 Mar 2026, doi 10\.1038\/s41591-026-04315-8\)/.test(k),
   "NATRON carries a resolvable identifier, so the model need not invent one");
ok(/hazard ratio 0\.35 \(95% CI 0\.18-0\.69, P=0\.0024\)/.test(k), "…with the primary result in full…");
ok(/19\.4% vs 42\.4%/.test(k) && /0\.41 vs 1\.23/.test(k), "…and both arms of the flare outcomes");

// ── TRAP 2: THE GENOTYPE THE TRIAL EXCLUDED ────────────────────────────────────────────────────────
ok(/NATRON enrolled\s+FIP1L1::PDGFRA-NEGATIVE HES/.test(k),
   "NATRON's population is stated, in the same paragraph as its result");
ok(/Do not let the trial result and the imatinib paragraph compose/.test(k),
   "…and the composition is forbidden in words, not left to adjacency");
ok(/that patient gets imatinib, and NATRON says nothing\s+about them/.test(k),
   "…naming what the composed error would do, which is the part a later editor must not tidy away");

// ── LYMPHOCYTIC VARIANT AND OVERLAP ────────────────────────────────────────────────────────────────
ok(/CD3-negative\/CD4-\s*positive/.test(k) && /raised IgE and skin-predominant/.test(k),
   "the lymphocytic variant's immunophenotype and phenotype are present");
ok(/progression to peripheral T-cell lymphoma/.test(k) && /ongoing haematology follow-up/.test(k),
   "…with the lymphoma risk AND what it implies for follow-up");
ok(/EGPA, eosinophilic oesophagitis,\s+eosinophilic pneumonia, asthma/.test(k),
   "overlap syndromes are listed and pushed to their own guidelines…");
ok(/BOTH mepolizumab \(adults\) and benralizumab\s+\(FDA-approved for EGPA on 18 Sep 2024\)/.test(k),
   "…and the EGPA biologic options are both named, since mepolizumab-only teaching is now dated");

// ── PROGNOSIS AND THE WITHHELD NUMBERS ─────────────────────────────────────────────────────────────
ok(/GENOTYPE- AND CARDIAC-DRIVEN, NOT COUNT-DRIVEN/.test(k), "prognosis is decoupled from the count…");
ok(/never as a severity score/.test(k), "…with the misuse of the count named directly");
ok(!/57-76%/.test(k) && !/86%/.test(k),
   "the review's unverified real-world remission and steroid-sparing percentages are ABSENT");
ok(/CARRIES NO REAL-WORLD REMISSION OR STEROID-SPARING PERCENTAGES/.test(k),
   "…and their absence is declared, so a quoted figure is recognisable as memory");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ HES GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
