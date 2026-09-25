// My gym's weights (RAJ-64): what each bar weighs and what the rest go up by, under My gym → Weights; a lift
// given an EZ bar in the plan editor, whose plates (in a set's menu in the workout) and warm-up sets then use the
// 10 kg bar; and a lift given dumbbells, which takes no plates and goes up by the dumbbells' step, to a weight they make.
import { K, flat, open, openTab, openWorkout, planDone, ready, savedPlan, session, shot, until, TAB_VIEWS } from "./harness.mjs";

export default async function weights({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000064", "2026-08-26T05:00:00Z", "t@example.com");
  // Legs on Wednesdays, with a barbell curl and a goblet squat added; last week's goblet squat topped out at 22 kg.
  const plan = savedPlan(), blank = { sets: "3", reps: "10-12", cue: "", flag: "", step: "", knee: false };
  plan.days[2].exercises.push({ name: "Barbell Curl", ...blank }, { name: "Goblet Squat", ...blank });
  const topped = { done: true, kg: 22, sets: [12, 12, 12].map((reps) => ({ reps, kg: 22 })) };
  const db = { logs: { [K(21)]: { exercises: { "Goblet Squat": topped }, warmup: [], cardio: false, steps: 6000, weight: null, note: "" } }, plan };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);
  const lifts = () => db.plan?.days?.[2]?.exercises ?? [];
  const value = (id) => page.locator(id).inputValue();

  // --- My gym → Weights
  await openTab(page, "settings");
  await page.click("#gymBtn");
  await page.waitForSelector("#gymView");
  const ids = ["#barKg", "#bar_ezbar", "#bar_trapbar", "#bar_smith", "#step_dumbbell", "#step_kettlebell", "#step_machine", "#step_cable", "#step_band"];
  const shown = [];
  for (const id of ids) shown.push(await value(id));
  check("each bar and step starts at its usual weight", JSON.stringify(shown) === '["20","10","20","0","2","4","2.5","2.5","5"]', JSON.stringify(shown));
  check("with the gym's plates", (await value("#plateKgs")) === "25, 20, 15, 10, 5, 2.5, 1.25");
  await page.locator("#gymWeights").scrollIntoViewIfNeeded();
  await shot(page, "gym-weights");
  await page.fill("#step_dumbbell", "0");
  check("a step out of range says so, and isn't saved", (await flat(page.locator("#step_dumbbellErr"))) === "From 0.25 to 20" && db.plan?.weights === undefined, await flat(page.locator("#step_dumbbellErr")));
  await page.fill("#step_dumbbell", "2");
  await until(() => db.plan?.weights != null);
  check("one in range saves them all with the plan", JSON.stringify(db.plan?.weights) === '{"ezbar":10,"trapbar":20,"smith":0,"dumbbell":2,"kettlebell":4,"machine":2.5,"cable":2.5,"band":5}', JSON.stringify(db.plan?.weights));
  await page.click("#gymDone");
  await page.waitForSelector("#settingsView");

  // --- the plan editor: what each lift is loaded with, as the library says until another is picked
  await page.click("#planBtn");
  const picked = (j) => page.$eval(`#pe_x${j}_load`, (s) => s.selectedOptions[0].textContent);
  const stepHint = (j) => page.locator(`#pe_x${j}_step`).getAttribute("placeholder");
  check("the plan editor has the day's two new lifts", (await page.locator("#pe_x5_name").inputValue()) === "Barbell Curl" && (await page.locator("#pe_x6_name").inputValue()) === "Goblet Squat");
  check("a barbell curl is on a barbell, as the library says, going up 2.5 kg", (await picked(5)) === "Barbell (library)" && (await stepHint(5)) === "2.5", `${await picked(5)}, ${await stepHint(5)}`);
  check("a goblet squat is a kettlebell's, going up 4 kg", (await picked(6)) === "Kettlebell (library)" && (await stepHint(6)) === "4", `${await picked(6)}, ${await stepHint(6)}`);
  await page.selectOption("#pe_x5_load", "ezbar");
  await page.selectOption("#pe_x6_load", "dumbbell");
  await until(() => lifts()[5]?.load === "ezbar" && lifts()[6]?.load === "dumbbell");
  check("a pick saves with the lift", lifts()[5]?.load === "ezbar" && lifts()[6]?.load === "dumbbell", JSON.stringify(lifts().slice(5)));
  check("and its step follows", (await stepHint(6)) === "2");
  // Every choice reads whole in the box, "Resistance band (library)" the longest there is.
  const cut = await page.$eval("#pe_x5_load", (s) => {
    const cs = getComputedStyle(s), c = document.createElement("canvas").getContext("2d");
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const room = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return ["Resistance band (library)", ...[...s.options].map((o) => o.textContent)].filter((t) => c.measureText(t).width > room).map((t) => `${t} (${Math.ceil(c.measureText(t).width)}px in ${room}px)`);
  });
  check("Loaded with shows each choice whole", cut.length === 0, cut.join(", "));
  await page.locator("#pe_x6_load").scrollIntoViewIfNeeded();
  await shot(page, "weights-plan");
  await planDone(page);

  // --- the workout: the barbell curl on its EZ bar. Its plates are in the set's menu (its number).
  await page.click("#backBtn");
  await page.waitForSelector(TAB_VIEWS); // Settings closes onto the tab it was opened from
  await openWorkout(page, "Barbell Curl");
  const card = page.locator("#workoutView section.ex-card");
  const plates = async () => {
    await card.locator(".srow.set .sn").first().click();
    const t = await flat(card.locator(".plates-info"));
    await card.locator(".srow.set .sn").first().click();
    return t;
  };
  await card.locator('input[data-set$=":0:kg"]').fill("30");
  let info = await plates();
  check("its plates go on the 10 kg EZ bar", info === "10 kg per side, 10 kg bar: 30 kg.", info);
  await card.getByRole("button", { name: "Warm-up sets", exact: true }).click();
  await card.locator(".wset-panel input").fill("30");
  let ladder = await flat(card.locator(".wset-ladder"));
  check("and so do its warm-up sets: 40, 60 and 80% on the EZ bar", ["8 × 12.5 kg", "5 × 17.5 kg", "3 × 25 kg"].every((s) => ladder.includes(s)), ladder);
  await shot(page, "weights-ez-bar");

  // --- the goblet squat, next, with dumbbells
  await page.click("#nextEx");
  await page.locator("#workoutView .ex-name .nm", { hasText: "Goblet Squat" }).waitFor();
  const hint = await flat(card.locator(".prog"));
  check("it goes up by the dumbbells' 2 kg", /^Go up to 24 kg: every set hit 12 reps last time/.test(hint), hint);
  check("as the placeholder says", (await card.locator('input[data-set$=":0:kg"]').getAttribute("placeholder")) === "24");
  await card.getByRole("button", { name: "Warm-up sets", exact: true }).click();
  ladder = await flat(card.locator(".wset-ladder"));
  check("its warm-up sets are dumbbells there are", (await card.locator(".wset-panel input").inputValue()) === "24" && ["8 × 10 kg", "5 × 14 kg", "3 × 20 kg"].every((s) => ladder.includes(s)), ladder);
  // A set with its weight typed: its menu has no plates for dumbbells (the barbell curl's had).
  await card.locator('input[data-set$=":0:kg"]').fill("24");
  await card.locator(".srow.set .sn").first().click();
  await card.locator(".setmenu").waitFor();
  check("dumbbells take no plates", (await card.locator(".plates-info").count()) === 0);
  await card.locator(".srow.set .sn").first().click();
  await card.locator('input[data-set$=":0:kg"]').fill("");
  await until(() => db.logs[K(28)]?.exercises?.["Goblet Squat"]?.sets?.[0]?.kg == null);

  // --- change the weights, and each lift follows
  await page.click("#closeWorkout");
  await openTab(page, "settings");
  await page.click("#gymBtn");
  await page.waitForSelector("#gymView");
  await page.fill("#bar_ezbar", "7.5");
  await page.fill("#step_dumbbell", "1");
  await until(() => db.plan?.weights?.ezbar === 7.5 && db.plan?.weights?.dumbbell === 1);
  await page.click("#gymDone");
  await page.waitForSelector("#settingsView");
  await page.click("#backBtn");
  await page.waitForSelector(TAB_VIEWS); // Settings closes onto the tab it was opened from
  await openWorkout(page, "Barbell Curl");
  info = await plates();
  check("a lighter EZ bar takes more plates", info === "10 kg, 1.25 kg per side, 7.5 kg bar: 30 kg.", info);
  await page.click("#nextEx");
  await page.locator("#workoutView .ex-name .nm", { hasText: "Goblet Squat" }).waitFor();
  check("smaller dumbbell steps go up less", /^Go up to 23 kg/.test(await flat(card.locator(".prog"))), await flat(card.locator(".prog")));

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
