// NO ORPHANED LOCALS — run: node test_no_orphan_locals.mjs
//
// On 2026-08-07 opening any saved talk hung on "Opening your talk…". The cause was one line: a depth
// control was deleted from the Edit panel, but an explanatory string BELOW it still referenced the
// control's local (_dvCached). render() threw ReferenceError, the overlay never cleared, and the app
// looked like it was stuck on a network call.
//
// Nothing caught it. `node --check` parses fine — an undeclared identifier is legal syntax and only
// fails when the line executes. No suite renders a talk. So the failure reached production twice.
//
// What this file GATES on is the specific regression: _dvCached must stay gone. The broader scan below is
// informational, because a regex cannot see scope and a noisy gate is worse than none.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

// Strip comments and string literals: a name inside a comment or a quoted string is not a reference.
// STRINGS FIRST, THEN COMMENTS. The first version stripped // comments before string literals, so every
// "https://…" truncated its line and deleted the declarations on it — 76 phantom orphans, which is the
// kind of noise that gets a useful check deleted rather than fixed.
const code = html
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, "``")
  .split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n");

const declared = new Set();
for (const m of code.matchAll(/\b(?:var|let|const)\s+(_\w+)/g)) declared.add(m[1]);
for (const m of code.matchAll(/\bfunction\s+(_\w+)\s*\(/g)) declared.add(m[1]);
// function parameters and catch bindings count as declarations
for (const m of code.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
  for (const p of m[1].split(",")) { const n = p.trim().split(/[=\s]/)[0]; if (/^_\w+$/.test(n)) declared.add(n); }
}
for (const m of code.matchAll(/catch\s*\(\s*(_\w+)\s*\)/g)) declared.add(m[1]);

const used = new Map();
for (const m of code.matchAll(/(?<![.\w$])(_\w+)\b/g)) {
  const name = m[1];
  if (declared.has(name)) continue;
  if (/^_+$/.test(name)) continue;
  if (!used.has(name)) used.set(name, code.slice(0, m.index).split("\n").length);
}

// Known non-locals: properties accessed without a dot are impossible, so anything left is suspicious.
// INFORMATIONAL, NOT A GATE. A regex cannot tell a genuine orphan from a name declared inside a template
// literal or a destructuring pattern, and this scan still reports dozens of those. A check that cries wolf
// gets deleted rather than fixed, so it prints candidates and does not fail the build.
//
// The real tool for this is eslint's no-undef against the inline scripts, which understands scope instead
// of guessing at it. Worth 10 minutes when someone is fresh; noted rather than half-built here.
const orphans = [...used.entries()];
console.log(`  (informational) ${orphans.length} underscore names used without a visible declaration — ` +
            `regex cannot see template-literal or destructured bindings, so most are false positives.`);

// And the specific one that broke production, named so a regression is unmistakable.
ok(!/(?<![.\w$])_dvCached\b/.test(code),
   "_dvCached — the depth-control local whose orphan hung every saved-talk open — is gone");

console.log("\n" + (failures === 0 ? "✔ NO ORPHANED LOCALS" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
