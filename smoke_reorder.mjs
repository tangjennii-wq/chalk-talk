// Headless smoke test: reorder mode renders, arrows move sections, Done exits.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", e => console.log("PAGEERROR:", e.message));
await page.goto("file://" + process.cwd() + "/index.html", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const result = await page.evaluate(() => {
  const out = { errors: [] };
  try {
    S.talk = {
      title: "Test Talk",
      sections: [
        { heading: "Alpha", points: ["a1 [1]", "a2"], teaching_pearl: "", board_tip: "" },
        { heading: "Bravo", points: ["b1"], teaching_pearl: "", board_tip: "" },
        { heading: "Charlie", points: ["c1"], teaching_pearl: "", board_tip: "" }
      ],
      summary_points: ["s1"],
      references: [{ id: 1, source: "Ref One", year: 2024, society: "ACC", type: "guideline" }]
    };
    S.style = "lecture"; S.loading = false;
    render();
    out.btnExists = !!document.getElementById("reorderModeBtn");
    if (!out.btnExists) return out;
    document.getElementById("reorderModeBtn").click();
    out.inReorderMode = S.reorderMode === true;
    out.rowCount = document.querySelectorAll(".secMoveDownBtn").length;
    // move "Alpha" (index 0) down
    document.querySelectorAll(".secMoveDownBtn")[0].click();
    out.orderAfterDown = S.talk.sections.map(s => s.heading).join(",");
    // first row's up-arrow should now move Bravo... move index 1 (Alpha) up -> back to original
    document.querySelectorAll(".secMoveUpBtn")[1].click();
    out.orderAfterUp = S.talk.sections.map(s => s.heading).join(",");
    // top row's ↑ and bottom row's ↓ disabled
    out.topUpDisabled = document.querySelectorAll(".secMoveUpBtn")[0].disabled;
    out.botDownDisabled = [...document.querySelectorAll(".secMoveDownBtn")].pop().disabled;
    // undo history recorded
    out.historyLen = S.talkHistory.length;
    // exit
    document.getElementById("reorderModeBtn").click();
    out.exited = S.reorderMode === false;
    out.editBtnBack = document.querySelectorAll(".secEditBtn").length > 0;
    out.unsaved = S.talkIsSaved === false;
  } catch (e) { out.errors.push(String(e && e.message)); }
  return out;
});

console.log(JSON.stringify(result, null, 2));
const ok = result.btnExists && result.inReorderMode && result.rowCount === 3 &&
  result.orderAfterDown === "Bravo,Alpha,Charlie" && result.orderAfterUp === "Alpha,Bravo,Charlie" &&
  result.topUpDisabled && result.botDownDisabled && result.historyLen >= 2 &&
  result.exited && result.editBtnBack && result.unsaved && result.errors.length === 0;
console.log(ok ? "✔ REORDER SMOKE TEST PASSED" : "✖ SMOKE TEST FAILED");
await browser.close();
process.exit(ok ? 0 : 1);
