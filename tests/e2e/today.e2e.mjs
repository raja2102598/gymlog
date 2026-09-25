// Today's training, across Home, Train and the workout: sets, skip and swap, the plan editor, switching a day's
// workout, and history for a new account. Home shows today; Train lists the selected day's lifts, a row each; the
// workout shows one lift at a time, with its set table and its ··· menu (Done, skip, swap, its chart).
import { flat, open, openTab, openWorkout, planDone, ready, session, shot, until } from "./harness.mjs";

export const covers = [
  "src/components/dashboard/LiftDetail.tsx",
  "src/components/health/Bars.tsx",
  "src/components/health/Trend.tsx",
  "src/lib/scale.ts",
];

// Today's real first entry (older format: one weight per lift, no sets).
const firstDay = () => ({
  exercises: { "Hack Squat": { done: true, kg: 0 }, "Leg Press": { done: true, kg: 50 }, "Leg Extension": { done: true, kg: 27 }, "Hamstring Curl": { done: true, kg: 27 }, "Calf Raise": { done: true, kg: 17.5 } },
  warmup: ["Jumping jacks", "Light warm-up sets"],
  cardio: true,
  steps: 7351,
  weight: 81,
  note: "Day 1.",
});

export default async function today({ browser, base, check }) {
  const db = {
    logs: {
      "2026-09-23": firstDay(),
      // Last week's Legs day in the new format, including a swap.
      "2026-09-16": {
        exercises: {
          "Leg Press": { done: true, kg: 45, sets: [{ reps: 10, kg: 45 }, { reps: 10, kg: 45 }, { reps: 8, kg: 45 }] },
          "Hack Squat": { done: true, kg: 20, swap: "Smith Squat", sets: [{ reps: 10, kg: 20 }] },
        },
        warmup: [],
        cardio: false,
        steps: 9000,
        weight: 82,
        note: "",
      },
    },
    plan: null,
  };
  const { ctx, page } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000001"), db });
  await ready(page);

  // The workout's current lift, and its parts.
  const card = page.locator("#workoutView section.ex-card");
  const shown = () => flat(card.locator(".ex-name .nm"));
  /** Shows the workout's step `n` (0-based), and waits for the lift named. */
  const goStep = async (n, name) => {
    await page.locator("ol.wprog li button").nth(n).click();
    await until(async () => (await shown()) === name);
  };
  const closeWorkout = async () => {
    await page.click("#closeWorkout");
    await page.waitForSelector("#trainView");
  };
  const chip = (n) => page.locator("#dayChips .dchip").nth(n);
  const pickDay = async (n) => {
    await chip(n).click();
    await until(async () => (await chip(n).getAttribute("aria-pressed")) === "true");
  };
  const sessName = () => flat(page.locator("#sessName"));
  const row = (name) => page.locator("#liftRows li", { has: page.locator(".lift-t", { hasText: name }) });
  /** A day's lifts done or skipped, by the workout's steps along the top. */
  const stepsDone = () => page.locator("ol.wprog li.done").count();

  check("signed-in app shows Home, with the tab bar", (await page.locator("#homeView").isVisible()) && (await page.locator('nav.tabbar[aria-label="Main"]').isVisible()));
  check("Home: today is Legs", (await flat(page.locator("#todayName"))) === "Legs");
  await openTab(page, "train");
  check("Train: today is Wed · Legs", (await sessName()) === "Legs" && /^Wed 23, Legs\b.*today$/.test(await chip(2).getAttribute("aria-label")) && (await chip(2).getAttribute("aria-pressed")) === "true", await chip(2).getAttribute("aria-label"));

  // --- an older entry shows as set 1; last week's sets drive hints and placeholders
  check("Train: all five lifts show done", (await page.locator("#liftRows li.lrow:not(:has(#cardioRow))").count()) === 5 && (await page.locator("#liftRows li.lrow.done:not(:has(#cardioRow))").count()) === 5);
  check("pill counts today's lifts, and says the day is done", /^5 lifts · .*done$/.test(await flat(page.locator("#liftPill"))), await flat(page.locator("#liftPill")));
  await openWorkout(page, "Leg Press");
  check("legacy weight shows as set 1 kg", (await page.locator("#s1_0_k").inputValue()) === "50");
  check("3 set rows for a 3-set lift", (await card.locator(".srow.set").count()) === 3);
  const last = card.locator(".ex-meta .last");
  const hint = await flat(last);
  check("last time's sets show, and that today is heavier (in words too)", /Last 10, 10, 8 × 45 kg · 16\/09 \(heavier than last time\)/.test(hint) && (await last.evaluate((e) => e.classList.contains("up"))), hint);
  check("it keeps each number with its × and kg", (await last.textContent()).includes("8 × 45 kg"));
  check("reps placeholder from last week", (await page.locator("#s1_1_r").getAttribute("placeholder")) === "10");
  const wsteps = await page.locator("ol.wprog li").count();
  check("progress along the top: a step per planned lift (and the cardio), filled when done", wsteps === 6 && (await stepsDone()) === 6, `${wsteps} steps, ${await stepsDone()} done`);
  // How to do a lift is folded until asked for; its warning note always shows.
  const how = card.locator("button.howto");
  check("how-to note starts folded", (await card.locator(".nt").count()) === 0 && (await how.getAttribute("aria-expanded")) === "false" && /KNEE NOTE/.test(await card.locator(".ch").textContent()));
  await how.click();
  check("How to opens the note", /Feet high on the platform/.test(await card.locator(".nt").textContent()) && (await how.getAttribute("aria-expanded")) === "true");
  await how.click();
  check("and folds it again", (await card.locator(".nt").count()) === 0);
  await shot(page, "1-today-legs", { fullPage: true });

  // --- a lift's own page, opened from the workout's "···" menu (not touched again below, so its one legacy
  // set - no reps logged - stays exactly as it started)
  await goStep(3, "Hamstring Curl");
  await card.locator("button[data-more]").click();
  await card.locator("a[data-chart]").click();
  await page.waitForSelector("#dashLift");
  check(
    "workout: \"See chart\" in a lift's ··· menu opens its own page, titled and addressed by name",
    (await page.textContent("#screenTitle")) === "Hamstring Curl" && page.url().endsWith("/#progress/lift/Hamstring%20Curl"),
    page.url(),
  );
  const hc = await flat(page.locator("#dashLift"));
  check(
    "lift page from the workout: a legacy set with no reps still shows as the heaviest set, but gives no 1RM estimate",
    /Part of Legs and Shoulders \+ Legs, 10-12 reps\./.test(hc) && /27 kg ?heaviest set, 23 Sept/.test(hc) && /-\s?best estimated 1RM/.test(hc) && /not enough sessions yet for a weekly rate/.test(hc),
    hc,
  );
  check(
    "lift page from the workout: a chart with nothing to draw is left out (no 1RM or volume from a set with no reps)",
    (await page.locator("#liftTop").count()) === 1 && (await page.locator("#liftE1rm").count()) === 0 && (await page.locator("#liftVolume").count()) === 0,
  );
  // The lift page opened from the workout: Back should return to the workout, where it was opened, on that lift.
  await page.click("#backBtn");
  await page.waitForSelector("#workoutView, #trainView, #dashView");
  check(
    "lift page from the workout: Back returns to the workout, on that lift, not to Progress",
    (await page.locator("#dashView").count()) === 0 && (await page.locator("#workoutView .ex-card").count()) === 1 && (await shown()) === "Hamstring Curl" && !page.url().includes("progress"),
    `${page.url()} shows ${await page.evaluate(() => document.querySelector(".view")?.id)}`,
  );
  if (!(await page.locator("#workoutView").count())) await openWorkout(page, "Leg Press"); // carry on in the workout

  // --- log sets on today's Leg Press
  await goStep(1, "Leg Press");
  await page.fill("#s1_0_r", "10");
  await page.fill("#s1_1_r", "10");
  check("next set copies previous weight", (await page.locator("#s1_1_k").inputValue()) === "50");
  await until(() => db.logs["2026-09-23"].exercises["Leg Press"].sets?.length === 2);
  const lps = db.logs["2026-09-23"].exercises["Leg Press"];
  check("sets saved with reps and kg", JSON.stringify(lps.sets) === JSON.stringify([{ reps: 10, kg: 50 }, { reps: 10, kg: 50 }]) && lps.kg === 50 && lps.done === true, JSON.stringify(lps));

  // --- a fresh day: Monday, Push
  await closeWorkout();
  await pickDay(0);
  check("Monday shows Push", (await sessName()) === "Push");
  await openWorkout(page, "Incline Machine Press");
  await page.fill("#s0_0_r", "8");
  await page.fill("#s0_0_k", "40");
  await page.fill("#s0_1_r", "8");
  const ticked = () => card.evaluate((c) => c.classList.contains("checked"));
  check("not done before the planned 3 sets", !(await ticked()) && (await flat(page.locator("#completeSet"))) === "Complete set 3");
  await page.fill("#s0_2_r", "7");
  check("done after the planned 3 sets", await ticked());
  await card.locator("button[data-more]").click();
  check("and the Done box in its ··· menu is ticked", await page.locator("#ex0").isChecked());
  await card.locator("button[data-more]").click();
  check("the steps along the top update live", (await stepsDone()) === 1);
  await card.locator("button[data-addset]").click();
  check("+ Add set adds a 4th row", (await card.locator(".srow.set").count()) === 4);
  await card.locator("button[data-rmset]").click();
  check("− Set removes it again", (await card.locator(".srow.set").count()) === 3);
  await until(() => db.logs["2026-09-21"]?.exercises["Incline Machine Press"]?.sets?.length === 3);
  const im = db.logs["2026-09-21"].exercises["Incline Machine Press"];
  check("Monday sets saved", JSON.stringify(im.sets) === JSON.stringify([{ reps: 8, kg: 40 }, { reps: 8, kg: 40 }, { reps: 7, kg: 40 }]) && im.done && im.kg === 40, JSON.stringify(im));

  // --- skip
  await page.click("#nextEx");
  await until(async () => (await shown()) === "Chest Press Machine");
  await card.locator("button[data-more]").click();
  await card.locator("button[data-skip]").click();
  check("on a phone, skipping keeps the keyboard closed: focus goes to Undo skip, not the optional reason", await page.evaluate(() => document.activeElement?.dataset.unskip !== undefined));
  await card.locator("[data-reason]").fill("machine busy");
  check("skip note shows reason", /Skipped · machine busy/.test(await card.locator(".skipnote").textContent()));
  check("the steps count the skipped lift as dealt with", (await stepsDone()) === 2);
  await until(() => db.logs["2026-09-21"].exercises["Chest Press Machine"]?.reason === "machine busy");
  const cp = db.logs["2026-09-21"].exercises["Chest Press Machine"];
  check("skip saved", cp.skipped === true && cp.done === false && cp.reason === "machine busy", JSON.stringify(cp));
  await closeWorkout();
  check("Train's row says it's skipped, and why", (await row("Chest Press Machine").evaluate((li) => li.classList.contains("skipped"))) && (await flat(row("Chest Press Machine").locator(".row-d"))) === "Skipped · machine busy");
  await shot(page, "2-monday-sets-and-skip", { fullPage: true });
  await openWorkout(page, "Chest Press Machine");
  await card.locator("button[data-more]").click();
  await card.locator("button[data-unskip]").click();
  await until(() => !db.logs["2026-09-21"].exercises["Chest Press Machine"].skipped);
  check("undo skip", !db.logs["2026-09-21"].exercises["Chest Press Machine"].skipped && !("reason" in db.logs["2026-09-21"].exercises["Chest Press Machine"]));

  // --- swap
  await page.click("#nextEx");
  await until(async () => (await shown()) === "Machine Shoulder Press");
  await card.locator("button[data-more]").click();
  await card.locator("button[data-swapopen]").click();
  const opts = await page.locator("#swapList option").evaluateAll((os) => os.map((o) => o.value));
  check("swap suggestions include past swaps and plan lifts", opts.includes("Smith Squat") && opts.includes("DB Shoulder Press") && !opts.includes("Machine Shoulder Press"));
  await page.locator("form[data-swapform] input").fill("DB Shoulder Press");
  await page.locator('form[data-swapform] button[type="submit"]').click();
  await until(async () => (await shown()) === "DB Shoulder Press");
  check("swapped lift shows the replacement's name, instead of the planned one", (await shown()) === "DB Shoulder Press" && (await flat(card.locator(".ex-was"))) === "instead of Machine Shoulder Press");
  check("swapped lift's last time is its own history", /First time/.test(await card.locator(".ex-meta .last").textContent()));
  await until(() => db.logs["2026-09-21"].exercises["Machine Shoulder Press"]?.swap === "DB Shoulder Press");
  check("swap saved under the planned lift", db.logs["2026-09-21"].exercises["Machine Shoulder Press"].swap === "DB Shoulder Press");
  await shot(page, "3-monday-swap", { fullPage: true });
  await card.locator("button[data-more]").click();
  await card.locator("button[data-unswap]").click();
  await until(() => !db.logs["2026-09-21"].exercises["Machine Shoulder Press"].swap);
  check("undo swap", !db.logs["2026-09-21"].exercises["Machine Shoulder Press"].swap && (await shown()) === "Machine Shoulder Press");

  // Back on Wednesday, last week's Smith Squat swap feeds the hint for a swap today.
  await closeWorkout();
  await pickDay(2);
  await openWorkout(page, "Hack Squat");
  await card.locator("button[data-more]").click();
  await card.locator("button[data-swapopen]").click();
  await page.locator("form[data-swapform] input").fill("Smith Squat");
  await page.locator("form[data-swapform] input").press("Enter");
  await until(async () => (await shown()) === "Smith Squat");
  check("swap hint uses that exercise's past sets", /Last 10 × 20 kg · 16\/09/.test(await flat(card.locator(".ex-meta .last"))), await flat(card.locator(".ex-meta .last")));
  await card.locator("button[data-more]").click();
  await card.locator("button[data-unswap]").click();
  await until(() => !db.logs["2026-09-23"].exercises["Hack Squat"].swap);

  // --- plan editor, from Settings, on the day selected in Train
  await closeWorkout();
  await pickDay(0); // Monday
  await openTab(page, "settings");
  await page.locator("#planBtn").click();
  await page.waitForSelector("#planView");
  check("plan editor opens on the selected weekday", (await page.locator("#planView").isVisible()) && (await page.locator("#pe_name").inputValue()) === "Push");
  await page.locator("#pe_name").fill("Push A");
  await page.locator("#pe_add").click();
  check("new lift field focused", await page.evaluate(() => document.activeElement?.id === "pe_x6_name"));
  await page.keyboard.type("Cable Triceps Pushdown");
  check("duplicate name warning", /Two lifts are called “Cable Triceps Pushdown”/.test(await page.locator("#peWarn").textContent()) && (await page.locator("#peWarn").isVisible()));
  await page.locator("#pe_x6_name").fill("Cable Fly");
  check("warning clears", !(await page.locator("#peWarn").isVisible()));
  await page.locator("#pe_x6_sets").fill("3");
  await page.locator("#pe_x6_reps").fill("12-15");
  await page.locator("#pe_x6_cue").fill("Slight bend in the elbows.");
  await page.locator('button[data-pmove="6:-1"]').click();
  check("move up reorders", (await page.locator("#pe_x5_name").inputValue()) === "Cable Fly");
  await page.locator('button[data-pdel="0"]').click(); // remove Incline Machine Press (it has Monday data)
  check("remove deletes the lift", (await page.locator("#pe_x0_name").inputValue()) === "Chest Press Machine");
  await page.locator("#pe_warm").fill("Treadmill walk 5 min\nWrist circles\n\nArm circles");
  await page.locator("#pe_goal").fill("12000");
  await page.locator("#pe_tempo").fill("3:0:1:0");
  await shot(page, "4-plan-editor", { fullPage: true });
  await until(() => db.plan?.days?.[0]?.name === "Push A" && db.plan.tempo === "3:0:1:0" && db.plan.stepGoal === 12000);
  const pd = db.plan?.days?.[0];
  check(
    "plan saved to plans table",
    pd &&
      pd.name === "Push A" &&
      pd.exercises.map((x) => x.name).join("|") === "Chest Press Machine|Machine Shoulder Press|DB Lateral Raises|Cable Triceps Pushdown|Cable Fly|Overhead Rope Extension" &&
      JSON.stringify(db.plan.warmups) === JSON.stringify(["Treadmill walk 5 min", "Wrist circles", "Arm circles"]),
    JSON.stringify(pd?.exercises.map((x) => x.name)),
  );
  await planDone(page);
  check("Done goes back to Settings, where the plan opened", await page.locator("#settingsView").isVisible());
  await page.click("#backBtn");
  await page.waitForSelector("#homeView");
  await openTab(page, "train");

  check("Train uses the edited plan", (await sessName()) === "Push A" && (await row("Cable Fly").count()) === 1);
  check("removed lift with logged sets still shows", (await row("Incline Machine Press").count()) === 1);
  check("edited warm-ups show", (await page.locator("#wuChips .chip", { hasText: "Wrist circles" }).count()) === 1);
  check("tempo note follows plan", /3:0:1:0/.test(await page.locator("#tempoNote").textContent()));
  check("day chip shows new day name", (await chip(0).getAttribute("aria-label")).includes(", Push A"));
  await shot(page, "5-edited-monday", { fullPage: true });
  await openWorkout(page, "Incline Machine Press");
  check(
    "in the workout, the removed lift says it's not in this workout, with its sets",
    /Not in this workout/.test(await card.textContent()) && (await card.locator('input[data-set$=":2:reps"]').inputValue()) === "7",
  );
  await closeWorkout();

  // --- reload: the plan comes back from the plans table
  await page.evaluate(() => localStorage.removeItem("gymlog.plan.v1"));
  await page.reload();
  await page.waitForSelector("#trainView", { timeout: 15000 });
  await until(async () => (await chip(0).getAttribute("aria-label"))?.includes(", Push A"));
  check("plan loads from the plans table after reload", (await chip(0).getAttribute("aria-label")).includes(", Push A"));

  // --- reset to the default plan
  await openTab(page, "settings");
  await page.locator("#planBtn").click();
  await page.waitForSelector("#planView");
  await page.locator("#pe_reset").click();
  await until(() => db.plan?.days?.[0]?.name === "Push");
  check("reset to default plan saved", db.plan.days[0].name === "Push" && db.plan.stepGoal === 10000 && db.plan.days[0].exercises.length === 6);
  await planDone(page);
  await page.click("#backBtn");
  await page.waitForSelector("#homeView");
  check("the reload came back to today", (await flat(page.locator("#todayName"))) === "Legs");
  await openTab(page, "train");
  check("and Train is on today too", (await sessName()) === "Legs");
  await pickDay(0);
  check(
    "Monday back on default plan",
    (await sessName()) === "Push" && (await row("Cable Fly").count()) === 0 && (await row("Incline Machine Press").count()) === 1,
  );
  await openWorkout(page, "Incline Machine Press");
  check("its Incline Machine Press is in the workout again", !/Not in this workout/.test(await card.textContent()));
  await closeWorkout();

  // --- a rest day renders, and no stray requests or errors
  await pickDay(3);
  check("rest day renders", (await sessName()) === "Rest day");
  check(
    "rest day: no lift rows or Start button, just its walk",
    (await page.locator("#liftRows .lrow-main:not(#cardioRow)").count()) === 0 && (await page.locator("#startBtn").count()) === 0 && /^Walk/.test(await flat(page.locator("#cardioRow .row-tt"))),
  );
  check("only logs/plans endpoints were called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors or warnings", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();

  // --- a brand-new account that started today (Wed 23 Sep), like the real one
  const db2 = { logs: { "2026-09-23": firstDay() }, plan: null };
  const { ctx: ctx2, page: p2 } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000001", "2026-09-23T06:00:00Z"), db: db2 });
  await ready(p2);
  const chip2 = (n) => p2.locator("#dayChips .dchip").nth(n);
  const pick2 = async (n) => {
    await chip2(n).click();
    await until(async () => (await chip2(n).getAttribute("aria-pressed")) === "true");
  };
  const name2 = () => flat(p2.locator("#sessName"));
  const kept = () => flat(p2.locator("#planKept"));
  await openTab(p2, "progress");
  check("new account: history starts today", (await p2.locator("#hist tbody tr").count()) === 1 && (await p2.locator("#histTitle").textContent()) === "Today");
  check("week counts Legs once: 1 of 5", /^1 of 5 this week/.test(await kept()), await kept());
  await openTab(p2, "train");
  check("today's picker shows its usual workout", (await p2.locator("#sessionSel option:checked").textContent()) === "Legs (Wed, usual)" && (await p2.locator(".moved").count()) === 0);
  check("no catch-up on a gym day", (await p2.locator(".catchup").count()) === 0);
  await pick2(3); // Thursday, a rest day tomorrow
  check("Thursday offers missed Push and Pull", /Missed this week: Push \(Mon\), Pull \(Tue\)\. Do one on Thu\?/.test(await flat(p2.locator(".catchup"))), await flat(p2.locator(".catchup")));
  await shot(p2, "6-thursday-catchup");
  await p2.locator('button[data-catch="0"]').click();
  await until(async () => (await name2()) === "Push");
  check("Thursday now shows Push", (await name2()) === "Push" && /Usually Rest/.test(await flat(p2.locator(".moved"))), await flat(p2.locator(".moved")));
  check("day chips show Push on Thursday", (await chip2(3).getAttribute("aria-label")).endsWith("Push"), await chip2(3).getAttribute("aria-label"));
  await until(() => db2.logs["2026-09-24"]?.session === 0);
  check("choice saved with the day", db2.logs["2026-09-24"]?.session === 0, JSON.stringify(db2.logs["2026-09-24"]));
  await shot(p2, "7-thursday-push");
  await pick2(6); // Sunday
  check("Sunday offers only Pull once Push is booked", /Missed this week: Pull \(Tue\)\. Do it on Sun\?/.test(await flat(p2.locator(".catchup"))), await flat(p2.locator(".catchup")));
  await p2.locator('button[data-catch="1"]').click();
  await until(async () => (await name2()) === "Pull");
  check("Sunday now shows Pull", (await name2()) === "Pull");
  await pick2(3);
  await p2.locator("#sessionSel").selectOption("3");
  await until(async () => (await name2()) === "Rest day");
  check("switching back restores the rest day", (await name2()) === "Rest day");
  await until(() => db2.logs["2026-09-24"] && !("session" in db2.logs["2026-09-24"]));
  check("switching back clears the saved choice", !("session" in db2.logs["2026-09-24"]));
  check("Thursday offers Push again (Pull is booked on Sunday)", /Missed this week: Push \(Mon\)\. Do it on Thu\?/.test(await flat(p2.locator(".catchup"))), await flat(p2.locator(".catchup")));
  await openTab(p2, "progress");
  check("week still counts 1 of 5", /^1 of 5 this week/.test(await kept()), await kept());
  db2.logs["2026-09-21"] = { exercises: {}, warmup: [], cardio: false, steps: 4000, weight: null, note: "" };
  await p2.reload();
  await p2.waitForSelector("#dashView", { timeout: 15000 });
  await until(async () => (await p2.locator("#hist tbody tr").count()) === 3);
  check("history starts at the earliest log", (await p2.locator("#hist tbody tr").count()) === 3 && (await p2.locator("#histTitle").textContent()) === "Last 3 days");
  check("new account: no console errors", p2.errors.length === 0, p2.errors.join(" | "));
  await ctx2.close();
}
