const fs=require("fs"); const p="index.html"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const rep=(from,to,msg)=>{ must(s.includes(from),msg); must(s.split(from).length===2,"not unique: "+msg); s=s.replace(from,to); };

// ── one retry after a transient failure ─────────────────────────────────────────────────────────────
rep(`var LANDMARK_PROMISE = null;          // so the boot kick-off and a generation can await the SAME fetch`,
    `var LANDMARK_PROMISE = null;          // so the boot kick-off and a generation can await the SAME fetch
var LANDMARK_ATTEMPTS = 0;            // bounded retry — see the catch in _loadLandmarkPmids()`,
  "promise decl");

rep(`    LANDMARK_PMIDS = null; LANDMARK_STATE = "error";
    console.warn("loadLandmarkPmids failed (" + (err && err.message) + ") — no trials will be named this session");`,
`    LANDMARK_PMIDS = null; LANDMARK_STATE = "error";
    // ONE retry. The promise is cached so boot and generation share a fetch, but that also means a single
    // transient failure would poison it for the WHOLE browser session — every later talk silently naming
    // no trials. Clearing it while an attempt remains lets the next generation try again; the bound stops
    // a genuinely missing file becoming a retry loop.
    if(LANDMARK_ATTEMPTS < 2) LANDMARK_PROMISE = null;
    console.warn("loadLandmarkPmids failed (" + (err && err.message) + ")"
      + (LANDMARK_ATTEMPTS < 2 ? " — will retry on the next generation" : " — giving up; no trials will be named this session"));`,
  "retry");

rep(`async function _loadLandmarkPmids(){
  LANDMARK_STATE = "loading";`,
`async function _loadLandmarkPmids(){
  LANDMARK_STATE = "loading";
  LANDMARK_ATTEMPTS++;`,
  "attempt counter");

// ── diagnostics: reset every run, and stamped onto the talk that is delivered ────────────────────────
rep(`  S.genCancelled=false;`,
`  // Trial-grounding diagnostics are per-generation. Left unreset they survive into a topic with no
  // guideline match and read as authoritative — the stale-flag defect this codebase keeps hitting
  // (genBackgroundSafe, _reviewSearched). Cleared here, set below, stamped onto the finished talk.
  S._trialIndexReady = false; S._trialsNamed = 0; S._trialsDropped = 0;
  S.genCancelled=false;`,
  "reset");

rep(`  talk._ragCount = (o.ragCount != null ? o.ragCount : 0);// 0 = don't claim RAG grounding`,
`  talk._ragCount = (o.ragCount != null ? o.ragCount : 0);// 0 = don't claim RAG grounding
  // Trial grounding travels WITH the talk, like _ragCount and _webSearched, so "which trials did this
  // talk actually have evidence for" survives save, resume and refine instead of living on S until the
  // next render clears it.
  talk._trialIndexReady = !!S._trialIndexReady;
  talk._trialsNamed = S._trialsNamed || 0;
  talk._trialsDropped = S._trialsDropped || 0;`,
  "stamp");

fs.writeFileSync(p,s); console.log("client fixes applied");
