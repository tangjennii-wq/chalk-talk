// Loads .env from the repo root into process.env and validates required vars with CLEAR errors.
//
// Why: Supabase throws "Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL." — a cryptic stack
// trace — when SUPABASE_URL is set but malformed (wrong key pasted, quotes, trailing text). This
// loader parses .env itself (so no --env-file flag is needed) and, on any problem, prints exactly
// which variable is wrong and a masked preview of what it actually read.
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env");

if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^(['"])(.*)\1$/, "$2").trim();   // strip matching surrounding quotes + space
    if (v && !process.env[k]) process.env[k] = v;
  }
}

const mask = (s) => (s && s.length > 10 ? s.slice(0, 6) + "…" + s.slice(-3) : s || "(empty)");

/** keys: array of names. urlKeys: names that must look like an http(s) URL. */
export function requireEnv(keys, urlKeys = ["SUPABASE_URL"]) {
  const problems = [];
  for (const k of keys) {
    const v = (process.env[k] || "").trim();
    if (!v) { problems.push(`${k} is MISSING or blank`); continue; }
    if (urlKeys.includes(k) && !/^https?:\/\//i.test(v))
      problems.push(`${k} does not start with https:// — got: "${mask(v)}"  (did you paste the wrong value here?)`);
  }
  if (!problems.length) return;

  console.error("\n✖ Environment problem — cannot connect.\n");
  for (const p of problems) console.error("  • " + p);
  console.error(existsSync(ENV_PATH)
    ? `\n  Your .env is at: ${ENV_PATH}\n  Open it (open -e "${ENV_PATH}") and check each line reads NAME=value with no quotes.\n  Expected:\n    SUPABASE_URL=https://hrcvcjiefndvytlcbmpa.supabase.co\n    SUPABASE_SERVICE_ROLE_KEY=<your service-role key>\n    OPENAI_API_KEY=<your OpenAI key>`
    : `\n  No .env found. Run:  cp .env.example .env   then paste your two secret keys into it.`);
  console.error("");
  process.exit(1);
}
