const fs=require("fs");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
function edit(file, pairs){
  let s=fs.readFileSync(file,"utf8");
  for(const [from,to,msg] of pairs){
    must(s.includes(from), file+" :: "+msg);
    must(s.split(from).length===2, file+" :: not unique :: "+msg);
    s=s.replace(from,to);
  }
  fs.writeFileSync(file,s);
  console.log("patched "+file);
}

// ── generation_workflow.js — the durable path the free tier actually uses ───────────────────────────
edit("generation_workflow.js", [
[`  let critique = { text: "", modelUsed: "", usage: null };`,
 `  let critique = { text: "", modelUsed: "", usage: null, webSearched: false };`,
 "critique default"],

[`      return { text: (c && c.text) || "", modelUsed: (c && c.modelUsed) || "", usage: (c && c.usage) || null };`,
 `      // webSearched MUST survive this return. callAnthropicText computes it from the response blocks, and
      // dropping it here is why the live check reported false for every free-tier talk after it started
      // working: the flag existed one frame earlier and the step threw it away.
      return { text: (c && c.text) || "", modelUsed: (c && c.modelUsed) || "", usage: (c && c.usage) || null,
               webSearched: !!(c && c.webSearched) };`,
 "critique step return"],

[`        webSearched: draft.webSearched,`,
 `        // THE CRITIQUE IS THE ONE THAT SEARCHES. callDraft passes tools:null deliberately (920773e), so
        // draft.webSearched is structurally always false — reporting it alone meant the result said "no
        // live check" no matter what the review actually did. OR-ed so the field keeps meaning "a real
        // web_search event came back", whichever call produced it.
        webSearched: !!(draft.webSearched || critique.webSearched),`,
 "finalize result"],
]);

// ── worker.js — the legacy waitUntil path ───────────────────────────────────────────────────────────
edit("worker.js", [
[`    let critText = "", critUsage = null, critModel = null;`,
 `    let critText = "", critUsage = null, critModel = null, critSearched = false;`,
 "crit locals"],

[`        crit = await callAnthropicText(env, body.critique.sys, [{ type: "text", text: critInput }], body.critique.maxTok || 16384, body.critique.models);`,
 `        // Tools were missing entirely here: five arguments, so this path's critique never received the
        // web_search tool even after the Workflow's did. Filtered downstream by ALLOWED_TOOL_TYPES.
        crit = await callAnthropicText(env, body.critique.sys, [{ type: "text", text: critInput }], body.critique.maxTok || 16384, body.critique.models, body.critique.tools || null);`,
 "legacy critique call"],

[`      critText = crit.text; critUsage = crit.usage; critModel = crit.modelUsed;`,
 `      critText = crit.text; critUsage = crit.usage; critModel = crit.modelUsed; critSearched = !!crit.webSearched;`,
 "crit unpack"],

[`webSearched: !!draft.webSearched }`,
 `webSearched: !!(draft.webSearched || critSearched) }`,
 "legacy result"],
]);
