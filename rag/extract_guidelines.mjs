#!/usr/bin/env node
/**
 * Flatten the guideline source (guidelines.json) into rag/guidelines_extracted.json.
 *
 * As of the JSON-source migration (2026-07), guidelines.json (repo root) is the SINGLE SOURCE OF
 * TRUTH for guideline data — the app fetches it at runtime and this pipeline derives the canonical
 * manifest from it. (Previously the source was the embedded GUIDELINES object in index.html.)
 *
 * Usage: node rag/extract_guidelines.mjs   (then build_manifest.mjs, audit_manifest.mjs)
 */
import { readFileSync, writeFileSync } from "fs";

const src = JSON.parse(readFileSync("guidelines.json", "utf8"));
const G = src.specialties || src;   // envelope { schema_version, specialties:{...} } or a bare map
if (!G || typeof G !== "object") { console.error("guidelines.json: no specialties map found"); process.exit(1); }

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
