const fs=require("fs"); const p="index.html"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const rep=(from,to,msg)=>{ must(s.includes(from),msg); must(s.split(from).length===2,"not unique: "+msg); s=s.replace(from,to); };

const BLOCK = [
'// ── LANDMARK TRIAL RESOLUTION ───────────────────────────────────────────────────────────────────────',
'// guidelines.json names trials as bare acronyms and the prompt told the model to cite them "by name with',
'// their PMID/DOI URL". Nothing ever supplied the paper: `documents` has no acronym column and PubMed',
'// titles do not contain acronyms, so searching for PEITHO, DAPA-HF, EMPEROR-Reduced or PROSEVA returns',
'// zero rows against a corpus that holds all four. Draft and review both produced the figures from memory,',
'// which is how PEITHO came out with its arms reversed (2.6% tenecteplase vs 5.6% placebo, stated the',
'// other way round) in two separate evals.',
'//',
'// landmark_pmids.json is generated from rag/landmark_trials.json by rag/build_landmark_index.mjs and',
'// contains ONLY trials with a verified PMID. A trial missing from it is not merely uncited — it is not',
'// named to the model at all. Naming a trial we cannot source is the instruction that produces invented',
'// figures, so the failure mode is removed rather than annotated.',
'var LANDMARK_PMIDS = null;            // { NORMALISEDACRONYM: {name, pmid, year} }',
'var LANDMARK_STATE = "idle";          // idle | loading | ready | error',
'',
'function normTrialName(s){ return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }',
'',
'async function loadLandmarkPmids(){',
'  if(LANDMARK_STATE === "loading" || LANDMARK_STATE === "ready") return;',
'  LANDMARK_STATE = "loading";',
'  try{',
'    var res = await fetch("landmark_pmids.json?v=" + encodeURIComponent(BUILD_ID), { cache: "no-store" });',
'    if(!res.ok) throw new Error("HTTP " + res.status);',
'    var data = await res.json();',
'    if(!data || !data.trials || typeof data.trials !== "object") throw new Error("malformed landmark index");',
'    LANDMARK_PMIDS = data.trials; LANDMARK_STATE = "ready";',
'  }catch(err){',
'    // FAIL CLOSED, and only on the citation instruction. resolveTrials() returns nothing, so no trial is',
'    // named — the talk loses trial citations it cannot support rather than gaining invented ones.',
'    // Generation is NOT blocked: this is a grounding improvement, not a precondition for teaching.',
'    LANDMARK_PMIDS = null; LANDMARK_STATE = "error";',
'    console.warn("loadLandmarkPmids failed (" + (err && err.message) + ") — no trials will be named this session");',
'  }',
'}',
'',
'// Pure. Returns the trials we can stand behind, and the ones we deliberately dropped.',
'function resolveTrials(names, index){',
'  var ix = index || LANDMARK_PMIDS;',
'  var resolved = [], dropped = [], seen = {};',
'  for(var i=0; i<(names || []).length; i++){',
'    var raw = names[i], key = normTrialName(raw);',
'    if(!key) continue;',
'    if(seen[key]) continue;',
'    seen[key] = 1;',
'    var hit = ix ? ix[key] : null;',
'    if(hit && hit.pmid) resolved.push({ name: hit.name || raw, pmid: String(hit.pmid), year: hit.year || null });',
'    else dropped.push(String(raw));',
'  }',
'  return { resolved: resolved, dropped: dropped };',
'}',
'',
''].join("\n");

// Put it next to loadGuidelines, which it mirrors.
rep("async function loadGuidelines(){", BLOCK + "async function loadGuidelines(){", "loadGuidelines anchor");

// Only name trials we can source, and give the verified PMID so the model has no reason to invent one.
rep(`      if (glRef.trials.length > 0) guidelineContext += "\\nLandmark trials to cite when relevant: " + glRef.trials.join(", ");`,
`      // Resolved trials only. An unresolvable trial is not named at all — see resolveTrials().',
      var _tr = resolveTrials(glRef.trials);
      if (_tr.resolved.length > 0) {
        guidelineContext += "\\nLandmark trials to cite when relevant (PMID given — use it, do not construct one): "
          + _tr.resolved.map(function(t){ return t.name + " (PMID " + t.pmid + (t.year ? ", " + t.year : "") + ")"; }).join("; ");
      }
      if (_tr.dropped.length > 0) console.info("trials not named (no verified PMID): " + _tr.dropped.join(", "));`,
  "trial injection site");

fs.writeFileSync(p,s); console.log("trial resolution wired");
