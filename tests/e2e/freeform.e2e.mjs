// A free-form workout on any day (RAJ-36): started from Train ("Empty workout") in place of the planned session,
// named, lifts added by name with suggestions, logged in the workout as usual; Progress counts it as an extra
// session, and going back to the plan keeps what was logged.
import fs from "node:fs";
import { K, flat, open, openSetting, openTab, openWorkout, ready, session, until } from "./harness.mjs";

export default async function freeform({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000036", "2026-08-26T05:00:00Z", "t@example.com");
  // A day logged four weeks ago, so the account keeps the default plan (Legs on Wednesdays) with no first-run step.
  const db = { logs: { [K(0)]: { exercises: {}, warmup: [], cardio: false, steps: 6000, weight: null, note: "" } }, plan: null };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);
  const today = () => db.logs[K(28)];
  // Train's session card: a planned day is titled by its name; a free workout by a name field in its place.
  const title = async () => ((await page.locator("#freeName").count()) ? `free: ${await page.inputValue("#freeName")}` : flat(page.locator("#sessName")));
  const names = async () => (await page.locator("#liftRows .lrow-main .lift-t").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const focused = () => page.evaluate(() => document.activeElement?.id);

  // --- starting one
  await openTab(page, "train");
  check("Legs is today's workout to begin with", (await title()) === "Legs");
  await page.click("#freeStart");
  await until(() => !!today()?.free);
  check("Empty workout saves one with the day", JSON.stringify(today()?.free) === '{"name":"","lifts":[]}', JSON.stringify(today()?.free));
  check("it takes the day's place, with no lifts yet", (await title()) === "free: " && (await names()).length === 0);
  check("and says so, rather than calling it a rest day", (await flat(page.locator("#liftPill"))) === "No lifts yet", await flat(page.locator("#liftPill")));
  check("its name field has focus, with a field to add a lift by name under it", (await focused()) === "freeName" && (await page.locator("#addLift").count()) === 1);
  await openTab(page, "home");
  check("unnamed, Home calls it a free workout", (await flat(page.locator("#todayName"))) === "Free workout");
  await openTab(page, "train");
  await page.fill("#freeName", "Hotel gym");
  await until(() => today()?.free?.name === "Hotel gym");
  await openTab(page, "home");
  check("it takes a name, which titles the day", today()?.free?.name === "Hotel gym" && (await flat(page.locator("#todayName"))) === "Hotel gym");
  await openTab(page, "train");

  // --- adding lifts
  const offered = await page.locator("#addLiftList option").evaluateAll((os) => os.map((o) => o.value));
  check("lifts from the plan are offered", offered.includes("Leg Press") && offered.includes("Lat Pulldown"), offered.join(", "));
  await page.fill("#addLift", "Goblet Squat");
  await page.press("#addLift", "Enter");
  await until(async () => (await names()).length === 1 && today()?.free?.lifts?.length === 1);
  check("a lift added by name gets its row", (await names()).join("|") === "Goblet Squat" && JSON.stringify(today()?.free?.lifts) === '["Goblet Squat"]');
  check("the field empties and keeps focus for the next one", (await page.inputValue("#addLift")) === "" && (await focused()) === "addLift");
  await page.fill("#addLift", "Leg Press");
  await page.click(".addlift button[type=submit]");
  await until(async () => (await names()).length === 2);
  const lpLine = await flat(page.locator("#liftRows li").nth(1).locator(".row-d"));
  check("a lift from the plan brings its sets and reps", /^3 × 10.12\b/.test(lpLine), lpLine);
  check("Leg Press is offered no more", !(await page.locator("#addLiftList option").evaluateAll((os) => os.map((o) => o.value))).includes("Leg Press"));

  // --- logging and removing, in the workout
  await openWorkout(page, "Goblet Squat");
  check("the workout is titled by its name", (await flat(page.locator("#screenTitle"))) === "Hotel gym");
  await page.fill("#s0_0_r", "12");
  await page.fill("#s0_0_k", "20");
  await until(() => today()?.exercises?.["Goblet Squat"]?.sets?.[0]?.kg === 20);
  check("its sets log as usual", JSON.stringify(today()?.exercises?.["Goblet Squat"]?.sets) === '[{"reps":12,"kg":20}]', JSON.stringify(today()?.exercises?.["Goblet Squat"]));
  check("the day counts its lifts: one of two done", (await page.locator("ol.wprog li").count()) === 2 && (await page.locator("ol.wprog li.done").count()) === 1);
  await page.click("#nextEx");
  await until(async () => (await flat(page.locator("#workoutView .ex-name .nm"))) === "Leg Press");
  await page.click('[data-more="1"]');
  await page.click('[data-freerm="1"]');
  await until(() => today()?.free?.lifts?.length === 1);
  check("Remove from this workout takes a lift out", JSON.stringify(today()?.free?.lifts) === '["Goblet Squat"]' && (await page.locator("ol.wprog li").count()) === 1);
  await page.click("#closeWorkout");
  await page.waitForSelector("#trainView");
  check("and Train's rows follow", (await names()).join("|") === "Goblet Squat" && (await page.locator("#liftRows li.done").count()) === 1);

  // --- Progress: an extra session, not a planned one
  await openTab(page, "progress");
  check("Progress counts it as an extra session", /^0 of \d this week, and 1 extra/.test(await flat(page.locator("#planKept"))), await flat(page.locator("#planKept")));
  check("and not as one of the plan's", (await flat(page.locator("#dashStats .stat").first())).startsWith("0"), await flat(page.locator("#dashStats .stat").first()));

  // --- the CSV names it; a reload keeps it
  await openTab(page, "settings");
  await openSetting(page, "setData");
  const [csv] = await Promise.all([page.waitForEvent("download"), page.click("#csvBtn")]);
  const text = fs.readFileSync(await csv.path(), "utf8");
  check("the CSV gives its name as the session", text.includes(`${K(28)},Hotel gym,Goblet Squat,1,12,20,working,`), text);
  await page.click("#backBtn");
  await page.waitForSelector("#homeView");
  await page.reload();
  await ready(page);
  await openTab(page, "train");
  check("a reload keeps it", (await title()) === "free: Hotel gym" && (await names()).join("|") === "Goblet Squat");

  // --- back to the plan: what was logged stays
  check("the way back names the usual workout", (await flat(page.locator("#freeEnd"))) === "Back to Legs");
  await page.click("#freeEnd");
  await until(() => !today()?.free);
  check("Back to Legs brings the planned lifts back", (await title()) === "Legs" && (await names()).slice(0, 5).join("|") === "Hack Squat|Leg Press|Leg Extension|Hamstring Curl|Calf Raise", (await names()).join("|"));
  check("what was logged stays, as a lift outside the plan", (await names()).filter((n) => n === "Goblet Squat").length === 1);
  await openWorkout(page, "Goblet Squat");
  check("and the workout says it's not in this workout", (await flat(page.locator("#workoutView .ex-card .note"))) === "Not in this workout");

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
