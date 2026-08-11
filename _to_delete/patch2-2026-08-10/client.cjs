const fs=require("fs"); const p="index.html"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const rep=(from,to,msg)=>{ must(s.includes(from),msg); must(s.split(from).length===2,"not unique: "+msg); s=s.replace(from,to); };

// The hourglass was set in ONE place — the synchronous/BYOK branch — so the durable path, which is the
// only path the free tier takes, never showed it. The predicate is the same one the async submit used to
// decide whether to send the tools at all (line ~8410), so the two cannot drift apart.
const HOURGLASS = `S.reviewLiveChecking = (stage === "critique") && topicNeedsLiveCheck(S.topic); `;

rep(`function(stage){ S.genPhase = (stage === "critique") ? "reviewing" : "drafting"; S.loadMsg = (stage === "critique") ? "AI-checking & polishing (server-side)…" : "Finishing your talk (server-side)…"; render(); },`,
    `function(stage){ S.genPhase = (stage === "critique") ? "reviewing" : "drafting"; ` + HOURGLASS + `S.loadMsg = (stage === "critique") ? "AI-checking & polishing (server-side)…" : "Finishing your talk (server-side)…"; render(); },`,
    "resume-path stage handler");

rep(`function(stage){ S.genPhase = (stage === "critique") ? "reviewing" : "drafting"; S.loadMsg = (stage === "critique") ? "AI-checking & polishing (server-side)…" : "Drafting your talk (server-side)…"; if (typeof render === "function") render(); },`,
    `function(stage){ S.genPhase = (stage === "critique") ? "reviewing" : "drafting"; ` + HOURGLASS + `S.loadMsg = (stage === "critique") ? "AI-checking & polishing (server-side)…" : "Drafting your talk (server-side)…"; if (typeof render === "function") render(); },`,
    "async-submit stage handler");

// Clear it wherever generation stops, so a stale true cannot leak into the next run — the same defect
// class as genBackgroundSafe (handoff, 2026-08-09).
const CLEAR_FROM = `S.citationAuditPending = false; S.loading = false;`;
const n = s.split(CLEAR_FROM).length - 1;
must(n === 2, "expected 2 loading-clear sites, found " + n);
s = s.split(CLEAR_FROM).join(`S.citationAuditPending = false; S.loading = false; S.reviewLiveChecking = false;`);

fs.writeFileSync(p,s); console.log("client patched (" + n + " clear sites)");
