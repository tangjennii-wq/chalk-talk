const fs=require("fs"); const p="index.html"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const rep=(from,to,msg)=>{ must(s.includes(from),msg); must(s.split(from).length===2,"not unique: "+msg); s=s.replace(from,to); };

rep("  // Reset cancel flag at the START of every generation. (Jenni 2026-06-08)",
[ "  // Trial-grounding diagnostics are per-generation. Left unreset they survive into a topic with no",
  "  // guideline match and read as authoritative — the stale-flag defect this codebase keeps hitting",
  "  // (genBackgroundSafe, _reviewSearched). Cleared here, set at resolution, stamped onto the talk.",
  "  S._trialIndexReady = false; S._trialsNamed = 0; S._trialsDropped = 0;",
  "  // Reset cancel flag at the START of every generation. (Jenni 2026-06-08)" ].join("\n"), "reset");

rep("var LANDMARK_PROMISE = null;          // so the boot kick-off and a generation can await the SAME fetch",
[ "var LANDMARK_PROMISE = null;          // so the boot kick-off and a generation can await the SAME fetch",
  "var LANDMARK_ATTEMPTS = 0;            // bounded retry — see the catch in _loadLandmarkPmids()" ].join("\n"), "decl");

rep('    LANDMARK_PMIDS = null; LANDMARK_STATE = "error";\n    console.warn("loadLandmarkPmids failed (" + (err && err.message) + ") — no trials will be named this session");',
[ '    LANDMARK_PMIDS = null; LANDMARK_STATE = "error";',
  "    // ONE retry. The promise is cached so boot and a generation share a fetch, but that also means a",
  "    // single transient failure would poison it for the WHOLE browser session — every later talk then",
  "    // silently names no trials. Clearing it while an attempt remains lets the next generation try again;",
  "    // the bound stops a genuinely missing file turning into a retry loop.",
  "    if(LANDMARK_ATTEMPTS < 2) LANDMARK_PROMISE = null;",
  '    console.warn("loadLandmarkPmids failed (" + (err && err.message) + ")"',
  '      + (LANDMARK_ATTEMPTS < 2 ? " — will retry on the next generation" : " — giving up; no trials named this session"));' ].join("\n"), "retry");

rep('async function _loadLandmarkPmids(){\n  LANDMARK_STATE = "loading";',
    'async function _loadLandmarkPmids(){\n  LANDMARK_STATE = "loading";\n  LANDMARK_ATTEMPTS++;', "counter");

const stampAnchor = "  talk._ragCount = (o.ragCount != null ? o.ragCount : 0);";
must(s.includes(stampAnchor), "stamp anchor");
const line = s.split("\n").find(l => l.startsWith(stampAnchor));
rep(line, line + "\n" +
[ "  // Trial grounding travels WITH the talk, like _ragCount and _webSearched, so which trials this talk",
  "  // actually had evidence for survives save, resume and refine instead of living on S until the next",
  "  // render clears it.",
  "  talk._trialIndexReady = !!S._trialIndexReady;",
  "  talk._trialsNamed = S._trialsNamed || 0;",
  "  talk._trialsDropped = S._trialsDropped || 0;" ].join("\n"), "stamp");

fs.writeFileSync(p,s); console.log("client fixes applied");
