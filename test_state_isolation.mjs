// State-isolation tests — a new/loaded talk must never inherit the previous talk's state.
// Locks in the _clearTalkScoped() consolidation + the withheld-draft ownership scoping.
// Run: node test_state_isolation.mjs
import { readFileSync } from "fs";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

// ── 1) all four talk-entry paths funnel through the shared helper ───────────────
ok(/function _clearTalkScoped\(/.test(html), "_clearTalkScoped() helper exists");
const calls = (html.match(/_clearTalkScoped\(/g) || []).length;
ok(calls >= 5, `helper is called from every talk-entry path (found ${calls - 1} call sites + definition)`);
for (const [fn, needle] of [
  ["resetAll", /function resetAll\(\)\{[\s\S]{0,300}?_clearTalkScoped\(\)/],
  ["loadSavedTalk", /_clearTalkScoped\(\{ keepIdentity: true \}\);\s*\n\s*S\.topic=entry\.topic/],
  ["loadPublicTalkByToken", /_clearTalkScoped\(\{ keepIdentity: true \}\);\s*\n\s*S\.talk = data\.talk_json/],
  ["loadSample", /_clearTalkScoped\(\{ keepIdentity: true \}\);\s*\n\s*S\.talk=chosen/],
]) ok(needle.test(html), `${fn}() clears talk-scoped state before adopting the new talk`);

// ── 2) the helper actually clears the fields that caused real leaks ─────────────
const helperSrc = html.slice(html.indexOf("function _clearTalkScoped("), html.indexOf("function resetAll()"));
for (const [field, why] of [
  ["S.talkHistory=[]", "Undo could reach back into a PREVIOUS talk and replace the current one"],
  ["S.files=[]", "the previous talk's uploaded PDF was re-sent to the model and stamped on the new talk"],
  ["S.ragChunks=[]", "stale retrieved chunks falsely UPGRADED the next talk's citation-confidence chips"],
  ["S.citationAuditPending=false", "a phantom 'checking citations' chip stuck on the next talk"],
  ["S.editingSection=null", "an in-progress section edit could be committed into a DIFFERENT talk"],
  ["S.depthVariantsCache=null", "the depth toggle could serve a different talk's content"],
  ["S.glRef=null", "the previous talk's guideline chips appeared on the new talk"],
  ["S.dg=null", "the previous talk's generated image showed on the new talk"],
  ["S.podScript=\"\"", "the previous talk's podcast script showed on the new talk"],
  ["S.msgs=[]", "the previous talk's chat transcript carried over"],
  ["S.vmcStale=false", "a false 'may not reflect your latest edits' warning on an untouched talk"],
  ["S.proofreadArmed=false", "the next talk's first chat message was silently routed to proofread mode"],
]) ok(helperSrc.includes(field), `clears ${field} — else: ${why}`);

// ── 3) keepIdentity must NOT stomp the loaded talk's own identity ───────────────
const ctx = { S: {}, speechSynthesis: { cancel() {} } };
vm.createContext(ctx);
vm.runInContext(html.slice(html.indexOf("function _clearTalkScoped("), html.indexOf("\nfunction resetAll()")), ctx);
const clear = vm.runInContext("_clearTalkScoped", ctx);

ctx.S = { talk: { title: "loaded" }, topic: "Sepsis", loadedTalkId: "abc", talkIsSaved: true, files: [1], talkHistory: [1], sharedTalk: true };
clear({ keepIdentity: true });
ok(ctx.S.talk && ctx.S.talk.title === "loaded", "keepIdentity preserves S.talk (the load path just assigned it)");
ok(ctx.S.topic === "Sepsis" && ctx.S.loadedTalkId === "abc" && ctx.S.talkIsSaved === true,
   "keepIdentity preserves topic / loadedTalkId / talkIsSaved");
ok(ctx.S.files.length === 0 && ctx.S.talkHistory.length === 0, "keepIdentity STILL clears leak-prone state (files, undo history)");

ctx.S = { talk: { title: "old" }, topic: "Old", loadedTalkId: "xyz", talkIsSaved: true, files: [1], talkHistory: [1] };
clear();
ok(ctx.S.talk === null && ctx.S.topic === "" && ctx.S.loadedTalkId === null && ctx.S.talkIsSaved === false,
   "without keepIdentity everything resets (New talk) — incl. loadedTalkId, so a new talk can't overwrite a saved row");
// Flipped 2026-07-26: drafting no longer searches the web. Live search sat on the critical path of every
// generation and its results were absorbed invisibly; recency is now an explicit post-generation check.
// Still a RESET assertion — the point is that a fresh talk does not inherit the previous talk's setting.
ok(ctx.S.wantWebSearch === false, "a fresh talk resets web search to OFF (drafting uses the curated corpus)");

// ── 4) resetAll must clear the withheld draft, else '+ New talk' is a no-op ─────
const resetSrc = html.slice(html.indexOf("function resetAll()"), html.indexOf("function resetAll()") + 700);
ok(/S\.reviewPending\s*=\s*null/.test(resetSrc), "resetAll clears S.reviewPending (the withheld card REPLACES the compose form)");

// ── 5) withheld draft is OWNER-SCOPED (shared-workstation safety) ───────────────
ok(/function _reviewOwnerId\(/.test(html), "_reviewOwnerId() exists");
ok(/owner_user_id: _reviewOwnerId\(\)/.test(html), "the persisted withheld draft is stamped with its owner");
ok(/function _restoreReviewPendingForUser\(/.test(html), "restore is gated by a dedicated owner-checking function");
const restoreSrc = html.slice(html.indexOf("function _restoreReviewPendingForUser("), html.indexOf("function _restoreReviewPendingForUser(") + 700);
ok(/owner_user_id \|\| null\) === \(_reviewOwnerId\(\) \|\| null\)/.test(restoreSrc), "restore compares stored owner to the current user");
ok(/removeItem\("ct_review_pending"\)/.test(restoreSrc), "a draft belonging to someone else is DROPPED, not shown");
ok(!/if\(_rpObj && _rpObj\.draft\) S\.reviewPending = _rpObj;/.test(html), "the old unconditional boot restore is gone");
const signOutSrc = html.slice(html.indexOf("async function signOut()"), html.indexOf("async function signOut()") + 800);
ok(/removeItem\("ct_review_pending"\)/.test(signOutSrc), "sign-out deletes the persisted withheld draft");
ok(/resetAll\(\)/.test(signOutSrc), "sign-out clears the signed-out user's talk from the screen");

// ── 6) refine must charge only when the talk is actually replaced ───────────────
const weaveIdx = html.indexOf("var parsed = JSON.parse(fixJSON(txt));");
const weaveWindow = html.slice(weaveIdx, weaveIdx + 500);
ok(!/consumeFreeTier\("talk"\)/.test(weaveWindow), "weaveFeedbackTalk no longer charges on mere parse success");
const applyIdx = html.indexOf("S.talk = revised;");
const applyWindow = html.slice(applyIdx, applyIdx + 400);
ok(/consumeFreeTier\("talk"\)/.test(applyWindow), "the charge now sits in the branch that actually replaces S.talk");
// the four guard branches must remain uncharged
const guardBlock = html.slice(html.indexOf("would have dropped content"), applyIdx);
ok(!/consumeFreeTier/.test(guardBlock), "none of the discard guards (content/ref/section/no-op) charge a credit");

console.log("\n" + (failures === 0 ? "✔ STATE ISOLATION TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
