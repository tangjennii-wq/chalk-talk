// MOBILE LIBRARY FILTER — run: node test_library_filter.mjs
//
// The drawer's scope rules are executed here, not pattern-matched. test_mobile_ux.mjs learned this the
// hard way: 16 of its 18 assertions still passed after deleting the feature they named, because a regex
// over a 15k-line file finds the string somewhere and calls it proof. Everything below either runs
// mobileLibraryView()/mobileLibSpecStrip() in a vm, or asserts on the HTML those functions actually
// produced — never on the file.
import fs from "node:fs";
import vm from "node:vm";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const src = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");

function functionSource(name){
  const start = src.indexOf(`function ${name}(`);
  if(start < 0) throw new Error(`missing ${name}`);
  const open = src.indexOf("{", start);
  let depth = 0, quote = null, escape = false;
  for(let i=open; i<src.length; i++){
    const ch = src[i];
    if(quote){
      if(escape) escape = false;
      else if(ch === "\\") escape = true;
      else if(ch === quote) quote = null;
      continue;
    }
    if(ch === '"' || ch === "'" || ch === "`"){ quote = ch; continue; }
    if(ch === "{") depth++;
    else if(ch === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unclosed ${name}`);
}

const ctx = { esc: (x) => String(x) };
vm.createContext(ctx);
vm.runInContext(
  `${functionSource("mobileLibraryView")}\n${functionSource("mobileLibSpecStrip")}\n` +
  `this.mobileLibraryView = mobileLibraryView; this.mobileLibSpecStrip = mobileLibSpecStrip;`, ctx);
const { mobileLibraryView: view, mobileLibSpecStrip: strip } = ctx;

// savedAt ordering is deliberately shuffled relative to array order, so "most recent" cannot pass by
// accident on input order.
const lib = [
  { id:"a", topic:"Hyponatremia",  savedAt:"2026-08-01T00:00:00Z", talk:{ title:"Hyponatremia" }, _spec:"Nephrology" },
  { id:"b", topic:"DKA",           savedAt:"2026-08-05T00:00:00Z", talk:{ title:"DKA" },          _spec:"Endocrinology" },
  { id:"c", topic:"AKI",           savedAt:"2026-08-03T00:00:00Z", talk:{ title:"AKI" },          _spec:"Nephrology" },
  { id:"d", topic:"HIT boards",    savedAt:"2026-08-09T00:00:00Z", talk:{ title:"HIT", question:{ stem:"..." } }, _spec:"Hematology" },
  { id:"e", topic:"PE",            savedAt:"2026-08-02T00:00:00Z", talk:{ title:"PE" },           _spec:"Pulmonary" },
  { id:"f", topic:"broken row",    savedAt:"2026-08-08T00:00:00Z", _spec:"Nephrology" },   // no .talk
];
const specOf = (e) => e._spec;
const ids = (v) => v.items.map(r => r.entry.id);

// ── scope ───────────────────────────────────────────────────────────────────────────────────────────
const all = view(lib, null, specOf);
ok(!ids(all).includes("d"), "a boards item (talk.question) is not in the drawer — it lives behind See all");
ok(!ids(all).includes("f"), "an entry with no .talk is dropped rather than rendered as a blank row");
ok(all.total === 4, `total counts lectures only (got ${all.total})`);

// ── sort ────────────────────────────────────────────────────────────────────────────────────────────
ok(JSON.stringify(ids(all)) === JSON.stringify(["b","c","e","a"]),
   "default order is most-recent first, regardless of input order");

// ── specialty filter ────────────────────────────────────────────────────────────────────────────────
const neph = view(lib, "Nephrology", specOf);
ok(JSON.stringify(ids(neph)) === JSON.stringify(["c","a"]),
   "selecting a specialty filters to it AND keeps most-recent order (does not reorder)");
ok(neph.active === "Nephrology", "the active specialty is reported back for the label");

// ── counts ──────────────────────────────────────────────────────────────────────────────────────────
ok(all.counts.Nephrology === 2 && all.counts.Endocrinology === 1 && all.counts.Pulmonary === 1,
   "per-specialty counts are lecture-only");
ok(all.counts.Hematology === undefined,
   "a specialty whose only item is a boards question does not appear as an option");
ok(JSON.stringify(all.specs) === JSON.stringify(["Nephrology","Endocrinology","Pulmonary"]),
   "specialties order by count desc, then alphabetically");

// ── the stale-filter case ───────────────────────────────────────────────────────────────────────────
// S.libSpec is shared with the desktop Library, so it can name a specialty with no lectures.
const stale = view(lib, "Cardiology", specOf);
ok(stale.active === null && stale.items.length === 4,
   "a specialty with no lectures falls back to All rather than rendering an empty drawer");
const boardsOnlySpec = view(lib, "Hematology", specOf);
ok(boardsOnlySpec.active === null && boardsOnlySpec.items.length === 4,
   "a specialty that exists only in boards also falls back to All");

// ── the strip ───────────────────────────────────────────────────────────────────────────────────────
const oneSpec = view([lib[0], lib[2]], null, specOf);
ok(strip(oneSpec, true) === "", "no specialty axis below two specialties — a filter that cannot change the view");
ok(strip(oneSpec, false) === "", "…closed as well as open");

const closed = strip(all, false), open = strip(all, true);
ok(/id="mobileLibSpecToggle"/.test(closed), "the axis is offered when there is more than one specialty");
ok(!/class="mobileLibSpecBtn" data-spec="Nephrology"/.test(closed),
   "closed: the specialty list is NOT rendered — it is a disclosure, default view stays most-recent");
ok(/class="mobileLibSpecBtn" data-spec="Nephrology"/.test(open), "open: the specialty list is revealed");
ok(/aria-expanded="false"/.test(closed) && /aria-expanded="true"/.test(open),
   "the toggle reports its expanded state to assistive tech");
ok(/overflow-x:auto/.test(open), "the revealed specialty list scrolls horizontally");
ok((open.match(/class="mobileLibSpecBtn"/g) || []).length === 4,
   "open strip offers All plus each of the three specialties");
ok(/data-spec="" style="[^"]*">All <span[^>]*>4</.test(open), "the All chip carries the lecture total");
ok(!/Clear</.test(closed), "no Clear affordance when nothing is filtered");
ok(/Clear</.test(strip(neph, false)), "Clear appears once a specialty is active");
ok(!/min-height:4[0-3]px/.test(open) && (open.match(/min-height:44px/g) || []).length >= 4,
   "every control in the axis meets the 44px touch target");

// ── the disclosure does not persist ─────────────────────────────────────────────────────────────────
const closeCtx = {
  S: { mobileLibOpen: true, mobileLibSpecOpen: true },
  render(){}, setTimeout(fn){ fn(); },
  document: { getElementById(){ return null; } },
};
vm.createContext(closeCtx);
vm.runInContext(`${functionSource("closeMobileLibraryDrawer")}; this.close = closeMobileLibraryDrawer;`, closeCtx);
closeCtx.close();
ok(closeCtx.S.mobileLibSpecOpen === false,
   "closing the drawer collapses the specialty strip — it is a disclosure, not a saved preference");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ LIBRARY FILTER OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
