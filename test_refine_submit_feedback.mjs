// REFINE SUBMIT FEEDBACK — run: node test_refine_submit_feedback.mjs
//
// The composer cleared its textarea and called sendChat(), but every outcome was written to S.msgs.
// No rendered view read S.msgs, so a refusal, parse failure or no-op looked exactly like a dead button.
// This executes the shared submit helper and requires a visible outcome plus recovery of failed input.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

function grab(name){
  const start = html.indexOf("function " + name + "(");
  const asyncStart = html.indexOf("async function " + name + "(");
  const from = asyncStart >= 0 && (start < 0 || asyncStart < start) ? asyncStart : start;
  if(from < 0) throw new Error("not found: " + name);
  let depth = 0;
  for(let i=html.indexOf("{", from); i<html.length; i++){
    if(html[i] === "{") depth++;
    else if(html[i] === "}") { depth--; if(depth === 0) return html.slice(from, i+1); }
  }
  throw new Error("unbalanced: " + name);
}

function harness(sendChat){
  const S = { reviseIn:"add the trial", chatIn:"", refineSubmitting:false, chatBusy:false,
              loading:false, refineNotice:null, msgs:[] };
  let renders = 0;
  const c = {};
  new Function("S", "sendChat", "render", "humanizeError", "c",
    grab("_refineOutcomeFromMessages") + grab("_refineOutcomeKind") +
    grab("submitRefineFromComposer") + "c.submit=submitRefineFromComposer;"
  )(S, sendChat.bind(null, S), () => { renders++; }, e => (e && e.message) || String(e), c);
  return { S, c, renders:() => renders };
}

// Failure: the original text comes back and the refusal is visible.
{
  let calls = 0;
  const h = harness(async S => { calls++; S.msgs.push({r:"a",t:"Couldn't authorise this refinement. Your talk is unchanged."}); });
  await h.c.submit();
  ok(calls === 1, "one submit makes exactly one refine attempt");
  ok(h.S.refineSubmitting === false, "the in-flight guard is released afterwards");
  ok(h.S.reviseIn === "add the trial", "failed input is restored instead of disappearing");
  ok(h.S.refineNotice && h.S.refineNotice.kind === "error", "the refusal becomes a visible error notice");
  ok(/unchanged/.test(h.S.refineNotice.text), "the notice preserves the server's useful explanation");
  ok(h.renders() >= 2, "the working and final states are both rendered");
}

// Success: do not restore the submitted text, and report success.
{
  const h = harness(async S => { S.msgs.push({r:"a",t:"✓ Applied 1 edit. Everything else untouched."}); });
  await h.c.submit();
  ok(h.S.reviseIn === "", "successful input stays cleared");
  ok(h.S.refineNotice && h.S.refineNotice.kind === "success", "success is visibly distinguished");
}

// Double activation while the first promise is pending must not buy two calls.
{
  let calls = 0, release;
  const h = harness(async S => { calls++; await new Promise(r => { release = r; }); S.msgs.push({r:"a",t:"✓ Applied"}); });
  const first = h.c.submit();
  const second = h.c.submit();
  await Promise.resolve();
  ok(calls === 1, "a rapid second activation is ignored while refinement is pending");
  release(); await first; await second;
}

// The message must have a rendered, accessible consumer — writing state alone is not UX.
ok(/class="refine-notice/.test(html) && /aria-live="polite"/.test(html),
   "the composer renders refinement outcomes in an aria-live status region");
ok(/submitRefineFromComposer\(\)/.test(html.slice(html.indexOf("rin.onkeydown"), html.indexOf("// ─── Auth"))),
   "keyboard and pointer submission share the guarded helper");

// Old library talks remain editable with today's refine code and save back to the same row.
const loadBody = html.slice(html.indexOf("async function loadSavedTalk"), html.indexOf("function exportTalkJSON"));
const saveBody = html.slice(html.indexOf("async function saveCurrentTalk"), html.indexOf("// Persist a generated visual"));
ok(/S\.loadedTalkId\s*=\s*entry\.id/.test(loadBody), "opening an old talk retains its library-row identity");
ok(/cloudUpdateTalk\(S\.loadedTalkId\)/.test(saveBody), "Save changes updates that same old-talk row after refinement");

// A saved-talk load is started from click/deep-link handlers without await. Its own boundary must consume
// failures and clear the full-page spinner, otherwise one network rejection becomes the global generic
// "background task failed" toast while "Opening your talk…" stays forever.
{
  const state = { loadingFromHash:true };
  let rendered = 0, toasted = "";
  const c = {};
  new Function("S", "render", "_toast", "_loadSavedTalkUnchecked", "c",
    grab("loadSavedTalk") + ";c.load=loadSavedTalk;"
  )(state, () => { rendered++; }, m => { toasted = m; }, async () => { throw new Error("network down"); }, c);
  let escaped = null, result;
  try { result = await c.load("old-talk-id"); } catch(e) { escaped = e; }
  ok(!escaped && result === false, "saved-talk failures resolve locally instead of becoming unhandled rejections");
  ok(state.loadingFromHash === false && rendered === 1, "a failed saved-talk load always exits the full-page spinner");
  ok(/Couldn't open that talk/.test(toasted), "the failure names the operation instead of saying only 'background task failed'");
}

console.log("\n" + (failures === 0 ? "✔ REFINE SUBMIT IS VISIBLE" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
