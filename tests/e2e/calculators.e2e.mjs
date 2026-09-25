// The plate calculator on a set, and a lift's warm-up sets (RAJ-37): Settings' bar and plates, what the
// plates button shows including leftovers and a weight under the bar, and that warm-up sets never tick off
// a lift, show a PR badge or set a false record, however heavy they are next to a working set.
import { flat, liftEl, open, openTab, ready, session, until } from "./harness.mjs";

export default async function calculators({ browser, base, check }) {
  const db = {
    logs: {
      // Last week's Leg Extension: a record to beat (27 kg), so a much heavier warm-up must never look like one.
      "2026-09-16": {
        exercises: { "Leg Extension": { done: true, kg: 27, sets: [{ reps: 10, kg: 27 }, { reps: 10, kg: 27 }, { reps: 10, kg: 27 }] } },
        warmup: [],
        cardio: false,
        steps: 8000,
        weight: null,
        note: "",
      },
      "2026-09-23": { exercises: {}, warmup: [], cardio: false, steps: 8000, weight: null, note: "" },
    },
    plan: null,
  };
  const { ctx, page } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000060"), db });
  await ready(page);
  check("today is Wednesday, Legs", (await page.locator("#session h2").textContent()) === "Legs");

  // ---------- Settings: bar weight and plates, defaulted, sanitized, saved with the rest of Training ----------
  await openTab(page, "settings");
  check(
    "bar weight and plates default to a 20 kg bar and a standard plate set",
    (await page.locator("#barKg").inputValue()) === "20" && (await page.locator("#plateKgs").inputValue()) === "25, 20, 15, 10, 5, 2.5, 1.25",
  );
  check("says what they're for", /plates button.*warm-up/.test(await flat(page.locator("#gearMsg"))), await flat(page.locator("#gearMsg")));
  const barBox = await page.locator("#barKg").boundingBox(), plateBox = await page.locator("#plateKgs").boundingBox();
  check("bar weight and plates fields are at least 44px tall", barBox.height >= 44 && plateBox.height >= 44, `${Math.round(barBox.height)}px, ${Math.round(plateBox.height)}px`);
  await page.fill("#plateKgs", "20, 10, not-a-number, 5, 20");
  await until(() => db.plan?.plateKgs != null);
  check("typed plates are sanitised: junk dropped, no duplicates, heaviest first", JSON.stringify(db.plan.plateKgs) === JSON.stringify([20, 10, 5]), JSON.stringify(db.plan?.plateKgs));
  await page.fill("#barKg", "15");
  await until(() => db.plan?.barKg === 15);
  check("bar weight saved with the plan, like the rest of Training", db.plan.barKg === 15);

  // ---------- the plates button: what can be loaded on the bar and plates just set, and what's left over ----------
  await openTab(page, "today");
  const curl = liftEl(page, "Hamstring Curl");
  const kgBox = curl.locator('input[data-set$=":0:kg"]');
  const platesBtn = curl.locator(".set").first().locator(".plates-btn");
  check("plates button is disabled until a weight is typed", await platesBtn.isDisabled());
  await kgBox.fill("100");
  check(
    "plates button enables once a weight is typed, and is named for the lift and set",
    !(await platesBtn.isDisabled()) && (await platesBtn.getAttribute("aria-label")) === "Plates for Hamstring Curl, set 1",
    await platesBtn.getAttribute("aria-label"),
  );
  const pbox = await platesBtn.boundingBox();
  check("plates button meets the 44px touch target", pbox.width >= 44 && pbox.height >= 44, `${Math.round(pbox.width)}x${Math.round(pbox.height)}`);
  await platesBtn.click();
  check("plates button marks itself open", (await platesBtn.getAttribute("aria-expanded")) === "true");
  let info = await flat(curl.locator(".plates-info"));
  check("100 kg on today's 15 kg bar and 20/10/5 plates: what's left over shows too", info === "20 kg × 2 per side, 15 kg bar: 95 kg. 5 kg left over.", info);
  await kgBox.fill("55");
  info = await flat(curl.locator(".plates-info"));
  check("55 kg loads exactly: no leftover sentence", info === "20 kg per side, 15 kg bar: 55 kg.", info);
  await kgBox.fill("10");
  info = await flat(curl.locator(".plates-info"));
  check("a weight under the bar says so instead of a plate breakdown", info === "The bar alone is 15 kg, more than 10 kg.", info);
  await platesBtn.click();
  check("plates button closes again, taking its breakdown with it", (await platesBtn.getAttribute("aria-expanded")) === "false" && (await curl.locator(".plates-info").count()) === 0);

  // ---------- warm-up sets: 40/60/80% of a working weight, logged apart from the working sets ----------
  const ext = liftEl(page, "Leg Extension");
  const toggle = ext.getByRole("button", { name: "Warm-up sets", exact: true });
  check("warm-up sets starts folded", (await ext.locator(".wset-panel").count()) === 0 && (await toggle.getAttribute("aria-expanded")) === "false");
  const tbox = await toggle.boundingBox();
  check("warm-up sets toggle is at least 44px tall", tbox.height >= 44, `${Math.round(tbox.height)}px`);
  await toggle.click();
  const kgInput = ext.locator(".wset-panel input");
  check("suggests last time's top set as the working weight", (await kgInput.inputValue()) === "27");
  await kgInput.fill("100");
  const ladderText = await flat(ext.locator(".wset-ladder"));
  check(
    "ladder is 40/60/80% of it, fewer reps as it climbs, rounded to the nearest 2.5 kg",
    ["40%", "8 × 40 kg", "60%", "5 × 60 kg", "80%", "3 × 80 kg"].every((s) => ladderText.includes(s)),
    ladderText,
  );
  await ext.locator(".wset-panel button", { hasText: "Log warm-up sets" }).click();
  await until(() => db.logs["2026-09-23"]?.exercises?.["Leg Extension"]?.sets?.length === 3);
  let saved = db.logs["2026-09-23"].exercises["Leg Extension"];
  check(
    "warm-up sets save marked apart from working sets, and don't tick the lift off",
    JSON.stringify(saved.sets) === JSON.stringify([{ reps: 8, kg: 40, type: "warmup" }, { reps: 5, kg: 60, type: "warmup" }, { reps: 3, kg: 80, type: "warmup" }]) && !saved.done,
    JSON.stringify(saved),
  );
  check(
    "on screen, the lift's 3 working set rows are still empty and unticked, whatever the warm-ups logged",
    (await ext.locator(".set").count()) === 3 && (await ext.locator(".set.logged").count()) === 0 && !(await ext.locator('input[type="checkbox"]').isChecked()),
  );
  check(
    "a summary of what was logged, and a way to remove it",
    (await flat(ext.locator(".wset-done span"))) === "3 warm-up sets logged: 8 × 40 kg, 5 × 60 kg, 3 × 80 kg.",
    await flat(ext.locator(".wset-done span")),
  );
  const removeBtn = ext.locator(".wset-done button", { hasText: "Remove warm-up sets" });
  const rbox = await removeBtn.boundingBox();
  check("Remove warm-up sets button is at least 44px tall", rbox.height >= 44, `${Math.round(rbox.height)}px`);

  // Now the real working sets, each lighter than the warm-ups and than last time's 27 kg: no record either way.
  for (let j = 0; j < 3; j++) {
    await ext.locator(`input[data-set$=":${j}:reps"]`).fill("10");
    await ext.locator(`input[data-set$=":${j}:kg"]`).fill("20");
  }
  await until(() => db.logs["2026-09-23"]?.exercises?.["Leg Extension"]?.sets?.length === 6);
  saved = db.logs["2026-09-23"].exercises["Leg Extension"];
  check(
    "the planned 3 working sets tick the lift off, saved after the warm-ups in the same array",
    saved.done === true &&
      JSON.stringify(saved.sets) ===
        JSON.stringify([
          { reps: 8, kg: 40, type: "warmup" },
          { reps: 5, kg: 60, type: "warmup" },
          { reps: 3, kg: 80, type: "warmup" },
          { reps: 10, kg: 20 },
          { reps: 10, kg: 20 },
          { reps: 10, kg: 20 },
        ]),
    JSON.stringify(saved),
  );
  check("no working set shows a PR badge, even though the warm-ups were far heavier", (await ext.locator(".set.pr").count()) === 0);

  // Nor does Progress: the heavier warm-ups never reach the records list.
  await openTab(page, "progress");
  const recordNames = await page.locator('#dashStrength h3.dh:has-text("Records in the last 30 days") + ul.plain > li b').allTextContents();
  check("Progress: no false record for Leg Extension from the heavier warm-up sets", !recordNames.includes("Leg Extension"), recordNames.join(", ") || "(none)");

  // Removing the warm-ups leaves the working sets, and the tick they gave, untouched. Tabs keep their view
  // mounted underneath, so the panel may still be open from before; open it only if it isn't.
  await openTab(page, "today");
  const ext2 = liftEl(page, "Leg Extension"), toggle2 = ext2.getByRole("button", { name: "Warm-up sets", exact: true });
  if ((await toggle2.getAttribute("aria-expanded")) !== "true") await toggle2.click();
  await ext2.locator(".wset-done button", { hasText: "Remove warm-up sets" }).click();
  await until(() => db.logs["2026-09-23"]?.exercises?.["Leg Extension"]?.sets?.length === 3);
  saved = db.logs["2026-09-23"].exercises["Leg Extension"];
  check(
    "removing warm-up sets leaves only the working sets, and keeps the tick they gave",
    JSON.stringify(saved.sets) === JSON.stringify([{ reps: 10, kg: 20 }, { reps: 10, kg: 20 }, { reps: 10, kg: 20 }]) && saved.done === true,
    JSON.stringify(saved),
  );
  check("the warm-up summary is gone", (await ext2.locator(".wset-done").count()) === 0);

  check("only logs/plans endpoints were called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors or warnings", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
