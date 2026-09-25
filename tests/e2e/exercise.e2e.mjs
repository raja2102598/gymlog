// Exercise pictures and how-to (free-exercise-db): photos in place of one icon for every lift in Train and the
// library, the steps and photos behind a workout card's ? and on a lift's page. Also: the avatar in the same place
// on every tab, and a finished workout opened to review it starting no clock.
import { K, flat, open, openTab, openWorkout, ready, session, settled, until } from "./harness.mjs";

export const covers = [
  "src/components/exercise/ExerciseThumb.tsx",
  "src/components/exercise/HowTo.tsx",
  "src/lib/exerciseMedia.ts",
  "src/components/ds/ProfileButton.tsx",
  "scripts/build-exercise-media.mjs",
];

const LEGS = ["Hack Squat", "Leg Press", "Leg Extension", "Hamstring Curl", "Calf Raise"];
const day = (exercises = {}) => ({ exercises, warmup: [], cardio: false, steps: null, weight: null, note: "" });

export default async function exercise({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-00000000e0e0", "2026-09-01T00:00:00Z", "raja@example.com");

  {
    const { ctx, page, db } = await open(browser, base, { auth, db: { logs: {}, plan: {} } });
    await ready(page);

    // The avatar opens Settings from the same spot on every tab.
    const spots = [];
    for (const tab of ["home", "train", "progress", "health"]) {
      await openTab(page, tab);
      await page.evaluate(settled); // the view's fade-in moves it a few pixels
      const b = await page.locator("#settingsBtn").boundingBox();
      spots.push(b ? `${Math.round(b.x)},${Math.round(b.y)}` : "none");
    }
    check("every tab has the avatar for Settings, in the same place", spots.every((s) => s !== "none" && s === spots[0]), spots.join(" | "));
    check("and it's the only way to Settings in the header: no Edit on Health", (await page.locator("#editGoals").count()) === 0);

    // Train: a photo for each library lift, loaded from the app's own files.
    await openTab(page, "train");
    const thumbs = await page.$$eval("#liftRows .lrow-main img.ex-thumb", (els) => els.map((e) => ({ src: e.getAttribute("src"), ok: e.complete && e.naturalWidth > 0, alt: e.getAttribute("alt") })));
    await until(async () => (await page.$$eval("#liftRows img.ex-thumb", (els) => els.every((e) => e.complete && e.naturalWidth > 0))) === true);
    check("Train: each lift the library knows shows its photo, not the one dumbbell icon", thumbs.length === LEGS.length && thumbs.every((t) => /^\/exercises\/thumbs\/[A-Za-z0-9_-]+\.webp$/.test(t.src)), JSON.stringify(thumbs));
    check("the photos load, and are decorative (the name is beside them)", (await page.$$eval("#liftRows img.ex-thumb", (els) => els.every((e) => e.naturalWidth > 0 && e.getAttribute("alt") === ""))) === true);

    // The library: a lift's photo and name open how to do it, before adding it.
    await page.click("#addExercise");
    await page.waitForSelector("#libList");
    const info = page.locator('[data-info="Barbell_Squat"]');
    check("the library says its photos open how to do a lift", (await info.getAttribute("aria-expanded")) === "false" && /See how to do it/.test(await flat(info)));
    await info.click();
    await page.waitForSelector("#libHow_Barbell_Squat .howto-steps li");
    check("tapping one shows its photos and steps under it", (await info.getAttribute("aria-expanded")) === "true" && (await page.locator("#libHow_Barbell_Squat .howto-photos img").count()) === 2 && (await page.locator("#libHow_Barbell_Squat .howto-steps li").count()) >= 3);
    check("and a way to videos of it", /^https:\/\/www\.youtube\.com\/results\?search_query=how%20to%20do%20Barbell%20Squat%20exercise$/.test(await page.getAttribute("#libHow_Barbell_Squat .howto-video", "href")), await page.getAttribute("#libHow_Barbell_Squat .howto-video", "href"));
    const moving = await page.$eval("#libHow_Barbell_Squat .howto-photos figure + figure", (e) => getComputedStyle(e).animationName);
    check("the two photos take turns, so the lift is seen moving", moving === "howtoMove", moving);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#libList", { state: "hidden" });

    // The workout: ? shows the plan's note, the photos and the steps.
    await openWorkout(page, "Leg Extension");
    const how = page.locator("#workoutView .ex-card .howto").first();
    check("the workout card's ? says what it's for", (await how.getAttribute("aria-label")) === "How to do Leg Extension");
    await how.click();
    await page.waitForSelector("#workoutView .howto-steps li");
    const steps = await page.locator("#workoutView .howto-steps li").count();
    const photos = await page.$$eval("#workoutView .howto-photos img", (els) => els.map((e) => e.getAttribute("alt")));
    check("? shows the start and finish photos, named for screen readers", photos.join("|") === "Leg Extension, start position|Leg Extension, finish position", photos.join("|"));
    check("and the steps, numbered", steps >= 3 && /leg extension machine/i.test(await flat(page.locator("#workoutView .howto-steps li").first())), String(steps));
    check("with where they come from", /free-exercise-db, public domain/.test(await flat(page.locator("#workoutView .howto-credit"))));
    // The photos load lazily: bring them on screen and wait for both before looking at what was asked for.
    await page.locator("#workoutView .howto-photos img").first().scrollIntoViewIfNeeded();
    await until(() => db.photos.filter((u) => u.includes("/Leg_Extensions/")).length === 2);
    check("the photos come from free-exercise-db, pinned to the library's commit", db.photos.filter((u) => u.includes("/Leg_Extensions/")).length === 2 && db.photos.every((u) => /free-exercise-db@[0-9a-f]{40}\/exercises\/[A-Za-z_]+\/[01]\.jpg$/.test(u)), db.photos.join(", "));

    // A lift's page: how to do it, under its progress.
    await page.goto(base + "#progress/lift/Calf%20Raise");
    await page.waitForSelector("#liftHowTo .howto-steps li");
    check("a lift's page ends with how to do it", (await flat(page.locator("#liftHowTo h2"))) === "How to do it" && (await page.locator("#liftHowTo .howto-steps li").count()) >= 2);
    check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // A plan saved before the library (its lifts unlinked, as on an older phone) still shows each lift's photo.
  {
    const days = Array.from({ length: 7 }, (_, i) => ({ name: i === 2 ? "Shoulders + Legs" : "Rest", exercises: i === 2 ? ["DB Shoulder Press", "Lateral Raises", "Hamstring Curl", "My Odd Lift"].map((name) => ({ name, sets: "3", reps: "10-12" })) : [] }));
    const { ctx, page } = await open(browser, base, { auth, db: { logs: {}, plan: { days } } });
    await ready(page);
    await openTab(page, "train");
    const srcs = await page.$$eval("#liftRows .lrow-main", (rows) => rows.map((r) => r.querySelector("img.ex-thumb")?.getAttribute("src") ?? "icon"));
    check(
      "unlinked lifts from an older plan get the photo of the lift picked for their name; a name nobody picked keeps the icon",
      srcs.join("|") === "/exercises/thumbs/Dumbbell_Shoulder_Press.webp|/exercises/thumbs/Side_Lateral_Raise.webp|/exercises/thumbs/Lying_Leg_Curls.webp|icon",
      srcs.join("|"),
    );
    await ctx.close();
  }

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
    await page.click("#wclock"); // the harness accepts the "Restart the workout clock?" question
    await until(async () => /^0:0\d$/.test(await shown()));
    check("tapping the clock starts it again from 0:00", /^0:0\d$/.test(await shown()), await shown());
    await page.click("#closeWorkout");
    await page.waitForSelector("#trainView");
    await seed(now - 5 * 60 * 60_000);
    await openWorkout(page);
    check("a clock left running for 5 hours starts again when the workout opens", /^0:0\d$/.test(await shown()), await shown());
    check("the clock names what a tap does", /Restart the clock$/.test(await page.getAttribute("#wclock", "aria-label")));
    await ctx.close();
  }

  // Skipping a day's workout, with why, and taking it back.
  {
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
    await page.click("#unskipHome");
    await until(() => db.logs[K(28)] && db.logs[K(28)].skip === undefined);
    check("Undo puts the workout back", (await page.locator("#startWorkout").count()) === 1 && (await page.locator("#skipHome").count()) === 1);
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
    check("and closing the review leaves another day's running clock alone", JSON.parse((await page.evaluate(() => localStorage.getItem("gymlog.workout.v1"))) ?? "null")?.startedAt === running.startedAt);
    await ctx.close();
  }
}
