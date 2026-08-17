const fs=require("fs"); const p="worker.js"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const start = s.indexOf("  const asked = Array.isArray(body.pmids) ? body.pmids : null;");
must(start>0,"body start");
const endMark = s.indexOf("\n}\n", s.indexOf("return jsonOK({", start));
must(endMark>start,"body end");
s = s.slice(0,start) + fs.readFileSync(".p7/body.txt","utf8").trimEnd() + s.slice(endMark+3);
fs.writeFileSync(p,s); console.log("worker: no silent slice, order preserved, truncation = drop");
