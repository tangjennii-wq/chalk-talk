// PRIVILEGED RPC EXPOSURE — run: node test_rpc_exposure.mjs
//
// ── WHAT WAS FOUND, 2026-07-31 ──────────────────────────────────────────────────────────────────────
// Auditing every callable function rather than only the receipt ones turned up four SECURITY DEFINER
// billing RPCs that anon and authenticated could execute. SECURITY DEFINER runs as the function owner
// and BYPASSES row-level security, so the RLS everyone assumes is protecting these was never in the
// path. The Supabase anon key ships inside index.html.
//
// The worst authorises nothing whatsoever:
//
//     free_tier_grant_bonus(p_email, p_bonus_talks, p_bonus_images)
//       SELECT id FROM auth.users WHERE email = lower(p_email)     -- ANY user, by email
//       INSERT ... bonus_talks = bonus_talks + EXCLUDED.bonus_talks
//
// No caller check, no ownership check. A stranger could grant themselves unlimited free talks, each of
// which spends the app-funded Anthropic key — defeating the entire receipt mechanism one layer beneath
// it. ledger_add was likewise open: it can only increase the total, so it cannot hide spend, but it can
// be driven past the cap, which disables generation for every user and fires false spend alerts.
//
// Fixed by revoking EXECUTE from PUBLIC/anon/authenticated (the grant Postgres adds at CREATE FUNCTION,
// which `revoke ... from anon, authenticated` does NOT remove) and granting service_role only.
// Verified by ATTEMPTING THE EXPLOIT as both roles, not by reading the grant table:
//
//     free_tier_grant_bonus  blocked (insufficient_privilege)
//     free_tier_consume      blocked        ledger_add       blocked
//     free_tier_remaining    blocked        receipt_issue    blocked
//     receipt_redeem         blocked        match_chunks     REACHABLE  <- retrieval still works
//
// ── WHAT THIS FILE CAN AND CANNOT DO ────────────────────────────────────────────────────────────────
// It cannot reach the database. What it CAN do is stop the two ways this regresses in code review:
//   1. a migration that grants a privileged RPC back to anon/authenticated/public;
//   2. the client learning to call one of these directly, which would create pressure to re-grant it.
// The live privilege check belongs in the pre-deploy smoke tests, and is recorded above.
import { readFileSync, readdirSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const here = new URL(".", import.meta.url);
const migDir = new URL("./supabase/migrations/", here);

// Functions that must NEVER be callable by a browser-held role.
const PRIVILEGED = [
  "free_tier_grant_bonus",   // grants quota — spends the app-funded key
  "free_tier_consume",       // burns quota, user_id is a plain parameter
  "free_tier_remaining",     // reads another user's quota
  "ledger_add",              // spend accounting; can be driven past the cap
  "receipt_issue",           // minting authorisation makes every check above it ornamental
  "receipt_redeem",
  "receipt_gc",
];
// Retrieval is intentionally reachable by anon — the Worker calls it with the anon key.
const PUBLIC_OK = ["match_chunks", "match_chunks_hnsw", "score_candidate_chunks"];

const files = readdirSync(migDir).filter(f => f.endsWith(".sql"));
ok(files.length > 0, `found ${files.length} migration files to scan`);

// ── 1 · NO MIGRATION GRANTS A PRIVILEGED RPC TO A BROWSER ROLE ───────────────
{
  const offences = [];
  for (const f of files) {
    const sql = readFileSync(new URL(f, migDir), "utf8");
    // Strip comments: several migrations DISCUSS these grants at length in prose.
    const code = sql.split("\n").filter(l => !/^\s*--/.test(l)).join("\n");
    // `grant execute on function <name>(...) to <roles>;` possibly spanning lines.
    const re = /grant\s+execute\s+on\s+function\s+([a-z_.]*?([a-z_]+))\s*\([^)]*\)\s*to\s+([^;]+);/gis;
    let m;
    while ((m = re.exec(code))) {
      const fn = m[2], roles = m[3].toLowerCase();
      if (!PRIVILEGED.includes(fn)) continue;
      if (/\banon\b|\bauthenticated\b|\bpublic\b/.test(roles)) {
        offences.push(`${f}: ${fn} -> ${roles.trim().replace(/\s+/g, " ")}`);
      }
    }
  }
  ok(offences.length === 0,
     offences.length ? `privileged RPC granted to a browser role:\n     ${offences.join("\n     ")}`
                     : "no migration grants a privileged RPC to anon/authenticated/public");
}

