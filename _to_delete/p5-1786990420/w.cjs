const fs=require("fs"); const p="worker.js"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const rep=(from,to,msg)=>{ must(s.includes(from),msg); must(s.split(from).length===2,"not unique: "+msg); s=s.replace(from,to); };
const handler = fs.readFileSync(".p5/handler.txt","utf8");

const routeFrom = '    if (request.method === "POST" && url.pathname === "/retrieve") {\n      return handleRetrieve(request, env, origin);\n    }';
rep(routeFrom, routeFrom + '\n\n    if (request.method === "POST" && url.pathname === "/trials") {\n      return handleTrials(request, env, origin);\n    }', "route");
rep("async function handleRetrieve(request, env, origin) {", handler + "async function handleRetrieve(request, env, origin) {", "handler");
fs.writeFileSync(p,s); console.log("worker /trials added");
