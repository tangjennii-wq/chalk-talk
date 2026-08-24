// BUILD STAMP — run: node test_build_id.mjs
//
// The app compares a BUILD_ID baked into index.html against build.txt fetched with cache:no-store, and
// shows "Refresh for the latest version" when they differ. That machinery has one failure mode and it is
// silent: bump only ONE of the two and the pill either never appears (build.txt stale) or appears forever
// (BUILD_ID stale). Both sat at 2026-08-18-01 through several commits, so nobody was ever told to refresh
// — which is exactly how Jenni ended up testing a page loaded before a fix landed, twice in one day.
//
// This suite does not check that the stamp is TODAY's. It checks the two agree, are well-formed, and are
// not the known-stale value — the properties a human bumping by hand actually gets wrong.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const txt = readFileSync(new URL("./build.txt", import.meta.url), "utf8").trim();

const m = html.match(/^var BUILD_ID = "([^"]+)";/m);
ok(!!m, "BUILD_ID is declared in index.html at the start of a line, not buried in an expression");
const id = m ? m[1] : "";

ok(/^\d{4}-\d{2}-\d{2}-\d{2}$/.test(id), `BUILD_ID is a YYYY-MM-DD-NN stamp (got "${id}")`);
ok(/^\d{4}-\d{2}-\d{2}-\d{2}$/.test(txt), `build.txt is a YYYY-MM-DD-NN stamp (got "${txt}")`);
ok(id === txt, `BUILD_ID and build.txt agree ("${id}" vs "${txt}") — bumping one alone breaks the refresh pill`);

// build.txt is fetched and string-compared, so a trailing newline is fine but stray content is not.
const raw = readFileSync(new URL("./build.txt", import.meta.url), "utf8");
ok(raw.split("\n").filter(l => l.trim()).length === 1,
   "build.txt holds exactly one non-empty line — the comparison is a string equality, not a parse");

// The known-stale value. Named explicitly: a generic "looks like a date" check passed all through the
// window in which both files were frozen at it.
ok(id !== "2026-08-18-01",
   "the stamp has moved off 2026-08-18-01, the value both files were stuck on across several commits");

// The comparison must still be wired at both ends, or the stamps agree and nothing uses them.
ok(/fetch\("build\.txt\?_=" \+ Date\.now\(\), \{ cache:"no-store" \}\)/.test(html),
   "build.txt is fetched cache-busted and no-store, so a CDN cannot serve the old stamp");
ok(/BUILD_ID/.test(html.slice(html.indexOf('fetch("build.txt'), html.indexOf('fetch("build.txt') + 600)),
   "…and compared against BUILD_ID rather than merely fetched");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ BUILD STAMP OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
