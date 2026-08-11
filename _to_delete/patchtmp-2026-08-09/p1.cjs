const fs=require("fs"); const p="index.html"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const rep=(from,to,msg)=>{ must(s.includes(from),msg); must(s.split(from).length===2,"not unique: "+msg); s=s.replace(from,to); };

const VIEW_FN = [
'// THE MOBILE LIBRARY DRAWER SCOPE, as a pure function so a test can execute it rather than pattern-match',
'// it. Three rules live here and nowhere else:',
'//   - SCOPE IS LECTURES. Boards items carry a .question; they are excluded, and there is no visuals axis',
'//     in the drawer. Both live behind "See all", which opens the full Library where each has its own tab.',
'//   - SORT IS MOST-RECENT, ALWAYS. Choosing a specialty filters the list; it never reorders it.',
'//   - A STALE SPECIALTY FALLS BACK TO ALL. S.libSpec is shared with the desktop Library, so it can name a',
'//     specialty with no lectures in it. An empty drawer would read as broken, so active is null unless',
'//     the specialty actually has items.',
'// specOf is injected rather than calling inferSpecialty() directly, so the test can supply its own.',
'function mobileLibraryView(entries, spec, specOf){',
'  var f = specOf || function(){ return "Other"; };',
'  var rows = [];',
'  for(var i=0;i<(entries||[]).length;i++){',
'    var e = entries[i];',
'    if(!e || !e.talk) continue;',
'    if(e.talk.question) continue;',
'    rows.push({ entry:e, spec:(f(e)||"Other"), t:(new Date(e.savedAt||0).getTime()||0) });',
'  }',
'  rows.sort(function(a,b){ return b.t - a.t; });',
'  var counts = {};',
'  for(var j=0;j<rows.length;j++) counts[rows[j].spec] = (counts[rows[j].spec]||0) + 1;',
'  var specs = Object.keys(counts).sort(function(a,b){',
'    return (counts[b]-counts[a]) || (a<b?-1:(a>b?1:0));',
'  });',
'  var active = (spec && counts[spec]) ? spec : null;',
'  var items = active ? rows.filter(function(r){ return r.spec===active; }) : rows;',
'  return { items:items, specs:specs, counts:counts, total:rows.length, active:active };',
'}',
'',
''].join("\n");

rep("// Keep the mobile Library's close behavior identical for its X, backdrop, and Escape key.",
    VIEW_FN + "// Keep the mobile Library's close behavior identical for its X, backdrop, and Escape key.",
    "close-drawer comment");

rep("  if(!S.mobileLibOpen) return false;\n  S.mobileLibOpen = false;\n  render();",
    "  if(!S.mobileLibOpen) return false;\n  S.mobileLibOpen = false;\n  S.mobileLibSpecOpen = false;   // a disclosure, not a preference: it does not survive the drawer closing\n  render();",
    "close-drawer body");

rep("mobileLibOpen:false,", "mobileLibOpen:false, mobileLibSpecOpen:false,", "state init");

fs.writeFileSync(p,s); console.log("part 1 applied");
