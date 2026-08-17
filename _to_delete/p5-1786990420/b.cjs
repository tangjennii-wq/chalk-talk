const fs=require("fs"); const p="index.html"; let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{ if(!c) throw new Error("ANCHOR: "+m); };
const rep=(from,to,msg)=>{ must(s.includes(from),msg); must(s.split(from).length===2,"not unique: "+msg); s=s.replace(from,to); };

rep(
`async function loadLandmarkPmids(){
  if(LANDMARK_STATE === "loading" || LANDMARK_STATE === "ready") return;
  LANDMARK_STATE = "loading";`,
`var LANDMARK_PROMISE = null;          // so the boot kick-off and a generation can await the SAME fetch

function loadLandmarkPmids(){
  if(!LANDMARK_PROMISE) LANDMARK_PROMISE = _loadLandmarkPmids();
  return LANDMARK_PROMISE;
}

// AWAITABLE AT GENERATION TIME. The boot call is fire-and-forget, and resolveTrials() fails closed, so a
// click that beats the fetch would silently drop EVERY trial from the prompt — a talk with no trial
// citations and no indication why. Bounded, because a hung fetch must not hold a generation: on timeout
// we proceed with nothing named and say so in the console and on the talk's stamp.
async function ensureLandmarkIndex(ms){
  var cap = (typeof ms === "number") ? ms : 4000;
  try{
    await Promise.race([
      loadLandmarkPmids(),
      new Promise(function(_, rej){ setTimeout(function(){ rej(new Error("landmark index timeout")); }, cap); }),
    ]);
  }catch(err){
    console.warn("landmark index not ready (" + (err && err.message) + ") — no trials will be named in this talk");
  }
  return LANDMARK_STATE === "ready";
}

async function _loadLandmarkPmids(){
  LANDMARK_STATE = "loading";`,
  "loader promise-cache");

fs.writeFileSync(p,s); console.log("awaitable loader wired");
