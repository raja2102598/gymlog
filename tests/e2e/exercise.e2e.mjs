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
    check("the photos come from free-exercise-db, pinned to the library's commit", db.photos.length === 2 && db.photos.every((u) => /free-exercise-db@[0-9a-f]{40}\/exercises\/Leg_Extensions\/[01]\.jpg$/.test(u)), db.photos.join(", "));

    // A lift's page: how to do it, under its progress.
    await page.goto(base + "#progress/lift/Calf%20Raise");
    await page.waitForSelector("#liftHowTo .howto-steps li");
    check("a lift's page ends with how to do it", (await flat(page.locator("#liftHowTo h2"))) === "How to do it" && (await page.locator("#liftHowTo .howto-steps li").count()) >= 2);
    check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
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
