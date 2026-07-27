// Show the raw responses behind the UNUSABLE rows and the clean-talk patches.
import { readFileSync } from "fs";
const r = JSON.parse(readFileSync("rag/eval_critic_report.json", "utf8"));
console.log(`model: ${r.model} · ${r.at}\n`);
for (const row of r.rows) {
  const interesting = /UNUSABLE/.test(row.verdict) || (row.class === "clean" && row.verdict !== "clean");
  if (!interesting) continue;
  console.log("─".repeat(78));
  console.log(`${row.id}  [${row.class}]  verdict=${row.verdict}`);
  console.log(`first 400 chars of the raw response:`);
  console.log(JSON.stringify(String(row.raw || "").slice(0, 400)));
  if (row.class === "clean") {
    try {
      const p = JSON.parse(String(row.raw).replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
      if (Array.isArray(p.patches)) {
        console.log(`\nWHAT IT WANTED TO CHANGE IN A HEALTHY TALK (${p.patches.length}):`);
        for (const q of p.patches) console.log(`   ${q.op} ${q.path}\n      → ${String(q.value || "").slice(0, 150)}`);
      }
    } catch {}
  }
}
