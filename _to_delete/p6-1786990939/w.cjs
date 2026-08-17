const fs=require("fs"); const p="worker.js"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const rep=(from,to,msg)=>{ must(s.includes(from),msg); must(s.split(from).length===2,"not unique: "+msg); s=s.replace(from,to); };
rep("const TRIALS_MAX = 12;\nconst TRIAL_ABSTRACT_CHARS = 3000;   // corpus p90 is 3065 chars, so this keeps ~90% of abstracts whole",
    fs.readFileSync(".p6/cap.txt","utf8").trimEnd(), "caps");
const oldFrom = s.indexOf("  // An EMPTY abstract is a MISS");
must(oldFrom > 0, "body start");
const oldTo = s.indexOf("\n}\n", s.indexOf("return jsonOK({ trials, missing:", oldFrom));
must(oldTo > oldFrom, "body end");
s = s.slice(0, oldFrom) + fs.readFileSync(".p6/body.txt","utf8").trimEnd() + s.slice(oldTo + 3);
fs.writeFileSync(p,s); console.log("caps + budget applied");
