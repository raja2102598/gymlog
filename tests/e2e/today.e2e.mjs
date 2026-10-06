// Today's training, across Home, Train and the workout: sets, skip and swap, the plan editor, switching a day's
// workout, skipping the whole day, history for a new account, a stuck lift's hint, and the readiness note with Hold
// today. Home shows today; Train lists the selected day's lifts, a row each; the
// workout shows one lift at a time, with its set table and its ··· menu (Done, skip, swap, its chart).
import { K, clearAsked, flat, lastAsked, open, openTab, openWorkout, planDone, ready, session, shot, until, TAB_VIEWS } from "./harness.mjs";

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
  check("lift page from the workout: the back chevron says it goes back to the workout", (await page.getAttribute("#backBtn", "aria-label")) === "Back to the workout");
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
  await page.locator("#s0_1_r").blur(); // set 2 counts once the cursor leaves it
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
  await clearAsked(page);
  await card.locator("button[data-rmset]").click();
  check("− Set takes an empty set away again, without asking", (await card.locator(".srow.set").count()) === 3 && (await lastAsked(page)) === "");
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
  await page.locator('button[data-pdel="0"]').click(); // remove Incline Machine Press (it has Monday data); the harness says yes
  await until(async () => (await page.locator("#pe_x0_name").inputValue()) === "Chest Press Machine");
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
  await page.waitForSelector(TAB_VIEWS); // Settings closes onto the tab it was opened from
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
  await page.waitForSelector(TAB_VIEWS); // Settings closes onto the tab it was opened from
  await openTab(page, "home");
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

  // Skipping a day's workout, with why, and taking it back.
  {
    const auth = session("00000000-0000-4000-8000-00000000e0e0", "2026-09-01T00:00:00Z", "raja@example.com");
    const { ctx, page, db } = await open(browser, base, { auth, db: { logs: {}, plan: {} } });
    await ready(page);
    await openTab(page, "train");
    await page.click("#skipDay");
    await until(() => db.logs[K(28)]?.skip === "");
    check("Train: Skip day marks the day's workout skipped", (await flat(page.locator("#liftPill"))) === "Skipped" && (await page.locator("#unskipBtn").count()) === 1 && (await page.locator("#startBtn").count()) === 0, await flat(page.locator("#liftPill")));
    // Opening one of its lifts means doing it after all: the skip goes.
    await page.locator(".lrow-main").first().click();
    await page.waitForSelector("#workoutView .ex-card");
    await until(() => db.logs[K(28)] && db.logs[K(28)].skip === undefined);
    check("opening a skipped day's lift takes the skip back", db.logs[K(28)].skip === undefined);
    await page.click("#closeWorkout");
    await page.waitForSelector("#trainView");
    await page.click("#skipDay");
    await until(() => db.logs[K(28)]?.skip === "");
    await page.fill("#skipReason", "travelling");
    await until(() => db.logs[K(28)]?.skip === "travelling");
    check("with why, kept on the day", (await flat(page.locator("#liftPill"))) === "Skipped · travelling");
    await openTab(page, "home");
    check("Home says today was skipped, with Undo", /^Skipped today · travelling$/.test(await flat(page.locator("#todaySub"))) && (await page.locator("#unskipHome").count()) === 1, await flat(page.locator("#todaySub")));
    check("with no knee question before a session that isn't happening", (await page.locator('[data-knee^="kneeBefore:"]').count()) === 0);
    const tl = await flat(page.locator("#timeline"));
    check("and so does the day's timeline, with no workout up next or cardio after it", /Skipped ?Legs workout · travelling/.test(tl) && !/Up next|After lifting/.test(tl), tl);
    await page.click("#unskipHome");
    await until(() => db.logs[K(28)] && db.logs[K(28)].skip === undefined);
    check("Undo puts the workout back", (await page.locator("#startWorkout").count()) === 1 && (await page.locator("#skipHome").count()) === 1);
    const back = await flat(page.locator("#timeline"));
    check("on the timeline too, and the knee question is back", /Up next ?Legs workout · 5 lifts/.test(back) && /After lifting ?Cycling/.test(back) && (await page.locator('[data-knee^="kneeBefore:"]').count()) === 11, back);
    await ctx.close();
  }

  await leftLifts({ browser, base, check });
  await stuckLift({ browser, base, check });
  await readiness({ browser, base, check });
  await pastDays({ browser, base, check });
}

