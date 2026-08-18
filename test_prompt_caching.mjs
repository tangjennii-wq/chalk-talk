// PROMPT CACHING — run: node test_prompt_caching.mjs
//
// Two separate things are under test, and only one of them is new.
//
// THE BUG THAT WAS ALREADY LIVE: cache_creation_input_tokens appeared NOWHERE in worker.js or
// index.html, while the browser path has sent cache_control since June 2026. Every BYOK generation that
// created a cache entry has therefore been billed at ZERO for the 1.25x write premium against the $250
// monthly cap. Enabling caching on the Worker without fixing that would have widened an open hole.
//
// THE NEW BEHAVIOUR: the durable path now marks the STABLE SYSTEM BLOCK only. Topic-specific content —
// guideline context, retrieved sources, trial abstracts, the draft under review — must stay uncached,
// because Anthropic matches on an exact prefix and that content changes every call: marking it would buy
// a write premium on every request and never a single read.
//
// Nothing here claims a speedup. That requires a live repeat inside five minutes reporting
// cache_read_input_tokens > 0, which no offline test can produce.
import { readFileSync } from "fs";
import vm from "node:vm";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

function fnSrc(name){
  let start = src.indexOf(`function ${name}(`);
  if(start < 0) throw new Error(`missing ${name}`);
  if(src.slice(Math.max(0,start-6), start) === "async ") start -= 6;
  const open = src.indexOf("{", start);
  let d=0,q=null,e=false;
  for(let i=open;i<src.length;i++){ const c=src[i];
    if(q){ if(e) e=false; else if(c==="\\") e=true; else if(c===q) q=null; continue; }
    if(c==='"'||c==="'"||c==="`"){ q=c; continue; }
    if(c==="{") d++; else if(c==="}" && --d===0) return src.slice(start,i+1);
  }
  throw new Error(`unclosed ${name}`);
}
const constOf = (name) => {
  const m = src.match(new RegExp("const " + name + " = ([0-9.]+);"));
  if(!m) throw new Error("missing const " + name);
  return Number(m[1]);
};

// Real values, read from source — a hardcoded copy here would keep passing after the real one moved.
const MULT = constOf("CACHE_WRITE_MULTIPLIER");
const MIN_CHARS = constOf("SYS_CACHE_MIN_CHARS");
const PRICES = (() => {
  const start = src.indexOf("const MODEL_PRICES = {");
  const body = src.slice(start, src.indexOf("};", start));
  const out = {};
  for (const m of body.matchAll(/"([^"]+)":\s*\{\s*in:\s*([\d.]+),\s*out:\s*([\d.]+),\s*cache:\s*([\d.]+)/g))
    out[m[1]] = { in: +m[2], out: +m[3], cache: +m[4] };
  return out;
})();

const ctx = { MODEL_PRICES: PRICES, CACHE_WRITE_MULTIPLIER: MULT, console: { log(){} } };
vm.createContext(ctx);
vm.runInContext(`${fnSrc("estimateCostCents")}\n${fnSrc("extractUsage")}\n${fnSrc("logCacheTelemetry")}\n`
  + "this.cost = estimateCostCents; this.extract = extractUsage; this.log = logCacheTelemetry;", ctx);
const { cost, extract } = ctx;

const M = "claude-opus-5", p = PRICES[M];
ok(!!p && p.in === 5 && p.cache === 0.5, "read the real Opus prices out of MODEL_PRICES");
ok(Math.abs(p.cache / p.in - 0.1) < 1e-9, "a cache READ is priced at 0.1x input, as published");

// ── the regression: cache WRITES used to cost nothing ───────────────────────────────────────────────
const writeOnly = cost(M, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 });
ok(writeOnly > 0, "a cache WRITE is billed at all — it was silently free before this patch");
ok(writeOnly === Math.ceil(p.in * MULT * 100),
   `…at ${MULT}x input ($${(p.in*MULT).toFixed(2)}/Mtok, got ${writeOnly} cents per Mtok)`);

const readOnly = cost(M, { cache_read_input_tokens: 1_000_000 });
ok(readOnly === Math.ceil(p.cache * 100), "a cache READ is billed at 0.1x input");
ok(writeOnly > readOnly * 10, "a write costs more than ten reads, so caching is not free to turn on");

