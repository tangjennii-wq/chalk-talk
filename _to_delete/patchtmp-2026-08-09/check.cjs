const fs=require("fs");
const html=fs.readFileSync("index.html","utf8");
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi; let m,n=0;
while((m=re.exec(html))){ if(/\bsrc\s*=/.test(m[1]||"")) continue; n++;
  if(/type\s*=\s*["']?module/i.test(m[1]||"")) continue;
  try{ new Function(m[2]); }catch(e){ console.log("PARSE FAIL block "+n+": "+e.message); process.exit(1); } }
console.log("all inline blocks parse");