// A day further back: opened from Progress's last two weeks or the date picker beside the week, to fix it or log one
// done on paper; and a workout logged on the wrong day, moved to the right one. The rules are in train.test.ts.
async function pastDays({ browser, base, check }) {
  const day = (more = {}) => ({ exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "", ...more });
  const db = { logs: { [K(21)]: day({ exercises: { "Leg Press": { done: true, kg: 40, sets: [{ reps: 10, kg: 40 }] } }, steps: 7000 }) }, plan: null };
  const { ctx, page } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000071", "2026-08-26T05:00:00Z"), db });
  await ready(page);
  await openTab(page, "progress");
  await page.click(`#hist [data-hday="${K(21)}"]`);
  await page.waitForSelector("#trainView");
  check("a day in Progress's last two weeks opens in Train", (await flat(page.locator("#weekLabel"))) === "Last week" && (await flat(page.locator("#sessName"))) === "Legs" && (await page.getAttribute("#dayChips .dchip.sel", "aria-label"))?.startsWith("Wed 16"));
  // Logged on the wrong day: it was Tuesday's.
  await page.click("#moveOpen");
  await page.fill("#moveTo", K(20));
  await page.click("#moveGo");
  await until(() => db.logs[K(20)]?.exercises?.["Leg Press"] != null && db.logs[K(21)]?.exercises?.["Leg Press"] == null);
  check(
    "Move to another day takes the workout there, as the same session, and shows it",
    db.logs[K(20)]?.session === 2 && db.logs[K(21)]?.steps === 7000 && (await flat(page.locator("#sessName"))) === "Legs" && (await page.getAttribute("#dayChips .dchip.sel", "aria-label"))?.startsWith("Tue 15"),
    JSON.stringify([db.logs[K(20)], db.logs[K(21)]]),
  );
  await page.click("#moveOpen");
  await page.fill("#moveTo", K(20));
  await page.click("#moveGo");
  check("and says why it can't: the day it's on already", (await flat(page.locator("#moveMsg"))) === "That’s the day it’s on already.");
  // Further back with the date picker: a Monday a month ago, to log one done on paper.
  await page.fill("#goDate", K(0));
  await until(async () => (await page.getAttribute("#dayChips .dchip.sel", "aria-label"))?.startsWith("Wed 26"));
  check("the date picker opens any day in Train", /^Week of 24 Aug$/.test(await flat(page.locator("#weekLabel"))), await flat(page.locator("#weekLabel")));
  check("past days: no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}

// Lifts left on an earlier day, offered in Add exercise, as in the report: Tuesday's Pull with 2 of its 6 lifts done.
// Opening Add exercise on Wednesday offers the other four first ("Missed on Tuesday"); one added for today goes on
// today's session and the workout like a planned lift, not into the plan, and leaves the list. Under them, the muscles
// low this week, picked like any library lift. And the rest pill, over Train, keeps clear of Add exercise.
async function leftLifts({ browser, base, check }) {
  const day = (exercises) => ({ exercises, warmup: [], cardio: false, steps: 6000, weight: null, note: "" });
  const done = (reps, kg, n) => ({ done: true, kg, sets: Array.from({ length: n }, () => ({ reps, kg })) });
  const db = {
    logs: {
      [K(20)]: day({ "Lat Pulldown": done(8, 50, 3), "Rear Delt Fly": done(12, 20, 2) }), // last Tuesday: last time's sets
      [K(27)]: day({ "Chest-Supported Row": done(10, 30, 3), "Dumbbell Curls": done(10, 12, 3) }),
    },
    plan: null,
  };
  const { ctx, page } = await open(browser, base, { auth: session("00000000-0000-4000-8000-0000000000e1", "2026-09-01T00:00:00Z"), db });
  await ready(page);
  await openTab(page, "train");
  const missed = () => page.locator("#libMissed .lib-n").allTextContents();
  const rows = () => page.locator("#liftRows .lift-t").allTextContents();
  const rowLine = (name) => flat(page.locator("#liftRows li", { has: page.locator(".lift-t", { hasText: name }) }).locator(".row-d"));
  /** Where things sit on screen: Add exercise's and the page's last content's bottom edges, and the tops of the rest
   *  pill and the tab bar. */
  const rects = () =>
    page.evaluate(() => {
      const box = (el) => el?.getBoundingClientRect() ?? null;
      return { add: box(document.querySelector("#addExercise"))?.bottom, last: box(document.querySelector("#trainView .screen").lastElementChild)?.bottom, pill: box(document.querySelector("#restPill"))?.top ?? null, tabs: box(document.querySelector(".tabbar")).top };
    });

  // No rest running: the page ends above the tabs, keeping no room for a pill that isn't there.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const bare = await rects();
  check("with no rest pill, Train's last content scrolls clear of the tabs, with no room kept for the pill", bare.pill === null && bare.last <= bare.tabs && bare.tabs - bare.last < 44, JSON.stringify(bare));
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.click("#addExercise");
  await page.waitForSelector("#libDialog[open] #libList");
  await until(async () => (await page.locator("#libMissed").count()) > 0);
  const heading = (await page.locator("#libMissedH").count()) ? await flat(page.locator("#libMissedH")) : "";
  check("Add exercise opens on what Tuesday left, first", heading === "Missed on Tuesday" && (await missed()).join("|") === "Lat Pulldown|Seated Row|Rear Delt Fly|Cable Curls", `${heading}: ${(await missed()).join("|")}`);
  const line = await flat(page.locator("#libMissed li").first().locator(".row-d"));
  check("each with its sets and reps as planned, both ranges with an en dash, and last time's top set", line === "3–4 × 8–10 · last 50 kg × 8", line);
  check("its button adds it for today", (await flat(page.locator('[data-missed="Rear Delt Fly"]'))) === "Add for today" && (await page.getAttribute('[data-missed="Rear Delt Fly"]', "aria-label")) === "Add Rear Delt Fly for today");
  const lows = await page.locator("#libLow [data-low-muscle]").count();
  check("then the muscles low this week, each with lifts to pick", lows >= 1 && lows <= 3 && (await flat(page.locator("#libLowH"))) === "Low this week" && (await page.locator("#libLow [data-low]").count()) <= lows * 2, `${lows} muscles`);
  await page.click('[data-missed="Rear Delt Fly"]');
  await until(() => !!db.logs[K(28)]?.exercises?.["Rear Delt Fly"]);
  const added = db.logs[K(28)]?.exercises?.["Rear Delt Fly"];
  check("Add for today puts it on today only, asking what it was planned with", JSON.stringify(added) === '{"done":false,"kg":null,"target":{"sets":"3","reps":"12-15"},"added":true}', JSON.stringify(added));
  check("and not in the plan", db.plan === null && db.writes.plans === 0, JSON.stringify(db.plan?.days?.[2]?.exercises?.map((x) => x.name)));
  check("it leaves the list, and the next one's button has focus", (await missed()).join("|") === "Lat Pulldown|Seated Row|Cable Curls" && (await page.evaluate(() => document.activeElement?.dataset.missed)) === "Cable Curls", (await missed()).join("|"));

  // A lift for a low muscle is picked as the library's are, and goes into the plan's Legs with them.
  const low = page.locator("#libLow [data-low]").first(), lowId = await low.getAttribute("data-low");
  await low.click();
  check("a lift for a low muscle is picked with + like the library's", (await low.getAttribute("aria-pressed")) === "true" && (await flat(page.locator("#libAdd"))) === "Add 1");
  await page.click("#libAdd");
  await until(() => db.plan?.days?.[2]?.exercises?.some((x) => x.lib === lowId));
  check("and Add puts it in the plan, for Legs", db.plan?.days?.[2]?.exercises?.some((x) => x.lib === lowId) && !db.plan.days[2].exercises.some((x) => x.name === "Rear Delt Fly"), JSON.stringify(db.plan?.days?.[2]?.exercises?.map((x) => x.name)));
  await page.waitForSelector("#libDialog:not([open])", { state: "attached" });

  // Today's session: the lift added for today after the planned ones, as one of them.
  check("Train lists Rear Delt Fly last, with its sets and reps and weight", (await rows()).at(-1) === "Rear Delt Fly" && (await rowLine("Rear Delt Fly")) === "3 × 12–15 · 20 kg", `${(await rows()).join("|")} / ${await rowLine("Rear Delt Fly")}`);
  check("and counts it", /^7 lifts/.test(await flat(page.locator("#liftPill"))), await flat(page.locator("#liftPill")));
  await page.click("#addExercise");
  await page.waitForSelector("#libMissed");
  check("opened again, Add exercise doesn't offer it", (await missed()).join("|") === "Lat Pulldown|Seated Row|Cable Curls", (await missed()).join("|"));
  await page.click("#libClose");
  await page.waitForSelector("#libDialog:not([open])", { state: "attached" });

  // In the workout it logs like a planned lift, says it's today's only, and a set starts the rest.
  await openWorkout(page, "Rear Delt Fly");
  const card = page.locator("#workoutView section.ex-card");
  const meta = await flat(card.locator(".ex-meta .sr"));
  check("in the workout: what it asks, its rest, a row per planned set, and that it's for today only", /^3 × 12–15 · rest 1:30/.test(meta) && (await card.locator(".srow.set").count()) === 3 && /Added for this day only, not to the plan/.test(await card.textContent()), meta);
  await page.click("#completeSet");
  await until(() => db.logs[K(28)]?.exercises?.["Rear Delt Fly"]?.sets?.length === 1);
  await page.click("#closeWorkout");
  await page.waitForSelector("#trainView");
  await page.waitForSelector("#restPill");

  // The rest pill: Add exercise scrolled to stops above it, as does the page's end.
  await page.locator("#addExercise").evaluate((e) => e.scrollIntoView({ block: "end" }));
  const at = await rects();
  check("Add exercise, scrolled into view, stops above the rest pill", at.pill !== null && at.add <= at.pill, JSON.stringify(at));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const end = await rects();
  check("and Train's last content scrolls clear of it", end.last <= end.pill, JSON.stringify(end));

  // Tuesday's session: a range of sets with an en dash, as its reps have.
  await page.locator("#dayChips .dchip").nth(1).click();
  await until(async () => (await flat(page.locator("#sessName"))) === "Pull");
  const lines = [await rowLine("Lat Pulldown"), await rowLine("Cable Curls")];
  check("Train prints a range of sets with an en dash: 3–4 × 8–10, 2–3 × 10–12", /^3–4 × 8–10\b/.test(lines[0]) && lines[1] === "2–3 × 10–12", lines.join(" / "));

  check("left lifts: only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("left lifts: no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}

/** A day with only these lifts logged. */
const liftDay = (exercises) => ({ exercises, warmup: [], cardio: false, steps: null, weight: null, note: "" });
/** Three sets of `reps` at `kg`, done. */
const threeOf = (reps, kg) => ({ done: true, kg, sets: [{ reps, kg }, { reps, kg }, { reps, kg }] });
/** An element's text, or "(none)" when it isn't on the page: its check then fails saying so, rather than waiting. */
const textOf = async (loc) => ((await loc.count()) ? flat(loc.first()) : "(none)");

// A stuck lift (lib/plateau.ts): Hamstring Curl hasn't beaten its best estimated 1RM in its last four sessions, so its
// card says what to try where the next-weight hint goes; Swap opens the swap, and Not now puts it off on this phone; its
// page on Progress says the same. Every case of the rule is in tests/unit/progression.test.ts.
async function stuckLift({ browser, base, check }) {
  const logs = {};
  // Five sessions, on Wednesdays and a Saturday: 3 × 10 at 30 kg each time, short of its 12s, so it doesn't go up.
  for (const n of [3, 7, 14, 21, 24]) logs[K(n)] = liftDay({ "Hamstring Curl": threeOf(10, 30) });
  const auth = session("00000000-0000-4000-8000-0000000057c1", "2026-08-26T05:00:00Z", "t@example.com");
  const { ctx, page, db } = await open(browser, base, { auth, db: { logs, plan: null } });
  await ready(page);
  await openWorkout(page, "Hamstring Curl");
  const card = page.locator("#workoutView section.ex-card"), hint = card.locator(".prog");
  const said = await textOf(hint.locator("span"));
  check("a stuck lift says so where the next weight goes, and what to try, at 90% on its machine's steps", said === "No progress in 4 sessions. Try 3 × 12 at 90% (27.5 kg), or swap it for a variation.", said);
  const taps = await hint.locator("button").evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)));
  check("its Swap and Not now are 44px to tap", taps.length === 2 && taps.every((h) => h >= 44), taps.join(", "));
  await shot(page, "8-stuck-lift");

  await hint.locator("button[data-stuckswap]").click();
  const focused = await until(() => page.evaluate(() => !!document.activeElement?.matches("form[data-swapform] input")));
  const opts = await page.locator("#swapList option").evaluateAll((os) => os.map((o) => o.value));
  check("Swap opens the ··· menu's swap, ready to type, suggesting the library's lifts for the same muscles", focused && opts.includes("Glute Ham Raise") && !opts.includes("Hamstring Curl"), `focused: ${focused}, ${opts.length} suggestions`);
  await card.locator("button[data-more]").click(); // ··· closes whatever it has open

  await hint.locator("button[data-notnow]").click();
  await until(async () => !/No progress/.test(await flat(card)));
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("gymlog.notnow.v1") ?? "null"));
  check("Not now puts it away, kept on this phone and not in the plan", !/No progress/.test(await flat(card)) && kept?.lifts?.["Hamstring Curl"] > 0 && !db.writes.plans, JSON.stringify({ kept, plans: db.writes.plans }));
  // A reload comes back to the workout, on this lift: once its history is in (last time's sets), still no hint.
  await page.reload();
  await page.waitForSelector("#workoutView .ex-card", { timeout: 15000 });
  await until(async () => /Last 10, 10, 10 × 30 kg/.test(await flat(card.locator(".ex-meta"))));
  check("…still away after a reload", /Hamstring Curl/.test(await flat(card.locator(".ex-name"))) && /Last 10, 10, 10 × 30 kg/.test(await flat(card)) && !/No progress/.test(await flat(card)), await flat(card));

  // Its page on Progress says so whatever the hint was put off with: it's the lift's record.
  await card.locator("button[data-more]").click();
  await card.locator("a[data-chart]").click();
  await page.waitForSelector("#dashLift");
  const line = await textOf(page.locator("#liftStuck"));
  check("its page on Progress says it's stuck, since when", line === "No progress in 4 sessions: no new best estimated 1RM since 29 Aug.", line);
  check("stuck lift: no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}

// The readiness note (lib/readiness.ts): a short night, from Health Connect, says so on Home's workout card in one line,
// with Hold today, which keeps the day's lifts at last time's weights, on the day's log, until Undo. Every case of the
// signals is in tests/unit/readiness.test.ts, and what a hold does to each rule in tests/unit/progression.test.ts.
async function readiness({ browser, base, check }) {
  // Last Wednesday's Hamstring Curl hit its 12s, so it's due to go up; last night was 5 h 10 min.
  const logs = { [K(21)]: liftDay({ "Hamstring Curl": threeOf(12, 30) }) }, health = { [K(28)]: { sleepMin: 310 } };
  const auth = session("00000000-0000-4000-8000-0000000057c2", "2026-08-26T05:00:00Z", "t@example.com");
  const { ctx, page, db } = await open(browser, base, { auth, db: { logs, plan: null, health } });
  await ready(page);
  const line = () => textOf(page.locator("#readyNote .ready-t > span"));
  await until(async () => (await page.locator("#readyNote").count()) === 1);
  check("Home's workout card: a short night says so, in a line, and what to do", (await line()) === "Slept 5 h 10 min. Keep today’s weights where they were last time.", await line());
  const hold = page.locator("#readyNoteHold");
  const tap = (await hold.count()) ? await hold.evaluate((b) => b.getBoundingClientRect().height) : 0;
  check("its Hold today is 44px to tap", tap >= 44, String(tap));
  await shot(page, "9-readiness");

  await hold.click();
  await until(async () => db.logs[K(28)]?.hold === true && (await textOf(hold)) === "Undo");
  check(
    "Hold today keeps it on the day's log, and the note says so, with Undo",
    db.logs[K(28)]?.hold === true && (await line()) === "Slept 5 h 10 min. Today’s weights stay where they were last time." && (await textOf(hold)) === "Undo",
    `${await line()} | ${JSON.stringify(db.logs[K(28)])}`,
  );
  // The workout's first step says so too, before a set is in.
  await page.click("#startWorkout");
  await page.waitForSelector("#workoutView .ex-card");
  const first = await textOf(page.locator("#readyWorkout .ready-t > span"));
  check("the workout's first step has the same note", first === "Slept 5 h 10 min. Today’s weights stay where they were last time.", first);
  await shot(page, "10-readiness-workout");
  await page.locator("ol.wprog li button").nth(3).click();
  const card = page.locator("#workoutView section.ex-card");
  await until(async () => (await flat(card.locator(".ex-name .nm"))) === "Hamstring Curl");
  const held = await textOf(card.locator(".prog"));
  check("held: a lift due to go up holds last time's weight, in its hint and its boxes", held === "Hold 30 kg: you’re holding today’s weights." && (await card.locator('input[data-set$=":0:kg"]').getAttribute("placeholder")) === "30", held);

  await page.click("#closeWorkout");
  await page.waitForSelector(TAB_VIEWS);
  if (!(await page.locator("#homeView").count())) await openTab(page, "home");
  await hold.click();
  await until(async () => db.logs[K(28)] && !("hold" in db.logs[K(28)]) && (await textOf(hold)) === "Hold today");
  check("Undo takes the hold off the day, and the note offers it again", !("hold" in db.logs[K(28)]) && (await textOf(hold)) === "Hold today", JSON.stringify(db.logs[K(28)]));
  await openWorkout(page, "Hamstring Curl");
  const up = await textOf(page.locator("#workoutView section.ex-card .prog"));
  check("…and the lift goes up again", /^Go up to 32\.5 kg/.test(up), up);
  check("readiness: no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
