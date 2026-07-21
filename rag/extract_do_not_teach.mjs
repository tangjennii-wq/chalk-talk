#!/usr/bin/env node
/**
 * Extract corrective/audit prose out of guideline `keys` into STRUCTURED constraint fields.
 *
 * WHY THIS EXISTS
 * 57/183 guideline entries carry corrective audit notes inline in `keys` — e.g.
 *   "PHANTOM-YEAR FIX: there was never a 2024 SSC update ... SSC 2026 REPLACES 2021."
 * `keys` is injected verbatim as GUIDELINE REFERENCE CONTEXT at generation time, so the model is
 * currently reading Jenni's audit notes as if they were TEACHING MATERIAL. That is the wrong field:
 * this text is a CONSTRAINT ("do not cite the 2024 doc, it doesn't exist"), not a teaching point.
 *
 * The manifest (rag/guidelines_manifest.json) already has the right homes for it and they are all
 * empty: do_not_teach[], supersedes[], caveats[]. This script proposes the split.
 *
 * DRY RUN BY DEFAULT. Writes a review report; does NOT touch index.html (the GUIDELINES object uses
 * double-quoted JS strings — a stray `"` breaks the whole file, so edits there are done by hand).
 *
 * Usage:
 *   node rag/extract_guidelines.mjs && node rag/extract_do_not_teach.mjs
 *   -> rag/do_not_teach_proposed.json   (machine-readable, to populate the manifest)
 *   -> DO_NOT_TEACH_REVIEW.md           (human review)
 */
import { readFileSync, writeFileSync } from "fs";

const entries = JSON.parse(readFileSync("rag/guidelines_extracted.json", "utf8"));

/**
 * Sentence split that survives medical prose. Splits ONLY on "." and ONLY at paren depth 0 —
 * splitting on ";" tore citations in half ("Kidney Int 2021;99(3S):S1-S87" -> two fragments).
 */
function sentences(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return [];
  const parts = [];
  let buf = "", depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    buf += ch;
    if (ch === "(" || ch === "[") { depth++; continue; }
    if (ch === ")" || ch === "]") { depth = Math.max(0, depth - 1); continue; }
    if (ch !== ".") continue;
    if (depth > 0) continue;                                   // never split inside a citation
    const before = buf.slice(-6);
    const after = s.slice(i + 1, i + 3);
    if (/\b[A-Z]\.$/.test(before)) continue;                   // "C. difficile"
    if (/\b(e\.g|i\.e|vs|approx|Dr|Suppl|Int|Am|J|Eur|no)\.$/i.test(before)) continue;
    if (/\d\.$/.test(before) && /^\s*\d/.test(after)) continue; // "1.5"
    if (!/^\s*[A-Z0-9]/.test(after)) continue;                 // next sentence must start capital/digit
    parts.push(buf.trim());
    buf = "";
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

// A sentence is CORRECTIVE (a constraint about what not to cite) vs TEACHING (clinical content).
const NEGATIVE = [
  /\bthere (?:is|was|are|were) (?:no|never)\b/i,
  /\bdoes not exist\b/i,
  /\bno longer\b/i,
  /\bis NOT (?:current|on|a )/i,
  /\bnot a \d{4}\b/i,
  /\blegacy\b/i,
  /\bphantom\b/i,
  /\bthe society list omitted\b/i,
  /\bdeclined to endorse\b/i,
  /\bdid not endorse\b/i,
];
const FIX_PREFIX = /^(?:[A-Z][A-Z\s+\-]*)?\bFIX\b\s*:/i;      // "YEAR FIX:", "SOCIETY + YEAR FIX:", "CITATION FIX:"
const SUPERSEDE  = /\b(replaces|supersedes|is now out and|the current (?:US )?(?:guideline|document) is|the operative document is|the real documents? (?:are|is))\b/i;
const CAVEAT     = /\b(contested|living document|cite by access date|cite .* by access|in review|uncertain|conditional recommendation)\b/i;

// Strong caveat signals win over the negative test: "CONTESTED - there is no longer a single
// consensus" is a hedging instruction, not a do-not-cite rule.
const CAVEAT_STRONG = /\b(contested|living document|cite by access date|declined to endorse|did not endorse|in review)\b/i;

// "replaces" alone is far too broad — "PREVENT calculator replaces pooled cohort equations" is
// TEACHING content, not a corpus correction. A supersede claim must either name a document type or
// appear in an entry that is explicitly flagged as a correction (has a FIX: prefix somewhere).
const DOC_WORD = /\b(guideline|guidance|document|statement|update|version|doc|criteria)\b/i;

function classify(sent, entryHasFix) {
  const bare = sent.replace(FIX_PREFIX, "").trim();
  const hasFix = FIX_PREFIX.test(sent);
  if (CAVEAT_STRONG.test(bare)) return { kind: "caveats", text: bare };
  if (NEGATIVE.some((r) => r.test(bare))) return { kind: "do_not_teach", text: bare };
  if (SUPERSEDE.test(bare) && (DOC_WORD.test(bare) || entryHasFix)) return { kind: "supersedes", text: bare };
  if (CAVEAT.test(bare)) return { kind: "caveats", text: bare };
  if (hasFix) return { kind: "do_not_teach", text: bare };               // explicit FIX: with no other signal
  return null;                                                           // teaching content
}

const out = [];
let totalMoved = 0;

for (const e of entries) {
  const sents = sentences(e.keys);
  const entryHasFix = sents.some((s) => FIX_PREFIX.test(s));
  const dnt = [], sup = [], cav = [], teach = [];
  for (const s of sents) {
    const c = classify(s, entryHasFix);
    if (!c) { teach.push(s); continue; }
    if (c.kind === "do_not_teach") dnt.push(c.text);
    else if (c.kind === "supersedes") sup.push(c.text);
    else cav.push(c.text);
  }
  // Also mine the NAME — several carry the correction in the title itself.
  const nameNote = /\(([^)]*(?:no |not |alone|omitted|there is)[^)]*)\)/i.exec(e.name || "");
  if (nameNote) cav.push("(from title) " + nameNote[1].trim());

  if (dnt.length || sup.length || cav.length) {
    totalMoved += dnt.length + sup.length + cav.length;
    out.push({
      name: e.name, specialty: e.specialty, year: e.year, url: e.url,
      do_not_teach: dnt, supersedes: sup, caveats: cav,
      keys_cleaned: teach.join(" "),
      keys_original_len: (e.keys || "").length,
      keys_cleaned_len: teach.join(" ").length,
    });
  }
}

