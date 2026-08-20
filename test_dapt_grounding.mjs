// DAPT STRATEGY GROUNDING — run: node test_dapt_grounding.mjs
//
// The ACS entry was 304 characters and said "DAPT individualized" — nothing on duration, de-escalation
// or P2Y12 monotherapy. Zero occurrences of "monotherapy", "de-escalation", "STOPDAPT" or "NEOMINDSET"
// anywhere in Cardiovascular. Every strategy claim in a DAPT card came from memory.
//
// AND THE CORPUS HOLDS ONLY ONE SOCIETY. There is no ESC document for ACS here at all, so a card citing
// an ESC preference was citing something the app never gave it. That is the sharpest form of the
// say-which-guideline problem: not two documents disagreeing, but one of them being absent entirely
// while the card speaks confidently for it.
//
// So this entry is guard rails, not answers. The load-bearing assertions are NEGATIVE.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;
const k = (G.Cardiovascular.guidelines || []).find(x => /ACS/.test(x.name)).keys;

// ── one society in the corpus, and the entry says so ────────────────────────────────────────────────
ok(/THIS CORPUS HOLDS THE US GUIDELINE ONLY/.test(k), "the entry states that only the US guideline is here…");
ok(/There is no ESC document here for ACS/.test(k), "…and that no ESC document exists in the corpus");
ok(/must not present a European preference as universal/.test(k),
   "…so an ESC preference cannot be generalised");
// The symmetric restriction matters as much: do not assert what the US guideline says either.
ok(/or assert what the US guideline says about it without citing the document/.test(k),
   "…and the entry equally forbids asserting what the US guideline says without citing it");
ok(/it records NO preference between the two/.test(k),
   "…recording only that this entry holds no ticagrelor-vs-prasugrel preference, which is a fact about the entry");
// Confirm that claim is TRUE of the entry rather than merely written in it.
ok(/Ticagrelor\/prasugrel preferred over clopidogrel/.test(k) && !/prasugrel over ticagrelor/i.test(k),
   "…and the entry really does treat the two together, with no preference between them");

// ── monotherapy: the agents are not interchangeable ─────────────────────────────────────────────────
ok(/Do not teach\s+abbreviated DAPT followed by CLOPIDOGREL monotherapy as an established ACS strategy/.test(k),
   "clopidogrel monotherapy after short DAPT is not to be taught as established in ACS");
ok(/the monotherapy\s+evidence in ACS rests on the potent agents/.test(k),
   "…because the monotherapy evidence rests on the potent agents");
ok(/high bleeding risk is its own separate discussion/.test(k), "…with HBR kept as a separate question");

// ── a floor on de-escalation ────────────────────────────────────────────────────────────────────────
ok(/Dropping aspirin within the first days after ACS is not supported/.test(k), "there is a floor on de-escalation…");
ok(/does not\s+follow/.test(k), "…and the entry names the faulty inference it exists to block");

// ── STEMI scope ─────────────────────────────────────────────────────────────────────────────────────
ok(/STEMI IS UNDER-REPRESENTED/.test(k) && /excluded or under-enrolled/.test(k),
   "STEMI under-representation in the monotherapy trials is recorded");

// ── the one thing the deck already had right ────────────────────────────────────────────────────────
ok(/WITH ORAL ANTICOAGULATION, CLOPIDOGREL IS THE P2Y12 OF CHOICE/.test(k),
   "clopidogrel with OAC is recorded, since the corpus was silent even where the card was right");

// ── NOTHING NUMERIC, NOTHING ABOUT TRIAL OUTCOMES ───────────────────────────────────────────────────
// This is the point. The review named trials and results; none was read here.
ok(!/noninferiority was|failed noninferiority|met noninferiority/i.test(k),
   "no claim about a trial meeting or missing noninferiority appears");
ok(!/\b\d+\s*(?:month|months|day|days)\b/.test(k),
   "no DAPT duration in days or months is stated");
ok(!/STOPDAPT|NEOMINDSET/i.test(k),
   "no trial is cited as evidence for a claim this entry has not verified");
ok(/Name the trial and cite it, or give no result/.test(k), "…with the instruction that replaces them");
ok(/no trial endpoint/.test(k), "…and the absence is declared rather than left to be noticed");

// ── standing rule ───────────────────────────────────────────────────────────────────────────────────
ok(!/\bnot\b[^.;]{0,32}?\bverified\b/i.test(k) && !/\bunverified\b/i.test(k),
   "the entry asserts nothing it admits it has not checked");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ DAPT GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
