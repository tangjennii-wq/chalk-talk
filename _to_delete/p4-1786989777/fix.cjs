const fs=require("fs"); const p="index.html"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const rep=(from,to,msg)=>{ must(s.includes(from),msg); must(s.split(from).length===2,"not unique: "+msg); s=s.replace(from,to); };
// stray quote-comma left in a comment by the previous patch
rep("// Resolved trials only. An unresolvable trial is not named at all — see resolveTrials().',",
    "// Resolved trials only. An unresolvable trial is not named at all — see resolveTrials().",
    "stray token");
fs.writeFileSync(p,s); console.log("cleaned");
