const fs=require("fs"); const p="index.html"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const rep=(from,to,msg)=>{ must(s.includes(from),msg); must(s.split(from).length===2,"not unique: "+msg); s=s.replace(from,to); };

// ── the strip renderer, top level, next to the view function ────────────────────────────────────────
const STRIP = [
'// The specialty axis for the mobile drawer. It is a DISCLOSURE: the strip is not shown until the user',
'// asks for it, because the default view is most-recent and most users want exactly that. Hidden entirely',
'// below two specialties, where a filter cannot change what you see.',
'function mobileLibSpecStrip(view, open){',
'  if(!view || view.specs.length < 2) return "";',
'  var label = view.active ? view.active : "All specialties";',
'  var h = \'<style>.mlSpecStrip::-webkit-scrollbar{display:none}</style>\';',
'  h += \'<div style="display:flex;align-items:center;gap:8px;margin:0 0 10px">\';',
'  h += \'<button id="mobileLibSpecToggle" aria-expanded="\'+(open?"true":"false")+\'" aria-controls="mobileLibSpecStrip" style="flex:1;min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:8px;background:\'+(view.active?"var(--lavender-bg)":"var(--cream)")+\';border:1px solid \'+(view.active?"var(--plum)":"var(--line)")+\';border-radius:10px;padding:8px 12px;font-family:inherit;font-size:12.5px;font-weight:600;color:\'+(view.active?"var(--plum-deep)":"var(--ink)")+\';cursor:pointer">\';',
'  h += \'<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\'+esc(label)+\'</span>\';',
'  h += \'<span aria-hidden="true" style="flex-shrink:0;font-size:10px;opacity:.7">\'+(open?"\\u25B2":"\\u25BC")+\'</span></button>\';',
'  if(view.active){',
'    h += \'<button class="mobileLibSpecBtn" data-spec="" style="min-height:44px;min-width:44px;background:none;border:none;color:var(--plum);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;padding:0 8px">Clear</button>\';',
'  }',
'  h += \'</div>\';',
'  if(!open) return h;',
'  h += \'<div class="mlSpecStrip" id="mobileLibSpecStrip" style="display:flex;gap:6px;margin:0 0 12px;overflow-x:auto;padding:2px 0;scrollbar-width:none;-ms-overflow-style:none;mask-image:linear-gradient(to right,#000 0,#000 calc(100% - 24px),transparent 100%);-webkit-mask-image:linear-gradient(to right,#000 0,#000 calc(100% - 24px),transparent 100%)">\';',
'  var chip = function(key, text, count, on){',
'    return \'<button class="mobileLibSpecBtn" data-spec="\'+esc(key)+\'" style="flex-shrink:0;min-height:44px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;background:\'+(on?"var(--plum)":"var(--cream)")+\';color:\'+(on?"#fff":"var(--ink)")+\';border:1px solid \'+(on?"var(--plum)":"var(--line)")+\';border-radius:22px;padding:0 14px;font-family:inherit;font-size:12.5px;font-weight:\'+(on?"600":"500")+\';cursor:pointer">\'+esc(text)+\' <span style="opacity:.7;font-size:11px;font-weight:500">\'+count+\'</span></button>\';',
'  };',
'  h += chip("", "All", view.total, !view.active);',
'  for(var i=0;i<view.specs.length;i++){',
'    var sp = view.specs[i];',
'    h += chip(sp, sp, view.counts[sp], view.active === sp);',
'  }',
'  h += \'</div>\';',
'  return h;',
'}',
'',
''].join("\n");

rep("// THE MOBILE LIBRARY DRAWER SCOPE,", STRIP + "// THE MOBILE LIBRARY DRAWER SCOPE,", "view fn anchor");

// ── drawer: build the view instead of an ad-hoc sorted list ─────────────────────────────────────────
rep(
`    var _libRecent = (getDisplayLibrary()||[])
      .filter(function(e){ return e && e.talk; })
      .sort(function(a,b){ return new Date(b.savedAt||0) - new Date(a.savedAt||0); });`,
`    var _libView = mobileLibraryView(getDisplayLibrary()||[], S.libSpec, function(e){
      return inferSpecialty(e.topic, e.talk||{}, (e._specialtyOverride||null));
    });`,
"drawer list build");

rep("    var _libHasOwn = _libRecent.length > 0;",
    "    var _libHasOwn = _libView.total > 0;",
    "drawer hasOwn");

// ── drawer: strip above the items, and iterate the filtered view ────────────────────────────────────
rep(
`    if(_libHasOwn){
      for(var mli=0; mli<_libRecent.length; mli++){
        var mrec=_libRecent[mli]; var mtk=mrec.talk||{};
        var misBoards=!!mtk.question;
        var mspec=inferSpecialty(mrec.topic, mtk, (mrec._specialtyOverride||null));
        var mico=SPEC_ICONS[mspec]||"\u25CF";`,
`    if(_libHasOwn){
      h+=mobileLibSpecStrip(_libView, !!S.mobileLibSpecOpen);
      for(var mli=0; mli<_libView.items.length; mli++){
        var mrow=_libView.items[mli]; var mrec=mrow.entry; var mtk=mrec.talk||{};
        var mspec=mrow.spec;
        var mico=SPEC_ICONS[mspec]||"\u25CF";`,
"drawer item loop");

// Every item in this list is a lecture now, so the label is not a question any more.
rep(`+esc(mspec)+' \u00B7 '+(misBoards?"Boards":"Lecture")+'</span></span>';`,
    `+esc(mspec)+' \u00B7 Lecture</span></span>';`,
    "drawer item label");

fs.writeFileSync(p,s); console.log("part 2 applied");
