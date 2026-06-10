#!/usr/bin/env node
// Quick JS syntax check for index.html.
// Extracts every inline <script> block and tries to parse it via `new Function`.
// If any block has a syntax error, prints the message + approximate line number in index.html
// and exits non-zero — so this can also be wired into a pre-push hook later.
//
// Usage:  node check_syntax.js              # checks ./index.html
//         node check_syntax.js path/to.html # checks the given file

const fs = require("fs");
const path = require("path");

const target = process.argv[2] || "index.html";
const abs = path.resolve(process.cwd(), target);

if (!fs.existsSync(abs)) {
  console.error("✗ Not found: " + abs);
  process.exit(2);
}

const html = fs.readFileSync(abs, "utf8");

// Match <script>…</script> blocks that do NOT have a src= attribute.
// Captures the opening tag in group 1 and the inner JS in group 2 (so we can detect type=module).
const scriptRe = /<script(?![^>]*\bsrc\b)([^>]*)>([\s\S]*?)<\/script>/g;

let scriptCount = 0;
let checkedCount = 0;
let errorCount = 0;
let m;

while ((m = scriptRe.exec(html)) !== null) {
  scriptCount += 1;
  const attrs = m[1] || "";
  const content = m[2];
  const tagOpenLen = m[0].indexOf(content);
  const startOffset = m.index + tagOpenLen;
  const startLine = html.slice(0, startOffset).split("\n").length;

  // Skip ES module scripts — `new Function()` can't parse `import` statements, but they're
  // valid syntax in the browser. False positives are worse than no check for these.
  if (/\btype\s*=\s*["']?module["']?/.test(attrs)) {
    continue;
  }
  checkedCount += 1;

  try {
    // `new Function` parses the body without executing it. Throws SyntaxError on bad parse.
    // eslint-disable-next-line no-new-func
    new Function(content);
  } catch (err) {
    errorCount += 1;
    console.error("");
    console.error("✗ <script> block #" + scriptCount + " starts around line " + startLine);
    console.error("  " + err.message);
    const stackHint = (err.stack || "").split("\n").slice(0, 3).join("\n  ");
    if (stackHint) console.error("  " + stackHint);
  }
}

if (scriptCount === 0) {
  console.error("✗ No inline <script> blocks found in " + target);
  process.exit(2);
}

if (errorCount === 0) {
  const skipped = scriptCount - checkedCount;
  const skipNote = skipped > 0 ? " (skipped " + skipped + " ES module" + (skipped === 1 ? "" : "s") + ")" : "";
  console.log("✓ Parsed " + checkedCount + " inline script" + (checkedCount === 1 ? "" : "s") + " — no syntax errors in " + target + skipNote);
  process.exit(0);
} else {
  console.error("");
  console.error("Found " + errorCount + " syntax error" + (errorCount === 1 ? "" : "s") + " in " + checkedCount + " checked script block" + (checkedCount === 1 ? "" : "s") + ".");
  process.exit(1);
}
