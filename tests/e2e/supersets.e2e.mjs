// Supersets and a day's own order (RAJ-54): the plan editor joins a lift to the one above it, and its Up and Down
// keep a superset whole; Today shows the superset as one card with its sets in rounds, starts the rest timer once
// a round is complete, and moves a lift or a whole superset up or down the day, kept with that day.
import fs from "node:fs";
import { K, flat, open, openTab, planDone, ready, session, until } from "./harness.mjs";

export default async function supersets({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000054", "2026-08-26T05:00:00Z", "t@example.com");
  // A day logged four weeks ago, so the account keeps the default plan (Legs on Wednesdays) with no first-run step.
  const db = { logs: { [K(0)]: { exercises: {}, warmup: [], cardio: false, steps: 6000, weight: null, note: "" } }, plan: null };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);
  const legs = () => db.plan?.days?.[2]?.exercises ?? [];
  const today = () => db.logs[K(28)];

  // --- the plan editor: Hamstring Curl joins Leg Extension as a superset
  await openTab(page, "settings");
  await page.click("#planBtn");
  check("a day's first lift can't join the one above it", (await page.locator("#pe_x0_ss").count()) === 0);
  check("the box names the lift above", (await flat(page.locator('label[for="pe_x3_ss"]'))) === "Superset with Leg Extension");
  await page.check("#pe_x3_ss");
  await until(() => legs()[3]?.superset === true);
  check("joining a lift to the one above saves the superset with the plan", legs()[3]?.superset === true && !("superset" in legs()[2]));
  check("both lifts say they're superset A", (await flat(page.locator('label[for="pe_x2_name"]'))) === "Lift 3 · superset A1" && (await flat(page.locator('label[for="pe_x3_name"]'))) === "Lift 4 · superset A2");

  // Up within a superset: the lifts trade places, the superset stays.
  await page.click('button[data-pmove="3:-1"]');
  await until(() => legs()[2]?.name === "Hamstring Curl");
  check(
    "Up inside a superset swaps its lifts and keeps it one",
    legs()[2]?.name === "Hamstring Curl" && !("superset" in legs()[2]) && legs()[3]?.name === "Leg Extension" && legs()[3]?.superset === true,
    JSON.stringify(legs().map((x) => [x.name, x.superset])),
  );
  // Down from outside: Leg Press moves past the whole superset.
  await page.click('button[data-pmove="1:1"]');
  await until(() => legs()[3]?.name === "Leg Press");
  check(
    "Down past a superset moves the lift past all of it",
    legs().map((x) => x.name).join("|") === "Hack Squat|Hamstring Curl|Leg Extension|Leg Press|Calf Raise" && legs()[2]?.superset === true && !("superset" in legs()[3]),
    JSON.stringify(legs().map((x) => [x.name, x.superset])),
  );
  await planDone(page);
  await openTab(page, "today");

  // --- Today: one card, its sets in rounds
  const card = page.locator("#session li.superset");
  check("the superset is one card", (await card.count()) === 1 && (await flat(card.locator(".ss-h"))) === "Superset A · 2 lifts in rounds");
  check("its lifts are A1 and A2", (await card.locator(".nm").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).join("|") === "A1 Hamstring Curl|A2 Leg Extension");
  const order = await card.locator("input[data-set]").evaluateAll((els) => els.map((e) => e.dataset.set));
  check(
    "its rows go round by round: A1's set 1, A2's set 1, then round 2",
    order.slice(0, 6).join(" ") === "1:0:reps 1:0:kg 2:0:reps 2:0:kg 1:1:reps 1:1:kg" && order.length === 12,
    order.join(" "),
  );
  check("three rounds, each headed", (await card.locator(".round-h").allInnerTexts()).join("|") === "Round 1|Round 2|Round 3");
  check("a row's number is the lift's place in the superset", (await card.locator(".round").first().locator(".sn").allInnerTexts()).join("|") === "A1|A2");

  // --- the rest timer, once a round
  const bar = page.locator(".resttimer");
  await page.fill('input[data-set="1:0:reps"]', "12");
  await page.fill('input[data-set="1:0:kg"]', "30");
  await until(() => today()?.exercises?.["Hamstring Curl"]?.sets?.[0]?.kg === 30);
  check("A1's set alone doesn't start a rest: A2 comes first", (await bar.count()) === 0);
  await page.fill('input[data-set="2:0:reps"]', "15");
  await bar.waitFor();
  check("A2's set completes the round and starts it, for the plan's 90 s", (await flat(page.locator(".rt-time"))) === "1:30", await flat(page.locator(".rt-time")));
  await page.click("#restSkip");
  await bar.waitFor({ state: "detached" });
  // Out of order: A2 first, then A1 completes the round.
  await page.fill('input[data-set="2:1:reps"]', "15");
  check("round 2 isn't complete with only A2", (await bar.count()) === 0);
  await page.fill('input[data-set="1:1:reps"]', "12");
  await bar.waitFor();
  check("whichever set completes the round starts the rest", (await bar.count()) === 1);
  await page.click("#restSkip");
  await bar.waitFor({ state: "detached" });
  await page.fill('input[data-set="1:2:reps"]', "11");
  await page.fill('input[data-set="2:2:reps"]', "14");
  await until(() => today()?.exercises?.["Hamstring Curl"]?.done && today()?.exercises?.["Leg Extension"]?.done);
  check("three rounds tick both lifts off", !!today()?.exercises?.["Hamstring Curl"]?.done && !!today()?.exercises?.["Leg Extension"]?.done);
  check("weight carries to the next set of the same lift", today()?.exercises?.["Hamstring Curl"]?.sets?.[1]?.kg === 30, JSON.stringify(today()?.exercises?.["Hamstring Curl"]?.sets));
  await page.click("#restSkip");

  // --- + Round and − Round
  await page.click('[data-addround="1"]');
  await until(async () => (await card.locator(".round").count()) === 4);
  check("+ Round adds a set to each lift", (await card.locator(".round").nth(3).locator(".set").count()) === 2);
  await page.click('[data-rmround="1"]');
  await until(async () => (await card.locator(".round").count()) === 3);
  check("− Round takes the empty round away", (await card.locator(".round").count()) === 3 && (await card.locator("[data-rmround]").count()) === 0);

  // --- moving on Today: Calf Raise up one, from its menu
  await page.click('[data-more="4"]');
  const up = page.locator('[data-lmove="4:-1"]');
  check("the menu can move a lift", (await up.getAttribute("aria-label")) === "Move Calf Raise up" && !(await up.isDisabled()));
  await up.click();
  await until(() => today()?.order?.join("|") === "Hack Squat|Hamstring Curl|Leg Extension|Calf Raise|Leg Press");
  check("moving saves the day's order", today()?.order?.join("|") === "Hack Squat|Hamstring Curl|Leg Extension|Calf Raise|Leg Press", JSON.stringify(today()?.order));
  await until(async () => (await page.evaluate(() => document.activeElement?.dataset?.lmove)) === "3:-1");
  check("focus follows the lift to its new place", (await page.evaluate(() => document.activeElement?.dataset?.lmove)) === "3:-1");
  check("its menu stays open there", (await page.locator('[data-more="3"]').getAttribute("aria-expanded")) === "true" && (await flat(page.locator("#session .ex > li").nth(2).locator(".nm"))) === "Calf Raise");

  // The superset moves whole, from either lift's menu.
  await page.click('[data-more="2"]');
  const ssUp = page.locator('[data-lmove="2:-1"]');
  check("a superset's menu moves the superset", (await ssUp.getAttribute("aria-label")) === "Move superset A up");
  await ssUp.click();
  await until(() => today()?.order?.[0] === "Hamstring Curl");
  check("the superset moves whole", today()?.order?.join("|") === "Hamstring Curl|Leg Extension|Hack Squat|Calf Raise|Leg Press", JSON.stringify(today()?.order));
  check("its card is first", await page.locator("#session .ex > li").first().evaluate((li) => li.classList.contains("superset")));
  await until(async () => (await page.evaluate(() => document.activeElement?.dataset?.lmove)) === "1:1");
  check("at the top, focus moves to Move down", (await page.evaluate(() => document.activeElement?.dataset?.lmove)) === "1:1" && (await page.locator('[data-lmove="1:-1"]').isDisabled()));

  // --- the order stays with the day: after a reload, and in the CSV
  await page.fill('input[data-set="2:0:reps"]', "10"); // Hack Squat, now third
  await until(() => today()?.exercises?.["Hack Squat"]?.sets?.[0]?.reps === 10);
  await page.reload();
  await ready(page);
  const shown = (await page.locator("#session .ex:not(.cardio) .nm").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).join("|");
  check("a reload shows the day in the order it was done", shown === "A1 Hamstring Curl|A2 Leg Extension|Hack Squat|Calf Raise|Leg Press", shown);
  await openTab(page, "settings");
  const [csv] = await Promise.all([page.waitForEvent("download"), page.click("#csvBtn")]);
  const lifts = fs
    .readFileSync(await csv.path(), "utf8")
    .split("\n")
    .filter((l) => l.startsWith(K(28)))
    .map((l) => l.split(",")[2]);
  check("the CSV lists the day's lifts in the order done", [...new Set(lifts)].join("|") === "Hamstring Curl|Leg Extension|Hack Squat", lifts.join("|"));

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
