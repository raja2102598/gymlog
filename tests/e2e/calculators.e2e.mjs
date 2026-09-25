// The plate calculator on a set, and a lift's warm-up sets (RAJ-37): My gym's bar and plates, what a set's menu
// (tap its number) shows for plates, including leftovers and a weight under the bar, and that warm-up sets never
// tick off a lift, show a PR badge or set a false record, however heavy they are next to a working set.
import { flat, open, openTab, openWorkout, ready, savedPlan, session, until } from "./harness.mjs";

// Legs, in the plan's order, with the barbell squat added at the end: the workout's steps, and the index its set
// boxes use (s<i>_<set>_k).
const LEGS = ["Hack Squat", "Leg Press", "Leg Extension", "Hamstring Curl", "Calf Raise", "Barbell Squat"];

export default async function calculators({ browser, base, check }) {
  // Legs, with a barbell squat added for the barbell's plates: the default plan's Legs are all machines.
  const plan = savedPlan();
  plan.days[2].exercises.push({ name: "Barbell Squat", sets: "3", reps: "5", cue: "", flag: "", step: "", knee: false });
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
    plan,
  };
  const { ctx, page } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000060"), db });
  await ready(page);
  check("today is Wednesday, Legs", (await flat(page.locator("#todayName"))) === "Legs");
  const card = page.locator("#workoutView section.ex-card");
  /** Shows a lift in the workout, by its step along the top. */
  const at = async (name) => {
    await page.locator("ol.wprog li button").nth(LEGS.indexOf(name)).click();
    await until(async () => (await flat(page.locator("#workoutView .ex-name .nm"))) === name);
  };

  // ---------- My gym: bar weight and plates, defaulted, sanitized, saved with the plan ----------
  await openTab(page, "train");
  await page.click("#gymTile");
  await page.waitForSelector("#gymView");
  check(
    "bar weight and plates default to a 20 kg bar and a standard plate set",
    (await page.locator("#barKg").inputValue()) === "20" && (await page.locator("#plateKgs").inputValue()) === "25, 20, 15, 10, 5, 2.5, 1.25",
  );
  check("says what they're for", /plates.*warm-up/.test(await flat(page.locator("#gearMsg"))), await flat(page.locator("#gearMsg")));
  const barBox = await page.locator("#barKg").boundingBox(), plateBox = await page.locator("#plateKgs").boundingBox();
  check("bar weight and plates fields are at least 44px tall", barBox.height >= 44 && plateBox.height >= 44, `${Math.round(barBox.height)}px, ${Math.round(plateBox.height)}px`);
  await page.fill("#plateKgs", "20, 10, not-a-number, 5, 20");
  await until(() => db.plan?.plateKgs != null);
  check("typed plates are sanitised: junk dropped, no duplicates, heaviest first", JSON.stringify(db.plan.plateKgs) === JSON.stringify([20, 10, 5]), JSON.stringify(db.plan?.plateKgs));
  await page.fill("#barKg", "15");
  await until(() => db.plan?.barKg === 15);
  check("bar weight saved with the plan", db.plan.barKg === 15);
  await page.click("#gymDone");
  await page.waitForSelector("#trainView");

  // ---------- a set's plates: what can be loaded on the bar and plates just set, and what's left over ----------
  await openWorkout(page, "Barbell Squat");
  const kgBox = page.locator("#s5_0_k");
  const sn = card.locator(".srow.set .sn").first(), plates = page.locator("#pl5_0");
  await sn.click();
  check("with no weight typed, the set's menu has no plates line", (await card.locator(".setmenu").count()) === 1 && (await plates.count()) === 0);
  await kgBox.fill("100");
  check(
    "once a weight is typed, the menu shows its plates; the number that opens it is named for the lift and set",
    (await plates.count()) === 1 && /^Barbell Squat, set 1\b/.test(await sn.getAttribute("aria-label")),
    await sn.getAttribute("aria-label"),
  );
  const pbox = await sn.boundingBox();
  check("the set's number is a 44px-tall touch target", pbox.height >= 44 && pbox.width >= 24, `${Math.round(pbox.width)}x${Math.round(pbox.height)}`);
  check("the set's number marks its menu open", (await sn.getAttribute("aria-expanded")) === "true");
  let info = await flat(plates);
  check("100 kg on today's 15 kg bar and 20/10/5 plates: what's left over shows too", info === "20 kg × 2 per side, 15 kg bar: 95 kg. 5 kg left over.", info);
  await kgBox.fill("55");
  info = await flat(plates);
  check("55 kg loads exactly: no leftover sentence", info === "20 kg per side, 15 kg bar: 55 kg.", info);
  await kgBox.fill("10");
  info = await flat(plates);
  check("a weight under the bar says so instead of a plate breakdown", info === "The bar alone is 15 kg, more than 10 kg.", info);
  await sn.click();
  check("tapping the number again closes the menu, taking its plates with it", (await sn.getAttribute("aria-expanded")) === "false" && (await plates.count()) === 0);
  // A machine takes plates with no bar.
  await at("Hamstring Curl");
  await page.fill("#s3_0_k", "100");
  await card.locator(".srow.set .sn").first().click();
  info = await flat(page.locator("#pl3_0"));
  check("a machine's plates name no bar", info === "20 kg × 2, 10 kg per side: 100 kg.", info);

  // ---------- warm-up sets: 40/60/80% of a working weight, logged apart from the working sets ----------
  await at("Leg Extension");
  const toggle = card.getByRole("button", { name: "Warm-up sets", exact: true });
  check("warm-up sets starts folded", (await card.locator(".wset-panel").count()) === 0 && (await toggle.getAttribute("aria-expanded")) === "false");
  const tbox = await toggle.boundingBox();
  check("warm-up sets toggle is at least 44px tall", tbox.height >= 44, `${Math.round(tbox.height)}px`);
  await toggle.click();
  const kgInput = card.locator(".wset-panel input");
  check("suggests last time's top set as the working weight", (await kgInput.inputValue()) === "27");
  await kgInput.fill("100");
  const ladderText = await flat(card.locator(".wset-ladder"));
  check(
    "ladder is 40/60/80% of it, fewer reps as it climbs, rounded to the nearest 2.5 kg",
    ["40%", "8 × 40 kg", "60%", "5 × 60 kg", "80%", "3 × 80 kg"].every((s) => ladderText.includes(s)),
    ladderText,
  );
  await card.locator(".wset-panel button", { hasText: "Log warm-up sets" }).click();
  await until(() => db.logs["2026-09-23"]?.exercises?.["Leg Extension"]?.sets?.length === 3);
  let saved = db.logs["2026-09-23"].exercises["Leg Extension"];
  check(
    "warm-up sets save marked apart from working sets, and don't tick the lift off",
    JSON.stringify(saved.sets) === JSON.stringify([{ reps: 8, kg: 40, type: "warmup" }, { reps: 5, kg: 60, type: "warmup" }, { reps: 3, kg: 80, type: "warmup" }]) && !saved.done,
    JSON.stringify(saved),
  );
  check(
    "on screen, the lift's 3 working set rows are still empty and the lift isn't done",
    (await card.locator(".srow.set").count()) === 3 && (await card.locator(".srow.set.logged").count()) === 0 && !(await card.evaluate((c) => c.classList.contains("checked"))) && (await flat(page.locator("#completeSet"))) === "Complete set 1",
  );
  check(
    "a summary of what was logged, and a way to remove it",
    (await flat(card.locator(".wset-done span"))) === "3 warm-up sets logged: 8 × 40 kg, 5 × 60 kg, 3 × 80 kg.",
    await flat(card.locator(".wset-done span")),
  );
  const removeBtn = card.locator(".wset-done button", { hasText: "Remove warm-up sets" });
  const rbox = await removeBtn.boundingBox();
  check("Remove warm-up sets button is at least 44px tall", rbox.height >= 44, `${Math.round(rbox.height)}px`);

  // Now the real working sets, each lighter than the warm-ups and than last time's 27 kg: no record either way.
  for (let j = 0; j < 3; j++) {
    await page.fill(`#s2_${j}_r`, "10");
    await page.fill(`#s2_${j}_k`, "20");
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
  check("no working set shows a PR badge, even though the warm-ups were far heavier", (await card.locator(".srow.set.pr").count()) === 0);

  // Nor does Progress: the heavier warm-ups never reach the records list (Strength).
  await page.click("#closeWorkout");
  await page.waitForSelector("#trainView");
  await openTab(page, "progress");
  await page.click('#progTabs button[data-seg="strength"]');
  await page.waitForSelector("#dashStrength");
  const recordNames = await page.locator('#dashStrength h3.dh:has-text("Records in the last 30 days") + ul.plain > li b').allTextContents();
  check("Progress: no false record for Leg Extension from the heavier warm-up sets", !recordNames.includes("Leg Extension"), recordNames.join(", ") || "(none)");

  // Removing the warm-ups leaves the working sets, and the tick they gave, untouched. The workout mounts afresh, so
  // the panel starts folded again; open it only if it isn't.
  await openWorkout(page, "Leg Extension");
  const toggle2 = card.getByRole("button", { name: "Warm-up sets", exact: true });
  if ((await toggle2.getAttribute("aria-expanded")) !== "true") await toggle2.click();
  await card.locator(".wset-done button", { hasText: "Remove warm-up sets" }).click();
  await until(() => db.logs["2026-09-23"]?.exercises?.["Leg Extension"]?.sets?.length === 3);
  saved = db.logs["2026-09-23"].exercises["Leg Extension"];
  check(
    "removing warm-up sets leaves only the working sets, and keeps the tick they gave",
    JSON.stringify(saved.sets) === JSON.stringify([{ reps: 10, kg: 20 }, { reps: 10, kg: 20 }, { reps: 10, kg: 20 }]) && saved.done === true,
    JSON.stringify(saved),
  );
  check("the warm-up summary is gone", (await card.locator(".wset-done").count()) === 0);

  check("only logs/plans endpoints were called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors or warnings", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
