#!/usr/bin/env node
/**
 * RECONCILE landmark flags in Supabase against the canonical manifest.
 *
 * WHY (Codex review 2026-07-17, step 4): ingest_landmarks.mjs UPSERTS the canonical papers, but it
 * cannot un-flag rows it doesn't touch. Rows flagged is_landmark_trial=true by an OLDER ingest — the
 * wrong papers (GRIFFIN for ALCYONE, design papers, the FIDELITY pooled analysis, etc.) — keep their
 * flag and their source_tier=1 unless something explicitly clears them. A stale wrong paper flagged
 * as a landmark is precisely the "review renders with a trial chip" bug, resurrected via old rows.
 *
 * This script computes the set of canonical PMIDs from rag/landmark_trials.json and UN-FLAGS every
 * is_landmark_trial=true document whose PMID is NOT in that set, re-tiering it by its own pubtypes.
 *
 * RUN ORDER: node rag/ingest_landmarks.mjs   (inserts/updates the correct papers) THEN this script.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write. Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage:
 *   node rag/reconcile_landmarks.mjs            # report orphans, change nothing
 *   node rag/reconcile_landmarks.mjs --apply    # un-flag orphans
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

import { requireEnv } from "./loadenv.mjs";   // loads .env + validates with clear errors
requireEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
const APPLY = process.argv.includes("--apply");
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const raw = JSON.parse(readFileSync("rag/landmark_trials.json", "utf8"));
const manifest = Array.isArray(raw) ? raw : Object.values(raw)[0];
const canonical = new Set(manifest.map((t) => String(t.expected_pmid || "")).filter(Boolean));
console.log(`Canonical manifest PMIDs: ${canonical.size} (of ${manifest.length} trials)`);

const { data: flagged, error } = await sb
  .from("documents")
  .select("id, pmid, title, source_tier, raw_metadata")
  .eq("is_landmark_trial", true);
if (error) { console.error("select:", error.message); process.exit(1); }
console.log(`Currently flagged is_landmark_trial=true: ${flagged.length}`);

const orphans = flagged.filter((d) => !canonical.has(String(d.pmid)));
console.log(`\nOrphans (flagged but NOT in canonical manifest): ${orphans.length}`);
for (const o of orphans.slice(0, 40))
  console.log(`  [${o.pmid}] "${String(o.title || "").slice(0, 78)}"`);
if (orphans.length > 40) console.log(`  … and ${orphans.length - 40} more`);

// tier a demoted paper by its own pubtypes, matching ingest_pubmed's tierForPubtypes
function tierOf(d) {
  const pts = (d.raw_metadata && d.raw_metadata.pubtypes) || [];
  const s = new Set(pts.map((p) => String(p).toLowerCase()));
  if (s.has("guideline") || s.has("practice guideline")) return 1;
  if (s.has("meta-analysis") || s.has("systematic review")) return 2;
  if (s.has("review")) return 3;
  return 4;
}

if (!orphans.length) { console.log("\n✔ Nothing to reconcile — every flagged doc is canonical."); process.exit(0); }
if (!APPLY) { console.log(`\nDRY RUN — pass --apply to un-flag these ${orphans.length} rows.`); process.exit(0); }

let done = 0;
for (const o of orphans) {
  const { error: uErr } = await sb.from("documents")
    .update({ is_landmark_trial: false, source_tier: tierOf(o), updated_at: new Date().toISOString() })
    .eq("id", o.id);
  if (uErr) { console.error(`  update ${o.pmid}: ${uErr.message}`); continue; }
  done++;
}
console.log(`\n✔ Un-flagged ${done}/${orphans.length} orphan rows.`);

// post-condition: every remaining flagged doc must be canonical
const { data: after } = await sb.from("documents").select("pmid").eq("is_landmark_trial", true);
const stillBad = (after || []).filter((d) => !canonical.has(String(d.pmid)));
console.log(stillBad.length
  ? `✖ ${stillBad.length} still non-canonical — investigate.`
  : `✔ All ${(after || []).length} remaining landmark flags are canonical.`);
