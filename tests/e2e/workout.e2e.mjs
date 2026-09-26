// The workout, one lift at a time: its clock (pause, resume, restart, one left running for hours or finished
// elsewhere, and a finished day opened to review it), − Set asking before it takes a set with numbers, and skipping a
// lift with a mouse putting the cursor in the reason box. Logging sets, skip and swap in the day's flow are in
// today.e2e.mjs; the rest timer, set types, supersets and voice have suites of their own.
import { K, answerAsk, flat, lastAsked, open, openTab, openWorkout, ready, session, until } from "./harness.mjs";

const LEGS = ["Hack Squat", "Leg Press", "Leg Extension", "Hamstring Curl", "Calf Raise"];
const day = (exercises = {}) => ({ exercises, warmup: [], cardio: false, steps: null, weight: null, note: "" });

export default async function workout({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-00000000e0e0", "2026-09-01T00:00:00Z", "raja@example.com");

  // The workout clock: tapping it starts it again from 0:00; one left running for hours starts again by itself.
  {
    const uid = "00000000-0000-4000-8000-00000000e0e0", now = Date.parse("2026-09-23T12:00:00");
    const { ctx, page } = await open(browser, base, { auth, db: { logs: {}, plan: {} } });
    await ready(page);
    const seed = (startedAt) => page.evaluate((r) => localStorage.setItem("gymlog.workout.v1", JSON.stringify(r)), { day: K(28), startedAt, user: uid });
    const shown = async () => (await flat(page.locator("#wclock"))).replace(/\s/g, "");
    await seed(now - 60 * 60_000);
    await openWorkout(page);
    check("an hour into the workout, the clock says so", /^1:00:\d\d$/.test(await shown()), await shown());
    // Tapped, the clock opens its own sheet: stop it for a while, or start it again from 0:00.
    await page.click("#wclock");
    await page.waitForSelector("#askDialog[open]");
    const sheet = { title: await flat(page.locator("#askTitle")), choices: await page.locator("#askDialog [data-choice]").allInnerTexts() };
    check("tapping the clock opens its sheet: Pause, and Restart from 0:00", sheet.title === "Workout clock" && sheet.choices.join("|") === "Pause the clock|Restart from 0:00" && (await page.locator("#askCancel").count()) === 1, JSON.stringify(sheet));
    await page.click('#askDialog [data-choice="pause"]');
    await until(async () => (await page.getAttribute("#wclock", "class")).includes("paused"));
    const paused = JSON.parse(await page.evaluate(() => localStorage.getItem("gymlog.workout.v1")));
    check("Pause stops the clock where it is, and says so", paused.pausedAt === now && /^Clock paused at 60 minutes\. Resume or restart it$/.test(await page.getAttribute("#wclock", "aria-label")) && /^1:00:\d\d$/.test(await shown()), JSON.stringify(paused));
    await page.click("#wclock");
    await page.waitForSelector('#askDialog [data-choice="resume"]');
    await page.click('#askDialog [data-choice="resume"]');
    await until(async () => !(await page.getAttribute("#wclock", "class")).includes("paused"));
    const resumed = JSON.parse(await page.evaluate(() => localStorage.getItem("gymlog.workout.v1")));
    check("Resume starts it again, the paused time not counted", resumed.pausedAt === undefined && resumed.pausedMs === 0 && resumed.startedAt === paused.startedAt, JSON.stringify(resumed));
    await page.click("#wclock");
    await page.waitForSelector('#askDialog [data-choice="restart"]');
    await page.click('#askDialog [data-choice="restart"]');
    await until(async () => /^0:0\d$/.test(await shown()));
    check("Restart from 0:00 starts it again from 0:00", /^0:0\d$/.test(await shown()), await shown());
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
    check("the clock names what a tap does", /Pause or restart the clock$/.test(await page.getAttribute("#wclock", "aria-label")));
    // In the middle of the screen, however wide × and Finish are: the title, and the time itself, its mark beside it.
    const middle = page.viewportSize().width / 2;
    const title = await page.locator("#screenTitle").boundingBox();
    const time = await page.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.querySelector("#wclock").firstChild);
      const b = r.getBoundingClientRect();
      return b.x + b.width / 2;
    });
    check("the title and the time sit in the middle of the screen", Math.abs(title.x + title.width / 2 - middle) < 1 && Math.abs(time - middle) < 1, `${title.x + title.width / 2} / ${time} / ${middle}`);
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
}
