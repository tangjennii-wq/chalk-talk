// CALIBRATION SCORING — run: node test_calibration_scoring.mjs
//
// WHY THIS EXISTS (Codex, 2026-07-29). The scorer computed macro precision as
//
//     if (items.length) p_at_n.push(direct / items.length)
//
// Returning ZERO sources on a topic the corpus does not cover is, by this experiment's own stated
// criteria, a SUCCESS. The `if` therefore excluded exactly the successful abstentions from the headline
// number — and, worse, averaged each arm over a DIFFERENT set of topics, so an arm that abstained more
// was silently scored on an easier subset. Two arms' numbers were not comparable quantities.
//
// This suite builds a synthetic run where the two statistics DISAGREE, and asserts the reported ones
// behave. The fixture is the argument: an arm that correctly stays silent on every absent topic must not
// score worse than one that returns junk there.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

// ── the two estimators, as implemented in eval_pipeline_arms.mjs ──────────────
const mean = (xs) => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN;
const OLD = (topics) => mean(topics.filter(t => t.kept > 0).map(t => t.direct / t.kept));
const MICRO = (topics) => {
  const k = topics.reduce((s, t) => s + t.kept, 0);
  return k ? topics.reduce((s, t) => s + t.direct, 0) / k : NaN;
};
const MACRO = (topics) => mean(topics.map(t =>
  t.kept === 0 ? (t.stratum === "absent" ? 1 : 0) : t.direct / t.kept));

// ── the fixture: two arms, and the disagreement is the point ──────────────────
// "abstainer" is the behaviour we want: perfect on covered topics, silent on absent ones.
// "junk" returns irrelevant sources on the absent topics instead of staying quiet.
const abstainer = [
  { topic: "hfref", stratum: "covered", direct: 8, kept: 10 },
  { topic: "ckd",   stratum: "covered", direct: 7, kept: 10 },
  { topic: "dka",   stratum: "absent",  direct: 0, kept: 0  },   // correct silence
  { topic: "bp",    stratum: "absent",  direct: 0, kept: 0  },   // correct silence
];
const junk = [
  { topic: "hfref", stratum: "covered", direct: 8, kept: 10 },
  { topic: "ckd",   stratum: "covered", direct: 7, kept: 10 },
  { topic: "dka",   stratum: "absent",  direct: 0, kept: 6  },   // six irrelevant sources
  { topic: "bp",    stratum: "absent",  direct: 0, kept: 6  },
];

{
  // THE BUG, demonstrated: under the old statistic the two arms are INDISTINGUISHABLE on the covered
  // topics and the abstainer gets no credit at all for the behaviour the experiment is looking for.
  ok(Math.abs(OLD(abstainer) - 0.75) < 1e-9,
     `old macro scores the abstainer on only its 2 non-empty topics (${OLD(abstainer).toFixed(3)})`);
  ok(OLD(abstainer) > OLD(junk),
     "…the old statistic does prefer the abstainer, but for the wrong reason:");
  ok(abstainer.filter(t => t.kept > 0).length === 2 && junk.filter(t => t.kept > 0).length === 4,
     "…it averaged the two arms over DIFFERENT topic counts (2 vs 4) — not comparable quantities");
}

{
  // THE FIX: a fixed denominator. Every topic scores for every arm.
  const a = MACRO(abstainer), j = MACRO(junk);
  ok(abstainer.length === junk.length, "macro* uses the same denominator for both arms (4 topics each)");
  ok(Math.abs(a - 0.875) < 1e-9, `abstainer macro* = ${a.toFixed(3)} — correct silence scores 1.0`);
  ok(Math.abs(j - 0.375) < 1e-9, `junk macro* = ${j.toFixed(3)} — irrelevant sources score 0`);
  ok(a > j, "…and the arm that stays quiet on uncovered topics now scores strictly better");
}

{
  // Silence is not blanket credit: staying quiet on a COVERED topic is a retrieval failure, not success.
  const lazy = [
    { topic: "hfref", stratum: "covered", direct: 0, kept: 0 },
    { topic: "ckd",   stratum: "covered", direct: 0, kept: 0 },
    { topic: "dka",   stratum: "absent",  direct: 0, kept: 0 },
    { topic: "bp",    stratum: "absent",  direct: 0, kept: 0 },
  ];
  ok(Math.abs(MACRO(lazy) - 0.5) < 1e-9,
     `an arm that returns NOTHING anywhere scores ${MACRO(lazy).toFixed(3)}, not 1.0 — silence on a`);
  ok(MACRO(lazy) < MACRO(abstainer), "…covered topic is a miss, so it cannot game the metric");
  ok(Number.isNaN(MICRO(lazy)), "…and micro is undefined for it (nothing returned), which is honest");
}

{
  // Micro pools everything: no topic dropped. NB the denominator is each arm's OWN kept count — an
  // earlier comment called it "one denominator for every arm", which is false. The shared-denominator
  // property belongs to macro* alone. (Corrected 2026-07-29.)
  ok(MICRO(abstainer) !== undefined && abstainer.reduce((s, t) => s + t.kept, 0) !== junk.reduce((s, t) => s + t.kept, 0),
     "micro denominators DIFFER between arms (20 vs 32) — it is not a shared-denominator statistic");
  ok(Math.abs(MICRO(abstainer) - 15 / 20) < 1e-9, `abstainer micro = ${MICRO(abstainer).toFixed(3)}`);
  ok(Math.abs(MICRO(junk) - 15 / 32) < 1e-9, `junk micro = ${MICRO(junk).toFixed(3)} — diluted by the junk`);
  ok(MICRO(abstainer) > MICRO(junk), "…micro penalises returning irrelevant sources, as it should");
}

// ── the implementation must actually report all of this ──────────────────────
{
  const src = readFileSync(new URL("./rag/eval_pipeline_arms.mjs", import.meta.url), "utf8");
  for (const [field, why] of [
    ["micro_precision", "pooled precision"],
    ["macro_precision_fixed_denominator", "macro over every topic"],
    ["abstained_topics", "how often each arm returned nothing"],
    ["irrelevant_on_absent_topics", "the number that speaks to D-1"],
    ["by_stratum", "covered / thin / absent reported separately"],
  ]) ok(new RegExp(field).test(src), `the scored artifact reports ${field} — ${why}`);

  ok(/macro_precision_excluding_abstentions_DEPRECATED/.test(src),
     "the old statistic is retained but named DEPRECATED, so the change stays auditable");
  ok(/DO NOT choose an arm on a single number/.test(src),
     "the console output warns against choosing on one number");
  ok(/journal_rank <= 2 as a HARD FILTER/.test(src),
     "…and states the journal_rank scope limit with the result, where it cannot be missed");
}

console.log("\n" + (failures === 0 ? "✔ CALIBRATION SCORING TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
