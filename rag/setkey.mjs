#!/usr/bin/env node
/**
 * setkey — paste an API key once, get it sanitized, LIVE-VALIDATED, and saved to .env correctly.
 *
 * WHY THIS EXISTS: a pasted key fails for boring reasons that look identical to "invalid key" —
 *   - a DUPLICATE line earlier in .env wins (loadenv takes the FIRST occurrence), so a stale or
 *     placeholder value silently shadows the real key. This actually happened: a literal
 *     "GEMINI_API_KEY=your_key_here" placeholder sat above two real keys and broke every run.
 *   - surrounding quotes, trailing spaces/newlines, a smart-quote from a doc, a zero-width character
 *   - pasting the whole line ("GEMINI_API_KEY=AIza...") into a value prompt, giving a doubled prefix
 * So: sanitize, REMOVE EVERY existing line for that key, verify against the real API, then save —
 * and never save a key that doesn't work.
 *
 * USAGE
 *   node rag/setkey.mjs                    # asks which key, then asks you to paste it
 *   node rag/setkey.mjs GEMINI_API_KEY     # straight to the paste prompt
 *   node rag/setkey.mjs --check            # only re-validate what's already in .env (no prompt)
 *
 * Supports live validation for GEMINI_API_KEY / GOOGLE_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY.
 * Any other key name is sanitized + saved (no validation available).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import readline from "readline";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env");
const ARGV = process.argv.slice(2);
const CHECK_ONLY = ARGV.includes("--check");
let NAME = ARGV.find((a) => /^[A-Z][A-Z0-9_]*$/.test(a)) || "";

const mask = (s) => (!s ? "(empty)" : s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)} (${s.length} chars)` : `${s.slice(0, 2)}…(${s.length} chars)`);

function ask(q, { hide = false } = {}) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hide) {
      // mask typed/pasted characters so the key never sits visibly in the scrollback
      const onData = (ch) => { const s = ch.toString(); if (s === "\n" || s === "\r" || s === "") return; readline.moveCursor(process.stdout, 0, 0); };
      process.stdin.on("data", onData);
      rl._writeToOutput = function (str) { if (/\n|\r/.test(str)) rl.output.write(str); else if (rl.line.length) rl.output.write("*"); else rl.output.write(str); };
      rl.question(q, (a) => { process.stdin.removeListener("data", onData); rl.close(); process.stdout.write("\n"); res(a); });
    } else {
      rl.question(q, (a) => { rl.close(); res(a); });
    }
  });
}

// ── sanitize a pasted value ───────────────────────────────────────────────────
function sanitize(raw, name) {
  const notes = [];
  let v = String(raw == null ? "" : raw);
  if (/[​-‍﻿]/.test(v)) { v = v.replace(/[​-‍﻿]/g, ""); notes.push("removed invisible zero-width characters"); }
  if (/[‘’“”]/.test(v)) { v = v.replace(/[‘’]/g, "'").replace(/[“”]/g, '"'); notes.push("converted smart quotes to plain quotes"); }
  const before = v;
  v = v.trim();
  if (v !== before) notes.push("trimmed surrounding whitespace/newline");
  // pasted the whole "NAME=value" line, possibly with `export `
  const line = v.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (line) { notes.push(`stripped the "${line[1]}=" prefix (you pasted the whole line)`); v = line[2].trim(); }
  const q = v.match(/^(['"])(.*)\1$/);
  if (q) { v = q[2].trim(); notes.push("removed surrounding quotes"); }
  if (/\s/.test(v)) { const c = v; v = v.replace(/\s+/g, ""); if (v !== c) notes.push("removed internal whitespace (API keys contain none)"); }

  const problems = [];
  if (!v) problems.push("value is empty");
  if (/^your[_-]?key|^paste|^<.*>$|here$|^xxx/i.test(v)) problems.push(`this looks like a PLACEHOLDER, not a real key: "${v}"`);
  if (/^(GEMINI|GOOGLE)_API_KEY$/.test(name) && v && !/^AIza|^AQ\./.test(v))
    notes.push("note: Google AI Studio keys usually start with \"AIza\" (some newer ones with \"AQ.\") — double-check if validation fails");
  if (name === "ANTHROPIC_API_KEY" && v && !/^sk-ant-/.test(v)) notes.push('note: Anthropic keys usually start with "sk-ant-"');
  if (name === "OPENAI_API_KEY" && v && !/^sk-/.test(v)) notes.push('note: OpenAI keys usually start with "sk-"');
  return { value: v, notes, problems };
}

// ── live validation ───────────────────────────────────────────────────────────
async function validate(name, key) {
  try {
    if (/^(GEMINI|GOOGLE)_API_KEY$/.test(name)) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
      const t = await r.text();
      if (r.ok) {
        let models = [];
        try { models = (JSON.parse(t).models || []).map((m) => String(m.name || "").replace("models/", "")); } catch {}
        const want = "gemini-3.6-flash";
        return { ok: true, detail: `${models.length} models visible`
          + (models.length ? (models.includes(want) ? ` · ${want} available ✓` : ` · ${want} NOT in list (app default) — available e.g. ${models.slice(0, 3).join(", ")}`) : "") };
      }
      let msg = t.slice(0, 200);
      try { const j = JSON.parse(t); msg = j?.error?.message || msg; } catch {}
      if (/API_KEY_INVALID|API key not valid/i.test(t)) return { ok: false, detail: "Google says API_KEY_INVALID — the key string itself is rejected. Re-copy it from https://aistudio.google.com/apikey (use the copy button, don't select by hand)." };
      if (r.status === 403) return { ok: false, detail: `403 — key valid but the Generative Language API may not be enabled for its project, or it's region-restricted. (${msg})` };
      if (r.status === 429) return { ok: true, detail: "429 rate-limited — the key is VALID, just throttled right now." };
      return { ok: false, detail: `HTTP ${r.status}: ${msg}` };
    }
    if (name === "ANTHROPIC_API_KEY") {
      const r = await fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
      if (r.ok) return { ok: true, detail: "Anthropic API accepted the key" };
      if (r.status === 401) return { ok: false, detail: "401 unauthorized — key rejected" };
      if (r.status === 429) return { ok: true, detail: "429 rate-limited — key is VALID" };
      return { ok: false, detail: `HTTP ${r.status}` };
    }
    if (name === "OPENAI_API_KEY") {
      const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
      if (r.ok) return { ok: true, detail: "OpenAI API accepted the key" };
      if (r.status === 401) return { ok: false, detail: "401 unauthorized — key rejected" };
      if (r.status === 429) return { ok: true, detail: "429 rate-limited — key is VALID" };
      return { ok: false, detail: `HTTP ${r.status}` };
    }
    return { ok: null, detail: "no live validation available for this key name — saved without verifying" };
  } catch (e) {
    return { ok: null, detail: `could not reach the API to validate (${e.message}) — not necessarily a bad key` };
  }
}

// ── .env read / dedupe / write ─────────────────────────────────────────────────
function readEnvLines() { return existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : []; }
function valuesFor(name) {
  const out = [];
  readEnvLines().forEach((l, i) => {
    if (/^\s*#/.test(l)) return;
    const m = l.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`));
    if (m) out.push({ line: i + 1, value: m[1].trim().replace(/^(['"])(.*)\1$/, "$2").trim() });
  });
  return out;
}
function writeKey(name, value) {
  const kept = readEnvLines().filter((l) => !new RegExp(`^\\s*${name}\\s*=`).test(l));
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  kept.push(`${name}=${value}`, "");
  writeFileSync(ENV_PATH, kept.join("\n"));
}

// ── main ──────────────────────────────────────────────────────────────────────
(async () => {
  // report duplicates up front — this is the failure mode that masquerades as a bad key
  const dupNames = {};
  for (const l of readEnvLines()) {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) dupNames[m[1]] = (dupNames[m[1]] || 0) + 1;
  }
  const dups = Object.entries(dupNames).filter(([, n]) => n > 1);
  if (dups.length) {
    console.log("⚠ DUPLICATE keys in .env — loadenv uses the FIRST occurrence, so later ones are IGNORED:");
    for (const [k, n] of dups) {
      console.log(`   ${k} appears ${n}×:`);
      for (const v of valuesFor(k)) console.log(`      line ${v.line}: ${mask(v.value)}`);
    }
    console.log("   Saving below rewrites the key to a SINGLE line and clears the duplicates.\n");
  }

  // --models: ask each provider what THIS key can actually reach. Model marketing names ("GPT-5.6 Sol",
  // "Gemini 3 Pro") are not API strings, and guessing one makes a benchmark run fail 20 rows in. Ask.
  if (ARGV.includes("--models")) {
    const oai = valuesFor("OPENAI_API_KEY")[0], gem = valuesFor("GEMINI_API_KEY")[0];
    if (oai) {
      process.stdout.write("OpenAI models your key can reach:\n");
      try {
        const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${oai.value}` } });
        if (!r.ok) console.log(`  ✖ HTTP ${r.status}`);
        else {
          const ids = ((await r.json()).data || []).map((m) => m.id)
            .filter((id) => /^(gpt|o\d|chatgpt)/i.test(id) && !/audio|realtime|transcribe|tts|image|embedding|moderation/i.test(id))
            .sort();
          // newest-looking first: highest version number wins
          const ver = (s) => { const m = s.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
          ids.sort((a, b) => ver(b) - ver(a) || a.localeCompare(b));
          ids.slice(0, 25).forEach((id) => console.log("   " + id));
          if (ids.length > 25) console.log(`   … and ${ids.length - 25} more`);
          console.log(`  → likely newest chat model: ${ids[0] || "(none found)"}`);
        }
      } catch (e) { console.log("  ✖ " + e.message); }
    } else console.log("OPENAI_API_KEY not in .env");
    if (gem) {
      process.stdout.write("\nGemini models your key can reach (generateContent):\n");
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(gem.value)}`);
        if (!r.ok) console.log(`  ✖ HTTP ${r.status}`);
        else {
          const ms = ((await r.json()).models || [])
            .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
            .map((m) => String(m.name).replace("models/", ""));
          const pro = ms.filter((n) => /pro/i.test(n)).sort();
          const flash = ms.filter((n) => /flash/i.test(n)).sort();
          if (pro.length) { console.log("   PRO (paid, stronger — the ones worth benchmarking):"); pro.forEach((n) => console.log("     " + n)); }
          if (flash.length) { console.log("   FLASH (free tier — this class FAILED the benchmark):"); flash.slice(0, 8).forEach((n) => console.log("     " + n)); }
          console.log(`  → ${ms.length} models total`);
        }
      } catch (e) { console.log("  ✖ " + e.message); }
    } else console.log("\nGEMINI_API_KEY not in .env");
    console.log("\nThen benchmark one:");
    console.log("  node rag/eval_gemini_quality.mjs --provider openai --openai-model <id> --topics 3");
    console.log("  node rag/eval_gemini_quality.mjs --gemini-model <id> --topics 3");
    process.exit(0);
  }

  if (CHECK_ONLY) {
    const names = NAME ? [NAME] : ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
    for (const n of names) {
      const vs = valuesFor(n);
      if (!vs.length) { console.log(`  ${n}: not in .env`); continue; }
      const eff = vs[0].value;   // first wins, matching loadenv
      process.stdout.write(`  ${n}: ${mask(eff)} → validating… `);
      const r = await validate(n, eff);
      console.log(r.ok === true ? `✓ ${r.detail}` : r.ok === false ? `✖ ${r.detail}` : `? ${r.detail}`);
    }
    process.exit(0);
  }

  if (!NAME) {
    console.log("Which key do you want to set?");
    console.log("  1) GEMINI_API_KEY      (Google AI Studio — for the free Gemini tier + eval)");
    console.log("  2) ANTHROPIC_API_KEY   (adds the Claude arm + judge to the eval)");
    console.log("  3) OPENAI_API_KEY      (embeddings)");
    const pick = (await ask("Enter 1, 2, 3, or the key name: ")).trim();
    NAME = { 1: "GEMINI_API_KEY", 2: "ANTHROPIC_API_KEY", 3: "OPENAI_API_KEY" }[pick] || pick.toUpperCase();
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(NAME)) { console.error(`✖ "${NAME}" is not a valid env var name.`); process.exit(1); }

  console.log(`\nPaste the value for ${NAME} and press Enter.`);
  console.log("(input is masked; paste the value only — a whole NAME=value line is fine too, I'll strip the prefix)");
  const raw = await ask("> ", { hide: true });

  const { value, notes, problems } = sanitize(raw, NAME);
  for (const n of notes) console.log(`  · ${n}`);
  if (problems.length) { for (const p of problems) console.error(`✖ ${p}`); console.error("Nothing was saved. Re-run and paste the real key."); process.exit(1); }
  console.log(`  · got: ${mask(value)}`);

  process.stdout.write("  · validating against the live API… ");
  const v = await validate(NAME, value);
  console.log(v.ok === true ? `✓ ${v.detail}` : v.ok === false ? `✖ ${v.detail}` : `? ${v.detail}`);

  if (v.ok === false) {
    console.error("\n✖ NOT SAVED — the API rejected this key, so saving it would just reproduce the same failure.");
    console.error("  Re-copy it with the copy button at https://aistudio.google.com/apikey and run this again.");
    process.exit(1);
  }
  writeKey(NAME, value);
  console.log(`\n✔ Saved ${NAME} to .env as a single line (duplicates removed).`);
  const after = valuesFor(NAME);
  console.log(`  .env now has ${after.length} line for ${NAME}: ${after.map((a) => `line ${a.line}`).join(", ")}`);
  console.log("  keys currently in .env: " + [...new Set(readEnvLines().map((l) => (l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/) || [])[1]).filter(Boolean))].join(", "));
  if (/^(GEMINI|GOOGLE)_API_KEY$/.test(NAME)) console.log("\nNext: node rag/eval_gemini_quality.mjs --topics 1     # 1-topic smoke test");
})();