// The three input classes are DISJOINT in Anthropic's reporting, so they must sum rather than overlap.
const mixed = cost(M, { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 });
const expected = Math.ceil((p.in + p.out + p.cache + p.in * MULT) * 100);
ok(mixed === expected, `all four token classes sum (expected ${expected}, got ${mixed})`);

// ── extraction: the count has to survive the response parser ─────────────────────────────────────────
const sse = [
  'data: {"type":"message_start","message":{"usage":{"input_tokens":11,"cache_read_input_tokens":22,"cache_creation_input_tokens":33}}}',
  'data: {"type":"message_delta","usage":{"output_tokens":44}}',
].join("\n");
const uSSE = await extract({ text: async () => sse });
ok(uSSE.cache_creation_input_tokens === 33 && uSSE.cache_read_input_tokens === 22,
   "streaming responses carry BOTH cache counts out of message_start");
ok(uSSE.input_tokens === 11 && uSSE.output_tokens === 44, "…without disturbing input/output");

const uJSON = await extract({ text: async () => JSON.stringify({ usage: {
  input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } }) });
ok(uJSON.cache_creation_input_tokens === 4 && uJSON.cache_read_input_tokens === 3,
   "non-streaming responses carry both counts too");

const uMissing = await extract({ text: async () => JSON.stringify({ usage: { input_tokens: 5 } }) });
ok(uMissing.cache_creation_input_tokens === 0,
   "an uncached response reports zero rather than undefined, so the cost maths cannot go NaN");
ok(!Number.isNaN(cost(M, uMissing)), "…and costing an uncached call stays a number");

// The INITIALISED default, not the parser's. Added because a mutation deleting
// `cache_creation_input_tokens: 0` from the usage object SURVIVED the assertions above: on the parsed
// paths the field is assigned anyway, so only a response the parser never gets to touch exposes it.
// That is the case that would put undefined into the cost maths and bill NaN cents.
const uNoUsage = await extract({ text: async () => JSON.stringify({ content: [] }) });
ok(uNoUsage.cache_creation_input_tokens === 0 && uNoUsage.cache_read_input_tokens === 0,
   "a response carrying NO usage block still reports 0 for both cache counts, never undefined");
const uBroken = await extract({ text: async () => { throw new Error("body already consumed"); } });
ok(uBroken.cache_creation_input_tokens === 0 && uBroken.input_tokens === 0,
   "…and so does a response whose body cannot be read at all");
ok(cost(M, uNoUsage) === 0 && cost(M, uBroken) === 0,
   "…so an unparseable response bills zero rather than NaN cents into the \$250 cap");

// ── what actually gets marked ───────────────────────────────────────────────────────────────────────
ok(/cache_control: \{ type: "ephemeral" \}/.test(src), "the durable path marks a block for caching");
const reqLine = src.match(/const reqBody = \{ model: models\[i\][^\n]*/)[0];
ok(/system: systemField/.test(reqLine), "…and it is the SYSTEM field that carries it");
ok(/messages: \[\{ role: "user", content: content \}\]/.test(reqLine),
   "…while `content` — guideline context, retrieved sources, trial abstracts, the draft — stays UNMARKED");
ok(!/content: content[^\n]*cache_control/.test(src), "no cache_control anywhere on the user content");
ok(/sys\.length >= SYS_CACHE_MIN_CHARS/.test(src),
   "a system prompt below the threshold is left uncached rather than paying a write premium");
ok(MIN_CHARS >= 4096, `the threshold clears Anthropic's 1024-token minimum (${MIN_CHARS} chars)`);

// ── telemetry ───────────────────────────────────────────────────────────────────────────────────────
let logged = null;
ctx.console.log = (line) => { logged = JSON.parse(line); };
ctx.log("claude-opus-5", { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }, 123);
ok(logged && logged.cache_read_input_tokens === 3 && logged.cache_creation_input_tokens === 4,
   "telemetry reports BOTH cache counts — the only way to know whether caching is working at all");
ok(logged.cache_hit === true && logged.elapsed_ms === 123, "…plus hit/miss and elapsed time");
ctx.log("m", null, 1);
ok(true, "telemetry survives a null usage rather than breaking a generation");

// ── the claim nobody had measured ───────────────────────────────────────────────────────────────────
ok(!/~80% cheaper \+ faster/.test(html),
   "the unverified '~80% cheaper + faster' comment is gone — it could not have been measured, because "
   + "the field that would prove it was read nowhere");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ PROMPT CACHING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
