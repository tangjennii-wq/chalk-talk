#!/usr/bin/env node
/**
 * Pull the GUIDELINES object out of index.html into rag/guidelines_extracted.json.
 * index.html is the single source of truth for guideline summaries; this keeps the vector store
 * in sync with it. Run this, then rag/ingest_guidelines.mjs.
 *
 * Usage: node rag/extract_guidelines.mjs
 */
import { readFileSync, writeFileSync } from "fs";

const h = readFileSync("index.html", "utf8");

const start = h.indexOf("var GUIDELINES");
if (start < 0) { console.error("GUIDELINES not found in index.html"); process.exit(1); }
const eq = h.indexOf("=", start);

// Walk braces to find the end of the object literal.
let i = h.indexOf("{", eq), depth = 0, end = -1;
for (let j = i; j < h.length; j++) {
  const c = h[j];
  if (c === "{") depth++;
  else if (c === "}") { depth--; if (depth === 0) { end = j; break; } }
}
if (end < 0) { console.error("Could not find end of GUIDELINES object"); process.exit(1); }

// eslint-disable-next-line no-eval
const G = eval("(" + h.slice(i, end + 1) + ")");

const entries = [];
for (const specialty of Object.keys(G)) {
  for (const g of (G[specialty].guidelines || [])) {
    entries.push({
      specialty,
      name: g.name,
      year: g.year,
      access: g.access || "",
      url: g.url || "",
      keys: g.keys || "",
    });
  }
}

writeFileSync("rag/guidelines_extracted.json", JSON.stringify(entries, null, 2));
console.log(`Extracted ${entries.length} guideline entries across ${Object.keys(G).length} specialties.`);
console.log("-> rag/guidelines_extracted.json");
