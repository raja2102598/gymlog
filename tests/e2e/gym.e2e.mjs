// My gym, and what it changes (RAJ-63, RAJ-64, RAJ-37): the equipment it has and the lifts it offers, what each bar
// weighs and the rest go up by, and, in the workout, a set's plates and a lift's warm-up sets on that equipment. What the
// numbers come to (plates, rounding, the warm-up ladder) is in tests/unit/gym.test.ts and stats.test.ts; here, that the
// screens show and save them.
import { K, TAB_VIEWS, flat, open, openTab, openWorkout, planDone, ready, savedPlan, session, shot, until, onDefaultPlan } from "./harness.mjs";

// Legs, in the plan's order, with the barbell squat added at the end: the workout's steps, and the index its set
// boxes use (s<i>_<set>_k).
const LEGS = ["Hack Squat", "Leg Press", "Leg Extension", "Hamstring Curl", "Calf Raise", "Barbell Squat"];

export default async function gym(t) {
  await equipment(t);
  await weights(t);
  await platesAndWarmUps(t);
}

// My gym (RAJ-63): Settings → My gym turns equipment on and off, and lists lifts always or never offered; the
// library, a swap's suggestions and its library then leave out what the gym can't do, and the plan editor keeps a
// plan lift that needs what isn't there, saying so.
async function equipment({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000063", "2026-08-26T05:00:00Z", "t@example.com");
  const db = onDefaultPlan();
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);
  const legs = () => db.plan?.days?.[2]?.exercises ?? [];
  const rows = async () => (await page.locator("#libList .lib-n").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const switchOn = (e) => page.locator(`[data-equip="${e}"]`).getAttribute("aria-checked");
  // The library's My gym chip: pressed while it offers only what the gym can do.
  const gymChip = async () => (await page.locator("#libGym").getAttribute("aria-pressed")) === "true";

  // --- Settings → My gym
  await openTab(page, "settings");
  check("Settings says the gym has everything to begin with", (await flat(page.locator("#gymBtn .row-v"))) === "Every lift", await flat(page.locator("#gymBtn .row-v")));
  await page.click("#gymBtn");
  await page.waitForSelector("#gymView");
  check("My gym opens as a page of its own", (await flat(page.locator("#screenTitle"))) === "My gym" && (await page.locator("nav.tabbar").count()) === 0);
  check("everything is on, and every lift offered", (await switchOn("barbell")) === "true" && (await flat(page.locator("#gymCount"))) === "The library offers all 657 of its lifts.");
  check("each piece of equipment says how many lifts use it", /^\d+ lifts use it$/.test(await flat(page.locator("#gq_barbellD"))), await flat(page.locator("#gq_barbellD")));
  await page.click('[data-equip="barbell"]');
  await until(() => JSON.stringify(db.plan?.gym?.off) === '["barbell"]');
  check("turning the barbell off saves with the plan", JSON.stringify(db.plan?.gym) === '{"off":["barbell"],"always":[],"never":[]}', JSON.stringify(db.plan?.gym));
  check("and the library offers fewer lifts", (await switchOn("barbell")) === "false" && (await flat(page.locator("#gymCount"))) === "The library offers 490 of its 657 lifts.", await flat(page.locator("#gymCount")));
  // The switch's thumb slides and grows by transform alone (no layout each frame): off, a 24px circle scaled to 16px.
  const thumb = (e) =>
    page.$eval(`[data-equip="${e}"] .switch`, (el) => {
      const a = getComputedStyle(el, "::after");
      return { moves: a.transitionProperty, transform: a.transform };
    });
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  const off = await thumb("barbell"), on = await thumb("dumbbell");
  check("a switch's thumb moves by transform, not by its position and size", /transform/.test(off.moves) && !/left|top|width|height/.test(off.moves), off.moves);
  check("off, it's shrunk in place; on, slid across at full size", /^matrix\(0\.66\d*, 0, 0, 0\.66\d*, 0, 0\)$/.test(off.transform) && on.transform === "matrix(1, 0, 0, 1, 20, 0)", `${off.transform} | ${on.transform}`);

  // Always and never: picked from every lift, whatever the gym has.
  await page.click('[data-gymadd="always"]');
  check("Add… shows every lift, with no Create", (await flat(page.locator("#libTitle"))) === "Always offer" && !(await gymChip()) && (await page.locator("#libCreate").count()) === 0);
  await page.fill("#libSearch", "barbell curl");
  const tag = page.locator("#libList .lib-row", { has: page.locator('[data-lib="Barbell_Curl"]') }).locator(".pill");
  check("a lift the gym can't do says so", (await flat(tag)) === "Not in my gym");
  await page.click('[data-lib="Barbell_Curl"]');
  await page.click("#libAdd");
  await until(() => db.plan?.gym?.always?.length === 1);
  await page.click('[data-gymadd="never"]');
  await page.fill("#libSearch", "pushups");
  await page.click('[data-lib="Pushups"]');
  await page.click("#libAdd");
  await until(() => db.plan?.gym?.never?.length === 1);
  check("the lists save with the plan", JSON.stringify(db.plan?.gym) === '{"off":["barbell"],"always":["Barbell_Curl"],"never":["Pushups"]}', JSON.stringify(db.plan?.gym));
  const listed = async (list) => (await page.locator(`#gym_${list} .gym-lifts li`).allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  check("and show their lifts", JSON.stringify([await listed("always"), await listed("never")]) === '[["Barbell Curl Barbell"],["Pushups Bodyweight"]]', JSON.stringify([await listed("always"), await listed("never")]));
  check("each count follows: one in, one out", (await flat(page.locator("#gymCount"))) === "The library offers 490 of its 657 lifts.");
  await shot(page, "gym");
  await page.click("#gymNone");
  await until(() => db.plan?.gym?.off?.length === 17);
  check("Clear all leaves lifts needing nothing, and the always list", (await flat(page.locator("#gymCount"))) === "The library offers 68 of its 657 lifts." && (await switchOn("dumbbell")) === "false", await flat(page.locator("#gymCount")));
  await page.click("#gymAll");
  await until(() => db.plan?.gym?.off?.length === 0);
  check("Select all brings everything back but the never list", (await flat(page.locator("#gymCount"))) === "The library offers 656 of its 657 lifts.");
  await page.click('[data-equip="barbell"]');
  await until(() => db.plan?.gym?.off?.length === 1);
  await page.click("#gymDone");
  await page.waitForSelector("#settingsView");
  check("Done goes back to Settings, which says what's offered", (await flat(page.locator("#gymBtn .row-v"))) === "490 of 657 lifts", await flat(page.locator("#gymBtn .row-v")));

  // --- the library in the plan editor
  await page.click("#planBtn");
  await page.click("#pe_lib");
  check("the library offers what the gym can do, My gym on", (await gymChip()) && /only what fits my gym · 490 lifts$/.test(await flat(page.locator("#libCount"))), await flat(page.locator("#libCount")));
  await page.fill("#libSearch", "barbell");
  const found = await rows();
  check("no barbell lifts but the one always offered", found.includes("Barbell Curl") && !found.includes("Barbell Squat") && !found.includes("Barbell Deadlift"), found.join(" | "));
  await page.fill("#libSearch", "barbell squat");
  const more = /^Nothing your gym can do matches: turn off My gym for (\d+) lifts that need more\.$/.exec(await flat(page.locator("#libList .empty")));
  check("nothing matching says so, and how many more there are", !!more, await flat(page.locator("#libList .empty")));
  await page.click("#libGym");
  const ids = () => page.locator("#libList [data-lib]").evaluateAll((els) => els.map((e) => e.dataset.lib));
  check("with My gym off, they're there", (await ids()).length === +more?.[1] && (await ids()).includes("Barbell_Squat") && (await flat(page.locator("#libCount"))) === `${more?.[1]} lifts of 657`, `${(await ids()).join(" | ")} ${await flat(page.locator("#libCount"))}`);
  check("marked as not in the gym", (await page.locator("#libList .pill.warn").count()) === +more?.[1]);
  await page.click('[data-lib="Barbell_Squat"]');
  await page.click("#libAdd");
  await until(() => legs().length === 6);
  check("and can still be added", legs()[5]?.name === "Barbell Squat");
  check("the plan editor says what it needs that the gym hasn't got", (await flat(page.locator("#pe_x5_gym"))) === "My gym has no barbell.", await flat(page.locator("#pe_x5_gym")));
  check("a lift the gym can do says nothing", (await page.locator("#pe_x0_gym").count()) === 0);
  await page.locator("#planDays .dchip").nth(5).click();
  check("a plan lift stays, flagged", (await page.locator("#pe_x2_name").inputValue()) === "Hip Thrust (machine or barbell)" && (await flat(page.locator("#pe_x2_gym"))) === "My gym has no barbell.");
  await planDone(page);

  // --- a swap in the workout, from the lift's ··· menu
  await page.click("#backBtn");
  await page.waitForSelector(TAB_VIEWS); // Settings closes onto the tab it was opened from
  await openWorkout(page, 1);
  await page.click('[data-more="1"]');
  await page.click('[data-swapopen="1"]');
  const offered = await page.locator("#swapList option").evaluateAll((os) => os.map((o) => o.value));
  // Barbell Squat is in the plan now, so it's offered like the plan's other lifts.
  check(
    "a swap's suggestions leave out barbell lifts",
    !offered.includes("Front Barbell Squat") && !offered.includes("Wide Stance Barbell Squat") && offered.includes("Goblet Squat") && offered.includes("Hack Squat") && offered.includes("Barbell Squat"),
    offered.join(", "),
  );
  await page.click('[data-swaplib="1"]');
  check("and so does its library", (await page.locator('[data-lib="Barbell_Squat"]').count()) === 0 && (await page.locator('[data-lib="Goblet_Squat"]').count()) === 1);
  await page.click("#libClose");

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}

// My gym's weights (RAJ-64): what each bar weighs and what the rest go up by, under My gym → Weights; a lift
// given an EZ bar in the plan editor, whose plates (in a set's menu in the workout) and warm-up sets then use the
// 10 kg bar; and a lift given dumbbells, which takes no plates and goes up by the dumbbells' step, to a weight they make.
async function weights({ browser, base, check }) {
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

// The plate calculator on a set, and a lift's warm-up sets (RAJ-37): My gym's bar and plates, what a set's menu
// (tap its number) shows for plates, including leftovers and a weight under the bar, and that warm-up sets never
// tick off a lift, show a PR badge or set a false record, however heavy they are next to a working set.
async function platesAndWarmUps({ browser, base, check }) {
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
  await kgBox.fill("10");
  info = await flat(plates);
  check("a weight under the bar says so instead of a plate breakdown", info === "The bar alone is 15 kg, more than 10 kg.", info);
  await sn.click();
  check("tapping the number again closes the menu, taking its plates with it", (await sn.getAttribute("aria-expanded")) === "false" && (await plates.count()) === 0);

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
