const fs=require("fs");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
function ed(f,pairs){ let s=fs.readFileSync(f,"utf8");
  for(const [from,to,msg] of pairs){ must(s.includes(from),f+" :: "+msg); must(s.split(from).length===2,f+" :: not unique :: "+msg); s=s.replace(from,to); }
  fs.writeFileSync(f,s); console.log("patched "+f); }

// ── 1 · a normalised-name collision must be fatal ───────────────────────────────────────────────────
ed("rag/build_landmark_index.mjs", [[
`  // First writer wins, and a collision is reported rather than silently resolved: two trials sharing a
  // normalised acronym would otherwise hand the model the wrong paper under the right name.
  if (index[key] && index[key].pmid !== String(t.expected_pmid)) {
    console.warn(\`COLLISION: \${key} -> \${index[key].pmid} and \${t.expected_pmid} (keeping the first)\`);
    continue;
  }`,
`  // A collision is FATAL. Two trials sharing a normalised acronym means the index would hand the model
  // the wrong paper under the right name — the exact failure this whole patch exists to remove, and one
  // that would read as grounded. Keeping the first was the wrong instinct: there is no basis for choosing.
  if (index[key] && index[key].pmid !== String(t.expected_pmid)) {
    console.error(\`COLLISION: normalised acronym \${key} maps to BOTH PMID \${index[key].pmid} (\${index[key].name}) \`
      + \`and PMID \${t.expected_pmid} (\${t.name}). Right acronym, wrong paper is worse than no paper — \`
      + \`disambiguate the names in rag/landmark_trials.json before regenerating.\`);
    process.exit(1);
  }`,
  "collision handling"]]);
