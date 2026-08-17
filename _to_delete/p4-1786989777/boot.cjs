const fs=require("fs"); const p="index.html"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const rep=(from,to,msg)=>{ must(s.includes(from),msg); must(s.split(from).length===2,"not unique: "+msg); s=s.replace(from,to); };
rep("\nloadGuidelines();",
`
loadGuidelines();
// Kicked off beside the guidelines, NOT awaited and NOT gating generation: a failure here costs trial
// citations, not the talk. resolveTrials() returns nothing while it is unset, so the window before it
// lands names no trials rather than naming unsourced ones.
loadLandmarkPmids();`,
"boot");
fs.writeFileSync(p,s); console.log("boot wired");
