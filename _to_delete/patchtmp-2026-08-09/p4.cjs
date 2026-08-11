const fs=require("fs"); const p="index.html"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const rep=(from,to,msg)=>{ must(s.includes(from),msg); must(s.split(from).length===2,"not unique: "+msg); s=s.replace(from,to); };
rep("    if(!_libRecent.length){", "    if(!_libView.total){", "fallback guard");
must(!/(?<![.\w$])_libRecent\b/.test(s), "_libRecent still referenced somewhere");
fs.writeFileSync(p,s); console.log("part 4 applied");