writeFileSync("rag/do_not_teach_proposed.json", JSON.stringify(out, null, 2));

// ── human review report ──
let md = `# do_not_teach extraction — REVIEW BEFORE APPLYING\n\n`;
md += `Generated ${new Date().toISOString().slice(0, 10)} · **${out.length} of ${entries.length} entries** carry corrective prose · **${totalMoved} statements** proposed for移 relocation.\n\n`;
md = md.replace("移 ", "");
md += `## Why\n\n`;
md += `\`keys\` is injected verbatim as GUIDELINE REFERENCE CONTEXT at generation time. Every sentence below is currently being fed to the model as **teaching material** when it is actually a **constraint**. Moving it to \`do_not_teach\` / \`supersedes\` / \`caveats\` means it can be enforced ("never cite X") instead of taught.\n\n`;
md += `**Nothing is auto-applied.** \`GUIDELINES\` in index.html uses double-quoted JS strings; edits there are by hand.\n\n`;
md += `| bucket | meaning |\n|---|---|\n`;
md += `| \`do_not_teach\` | this document/year/society does not exist — never cite it |\n`;
md += `| \`supersedes\` | the correct current document to cite instead |\n`;
md += `| \`caveats\` | contested, living, or low-certainty — teach with hedging |\n\n---\n\n`;

for (const r of out) {
  md += `### [${r.specialty}] ${r.name}\n\n`;
  if (r.do_not_teach.length) { md += `**do_not_teach**\n`; r.do_not_teach.forEach((x) => (md += `- ${x}\n`)); md += `\n`; }
  if (r.supersedes.length)   { md += `**supersedes**\n`;   r.supersedes.forEach((x) => (md += `- ${x}\n`));   md += `\n`; }
  if (r.caveats.length)      { md += `**caveats**\n`;      r.caveats.forEach((x) => (md += `- ${x}\n`));      md += `\n`; }
  md += `<details><summary>keys after removal (${r.keys_cleaned_len}/${r.keys_original_len} chars)</summary>\n\n${r.keys_cleaned || "_(empty — review by hand)_"}\n\n</details>\n\n---\n\n`;
}
writeFileSync("DO_NOT_TEACH_REVIEW.md", md);

console.log(`entries scanned:      ${entries.length}`);
console.log(`with corrective prose:${out.length}`);
console.log(`statements relocated: ${totalMoved}`);
console.log(`  do_not_teach: ${out.reduce((n, r) => n + r.do_not_teach.length, 0)}`);
console.log(`  supersedes:   ${out.reduce((n, r) => n + r.supersedes.length, 0)}`);
console.log(`  caveats:      ${out.reduce((n, r) => n + r.caveats.length, 0)}`);
const emptied = out.filter((r) => !r.keys_cleaned.trim()).length;
if (emptied) console.log(`\n⚠ ${emptied} entr(ies) would have EMPTY keys after removal — review by hand.`);
console.log(`\n-> rag/do_not_teach_proposed.json`);
console.log(`-> DO_NOT_TEACH_REVIEW.md`);
