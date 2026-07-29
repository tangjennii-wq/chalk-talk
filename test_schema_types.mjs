// SQL TYPE AGREEMENT — assert new RPCs match the schema they query. Run: node test_schema_types.mjs
//
// WHY THIS EXISTS. score_candidate_chunks was first written with `candidate_chunk_ids uuid[]` and
// `returns chunk_id uuid`, copied from documents.id without checking. But document_chunks.id is
// **bigserial**, and match_chunks already returns `chunk_id bigint`.
//
// WHERE IT ACTUALLY FAILS (corrected — my first account of this was wrong). Postgres rejects it at
// CREATION: `c.id = any(candidate_chunk_ids)` with a bigint column and uuid[] parameter raises
// `operator does not exist: bigint = uuid`, and the GRANT names a signature no function has. The
// migration fails loudly; it does not install something broken.
//
// The real risk is narrower: ignore the failed migration, deploy the Worker anyway, and every rerank
// request falls back with rerank_applied:false — a feature that looks live and does nothing. Worth a
// suite because that is quiet, and because catching it at commit time beats catching it at deploy time.
//
// And no JavaScript test could have caught it. The stub passes string ids ("dcct", "ada2024"), which is
// exactly right for exercising ranking logic and exactly useless for catching a database type error.
// The types have to be compared against the schema itself. (Codex, 2026-07-28)
import { readFileSync, readdirSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const base = readFileSync(new URL("./supabase/migration_v2_rag.sql", import.meta.url), "utf8");
// THE REFERENCE FOR match_chunks IS THE EXPORT, NOT THE BOOTSTRAP (Codex, 2026-07-29).
// migration_v2_rag.sql was four parameters and four return columns behind the live function, so deriving
// anything about match_chunks from it was reading a file that had not described production for some time.
// Table DDL still comes from the bootstrap — the tables have not drifted — but the function does not.
const canonical = readFileSync(new URL("./supabase/migrations/canonical_match_chunks.sql", import.meta.url), "utf8");

// ── the ground truth: what type is document_chunks.id? ────────────────────────
const chunkTable = base.slice(base.indexOf("create table if not exists public.document_chunks"));
const idDecl = (chunkTable.match(/\n\s*id\s+(\w+)/) || [])[1];
ok(!!idDecl, `found document_chunks.id declaration (${idDecl})`);

// bigserial IS bigint — serial types are integer types with a default sequence.
const ID_SQL_TYPE = /bigserial|bigint/i.test(idDecl || "") ? "bigint"
                  : /^serial$|^integer$|^int$/i.test(idDecl || "") ? "integer"
                  : /uuid/i.test(idDecl || "") ? "uuid" : "unknown";
ok(ID_SQL_TYPE !== "unknown", `document_chunks.id resolves to SQL type "${ID_SQL_TYPE}"`);

// ── match_chunks must already agree (it is the incumbent, so it is the reference) ──
const mc = canonical.slice(canonical.search(/CREATE OR REPLACE FUNCTION public\.match_chunks/i));
const mcChunkId = (mc.match(/chunk_id\s+(\w+)/) || [])[1];
ok((mcChunkId || "").toLowerCase() === ID_SQL_TYPE,
   `canonical match_chunks returns chunk_id ${mcChunkId} — agrees with document_chunks.id`);

// The stale bootstrap definition must stay labeled as stale, so nobody reads it for ranking behaviour.
ok(/SUPERSEDED/.test(base.slice(0, base.indexOf("create or replace function public.match_chunks"))
     .split("\n").slice(-14).join("\n")),
   "the superseded match_chunks in migration_v2_rag.sql is marked as such");

// ── every migration that mentions chunk ids must use the SAME type ────────────
const migDir = new URL("./supabase/migrations/", import.meta.url);
const mig = readdirSync(migDir).filter(f => f.endsWith(".sql"));
let checked = 0;
for (const f of mig) {
  const sql = readFileSync(new URL(f, migDir), "utf8");
  if (!/chunk_id|candidate_chunk_ids/.test(sql)) continue;
  checked++;

  // array parameters of chunk ids
  for (const m of sql.matchAll(/candidate_chunk_ids\s+(\w+)\s*\[\s*\]/g)) {
    ok(m[1].toLowerCase() === ID_SQL_TYPE,
       `${f}: candidate_chunk_ids is ${m[1]}[] — must match document_chunks.id (${ID_SQL_TYPE})`);
  }
  // scalar chunk_id columns in RETURNS TABLE
  for (const m of sql.matchAll(/\n\s*chunk_id\s+(\w+)\s*,/g)) {
    ok(m[1].toLowerCase() === ID_SQL_TYPE,
       `${f}: returns chunk_id ${m[1]} — must match document_chunks.id (${ID_SQL_TYPE})`);
  }
  // GRANT signatures must name the same argument types as the definition, or the grant silently
  // applies to a function that does not exist
  const defArgs = [...sql.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\)\s*returns/g)];
  for (const [, fname, args] of defArgs) {
    // A GRANT names the function's IDENTITY arguments: types only, no parameter names and no DEFAULT
    // clauses. So strip -- comments (which can carry commas and prose that the split would read as an
    // argument) and strip `default <expr>` before comparing. Both of those appeared the moment the
    // scorer gained boost parameters, and produced three failures against a GRANT that was correct.
    const argTypes = args
      .split("\n").map(l => l.replace(/--.*$/, "")).join("\n")
      .split(",")
      .map(a => a.replace(/\bdefault\b[\s\S]*$/i, "").trim())
      .filter(Boolean)
      .map(a => a.split(/\s+/).slice(1).join(" ").trim())
      .filter(Boolean);
    const sig = argTypes.join(", ").replace(/\s+/g, " ");
    // NB: greedy to the last ")" before " to ", because vector(1536) contains a paren — a lazy
    // [^)]* match stops inside it and compares "vector(1536" against the real signature.
    const grants = [...sql.matchAll(new RegExp(`grant execute on function public\\.${fname}\\((.*)\\)\\s+to\\s`, "gi"))];
    ok(grants.length > 0, `${f}: ${fname} has at least one GRANT`);
    for (const [, g] of grants) {
      ok(g.replace(/\s+/g, " ").trim() === sig,
         `${f}: GRANT signature "${g.trim()}" matches the definition "${sig}" — a mismatched grant applies to nothing`);
    }
  }
}
ok(checked > 0, `checked ${checked} migration(s) that reference chunk ids`);

// ── the specific regression ──────────────────────────────────────────────────
const scs = readFileSync(new URL("./supabase/migrations/add_score_candidate_chunks.sql", import.meta.url), "utf8");
ok(!/uuid/.test(scs.split("--").filter(x => !x.startsWith(" ")).join("")) || !/candidate_chunk_ids\s+uuid/.test(scs),
   "score_candidate_chunks no longer declares uuid ids — the original defect");
ok(/candidate_chunk_ids bigint\[\]/.test(scs), "…it takes bigint[]");
ok(/chunk_id bigint/.test(scs), "…and returns chunk_id bigint");

console.log("\n" + (failures === 0 ? "✔ SCHEMA TYPE TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
