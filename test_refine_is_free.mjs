// REFINEMENT IS FREE — run: node test_refine_is_free.mjs
//
// ── THE DEFECT, OBSERVED IN PRODUCTION 2026-08-06 ────────────────────────────────────────────────────
// Policy (Jenni, 2026-07-31): "let's just not charge for refine." All five refinement operations
// nevertheless called consumeFreeTier("talk"), taking a FULL talk credit — and taking it through the
// legacy user-scoped free_tier_consume, which writes no job_reservations row, so the exactly-once refund
// machinery could not see the charge at all. One refine moved talks_used from 6 to 7 and left a stray
// talk receipt with no reservation behind it.
//
// createRefineSession() — narrow, ownership-checked, free — existed the whole time and was called from
// nowhere. A grep for its name would have found the bug; no test did, because no test asked "what does
// refining cost?"
//
// Each operation is asserted to: redeem a REFINE stage, never touch talks_used, and make NO model call
// when authorisation fails. The last is the one that matters most: refusing must cost nothing AND change
// nothing, and there is deliberately no fallback that re-prices a free action at one credit.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const code = html.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");

const OPS = ["applyProofreadFeedback", "compressTalk", "expandTalk", "weaveRevision", "retryReview"];
const slice = (name) => {
  const i = code.indexOf("async function " + name + "(");
  if (i < 0) throw new Error("not found: " + name);
  const j = code.indexOf("\nasync function ", i + 30);
  return code.slice(i, j > i ? j : code.length);
};

// ── 0 · THE HELPER READS THE FIELD THIS APP ACTUALLY USES ────────────────────
ok(/S\.loadedTalkId/.test(code.slice(code.indexOf("async function ensureRefineAuth"),
                                      code.indexOf("async function ensureRefineAuth") + 1200)),
   "ensureRefineAuth reads S.loadedTalkId, where a library-opened talk's id actually lives");

// ── 1 · NO REFINEMENT OPERATION CHARGES A TALK CREDIT ────────────────────────
for (const op of OPS) {
  const body = slice(op);
  ok(!/consumeFreeTier\(/.test(body), `${op} does not consume a talk credit`);
  ok(/ensureRefineAuth\(\)/.test(body), `…and authorises through ensureRefineAuth() instead`);
}
ok(!/consumeFreeTier\("talk"\)/.test(code.replace(/\/\*[\s\S]*?\*\//g, "")),
   "no code path anywhere still consumes a talk credit for a refinement");

// ── 2 · AUTHORISATION HAPPENS BEFORE ANY MODEL CALL ──────────────────────────
// The old charges sat AFTER callAPI on three of the five, so moving the gate to the top is the whole fix:
// a refusal must happen before a paid call, not after one.
for (const op of OPS) {
  const body = slice(op);
  const gate = body.indexOf("ensureRefineAuth()");
  const call = Math.min(...["callAPI(", "callAPIWithFallback(", "_callClaude("]
    .map(n => { const i = body.indexOf(n); return i < 0 ? Infinity : i; }));
  if (call === Infinity) {
    ok(gate > 0, `${op}: gated (makes no direct model call itself)`);
  } else {
    ok(gate > 0 && gate < call,
       `${op}: authorisation precedes the model call (gate @${gate}, call @${call})`);
  }
}

// ── 3 · A REFUSAL MAKES NO MODEL CALL AND LEAVES THE TALK ALONE ──────────────
// Executed, not pattern-matched: the real helper runs against a stubbed session endpoint that refuses.
{
  // Handle BOTH `async function` and plain `function`. The first version searched only for the async
  // form, so setGenCredentials (a plain function) gave indexOf -1 and the slice ran from the END of the
  // file — producing a SyntaxError about await, which looked like a problem in the code under test.
  const grab = (name) => {
    let start = html.indexOf("async function " + name + "(");
    if (start < 0) start = html.indexOf("function " + name + "(");
    if (start < 0) throw new Error("not found: " + name);
    let depth = 0;
    for (let j = html.indexOf("{", start); j < html.length; j++) {
      if (html[j] === "{") depth++;
      else if (html[j] === "}") { depth--; if (depth === 0) return html.slice(start, j + 1); }
    }
    throw new Error("unbalanced: " + name);
  };
  const mk = (sessionOk, cred) => {
    const store = {};
    if (cred) store["ct_active_cred"] = JSON.stringify(cred);
    const calls = [];
    const ctx = {
      // THE REAL SHAPE. The first version of this stub was `S.talk = { id: "talk-42" }` — an id field this
      // app has never had. The helper read the same invented field, so stub and code agreed with each other
      // and disagreed with production: every refine of a saved talk was refused. A saved talk's id lives in
      // S.loadedTalkId; S.talk holds only content.
      S: { loadedTalkId: "talk-42", talk: { title: "T" }, talkIsSaved: true, freeTier: {} },
      localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      },
      console: { info() {}, warn() {} },
      RAG_CONFIG: { url: "https://p.test/" },
      freeTierActive: () => true,
      freeTierToken: () => "tok",
      fetch: async (u) => {
        calls.push(String(u));
        return { ok: sessionOk, status: sessionOk ? 200 : 403, json: async () =>
          sessionOk ? { jobId: "refine:talk-42", receipt: "r-refine",
                        receiptExpiresAt: new Date(Date.now() + 18e5).toISOString() }
                    : { error: { type: "not_owner", message: "That talk isn't yours." } } };
      },
    };
    const c = {};
    new Function("S", "localStorage", "console", "RAG_CONFIG", "freeTierActive", "freeTierToken", "fetch", "c",
      "var GEN_CRED_KEY='ct_active_cred';" +
      grab("setGenCredentials") + grab("loadGenCredentials") +
      grab("ensureRefineAuth") + grab("createRefineSession") +
      "c.auth = ensureRefineAuth;"
    )(ctx.S, ctx.localStorage, ctx.console, ctx.RAG_CONFIG, ctx.freeTierActive, ctx.freeTierToken, ctx.fetch, c);
    return { c, calls, store };
  };

  // (a) saved talk, session granted -> authorised via the FREE refine session
  let h = mk(true, null);
  let r = await h.c.auth();
  ok(r.ok === true && r.refineSession === true, "a saved talk authorises via the free refine session");
  ok(h.calls.some(u => u.includes("/v1/free-tier/refine-session")),
     `…hitting the ownership-checked refine endpoint (${h.calls.join(", ")})`);
  ok(!h.calls.some(u => u.includes("/consume")),
     "…and never the consume endpoint");

  // (b) unsaved talk with a live receipt in hand -> reuse it, no request at all
  h = mk(true, { jobId: "job-9", receipt: "r-live", expiresAt: new Date(Date.now() + 6e5).toISOString() });
  r = await h.c.auth();
  ok(r.ok === true && r.reused === true, "a just-generated talk reuses the receipt already in hand");
  ok(h.calls.length === 0, `…without any network call (${h.calls.length})`);

  // (c) session REFUSED -> refuse, with no charge and no fallback
  h = mk(false, null);
  r = await h.c.auth();
  ok(r.ok === false, "a refused session refuses the refinement");
  ok(/unchanged/i.test(r.message || ""), `…telling the user the talk is unchanged ("${r.message}")`);
  ok(!h.calls.some(u => u.includes("/consume")),
     "…and does NOT fall back to consuming a credit, which would re-price a free action during an outage");
}

console.log("\n" + (failures === 0 ? "✔ REFINE IS FREE" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
