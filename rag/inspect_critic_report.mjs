// Inspect a critic-benchmark report. Run:
//   node rag/inspect_critic_report.mjs                       (most recent)
//   node rag/inspect_critic_report.mjs claude-opus-5         (a specific model)
import { readFileSync, existsSync } from "fs";
const arg = process.argv[2];
const path = arg
  ? (existsSync(`rag/eval_critic_${arg}.json`) ? `rag/eval_critic_${arg}.json` : arg)
  : "rag/eval_critic_report.json";
const r = JSON.parse(readFileSync(path, "utf8"));
console.log(`${path}\nmodel: ${r.model} · ${r.at}\n`);

const patchesOf = (row) => {
  try {
    const p = JSON.parse(String(row.raw || "").replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
    return Array.isArray(p.patches) ? p.patches : [];
  } catch { return []; }
};

for (const row of r.rows) {
  const isCleanTouch = row.class === "clean" && row.verdict !== "clean";
  const isUnusable = /UNUSABLE/.test(row.verdict);
  const isMiss = row.class !== "clean" && !row.caught;
  if (!isCleanTouch && !isUnusable && !isMiss) continue;
  console.log("─".repeat(78));
  console.log(`${row.id}  [${row.class}]  ${row.verdict}  ${Math.round(row.ms / 100) / 10}s`);
  if (isUnusable) {
    console.log("raw (first 300):", JSON.stringify(String(row.raw || "").slice(0, 300)));
    continue;
  }
  if (isMiss) {
    console.log("MISSED the planted defect. What it DID change instead:");
  } else {
    console.log("CHANGED A TALK I CALLED CLEAN — is the fixture wrong, or the critic over-eager?");
  }
  for (const q of patchesOf(row)) {
    const v = typeof q.value === "string" ? q.value : JSON.stringify(q.value);
    console.log(`  ${q.op.padEnd(8)} ${q.path}`);
    console.log(`      → ${String(v).slice(0, 180)}`);
  }
}
