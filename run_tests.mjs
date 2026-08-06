// THE CANONICAL TEST COMMAND.  node run_tests.mjs [--shard i/n]
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────────────
// I validated the free-tier pass with two ad-hoc shell loops — `ls test_*.mjs | head -18` and
// `| tail -17` — and reported "all 35 suites pass". There are 39. The two ranges do not meet: positions
// 19–22 were never executed, and two of them (legacy-path metering, migration atomicity) were the suites
// MOST likely to be broken by that very change. The count was the only reason it was caught.
//
// This is the same defect that has recurred all day in a new place: an instrument reporting a state it had
// not earned. A runner that cannot say how many suites exist cannot tell you it ran them.
//
// So: discover every test file, run each exactly once, and PROVE coverage — if the number executed does
// not equal the number discovered, that is a failure regardless of what the suites themselves said.
import { readdirSync, existsSync } from "fs";
import { spawnSync } from "child_process";

const here = new URL("./", import.meta.url).pathname;
const discover = () => {
  const files = readdirSync(here).filter(f => /^test_.*\.mjs$/.test(f)).sort().map(f => f);
  // Tests living outside the root are the ones a root-only glob silently forgets.
  if (existsSync(here + "rag")) {
    for (const f of readdirSync(here + "rag").filter(f => /^test_.*\.mjs$/.test(f)).sort()) files.push("rag/" + f);
  }
  return files;
};

const all = discover();
const arg = process.argv.find(a => a.startsWith("--shard="));
let mine = all, shard = null;
if (arg) {
  const [i, n] = arg.slice(8).split("/").map(Number);
  if (!(i >= 1 && n >= 1 && i <= n)) { console.error("bad --shard"); process.exit(2); }
  shard = { i, n };
  mine = all.filter((_, k) => k % n === (i - 1));
}

console.log(`discovered ${all.length} suite(s)` + (shard ? `; shard ${shard.i}/${shard.n} runs ${mine.length}` : ""));

let ran = 0, failed = [];
for (const f of mine) {
  const r = spawnSync(process.execPath, [here + f], { encoding: "utf8", timeout: 120000 });
  ran++;
  const bad = r.status !== 0 || r.error;
  if (bad) {
    failed.push(f);
    console.log("FAIL " + f + (r.error ? " (" + r.error.message + ")" : ""));
    const out = ((r.stdout || "") + (r.stderr || "")).split("\n");
    for (const l of out.filter(l => /FAIL|Error/.test(l)).slice(0, 6)) console.log("      " + l.trim());
  } else {
    console.log("ok   " + f);
  }
}

// COVERAGE IS ITSELF AN ASSERTION.
const expected = mine.length;
const covered = ran === expected;
console.log(`\nexecuted ${ran}/${expected} of this run's suites (of ${all.length} discovered)`);
if (!covered) console.log("✗ COVERAGE FAILURE: a suite was discovered but not executed");
if (failed.length) console.log("✗ " + failed.length + " SUITE(S) FAILED: " + failed.join(" "));
if (covered && !failed.length) console.log(shard ? "✔ SHARD CLEAN" : "✔ ALL SUITES PASS");
process.exit(covered && !failed.length ? 0 : 1);
