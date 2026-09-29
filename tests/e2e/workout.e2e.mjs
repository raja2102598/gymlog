// The workout, one lift at a time: a whole one done with its big button, from Home's Start to Workout complete; a set
// typed in on a phone logging what was typed; its clock (a tap pauses and resumes it, ↺ restarts it; one left running
// for hours or finished elsewhere, and a finished day opened to review it), − Set asking before it takes a set with
// numbers, and skipping a lift with a mouse putting the cursor in the reason box. Logging sets, skip and swap in the
// day's flow are in today.e2e.mjs; the rest timer, set types, supersets and voice have suites of their own.
import { K, answerAsk, flat, lastAsked, open, openTab, openWorkout, ready, session, until } from "./harness.mjs";

const LEGS = ["Hack Squat", "Leg Press", "Leg Extension", "Hamstring Curl", "Calf Raise"];
const day = (exercises = {}) => ({ exercises, warmup: [], cardio: false, steps: null, weight: null, note: "" });
const INK = "rgb(21, 23, 27)", MUTED = "rgb(95, 101, 112)";

// A set typed in as a phone does it, a tap and a key at a time. Leg Press is 3 × 10–12 and done for the first time,
// so its boxes suggest 10 reps: the 1 on the way to 12 logs nothing and moves nothing on, and Complete set 1, or the
// set's check, logs what was typed and shows it in full ink, never as the grey suggestion. Hack Squat, 8 × 60 kg last
// week, suggests a weight: reps typed without one take it, as Complete set does, and a logged set shows what was
// logged. Every case of these rules is in train.test.ts.
async function typingASet({ browser, base, check, auth }) {
  const lastWeek = { [K(21)]: day({ "Hack Squat": { done: true, kg: 60, sets: [{ reps: 8, kg: 60 }] } }) };
  const { ctx, page, db } = await open(browser, base, { auth, db: { logs: lastWeek, plan: {} } });
  await ready(page);
  await openWorkout(page, "Leg Press");
  const saved = () => db.logs[K(28)]?.exercises?.["Leg Press"]?.sets;
  const button = () => flat(page.locator("#completeSet"));
  const box = (id) => page.$eval(id, (e) => ({ value: e.value, color: getComputedStyle(e).color, hint: getComputedStyle(e, "::placeholder").color, row: e.closest(".srow").className }));
  await page.tap("#s1_0_k");
  await page.keyboard.type("5");
  await page.tap("#s1_0_r");
  await page.keyboard.type("1");
  const midway = { row: (await box("#s1_0_r")).row, button: await button(), check: await page.getAttribute('[data-check="1:0"]', "aria-label") };
  check("the 1 of 12 logs nothing yet: set 1 is still the one to complete", !/\blogged\b/.test(midway.row) && midway.button === "Complete set 1" && midway.check === "Mark Leg Press, set 1 done", JSON.stringify(midway));
  await page.keyboard.type("2");
  await page.tap("#completeSet");
  await until(() => saved()?.[0]?.reps === 12);
  const done = await box("#s1_0_r");
  check(
    "Complete set 1 logs the 12 typed, not the suggested 10, and shows it in full ink",
    JSON.stringify(saved()) === JSON.stringify([{ reps: 12, kg: 5 }]) && done.value === "12" && done.color === INK && /\blogged\b/.test(done.row) && (await button()) === "Complete set 2",
    JSON.stringify({ saved: saved(), done, button: await button() }),
  );
  // The report's way: reps typed, then the set's check, which had turned into Undo by the time the tap landed.
  await page.tap("#s1_1_r");
  await page.keyboard.type("15");
  await page.tap('[data-check="1:1"]');
  await until(() => saved()?.[1]?.reps === 15);
  check("the set's check logs what's typed in it too, rather than clearing it", JSON.stringify(saved()) === JSON.stringify([{ reps: 12, kg: 5 }, { reps: 15, kg: 5 }]) && (await page.inputValue("#s1_1_r")) === "15", JSON.stringify(saved()));
  // A weight typed ahead into a later set, left for now: in full ink, unlike that row's grey suggestion.
  await page.tap('[data-addset="1"]');
  await page.tap("#s1_3_k");
  await page.keyboard.type("7");
  await page.tap("#screenTitle");
  const ahead = await box("#s1_3_k");
  check("a number typed into a later set is full ink, and only its suggestions grey", ahead.value === "7" && /\bup\b/.test(ahead.row) && ahead.color === INK && (await box("#s1_3_r")).hint === MUTED, JSON.stringify(ahead));
  // Reps alone, then away: the set takes the suggested weight, and shows it as logged.
  const hack = () => db.logs[K(28)]?.exercises?.["Hack Squat"]?.sets;
  await page.tap('[aria-label^="Go to exercise 1"]');
  await page.tap("#s0_0_r");
  await page.keyboard.type("9");
  await page.tap("#screenTitle");
  await until(() => hack()?.[0]?.kg === 60);
  const took = await box("#s0_0_k");
  check("reps typed without a weight take the suggested 60 kg, as Complete set does, shown as logged", JSON.stringify(hack()) === JSON.stringify([{ reps: 9, kg: 60 }]) && took.value === "60" && took.color === INK && /\blogged\b/.test(took.row), JSON.stringify({ saved: hack(), took }));
  await page.tap("#s0_0_k");
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.tap("#screenTitle");
  await until(() => hack()?.[0]?.kg === null);
  const none = await page.$eval("#s0_0_k", (e) => ({ value: e.value, placeholder: e.placeholder, row: e.closest(".srow").className }));
  check("a logged set with its weight taken off shows none, not the suggestion that would pass for one", hack()?.[0]?.kg === null && none.value === "" && none.placeholder === "" && /\blogged\b/.test(none.row), JSON.stringify({ saved: hack(), none }));
  check("typing a set: no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}

export default async function workout({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-00000000e0e0", "2026-09-01T00:00:00Z", "raja@example.com");

  // A whole workout with the big button, from Home's Start to Workout complete. Complete set N logs what's typed and,
  // for what isn't, the suggestion in its boxes; the planned sets tick the lift off and Next exercise moves on; ✕ leaves
  // the clock running and Continue carries on; a reload keeps the lift on screen; the cycling is the last step; and
  // Finish adds the session up, with the heart rate the watch measured, asks after the knee, and shares it. The clock
  // runs here, and the test moves it on.
  {
    // Last Wednesday: Hack Squat topped its 8-10 (so it goes up today), the rest didn't (the same again).
    const last = { "Hack Squat": [10, 20], "Leg Press": [10, 45], "Leg Extension": [12, 27], "Hamstring Curl": [10, 30], "Calf Raise": [12, 40] };
    const lastWeek = Object.fromEntries(Object.entries(last).map(([n, [reps, kg]]) => [n, { done: true, kg, sets: [0, 1, 2].map(() => ({ reps, kg })) }]));
    // Today's heart rate so far, as the watch sends it (docs/watch.md): kept on the day through every set logged.
    const hr = { avg: 128, max: 165 };
    const db = { logs: { [K(21)]: day(lastWeek), [K(28)]: { ...day(), steps: 7000, hr } }, plan: {} };
    const { ctx, page } = await open(browser, base, { auth, db, clock: "running", url: null });
    // The phone's share sheet, recorded rather than shown.
    await ctx.addInitScript(() => void (navigator.share = (d) => ((window.__shared = d), Promise.resolve())));
    await page.goto(base);
    await ready(page);
    page.setDefaultTimeout(10000); // something missing fails its check, rather than holding the suite up
    const today = () => db.logs[K(28)];
    const saved = (name) => JSON.stringify(today()?.exercises?.[name]?.sets ?? []);
    const shown = () => flat(page.locator("#workoutView .ex-name").first());
    const big = () => flat(page.locator("#completeSet"));
    const next = async () => ((await page.locator("#nextEx").count()) ? flat(page.locator("#nextEx")) : "");
    const step = () => page.locator("ol.wprog li button").evaluateAll((bs) => bs.findIndex((b) => b.getAttribute("aria-current") === "step"));
    const run = () => page.evaluate(() => JSON.parse(localStorage.getItem("gymlog.workout.v1") ?? "null"));
    const clockShows = async () => ((await page.locator("#wclock").count()) ? flat(page.locator("#wclock")) : "no clock");
    /** The suggestion in set j's boxes, reps and kg, as numbers. */
    const suggested = async (i, j) => [Number(await page.getAttribute(`#s${i}_${j}_r`, "placeholder")), Number(await page.getAttribute(`#s${i}_${j}_k`, "placeholder"))];
    /** Taps the big button, and waits for the workout to move on from it. */
    const tap = async () => {
      const was = `${await shown()} / ${await big()}`;
      await page.click("#completeSet");
      await until(async () => `${await shown()} / ${await big()}` !== was);
    };
    /** Taps the big button through the lift on screen's sets, to Next exercise. */
    const finishLift = async () => {
      while ((await big()) !== "Next exercise") await tap();
    };

    check("Home offers to start today's workout", (await flat(page.locator("#startWorkout"))) === "Start workout", await flat(page.locator("#startWorkout")));
    await page.click("#startWorkout");
    await page.waitForSelector("#workoutView .ex-card");
    const started = await run();
    check(
      "Start workout opens it on its first lift, under the session's name, with the clock just started",
      (await flat(page.locator("#screenTitle"))) === "Legs" && (await shown()) === "Hack Squat" && (await step()) === 0 && started?.day === K(28) && !started.endedAt && /^0:0\d$/.test(await clockShows()),
      `${await flat(page.locator("#screenTitle"))} / ${await shown()} / step ${await step()} / ${JSON.stringify(started)} / ${await clockShows()}`,
    );

    // --- Hack Squat: the suggestion, a tick undone, what's typed, and the weight carried on
    const [r0, k0] = await suggested(0, 0);
    check("nothing logged yet: the big button is set 1's", (await big()) === "Complete set 1" && k0 > 20, `${await big()} / ${r0} × ${k0}`);
    await tap();
    await until(() => saved("Hack Squat") === JSON.stringify([{ reps: r0, kg: k0 }]));
    check(
      "Complete set 1, with nothing typed, logs the suggestion in its boxes, starts the rest, and moves on to set 2",
      saved("Hack Squat") === JSON.stringify([{ reps: r0, kg: k0 }]) && (await big()) === "Complete set 2" && (await page.locator("#restCard").count()) === 1,
      `${saved("Hack Squat")} / ${await big()}`,
    );
    await page.click('[data-check="0:0"]');
    await until(() => saved("Hack Squat") === JSON.stringify([{ reps: null, kg: k0 }]));
    check(
      "a done set's tick undoes it: its reps go, its weight stays, and the big button is back on it",
      saved("Hack Squat") === JSON.stringify([{ reps: null, kg: k0 }]) && (await big()) === "Complete set 1" && (await page.getAttribute('[data-check="0:0"]', "aria-pressed")) === "false",
      `${saved("Hack Squat")} / ${await big()}`,
    );
    const typed = k0 + 2.5, reps = r0 + 2;
    await page.fill("#s0_0_k", String(typed));
    await page.fill("#s0_0_r", String(reps));
    await tap();
    const [r1, k1] = await suggested(0, 1), [r2, k2] = await suggested(0, 2);
    await tap();
    await tap();
    const hack = JSON.stringify(Array(3).fill({ reps, kg: typed }));
    await until(() => saved("Hack Squat") === hack && today().exercises["Hack Squat"].done);
    check(
      "what's typed stays, and the sets after it repeat it, greyed in their boxes and logged, rather than the suggestion",
      r1 === reps && k1 === typed && r2 === reps && k2 === typed && saved("Hack Squat") === hack,
      `${saved("Hack Squat")} (set 2 greyed ${r1} × ${k1} kg, set 3 ${r2} × ${k2} kg)`,
    );
    check(
      "the planned sets tick the lift off, fill its step, and the big button moves on, naming what's next",
      today()?.exercises?.["Hack Squat"]?.done === true && (await page.locator("ol.wprog li").first().getAttribute("class")) === "done" && (await big()) === "Next exercise" && (await next()) === "Next: Leg Press",
      `${JSON.stringify(today()?.exercises?.["Hack Squat"])} / ${await big()} / ${await next()}`,
    );
    await tap();
    check("Next exercise shows the next lift", (await shown()) === "Leg Press" && (await step()) === 1 && (await big()) === "Complete set 1", `${await shown()} / step ${await step()}`);

    // --- ✕ leaves the clock running; Continue carries on at the first lift not done
    await page.click("#closeWorkout");
    await page.waitForSelector("#homeView"); // back where it was started from
    const away = await run();
    check(
      "✕ closes the workout with its clock still running, and Home offers to continue it",
      (await flat(page.locator("#startWorkout"))) === "Continue" && away?.day === K(28) && away.startedAt === started?.startedAt && !away.endedAt && away.pausedAt == null,
      `${await flat(page.locator("#startWorkout"))} / ${JSON.stringify(away)}`,
    );
    await page.clock.fastForward("10:00");
    await openTab(page, "train");
    check("so does Train", (await flat(page.locator("#startBtn"))) === "Continue", await flat(page.locator("#startBtn")));
    await page.click("#startBtn");
    await page.waitForSelector("#workoutView .ex-card");
    await until(async () => /^10:\d\d$/.test(await clockShows()));
    check(
      "Continue opens it where it was, the clock counting the time away",
      (await shown()) === "Leg Press" && /^10:\d\d$/.test(await clockShows()) && (await run())?.startedAt === started?.startedAt,
      `${await shown()} / ${await clockShows()}`,
    );

    // --- a step along the top jumps to its lift, and a reload keeps it on screen
    await page.locator("ol.wprog li button").nth(4).click();
    await until(async () => (await shown()) === "Calf Raise");
    await tap();
    await until(() => saved("Calf Raise") !== "[]");
    const calf = JSON.parse(saved("Calf Raise"))[0];
    await page.reload();
    await page.waitForSelector("#workoutView .ex-card", { timeout: 15000 });
    await until(async () => (await page.locator("#status").textContent()) === "Synced");
    const box = async (id) => ((await page.locator(id).count()) ? page.inputValue(id) : "no box");
    const kept = `${await shown()} / step ${await step()} / ${await box("#s4_0_r")} × ${await box("#s4_0_k")} / ${await big()}`;
    check("a reload keeps the lift on screen, and its set", kept === `Calf Raise / step 4 / ${calf.reps} × ${calf.kg} / Complete set 2`, kept);
    if ((await shown()) !== "Calf Raise") {
      await page.locator("ol.wprog li button").nth(4).click();
      await until(async () => (await shown()) === "Calf Raise");
    }
    await finishLift();
    check("the last lift's Next is the cycling", (await next()) === "Next: Cycling - 15-20 min", (await next()) || "no Next");

    // --- the rest of the lifts, then the cycling: the last step
    await page.locator("ol.wprog li button").nth(1).click();
    await until(async () => (await shown()) === "Leg Press");
    for (const name of ["Leg Press", "Leg Extension", "Hamstring Curl", "Calf Raise"]) {
      await until(async () => (await shown()) === name);
      await finishLift();
      await tap();
    }
    check(
      "the cycling is the workout's last step, done with the big button",
      (await shown()) === "Cycling - 15-20 min" && (await flat(page.locator("#workoutView .ex-step"))) === "Exercise 6 of 6" && (await big()) === "Done with cycling - 15-20 min" && (await next()) === "",
      `${await shown()} / ${await big()} / ${await next()}`,
    );
    await tap();
    await until(() => today()?.cardio === true);
    check("…which ticks it off, and the big button finishes the workout", today()?.cardio === true && (await big()) === "Finish workout", await big());

    // --- Workout complete: the session in numbers, its record, the rings, the knee, Share and Done
    await page.click("#completeSet");
    await page.waitForSelector("#doneStats");
    const all = Object.values(today().exercises).flatMap((r) => r.sets);
    const kg = all.reduce((a, s) => a + s.reps * s.kg, 0);
    const stats = await page.locator("#doneStats .stat .v").allInnerTexts();
    check(
      "Workout complete: the session's name and day, its time, the kg lifted and its sets",
      (await flat(page.locator("#screenTitle"))) === "Workout complete" && (await flat(page.locator(".done-top .sub"))) === "Legs · Wednesday 23 September" &&
        /^10:\d\d$/.test(stats[0]) && stats[1] === kg.toLocaleString("en-IN") && stats[2].replace(/\s/g, "") === "15/15" && all.length === 15,
      `${await flat(page.locator(".done-top .sub"))} / ${stats.join(" | ")} / ${kg} kg in ${all.length} sets`,
    );
    const heart = (await page.locator("#doneHr").count()) ? await flat(page.locator("#doneHr")) : "no heart rate";
    check(
      "under them, the heart rate the watch measured, still on the day after every set logged",
      heart === "Avg 128 bpm · max 165" && JSON.stringify(today().hr) === JSON.stringify(hr),
      `${heart} / ${JSON.stringify(today().hr)}`,
    );
    const pbs = (await page.locator("#doneBests").count()) ? await flat(page.locator("#doneBests")) : "no personal bests";
    check("its personal best: Hack Squat at what was typed", new RegExp(`^1 personal best ?Hack Squat ?${typed} kg × ${reps} heaviest yet`).test(pbs), pbs);
    check("where the day's rings stand, and the steps left", /3,000 steps left for today\./.test(await flat(page.locator("#doneRings"))), await flat(page.locator("#doneRings")));
    await page.click('#doneKnee button[data-knee="kneeAfter:3"]');
    await until(() => today()?.kneeAfter === 3);
    check("a knee day asks how the knee is now, and keeps the answer", today()?.kneeAfter === 3, JSON.stringify({ kneeBefore: today()?.kneeBefore, kneeAfter: today()?.kneeAfter }));
    await page.click("#shareBtn");
    await until(() => page.evaluate(() => !!window.__shared));
    const shared = await page.evaluate(() => window.__shared);
    check("Share sends the session in a line", shared.text === `Legs: 15 sets, ${kg.toLocaleString("en-IN")} kg lifted in ${stats[0]}. 1 personal best.`, JSON.stringify(shared));
    await page.click("#doneBtn");
    await page.waitForSelector("#homeView");
    check(
      "Done goes Home, the workout over: its clock put away, no rest counting down, and the day done",
      (await run()) === null && (await page.locator("#restPill").count()) === 0 && (await flat(page.locator("#startWorkout"))) === "Workout done",
      `${JSON.stringify(await run())} / ${await page.locator("#restPill").count()} rest pill / ${await flat(page.locator("#startWorkout"))}`,
    );
    const lifts = Object.values(today().exercises);
    check("and the day's log holds every lift done, three sets each, and the cycling", lifts.length === 5 && lifts.every((r) => r.done && r.sets?.length === 3) && today().cardio === true, JSON.stringify(today()));
    check("no console errors in a whole workout", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // The workout clock: a tap pauses and resumes it, ↺ restarts it; one left running for hours starts again by itself.
  {
    const uid = "00000000-0000-4000-8000-00000000e0e0", now = Date.parse("2026-09-23T12:00:00");
    const { ctx, page } = await open(browser, base, { auth, db: { logs: {}, plan: {} } });
    await ready(page);
    const seed = (startedAt) => page.evaluate((r) => localStorage.setItem("gymlog.workout.v1", JSON.stringify(r)), { day: K(28), startedAt, user: uid });
    const shown = async () => (await flat(page.locator("#wclock"))).replace(/\s/g, "");
    await seed(now - 60 * 60_000);
    await openWorkout(page);
    check("an hour into the workout, the clock says so", /^1:00:\d\d$/.test(await shown()), await shown());
    // One pill: a tap pauses it where it is, and another resumes it. Paused, ↺ beside it starts it again from 0:00.
    const clockState = async () => `${await page.getAttribute("#wclock", "aria-label")} / ${await page.getAttribute("#wclock", "class")} / ${await page.locator("#wclockRestart").count()}`;
    check("it says a tap pauses it", (await page.getAttribute("#wclock", "aria-label")) === "Pause the clock, 60 minutes in", await clockState());
    await page.click("#wclock");
    await until(async () => (await page.getAttribute("#wclock", "class")).includes("paused"));
    const paused = JSON.parse(await page.evaluate(() => localStorage.getItem("gymlog.workout.v1")));
    check(
      "a tap pauses it where it is, straight away, and ↺ appears beside it",
      paused.pausedAt === now && /^1:00:\d\d$/.test(await shown()) && (await page.getAttribute("#wclock", "aria-label")) === "Resume the clock, paused at 60 minutes" && (await page.getAttribute("#wclockRestart", "aria-label")) === "Restart the clock from 0:00" && (await page.locator("#askDialog[open]").count()) === 0,
      `${JSON.stringify(paused)} / ${await clockState()}`,
    );
    await page.click("#wclock");
    await until(async () => !(await page.getAttribute("#wclock", "class")).includes("paused"));
    const resumed = JSON.parse(await page.evaluate(() => localStorage.getItem("gymlog.workout.v1")));
    check("another tap resumes it, the paused time not counted, and ↺ goes", resumed.pausedAt === undefined && resumed.pausedMs === 0 && resumed.startedAt === paused.startedAt && (await page.locator("#wclockRestart").count()) === 0, `${JSON.stringify(resumed)} / ${await clockState()}`);
    await page.click("#wclock");
    await page.waitForSelector("#wclockRestart");
    await page.click("#wclockRestart");
    await until(async () => /^0:0\d$/.test(await shown()));
    check(
      "↺ asks, then starts it again from 0:00, running",
      /^Restart the clock from 0:00\? It's at 1:00:\d\d, paused\./.test(await lastAsked(page)) && /^0:0\d$/.test(await shown()) && !(await page.getAttribute("#wclock", "class")).includes("paused"),
      `${await lastAsked(page)} / ${await clockState()}`,
    );
    await page.click("#closeWorkout");
    await page.waitForSelector("#trainView");
    await seed(now - 5 * 60 * 60_000);
    await openWorkout(page);
    check("a clock left running for 5 hours starts again when the workout opens", /^0:0\d$/.test(await shown()), await shown());
    // The same when the app comes back already on the workout (a reload).
    await seed(now - 5 * 60 * 60_000);
    await page.reload();
    await page.waitForSelector("#workoutView #wclock", { timeout: 15000 });
    await until(async () => /^0:0\d$/.test(await shown()));
    check("and when the app reloads on the workout", /^0:0\d$/.test(await shown()), await shown());
    // In the middle of the screen, however wide × and Finish are: the session's name, and the clock under it.
    const middle = page.viewportSize().width / 2;
    const centre = async (sel) => {
      const b = await page.locator(sel).boundingBox();
      return b.x + b.width / 2;
    };
    check("the name and the clock sit in the middle of the screen", Math.abs((await centre("#screenTitle")) - middle) < 1 && Math.abs((await centre("#wclock")) - middle) < 1, `${await centre("#screenTitle")} / ${await centre("#wclock")} / ${middle}`);
    await ctx.close();
  }

  // Reloaded on the workout after the session was finished on another device: the clock goes by the day as loaded
  // from Supabase, not this phone's older copy, so a stale clock is dropped rather than started again.
  {
    const uid = "00000000-0000-4000-8000-00000000e0e0", now = Date.parse("2026-09-23T12:00:00");
    const { ctx, page, db } = await open(browser, base, { auth, db: { logs: {}, plan: {} } });
    await ready(page);
    await openWorkout(page);
    db.logs[K(28)] = day(Object.fromEntries(LEGS.map((n) => [n, { done: true, sets: [{ reps: 10, kg: 40 }] }])));
    await page.evaluate((r) => localStorage.setItem("gymlog.workout.v1", JSON.stringify(r)), { day: K(28), startedAt: now - 5 * 60 * 60_000, user: uid });
    await page.reload();
    await page.waitForSelector("#workoutView .ex-card", { timeout: 15000 });
    await until(async () => (await page.locator("#status").textContent()) === "Synced");
    await until(async () => (await page.locator("#workoutView .wclock").count()) === 0); // the clock redraws each second
    const run = JSON.parse((await page.evaluate(() => localStorage.getItem("gymlog.workout.v1"))) ?? "null");
    check("a reload on a workout finished elsewhere drops its stale clock, not restarts it", run === null && (await page.locator("#workoutView .wclock").count()) === 0, JSON.stringify(run));
    await ctx.close();
  }

  // A finished workout, opened again to look it over, starts no clock.
  {
    const done = Object.fromEntries(LEGS.map((n) => [n, { done: true, sets: [{ reps: 10, kg: 40 }] }]));
    const { ctx, page } = await open(browser, base, { auth, db: { logs: { [K(28)]: day(done) }, plan: {} } });
    await ready(page);
    await openTab(page, "train");
    check("a finished day's button says Review", /Review/.test(await flat(page.locator("#startBtn"))), await flat(page.locator("#startBtn")));
    // Yesterday's workout was left running.
    const running = { day: K(27), startedAt: Date.parse("2026-09-22T18:00:00Z"), user: "00000000-0000-4000-8000-00000000e0e0" };
    await page.evaluate((r) => localStorage.setItem("gymlog.workout.v1", JSON.stringify(r)), running);
    await openWorkout(page);
    check("reviewing it starts no workout clock", (await page.locator("#workoutView .wclock").count()) === 0 && JSON.parse(await page.evaluate(() => localStorage.getItem("gymlog.workout.v1"))).day === K(27));
    await page.click("#finishBtn");
    await page.click("#doneBtn");
    await page.waitForSelector("#homeView");
    const reviewed = JSON.parse((await page.evaluate(() => localStorage.getItem("gymlog.workout.v1"))) ?? "null");
    // A finished clock, opened again: its duration, with nothing to restart.
    await page.evaluate((r) => localStorage.setItem("gymlog.workout.v1", JSON.stringify(r)), { day: K(28), startedAt: Date.parse("2026-09-23T09:00:00"), endedAt: Date.parse("2026-09-23T09:52:00"), user: "00000000-0000-4000-8000-00000000e0e0" });
    await openWorkout(page);
    check("a finished workout's clock shows how long it took, and can't be restarted", (await page.$eval("#wclock", (e) => e.tagName)) === "SPAN" && (await flat(page.locator("#wclock"))) === "52:00", await flat(page.locator("#wclock")));
    await page.click("#closeWorkout");
    await page.waitForSelector("#trainView");
    await page.evaluate((r) => localStorage.setItem("gymlog.workout.v1", JSON.stringify(r)), reviewed);
    check("and closing the review leaves another day's running clock alone", reviewed?.startedAt === running.startedAt, JSON.stringify(reviewed));
    await ctx.close();
  }

  // − Set asks before taking a set with numbers in it (an empty one just goes: today.e2e.mjs), and skipping a lift with
  // a mouse puts the cursor in the reason box.
  {
    const { ctx, page } = await open(browser, base, { auth, db: { logs: { [K(0)]: day() }, plan: null }, mobile: false });
    await ready(page);
    await openWorkout(page, 0);
    await page.click('[data-addset="0"]');
    await page.fill("#s0_3_r", "10");
    await page.fill("#s0_3_k", "20");
    await answerAsk(page, "cancel");
    await page.click('[data-rmset="0"]');
    await until(async () => (await lastAsked(page)) !== "" && (await page.locator("#askDialog[open]").count()) === 0);
    const removeAsk = await lastAsked(page);
    check("− Set on a set with numbers asks first, and Cancel keeps it", removeAsk === "Remove set 4 (10\u00a0×\u00a020\u00a0kg)?" && (await page.locator("#s0_3_r").count()) === 1, removeAsk);
    await page.click('[data-more="0"]');
    await page.click('[data-skip="0"]');
    await until(() => page.evaluate(() => document.activeElement?.dataset.reason !== undefined));
    check("with a mouse, skipping focuses the reason box", await page.evaluate(() => document.activeElement?.id === "reason0"));
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  await typingASet({ browser, base, check, auth });
}
