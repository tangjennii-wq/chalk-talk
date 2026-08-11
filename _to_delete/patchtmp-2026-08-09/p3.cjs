const fs=require("fs"); const p="index.html"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const rep=(from,to,msg)=>{ must(s.includes(from),msg); must(s.split(from).length===2,"not unique: "+msg); s=s.replace(from,to); };

// The drawer shows lectures only, so its footer has to say where boards and visuals went. Scoped to the
// drawer's own button — the landing row has a differently-scoped link with the same words.
rep(`font-family:inherit">See all in library →</button></div>`,
    `font-family:inherit">See all — boards &amp; visuals too →</button></div>`,
    "see-all label (drawer footer)");

rep(`_mlsa.onclick=function(){S.mobileLibOpen=false;S.showSaved=true;S.savedSearch="";render();refreshLibraryShowcaseSamples();};`,
    `_mlsa.onclick=function(){S.mobileLibOpen=false;S.mobileLibSpecOpen=false;S.showSaved=true;S.savedSearch="";render();refreshLibraryShowcaseSamples();};`,
    "see-all handler");

rep(`  document.querySelectorAll(".mobileLibItem").forEach(function(b){b.onclick=function(){S.mobileLibOpen=false;loadSavedTalk(b.dataset.id);}});`,
`  var _mlspt=document.getElementById("mobileLibSpecToggle");
  if(_mlspt)_mlspt.onclick=function(){S.mobileLibSpecOpen=!S.mobileLibSpecOpen;render();};
  // Empty data-spec means All. S.libSpec is the SAME key the desktop Library uses, so a choice made here
  // survives "See all" instead of silently resetting.
  document.querySelectorAll(".mobileLibSpecBtn").forEach(function(b){b.onclick=function(){var v=b.dataset.spec||"";S.libSpec=v||null;render();}});
  document.querySelectorAll(".mobileLibItem").forEach(function(b){b.onclick=function(){S.mobileLibOpen=false;S.mobileLibSpecOpen=false;loadSavedTalk(b.dataset.id);}});`,
    "drawer item wiring");

fs.writeFileSync(p,s); console.log("part 3 applied");
