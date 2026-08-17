const fs=require("fs"); const p="index.html"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const rep=(from,to,msg)=>{ must(s.includes(from),msg); must(s.split(from).length===2,"not unique: "+msg); s=s.replace(from,to); };

rep(
`    var guidelineContext = "";
    if (glRef) {
      guidelineContext = "\\n\\n═══ GUIDELINE REFERENCE CONTEXT (use this to anchor your recommendations) ═══" + glRef.context;
      // Resolved trials only. An unresolvable trial is not named at all — see resolveTrials().
      var _tr = resolveTrials(glRef.trials);`,
`    // AWAITED, not assumed. The boot kick-off usually wins this race, but "usually" is how the talk ends
    // up with zero trials and nothing saying so. retrieveRAG has already run above, so in practice this
    // resolves instantly; the bound only matters when the fetch is genuinely stuck.
    var _lmReady = await ensureLandmarkIndex();
    S._trialIndexReady = _lmReady;
    var guidelineContext = "";
    if (glRef) {
      guidelineContext = "\\n\\n═══ GUIDELINE REFERENCE CONTEXT (use this to anchor your recommendations) ═══" + glRef.context;
      // Resolved trials only. An unresolvable trial is not named at all — see resolveTrials().
      var _tr = resolveTrials(glRef.trials);
      S._trialsNamed = _tr.resolved.length;
      S._trialsDropped = _tr.dropped.length;`,
  "await site");

fs.writeFileSync(p,s); console.log("await wired");
