// The rest timer (RAJ-35): it starts when a set gets its reps, counts down in the workout's rest card with pause,
// +15 s and skip, buzzes and says "Rest over" at zero, takes the plan's default from Settings and a lift's own length
// from the plan editor, and survives a reload. The clock runs here, and the test moves it on. Then, in the Android
// app, what Settings says Android allows its alerts.
import { flat, open, openSetting, openTab, openWorkout, planDone, ready, session, until, TAB_VIEWS, onDefaultPlan } from "./harness.mjs";

export default async function rest(t) {
  await timer(t);
  await androidSettings(t);
}

async function timer({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000035", "2026-08-26T05:00:00Z", "t@example.com");
  const db = onDefaultPlan();
  const { ctx, page } = await open(browser, base, { auth, db, clock: "running", url: null });
  // The buzz at zero, recorded rather than felt.
  await ctx.addInitScript(() => {
    window.__buzz = [];
    navigator.vibrate = (p) => (window.__buzz.push(p), true);
  });
  await page.goto(base);
  await ready(page);
  // The rest card, in the workout under the current exercise. Its ring shows the time left while running; paused, the
  // line under "Paused" says what's left; at zero its heading says "Rest over".
  const bar = page.locator("#restCard");
  const time = async () => {
    const h = await flat(page.locator("#restCard .rest-h"));
    if (h === "Rest over") return h;
    if (h === "Paused") return (await flat(page.locator("#restCard .sub"))).replace(/ left$/, "");
    return flat(page.locator("#restCard .rest-time"));
  };
  const secs = async () => {
    const [m, s] = (await time()).split(":").map(Number);
    return m * 60 + s;
  };
  // The page's clock runs as the test does, so a reading can be a second or two under the exact one.
  const about = async (want) => {
    const got = await secs();
    return got <= want && got >= want - 2;
  };
  // Legs: Hack Squat (0), Leg Press (1), Leg Extension (2), Hamstring Curl (3), Calf Raise (4). The workout shows one
  // lift at a time, so its set boxes are found by their ids.
  const box = (i, j, f) => page.locator(`#s${i}_${j}_${f === "kg" ? "k" : "r"}`);
  /** Leaves the workout (it keeps running), back to Train. */
  const closeWorkout = async () => {
    await page.click("#closeWorkout");
    await page.waitForSelector("#trainView");
  };

  await openWorkout(page, "Leg Press");
  check("no timer before any set is logged", (await bar.count()) === 0);

  // --- kg first, then reps: the reps start it, at the plan's default of 90 s
  await box(1, 0, "kg").fill("50");
  check("a set's kg alone doesn't start it", (await bar.count()) === 0);
  await box(1, 0, "reps").fill("10");
  await bar.waitFor();
  check("reps start it in the workout's rest card, at the plan's 90 s", await about(90), await time());
  const sizes = await page.$$eval("#restPause, #restAdd, #restSkip", (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  check("pause, +15 s and skip are there, each at least 44px tall", sizes.length === 3 && sizes.every((h) => h >= 44), sizes.join(", "));

  await page.clock.fastForward(30_000);
  await until(async () => (await secs()) <= 60);
  check("counts down with the clock", await about(60), await time());
  await box(1, 0, "reps").fill("12");
  check("changing that set's reps doesn't start it again", await about(60), await time());

  // --- pause holds it, resume carries on, +15 s adds to it
  await page.click("#restPause");
  check("pausing offers Resume", (await page.locator("#restPause").getAttribute("aria-label")) === "Resume rest" && (await flat(page.locator("#restCard .rest-h"))) === "Paused");
  const held = await secs();
  await page.clock.fastForward(60_000);
  check("paused, it holds", (await secs()) === held, `${held} then ${await time()}`);
  await page.click("#restPause");
  await page.click("#restAdd");
  check("+15 s adds a quarter of a minute", await about(held + 15), await time());
  await page.click("#restSkip");
  await bar.waitFor({ state: "detached" });
  check("skip takes it away", (await bar.count()) === 0);

  // --- the next set starts it again; a correction to an earlier one doesn't
  await box(1, 1, "reps").fill("10");
  await bar.waitFor();
  check("the next set starts it again from the full length", await about(90), await time());
  await page.click("#restSkip");
  await bar.waitFor({ state: "detached" });
  await box(1, 0, "reps").fill("");
  await box(1, 0, "reps").fill("11");
  check("correcting an earlier set, with a later one logged, doesn't start it", (await bar.count()) === 0);

  // --- a lift's own length, from the plan editor (Train's Change plan)
  await closeWorkout();
  await page.click("#changePlan");
  await page.waitForSelector("#planView");
  await page.fill("#pe_x2_rest", "45"); // Leg Extension, on today's Legs day
  await until(() => db.plan?.days?.[2]?.exercises?.[2]?.rest === "45");
  check("a lift's rest is saved with the plan", db.plan?.days?.[2]?.exercises?.[2]?.rest === "45");
  await planDone(page);
  await openWorkout(page, "Leg Extension");
  await box(2, 0, "reps").fill("12");
  await bar.waitFor();
  check("that lift's sets rest for its own 45 s", await about(45), await time());

  // --- zero: it buzzes once and says so
  await page.clock.fastForward(46_000);
  await until(async () => (await time()) === "Rest over");
  check("at zero it says Rest over", (await time()) === "Rest over");
  check("and tells a screen reader, once", (await flat(page.locator("#restCard [role=status]"))) === "Rest over.");
  check("it buzzed, once", (await page.evaluate(() => window.__buzz.length)) === 1, String(await page.evaluate(() => window.__buzz.length)));
  check("there's nothing to pause once it's over", await page.locator("#restPause").isDisabled());
  await page.click("#restAdd");
  check("+15 s after it's over counts a quarter of a minute from now", await about(15), await time());

  // --- a reload keeps it (the workout reopens on its day, with the rest still running)
  await page.reload();
  await page.waitForSelector("#workoutView .ex-card", { timeout: 15000 });
  await until(async () => (await page.locator("#status").textContent()) === "Synced");
  await bar.waitFor();
  check("a reload keeps the timer running", await about(15), await time());
  await page.click("#restSkip");

  // --- Settings: the plan's default
  await closeWorkout();
  await openTab(page, "settings");
  await openSetting(page, "setTraining");
  await page.fill("#restSec", "120");
  await until(() => db.plan?.restSec === 120);
  check("Settings saves the plan's default rest", db.plan?.restSec === 120);
  await page.click("#backBtn");
  await page.waitForSelector(TAB_VIEWS); // Settings closes onto the tab it was opened from
  await openWorkout(page, "Hack Squat");
  await box(0, 0, "reps").fill("10");
  await bar.waitFor();
  check("a lift without its own length rests for the new default", await about(120), await time());

  // --- away from the workout, a pill keeps counting and leads back
  await closeWorkout();
  check("away from the workout, the rest pill shows the countdown", /^\d:\d\d/.test(await flat(page.locator("#restPill"))), await flat(page.locator("#restPill")));
  await page.click("#restPill");
  await page.waitForSelector("#workoutView #restCard");
  check("the pill leads back to the workout, rest still running", (await bar.count()) === 1);

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}

/**
 * In the page, before it loads: the Android app, as far as the page can tell. Capacitor takes the page for Android's,
 * and the app's own plugins (RestTimer, GymSync and the rest) answer from `window.__native.answers` ({ plugin: {
 * method: answer } }; anything else gets `{}`), each call kept in `window.__native.calls` as "Plugin.method".
 * Capacitor's own plugins (App, Health) answer as they do in a browser. `__away()` and `__back()` leave the app and
 * come back to it, as for Android's settings: Capacitor's App says "resume" as the page shows again.
 */
function androidApp(answers) {
  window.__native = { answers, calls: [] };
  window.CapacitorCustomPlatform = { name: "android" };
  const anyMethod = { find: () => ({ rtype: "promise" }) };
  window.Capacitor = {
    isNativePlatform: () => true,
    PluginHeaders: ["RestTimer", "GymSync", "GymWidget", "Speech", "AppUpdate", "GoogleSignIn"].map((name) => ({ name, methods: anyMethod })),
    nativePromise: async (plugin, method) => {
      window.__native.calls.push(`${plugin}.${method}`);
      return window.__native.answers[plugin]?.[method] ?? {};
    },
  };
  let hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  const show = (h) => {
    hidden = h;
    document.dispatchEvent(new Event("visibilitychange"));
  };
  window.__away = () => show(true);
  window.__back = () => show(false);
}

// Settings → Rest timer & effort in the Android app, on a Samsung phone on Android 16, notifications on: under them,
// "Rest over" isn't allowed to be on time yet and Live Updates are off, each with a way to Android's page for it, and
// coming back from there reads it again.
async function androidSettings({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000036", "2026-08-26T05:00:00Z", "t@example.com");
  const { ctx, page, db } = await open(browser, base, { auth, db: onDefaultPlan(), url: null });
  await ctx.addInitScript(androidApp, { RestTimer: { checkPermissions: { notifications: "granted" }, checkAlarms: { exact: false, liveUpdates: false, samsung: true } } });
  await page.goto(base);
  await ready(page);
  await openTab(page, "settings");
  await openSetting(page, "setTraining");
  const exact = page.locator("#restExactStatus"), live = page.locator("#restLiveStatus");
  const called = (name) => page.evaluate((n) => window.__native.calls.includes(n), name);
  // A row's button, or "" when there's none, without waiting for one.
  const button = async (id) => (await page.locator(id).allTextContents()).join(" | ");
  // Taps it if it's there: if not, the check after says what was called instead.
  const tap = async (id) => {
    if (await page.locator(id).count()) await page.click(id);
  };
  await exact.waitFor();
  check(
    "Android app: under notifications, Alarms & reminders says Rest over can be late, with Open settings",
    (await flat(exact)) === "Off, so “Rest over” can come a few minutes late while the phone is idle. Turn it on to get it on time." && (await button("#restExactOpen")) === "Open settings",
    `${await flat(exact)} [${await button("#restExactOpen")}]`,
  );
  check(
    "Android app: Live Updates are off, with Open settings and, on a Samsung, the Now Bar's Developer option",
    (await flat(live)) ===
      "Off. Turn them on to keep your workout’s clock and rest countdown at the top of the lock screen. Samsung’s Now Bar shows them only with Developer options → Live notifications for all apps on." &&
      (await button("#restLiveOpen")) === "Open settings",
    `${await flat(live)} [${await button("#restLiveOpen")}]`,
  );
  await tap("#restExactOpen");
  await until(() => called("RestTimer.openExactAlarmSettings"));
  check("its Open settings opens Android's Alarms & reminders page for Gym Log", await called("RestTimer.openExactAlarmSettings"), (await page.evaluate(() => window.__native.calls)).join(", "));
  // Allowed there, then back to the app.
  await page.evaluate(() => {
    window.__native.answers.RestTimer.checkAlarms = { exact: true, liveUpdates: false, samsung: true };
    window.__away();
    window.__back();
  });
  await until(async () => (await flat(exact)).startsWith("On"));
  check(
    "back from Android's settings, it reads it again: Rest over comes on time, and there's nothing to open",
    (await flat(exact)) === "On. “Rest over” comes the moment a rest ends, even with the phone locked." && (await button("#restExactOpen")) === "",
    `${await flat(exact)} [${await button("#restExactOpen")}]`,
  );
  await tap("#restLiveOpen");
  await until(() => called("RestTimer.openLiveUpdateSettings"));
  check("Live Updates' Open settings opens Android's Live Updates page for Gym Log", await called("RestTimer.openLiveUpdateSettings"), (await page.evaluate(() => window.__native.calls)).join(", "));
  check("Android app: no console errors", page.errors.length === 0 && db.unexpected.length === 0, [...page.errors, ...db.unexpected].join(" | "));
  await ctx.close();
}
