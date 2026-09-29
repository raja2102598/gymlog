// The workout, one lift at a time: its clock (a tap pauses and resumes it, ↺ restarts it; one left running for hours
// or finished elsewhere, and a finished day opened to review it), − Set asking before it takes a set with numbers,
// skipping a lift with a mouse putting the cursor in the reason box, and a set typed in on a phone logging what was
// typed. Logging sets, skip and swap in the day's flow are in today.e2e.mjs; the rest timer, set types, supersets and
// voice have suites of their own.
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
