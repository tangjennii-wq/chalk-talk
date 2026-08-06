// CI WIRING — run: node test_ci_wiring.mjs
//
// ── WHY ──────────────────────────────────────────────────────────────────────────────────────────────
// Two counting failures in one day, both in the instrument rather than the code:
//   • I reported "35 suites pass" from `ls | head -18` plus `| tail -17`. The ranges don't meet; positions
//     19–22 never ran, and two of them were the suites most exposed to the change under test.
//   • test_refine_guard.mjs made all 15 of its checks with console.assert, which neither throws nor sets
//     an exit code, and then printed "✔ ALL TESTS PASSED" unconditionally. It could not fail, and every
//     runner counted it as passing.
//
// So this suite tests the test system: the counts are stated explicitly, discovery is verified against an
// independent walk, and every suite must be capable of failing. A suite that cannot fail is worse than a
// missing one, because it reports safety it never checked.
import { readdirSync, readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const here = new URL("./", import.meta.url).pathname;

// ── 1 · THE COUNTS, STATED ───────────────────────────────────────────────────
// 39 root + 1 under rag/ = 40. Naming both numbers is the point: "39" and "40" are both correct answers to
// different questions, and the discrepancy that started this was someone quoting one as the other.
const rootTests = readdirSync(here).filter(f => /^test_.*\.mjs$/.test(f)).sort();
const subTests = [];
for (const d of readdirSync(here, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name === "node_modules" || d.name.startsWith(".")) continue;
  for (const f of readdirSync(here + d.name).filter(f => /^test_.*\.mjs$/.test(f)).sort()) {
    subTests.push(d.name + "/" + f);
  }
}
const total = rootTests.length + subTests.length;
console.log(`  root: ${rootTests.length}   subdirectories: ${subTests.length} (${subTests.join(", ") || "none"})   total: ${total}`);
ok(rootTests.length >= 39, `at least 39 suites at the repo root (found ${rootTests.length})`);
ok(subTests.length >= 1, `…plus the suites that live in subdirectories, which a root-only glob forgets (${subTests.length})`);

// ── 2 · THE RUNNER DISCOVERS EVERY ONE OF THEM ───────────────────────────────
ok(existsSync(here + "run_tests.mjs"), "there is a single canonical runner");
const runner = spawnSync(process.execPath, [here + "run_tests.mjs", "--shard=1/9999"], { encoding: "utf8", timeout: 60000 });
const m = /discovered (\d+) suite/.exec(runner.stdout || "");
ok(!!m, "…which reports how many suites it discovered");
if (m) {
  ok(Number(m[1]) === total,
     `…and that number equals this independent walk: runner ${m[1]} vs walk ${total}`);
}
const pkg = existsSync(here + "package.json") ? JSON.parse(readFileSync(here + "package.json", "utf8")) : {};
ok((pkg.scripts || {}).test === "node run_tests.mjs",
   "…wired to `npm test`, so there is one command and not a remembered shell loop");

// ── 3 · EVERY SUITE IS CAPABLE OF FAILING ────────────────────────────────────
// The check is structural: a suite must set a nonzero exit code on failure. console.assert cannot, and a
// suite whose last line unconditionally prints success is asserting nothing about itself.
const unfalsifiable = [];
const consoleAsserters = [];
for (const rel of [...rootTests, ...subTests]) {
  const src = readFileSync(here + rel, "utf8");
  const exits = /process\.exit\(/.test(src);
  const conditionalExit = /process\.exit\(\s*[\w.]+\s*(===|!==|>|<|\?)/.test(src) || /process\.exit\(1\)/.test(src);
  const throws = /\bthrow new /.test(src) && !/catch/.test(src);
  if (!(exits && conditionalExit) && !throws) unfalsifiable.push(rel);
  if (/console\.assert\(/.test(src)) consoleAsserters.push(rel);
}
ok(unfalsifiable.length === 0,
   `every suite exits nonzero when it fails (offenders: ${unfalsifiable.join(", ") || "none"})`);
ok(consoleAsserters.length === 0,
   "…and none relies on console.assert, which prints a failure and returns success " +
   `(offenders: ${consoleAsserters.join(", ") || "none"})`);

// ── 3b · AND EVERY SUITE IS WIRED INTO CI ────────────────────────────────────
// tests.yml already ends with a shell guard that fails when a suite on disk never runs. It works — it is
// why this file had to be wired before pushing. Asserting it here too means the answer arrives locally,
// before a red CI run, and in the same place as the counts.
{
  const wf = here + ".github/workflows/tests.yml";
  if (!existsSync(wf)) { ok(false, "the CI workflow exists"); }
  else {
    const y = readFileSync(wf, "utf8");
    const unwired = [...rootTests, ...subTests].filter(f => !y.includes("node " + f));
    ok(unwired.length === 0,
       `every suite on disk runs in CI (unwired: ${unwired.join(", ") || "none"})`);
    ok(/UNWIRED:/.test(y),
       "…and the workflow keeps its own guard against a suite being added without being wired");
  }
}

// ── 4 · THE RUNNER TREATS COVERAGE AS AN ASSERTION ───────────────────────────
const rsrc = readFileSync(here + "run_tests.mjs", "utf8");
ok(/executed \$\{ran\}\/\$\{expected\}/.test(rsrc) || /executed .*ran/.test(rsrc),
   "the runner states how many suites it actually executed");
ok(/COVERAGE FAILURE/.test(rsrc),
   "…and fails when a discovered suite was not executed, rather than reporting on the subset it ran");

console.log("\n" + (failures === 0 ? "✔ CI WIRING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
