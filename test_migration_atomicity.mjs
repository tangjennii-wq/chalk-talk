// MIGRATION ATOMICITY — run: node test_migration_atomicity.mjs
//
// WHY THIS EXISTS (Codex, 2026-07-29 — BLOCKING finding).
// canonical_match_chunks.sql drops BOTH match_chunks signatures before creating the canonical one.
// PostgreSQL DDL is transactional, but psql autocommits each statement when there is no explicit
// transaction block, and `-v ON_ERROR_STOP=1` only STOPS on error — it does not UNDO what already
// committed. So an unwrapped file could commit both DROPs, fail on CREATE FUNCTION (a syntax slip, a
// missing pgvector extension, a permissions problem) or on a GRANT, exit non-zero, and leave production
// with NO match_chunks at all. Every retrieval request then 404s with PGRST202.
//
// The first version of the file was exactly that: drop, drop, create, comment, grant — no BEGIN.
//
// VERIFIED AGAINST A REAL DATABASE, not reasoned about. On throwaway objects in a scratch schema
// (never touching match_chunks):
//
//   * a DROP followed by a failure INSIDE a transaction rolled back — the original function still
//     answered afterwards ('original')
//   * the same DROP issued WITHOUT a transaction committed on its own — to_regprocedure returned NULL,
//     the function was gone for good
//
// That contrast is the whole argument for BEGIN/COMMIT, and it is why "the migration installed fine
// when I ran it" is not evidence of anything. Testing the SUCCESS path only would have missed this.
import { readFileSync, readdirSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const dir = new URL("./supabase/migrations/", import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith(".sql"));

// Statements that leave the database in a broken state if the file stops halfway.
const DESTRUCTIVE = /^\s*(drop|alter)\s+/im;

let checked = 0;
for (const f of files) {
  const sql = readFileSync(new URL(f, dir), "utf8");
  const code = sql.split("\n").map(l => l.replace(/--.*$/, "")).join("\n");
  if (!DESTRUCTIVE.test(code)) continue;      // nothing destructive: atomicity is not load-bearing
  checked++;

  const hasBegin  = /^\s*begin\s*;/im.test(code);
  const hasCommit = /^\s*commit\s*;/im.test(code);
  ok(hasBegin,  `${f}: opens an explicit transaction (it contains DROP/ALTER)`);
  ok(hasCommit, `${f}: …and commits it`);

  if (hasBegin && hasCommit) {
    const b = code.search(/^\s*begin\s*;/im);
    const c = code.search(/^\s*commit\s*;/im);
    ok(b < c, `${f}: BEGIN precedes COMMIT`);

    // Every destructive statement AND every grant must sit inside the block. A GRANT outside it is the
    // subtle version: the function installs, the transaction commits, then the grant fails and the
    // function exists with no ACL — present, callable by nobody, and \df+ calls that a success.
    const lines = code.split("\n");
    let inBlock = false, strays = [];
    for (const line of lines) {
      if (/^\s*begin\s*;/i.test(line)) { inBlock = true; continue; }
      if (/^\s*commit\s*;/i.test(line)) { inBlock = false; continue; }
      if (!inBlock && /^\s*(drop|alter|grant|create or replace function)\s+/i.test(line)) {
        strays.push(line.trim().slice(0, 60));
      }
    }
    ok(strays.length === 0,
       `${f}: no drop/create/grant outside the transaction${strays.length ? " — stray: " + strays[0] : ""}`);
  }
}
ok(checked > 0, `checked ${checked} migration(s) containing destructive statements`);

// ── the wrapping must not have broken anything ────────────────────────────────
// BEGIN/COMMIT were inserted mechanically into eight pre-existing migrations. A dollar-quoted function
// body that got split, or a COMMIT landing inside one, would be a syntax error at apply time — long
// after anyone would connect it to this change. Structural checks, since these files never execute here.
//
// NB: `begin` inside a plpgsql body has NO semicolon, which is why /^\s*begin\s*;/ does not match it.
// That distinction is load-bearing for every check in this file.
for (const f of files) {
  const sql = readFileSync(new URL(f, dir), "utf8");
  const dollars = (sql.match(/\$\$/g) || []).length;
  ok(dollars % 2 === 0, `${f}: dollar-quote delimiters are balanced (${dollars})`);

  const begins  = (sql.match(/^\s*begin\s*;/gim)  || []).length;
  const commits = (sql.match(/^\s*commit\s*;/gim) || []).length;
  ok(begins === commits, `${f}: BEGIN and COMMIT are balanced (${begins}/${commits})`);
  ok(begins <= 1, `${f}: exactly one transaction, not nested (${begins})`);

  if (commits === 1) {
    // COMMIT must be the last statement — anything executable after it is outside the transaction.
    const after = sql.slice(sql.search(/^\s*commit\s*;/im) + 8);
    const executableAfter = after.split("\n")
      .map(l => l.replace(/--.*$/, "").trim())
      .filter(Boolean);
    ok(executableAfter.length === 0,
       `${f}: nothing executable after COMMIT${executableAfter.length ? " — found: " + executableAfter[0].slice(0, 50) : ""}`);
  }
}

// ── the specific regression: canonical drops two signatures, so it MUST be atomic ──
const canonical = readFileSync(new URL("canonical_match_chunks.sql", dir), "utf8");
const drops = (canonical.match(/^\s*drop function if exists public\.match_chunks/gim) || []).length;
ok(drops === 2, `canonical drops both signatures (${drops}) — which is exactly why it must be atomic`);
ok(/^\s*begin\s*;/im.test(canonical), "…and it is wrapped in BEGIN");

// ── the corrected failure mode must be recorded, not the wrong one ────────────
// The comments claimed an ambiguous overload would let PostgREST "silently" pick one. It does not:
// PostgreSQL raises 42725 and PostgREST returns PGRST203/300. A wrong failure mode in a comment is a
// wrong mental model for whoever debugs it at 2am.
ok(/42725/.test(canonical) && /PGRST203/.test(canonical),
   "canonical records the REAL overload failure (42725 / PGRST203), not a silent-selection story");
ok(!/silently does not, with nothing in the response/.test(canonical),
   "…and the incorrect 'silent' claim is gone");

console.log("\n" + (failures === 0 ? "✔ MIGRATION ATOMICITY TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
