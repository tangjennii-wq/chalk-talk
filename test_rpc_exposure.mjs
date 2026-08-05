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

// ── 8 · EVERY SECURITY DEFINER FUNCTION PINS search_path ─────────────────────
// The second half of the same defect. SECURITY DEFINER runs as the owner; Postgres searches pg_temp
// FIRST by default; and all four billing functions referenced their tables UNQUALIFIED with no
// search_path set. A caller able to create a temp table named `free_tier_usage` could therefore shadow
// the real one and have the function read and write the attacker's table as the owner. Revoking EXECUTE
// closed the direct route — this closes the hijack that returns the moment anyone re-grants one.
{
  const all = files.map(f => readFileSync(new URL(f, migDir), "utf8")).join("\n");
  const code = all.split("\n").filter(l => !/^\s*--/.test(l)).join("\n");

  // Every CREATE FUNCTION carrying SECURITY DEFINER must also carry a SET search_path.
  const re = /create\s+(?:or\s+replace\s+)?function\s+([a-z_.]+)\s*\(/gis;
  const hits = [...code.matchAll(re)];
  const unpinned = [];
  hits.forEach((m, i) => {
    const body = code.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : code.length);
    // BOTH SPELLINGS. pg_get_functiondef() emits `SET search_path TO 'public', 'pg_temp'`, while
    // hand-written migrations use `set search_path = public, pg_temp`. The first version of this guard
    // accepted only `=` and therefore flagged a CORRECTLY pinned function exported from production —
    // a guard that rejects the right answer teaches people to route around it.
    if (/security\s+definer/i.test(body) && !/set\s+search_path\s*(=|to)\s/i.test(body)) {
      unpinned.push(m[1].replace(/^public\./, ""));
    }
  });
  ok(unpinned.length === 0,
     unpinned.length ? `SECURITY DEFINER without a pinned search_path: ${unpinned.join(", ")}`
                     : "every SECURITY DEFINER definition in the repo pins search_path");

  ok(/pg_temp/.test(code), "…and pg_temp is named explicitly (last), not left to the default ordering");

  // The billing functions must now HAVE a checked-in definition, not merely a checked-in revoke.
  for (const fn of ["free_tier_consume", "free_tier_remaining", "free_tier_grant_bonus", "ledger_add"]) {
    ok(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, "i").test(code),
       `${fn} now has a checked-in definition (the repo can reproduce production)`);
  }

  // And they must reference their tables schema-qualified, or the pin is doing half the work.
  const billing = code.slice(code.indexOf("free_tier_consume"));
  ok(!/[^.]\bfree_tier_usage\b/.test(billing.replace(/public\.free_tier_usage/g, "")),
     "billing functions reference public.free_tier_usage schema-qualified");
}

// ── 9 · THE MIGRATIONS MATCH WHAT THE WORKER EXPECTS ─────────────────────────
// The owner check was applied to production with execute_sql and the migration file was never updated,
// so the repo returned `already_reserved` on every conflict while production returned `owned_by_other`.
// A rebuild from migrations would have RESTORED the cross-user vulnerability, and the Worker — which
// reads owner_id — would have broken against the rebuilt function.
//
// This is the second time in one day that repo-vs-production drift hid a security property. A guard is
// cheaper than remembering: whatever contract the Worker consumes must be visible in the SQL.
{
  // COMMENTS STRIPPED FIRST. These migrations DISCUSS `owned_by_other` at length in prose, so
  // `all.includes("'owned_by_other'")` was satisfied by the explanation of the bug rather than by the
  // branch that fixes it — deleting the return statement and keeping the comment would have passed.
  // That is the fourth time in this repo a check has matched its own documentation, and the reason the
  // earlier "mutation-tested" claim did not prove what it said. Extract the FUNCTION BODY, not the file.
  const stripSql = (t) => t.split("\n").filter(l => !/^\s*--/.test(l)).join("\n");
  const allRaw = files.map(f => readFileSync(new URL(f, migDir), "utf8")).join("\n");
  const all = (() => {
    const src = stripSql(allRaw);
    const i = src.indexOf("create or replace function public.reserve_talk_for_job");
    if (i < 0) return src;
    const end = src.indexOf("$function$;", src.indexOf("$function$", i) + 10);
    return src.slice(i, end > i ? end : src.length);
  })();
  const wsrc = readFileSync(new URL("./worker.js", here), "utf8");
  const wcode = wsrc.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");

  // Every outcome string the Worker branches on must exist in the checked-in SQL.
  for (const outcome of ["owned_by_other", "already_reserved", "quota_exhausted", "reserved"]) {
    if (!new RegExp(`["'\`]${outcome}["'\`]`).test(wcode)) continue;   // Worker doesn't use it — skip
    // RETURNED, not merely mentioned. Comments are stripped and the search is scoped to the function
    // body already, but `includes` would still be satisfied by the string appearing in a condition or a
    // leftover fragment. The contract the Worker consumes is what the function RETURNS.
    ok(new RegExp(`return query select[^;]*'${outcome}'`, "s").test(all),
       `the Worker branches on "${outcome}" and the function RETURNS it`);
  }

  // Every column the Worker reads off the row must be in the declared return type.
  if (/row\.owner_id/.test(wcode)) {
    ok(/returns table \(reserved boolean, outcome text, owner_id uuid\)/.test(all),
       "the Worker reads row.owner_id and the migration declares it");
  }

  // And the signature change needs an explicit DROP, or a replay fails on the OUT-parameter row type.
  ok(/drop function if exists public\.reserve_talk_for_job/.test(stripSql(allRaw)),
     "…with an explicit DROP, since CREATE OR REPLACE cannot change an OUT-parameter row type");
}

console.log("\n" + (failures === 0 ? "✔ RPC EXPOSURE OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
