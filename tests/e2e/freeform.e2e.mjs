// A free-form workout on any day (RAJ-36): started from Today in place of the planned session, named, lifts added
// by name with suggestions, logged as usual; Progress counts it as an extra session, and going back to the plan
// keeps what was logged.
import fs from "node:fs";
import { K, flat, open, openTab, ready, session, until } from "./harness.mjs";

export default async function freeform({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000036", "2026-08-26T05:00:00Z", "t@example.com");
  // A day logged four weeks ago, so the account keeps the default plan (Legs on Wednesdays) with no first-run step.
  const db = { logs: { [K(0)]: { exercises: {}, warmup: [], cardio: false, steps: 6000, weight: null, note: "" } }, plan: null };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);
  const today = () => db.logs[K(28)];
  const title = () => flat(page.locator(".sess-title h2"));
  const names = async () => (await page.locator("#session .ex:not(.cardio) .nm").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const focused = () => page.evaluate(() => document.activeElement?.id);

  // --- starting one
  check("Legs is today's workout to begin with", (await title()) === "Legs");
  await page.click("#freeStart");
  await until(() => !!today()?.free);
  check("Start an empty workout saves one with the day", JSON.stringify(today()?.free) === '{"name":"","lifts":[]}', JSON.stringify(today()?.free));
  check("it takes the day's place, with no lifts yet", (await title()) === "Free workout" && (await names()).length === 0);
  check("it says what to do, and the field to add a lift has focus", (await flat(page.locator(".addlift .note"))).startsWith("A workout of your own") && (await focused()) === "addLift");
  await page.fill("#freeName", "Hotel gym");
  await until(() => today()?.free?.name === "Hotel gym");
  check("it takes a name, which titles the day", today()?.free?.name === "Hotel gym" && (await title()) === "Hotel gym");

  // --- adding lifts
  const offered = await page.locator("#addLiftList option").evaluateAll((os) => os.map((o) => o.value));
  check("lifts from the plan are offered", offered.includes("Leg Press") && offered.includes("Lat Pulldown"), offered.join(", "));
  await page.fill("#addLift", "Goblet Squat");
  await page.press("#addLift", "Enter");
  await until(async () => (await names()).length === 1 && today()?.free?.lifts?.length === 1);
  check("a lift added by name gets its card", (await names()).join("|") === "Goblet Squat" && JSON.stringify(today()?.free?.lifts) === '["Goblet Squat"]');
  check("the field empties and keeps focus for the next one", (await page.inputValue("#addLift")) === "" && (await focused()) === "addLift");
  await page.fill("#addLift", "Leg Press");
  await page.click(".addlift button[type=submit]");
  await until(async () => (await names()).length === 2);
  check("a lift from the plan brings its sets and reps", (await flat(page.locator("#session .ex li").nth(1).locator(".lift-meta .sr"))) === "3 × 10-12");
  check("Leg Press is offered no more", !(await page.locator("#addLiftList option").evaluateAll((os) => os.map((o) => o.value))).includes("Leg Press"));

  // --- logging and removing
  await page.fill('input[data-set="0:0:reps"]', "12");
  await page.fill('input[data-set="0:0:kg"]', "20");
  await until(() => today()?.exercises?.["Goblet Squat"]?.sets?.[0]?.kg === 20);
  check("its sets log as usual", JSON.stringify(today()?.exercises?.["Goblet Squat"]?.sets) === '[{"reps":12,"kg":20}]', JSON.stringify(today()?.exercises?.["Goblet Squat"]));
  check("the day counts its lifts", (await flat(page.locator("#liftPill"))) === "1/2 lifts");
  await page.click('[data-more="1"]');
  await page.click('[data-freerm="1"]');
  await until(() => today()?.free?.lifts?.length === 1);
  check("Remove from this workout takes a lift out", JSON.stringify(today()?.free?.lifts) === '["Goblet Squat"]' && (await names()).join("|") === "Goblet Squat");

  // --- Progress: an extra session, not a planned one
  await openTab(page, "progress");
  check("Progress counts it as an extra session", (await flat(page.locator("#dashPlan .kpi .l").first())) === "sessions this week, and 1 extra", await flat(page.locator("#dashPlan .kpi .l").first()));
  check("and not as one of the plan's", (await flat(page.locator("#dashPlan .kpi .v").first())).startsWith("0/"));

  // --- the CSV names it; a reload keeps it
  await openTab(page, "settings");
  const [csv] = await Promise.all([page.waitForEvent("download"), page.click("#csvBtn")]);
  const text = fs.readFileSync(await csv.path(), "utf8");
  check("the CSV gives its name as the session", text.includes(`${K(28)},Hotel gym,Goblet Squat,1,12,20,working,`), text);
  await openTab(page, "today");
  await page.reload();
  await ready(page);
  check("a reload keeps it", (await title()) === "Hotel gym" && (await names()).join("|") === "Goblet Squat");

  // --- back to the plan: what was logged stays
  check("the way back names the usual workout", (await flat(page.locator("#freeEnd"))) === "Back to Legs");
  await page.click("#freeEnd");
  await until(() => !today()?.free);
  check("Back to Legs brings the planned lifts back", (await title()) === "Legs" && (await names()).slice(0, 5).join("|") === "Hack Squat|Leg Press|Leg Extension|Hamstring Curl|Calf Raise");
  const extra = page.locator("#session .ex li", { has: page.locator(".nm", { hasText: "Goblet Squat" }) });
  check("what was logged stays, as a lift outside the plan", (await extra.count()) === 1 && (await flat(extra.locator(".ch"))) === "Not in this workout");

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