// ── 2 · THE REVOKE INCLUDES `public`, NOT ONLY THE TWO NAMED ROLES ───────────
// The original receipt migration wrote `revoke ... from anon, authenticated` and believed the functions
// were locked. They were not: CREATE FUNCTION grants EXECUTE to PUBLIC, and that grant survived.
{
  const all = files.map(f => readFileSync(new URL(f, migDir), "utf8"))
                   .map(s => s.split("\n").filter(l => !/^\s*--/.test(l)).join("\n"))
                   .join("\n");
  for (const fn of ["free_tier_grant_bonus", "ledger_add", "receipt_issue", "receipt_redeem"]) {
    // ALL revokes, not the first. add_receipts.sql still carries the original incomplete
    // `from anon, authenticated` — which is history worth keeping, and which matched first and made
    // this assertion fail on a repo that is actually correct. The question is whether SOME migration
    // revokes from PUBLIC, not whether the earliest one did.
    const re = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+[a-z_.]*${fn}\\s*\\([^)]*\\)\\s*from\\s+([^;]+);`, "gis");
    const roleLists = [...all.matchAll(re)].map(m => m[1].toLowerCase());
    ok(roleLists.some(r => /\bpublic\b/.test(r)),
       `${fn} is revoked from PUBLIC somewhere (found ${roleLists.length} revoke(s))`);
  }
}

// ── 3 · THE CLIENT NEVER CALLS A PRIVILEGED RPC ──────────────────────────────
// If the browser ever needs one of these, the fix is a Worker endpoint that authorises the caller —
// never a grant. This catches the change that would create pressure to re-open the hole.
{
  const html = readFileSync(new URL("./index.html", here), "utf8");
  const code = html.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const called = PRIVILEGED.filter(fn => new RegExp(`rpc\\(\\s*["'\`]${fn}["'\`]|/rpc/${fn}\\b`).test(code));
  ok(called.length === 0,
     called.length ? `index.html calls privileged RPC(s) directly: ${called.join(", ")}`
                   : "index.html calls no privileged RPC directly");
}

// ── 4 · THE WORKER REACHES THEM ONLY VIA THE SERVICE ROLE ────────────────────
{
  const w = readFileSync(new URL("./worker.js", here), "utf8");
  const code = w.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const bad = [];
  for (const fn of PRIVILEGED) {
    // Every mention must be inside a supaServiceRPC(...) call.
    const re = new RegExp(`["'\`]${fn}["'\`]`, "g");
    let m;
    while ((m = re.exec(code))) {
      const before = code.slice(Math.max(0, m.index - 120), m.index);
      if (!/supaServiceRPC\(\s*env\s*,\s*$/.test(before)) bad.push(`${fn} @${m.index}`);
    }
  }
  ok(bad.length === 0,
     bad.length ? `privileged RPC reached outside supaServiceRPC: ${bad.join(", ")}`
                : "the Worker reaches every privileged RPC through supaServiceRPC (service role)");
}

// ── 5 · RETRIEVAL STAYS REACHABLE ────────────────────────────────────────────
// Over-revoking is its own outage: retrieval runs as anon and must keep working.
{
  const all = files.map(f => readFileSync(new URL(f, migDir), "utf8")).join("\n");
  for (const fn of ["match_chunks_hnsw"]) {
    const re = new RegExp(`grant\\s+execute\\s+on\\s+function\\s+[a-z_.]*${fn}\\s*\\([^)]*\\)\\s*to\\s+([^;]+);`, "is");
    const m = all.match(re);
    ok(!!m && /anon/.test(m[1]), `${fn} is still granted to anon — the Worker retrieves with the anon key`);
  }
  ok(PUBLIC_OK.every(fn => !PRIVILEGED.includes(fn)),
     "retrieval functions are not on the privileged list (they carry no billing authority)");
}

// ── 6 · EXHAUSTIVE: EVERY SECURITY DEFINER FUNCTION IN THE CHECKED-IN SCHEMA ──
// Not a hard-coded list of the seven found today. SECURITY DEFINER runs as the function OWNER and
// bypasses RLS, so any such function reachable from a browser role is a privilege escalation waiting
// for someone to add a body that trusts its parameters — which is exactly how free_tier_grant_bonus
// became exploitable. Every one must either be revoked from PUBLIC, or allow-listed WITH A REASON.
const SECDEF_ALLOWLIST = {
  get_public_profile:
    "Public by design: returns the already-public profile for a handle, which is the point of a public " +
    "profile page. Takes a handle, not a user id, and exposes no private column.",
  is_handle_available:
    "Public by design: sign-up must tell an anonymous visitor whether a handle is free, before they " +
    "have any session. Returns a boolean and nothing else.",
  reject_reserved_handle:
    "Trigger function. Calling it directly raises 'can only be called as trigger', so an EXECUTE grant " +
    "confers nothing. Listed rather than revoked so the exemption is a decision on the record.",
  handle_new_user:
    "Trigger function on auth.users insert; same reasoning as reject_reserved_handle.",
};
{
  const secdef = new Map();   // fn -> file
  for (const f of files) {
    const sql = readFileSync(new URL(f, migDir), "utf8");
    const code = sql.split("\n").filter(l => !/^\s*--/.test(l)).join("\n");
    // Each CREATE FUNCTION body up to the next CREATE/end, checked for SECURITY DEFINER.
    const re = /create\s+(?:or\s+replace\s+)?function\s+([a-z_.]+)\s*\(/gis;
    const hits = [...code.matchAll(re)];
    hits.forEach((m, i) => {
      const body = code.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : code.length);
      if (/security\s+definer/i.test(body)) {
        secdef.set(m[1].replace(/^public\./, ""), f);
      }
    });
  }
  ok(secdef.size > 0, `found ${secdef.size} SECURITY DEFINER function(s) in checked-in migrations`);

  const all = files.map(f => readFileSync(new URL(f, migDir), "utf8"))
                   .map(s => s.split("\n").filter(l => !/^\s*--/.test(l)).join("\n")).join("\n");
  const unguarded = [];
  for (const [fn, file] of secdef) {
    const re = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+[a-z_.]*${fn}\\s*\\([^)]*\\)\\s*from\\s+([^;]+);`, "gis");
    const revoked = [...all.matchAll(re)].some(m => /\bpublic\b/.test(m[1].toLowerCase()));
    const allowed = Object.prototype.hasOwnProperty.call(SECDEF_ALLOWLIST, fn)
                 && SECDEF_ALLOWLIST[fn].length > 40;   // a reason, not a rubber stamp
    if (!revoked && !allowed) unguarded.push(`${fn} (${file})`);
  }
  ok(unguarded.length === 0,
     unguarded.length
       ? `SECURITY DEFINER reachable by a browser role, not revoked and not allow-listed:\n     ${unguarded.join("\n     ")}`
       : "every SECURITY DEFINER function is revoked from PUBLIC or allow-listed with a justification");
}

// ── 7 · THE REPO MUST BE ABLE TO REPRODUCE THE FIX ───────────────────────────
// The billing functions have NO checked-in definition — they were created outside the repo, which is a
// large part of why the exposure was invisible to code review: there was no file for a reviewer to read.
// Until they are captured, the least this can do is guarantee the REVOKE is reproducible, so a rebuild
// from migrations cannot silently restore the open grants.
{
  const known = ["free_tier_grant_bonus", "free_tier_consume", "free_tier_remaining", "ledger_add"];
  const all = files.map(f => readFileSync(new URL(f, migDir), "utf8"))
                   .map(s => s.split("\n").filter(l => !/^\s*--/.test(l)).join("\n")).join("\n");
  const missing = known.filter(fn => {
    const re = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+[a-z_.]*${fn}\\s*\\(`, "is");
    return !re.test(all);
  });
  ok(missing.length === 0,
     missing.length ? `production SECURITY DEFINER function(s) with no reproducible revoke: ${missing.join(", ")}`
                    : "every known production billing RPC has a checked-in revoke");

  // Recorded so the omission is tracked rather than forgotten.
  const review = readFileSync(new URL("./rag/runs/2026-07-31-privileged-rpc-security-review.md", here), "utf8");
  ok(/no checked-in definition/i.test(review) || /created outside the repo/i.test(review),
     "the security review records that these functions are not defined in the repo");
}

console.log("\n" + (failures === 0 ? "✔ RPC EXPOSURE OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
