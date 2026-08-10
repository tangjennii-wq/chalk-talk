// INLINE-SCRIPT SCOPE CHECK — run: node test_inline_scope.mjs
//
// `node --check` cannot see scope. An undeclared identifier is valid syntax; it only fails when the line
// executes. Two production defects came through that hole:
//   • _dvCached — a deleted control's local, still referenced below it. render() threw and every
//     saved-talk open hung on "Opening your talk". (test_no_orphan_locals.mjs gates that specific name.)
//   • ROLES — declared with `var` inside the profile-edit branch of the settings renderer and read by a
//     top-level function. That function threw on every call, a bare catch swallowed it, and profiles
//     showed "resident" instead of "Resident". Silent for as long as it existed.
//
// test_no_orphan_locals.mjs says in its own comments that a regex cannot see scope and that eslint
// no-undef is the real tool. This is that tool. It parses the inline blocks properly, so it reports
// scope, not a guess — and it found ROLES on its first run.
//
// Requires devDependencies (eslint, globals). If they are absent this FAILS rather than skipping: a
// check that quietly does nothing is the instrument-reporting-an-unearned-state defect this repo keeps
// hitting. Run `npm install`.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

let ESLint, globals;
try {
  ({ ESLint } = await import("eslint"));
  globals = (await import("globals")).default;
} catch (e) {
  console.log("✗ FAIL — eslint/globals not installed. Run `npm install`. (" + e.message + ")");
  console.log("\n✗ 1 FAILURE(S)");
  process.exit(1);
}

const htmlPath = new URL("./index.html", import.meta.url);
const html = readFileSync(htmlPath, "utf8");

// Extract every inline block, remembering where its body starts in index.html so a reported line maps
// back to the file a human actually edits.
const blocks = [];
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html))) {
  const attrs = m[1] || "";
  if (/\bsrc\s*=/.test(attrs)) continue;                    // external file, not ours to lint
  const bodyStart = m.index + m[0].indexOf(">") + 1;
  blocks.push({
    code: m[2],
    isModule: /type\s*=\s*["']?module/i.test(attrs),
    // body begins on the same line as the closing ">" of the opening tag
    htmlLine: html.slice(0, bodyStart).split("\n").length,
  });
}

ok(blocks.length >= 2, `found ${blocks.length} inline script block(s) to lint`);

// The CDN libraries the page loads via <script src>, plus the client the module block publishes.
const PAGE_GLOBALS = { html2canvas: "readonly", Sortable: "readonly", supabase: "readonly" };

const makeLinter = (sourceType) => new ESLint({
  cwd: process.cwd(),
  overrideConfigFile: true,
  overrideConfig: [{
    languageOptions: {
      ecmaVersion: 2022,
      sourceType,
      globals: { ...globals.browser, ...PAGE_GLOBALS },
    },
    rules: { "no-undef": "error" },
  }],
});

const found = [];
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i];
  const linter = makeLinter(b.isModule ? "module" : "script");
  const ext = b.isModule ? "mjs" : "js";
  const results = await linter.lintText(b.code, { filePath: `${process.cwd()}/__inline_block${i + 1}.${ext}` });
  for (const r of results) {
    for (const msg of r.messages) {
      found.push({
        block: i + 1,
        htmlLine: b.htmlLine + msg.line - 1,
        name: (msg.message.match(/'([^']+)'/) || [])[1] || msg.message,
        message: msg.message,
      });
    }
  }
}

for (const f of found) {
  console.log(`      index.html:${f.htmlLine} (block ${f.block}) — ${f.message}`);
}
ok(found.length === 0,
   `no-undef across every inline block — ${found.length} undeclared reference(s)` +
   (found.length ? ": " + [...new Set(found.map(f => f.name))].join(", ") : ""));

// The regression this was built on. ROLES must stay reachable from _roleLabel, which is top level.
const declaredTopLevel = /^var ROLES\s*=/m.test(html);
ok(declaredTopLevel, "ROLES is declared at top level, where _roleLabel() can see it");

console.log("\n" + (failures === 0 ? "✔ INLINE SCOPE CLEAN" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
