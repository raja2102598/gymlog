// Set types and effort (RAJ-53): a set's number opens its menu, where it becomes a set to failure or a drop set
// and, with Settings' effort switched on, takes an RPE; the lift's tick follows what counts toward its planned
// sets, and the CSV says both.
import fs from "node:fs";
import { K, flat, liftEl, open, openTab, ready, session, until } from "./harness.mjs";

export default async function settypes({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000053", "2026-08-26T05:00:00Z", "t@example.com");
  // A day logged four weeks ago, so the account keeps the default plan (Legs on Wednesdays) with no first-run step.
  const db = { logs: { [K(0)]: { exercises: {}, warmup: [], cardio: false, steps: 6000, weight: null, note: "" } }, plan: null };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);
  const today = () => db.logs[K(28)]?.exercises?.["Leg Press"];

  // --- effort is off until Settings says RPE or reps in reserve
  await openTab(page, "settings");
  check("effort per set starts off", (await flat(page.locator('[aria-label="Effort per set"] [aria-pressed="true"]'))) === "Off");
  await page.locator('[aria-label="Effort per set"] button', { hasText: "RPE" }).click();
  await until(() => db.plan?.effort === "rpe");
  check("choosing RPE saves it with the plan", db.plan?.effort === "rpe");
  await openTab(page, "today");

  // --- a set's number opens its menu
  const lp = liftEl(page, "Leg Press");
  for (const [j, reps, kg] of [[0, "10", "50"], [1, "10", "50"], [2, "9", "50"]]) {
    await lp.locator(`input[data-set$=":${j}:reps"]`).fill(reps);
    await lp.locator(`input[data-set$=":${j}:kg"]`).fill(kg);
  }
  await until(() => today()?.done === true);
  check("three working sets tick the lift off", today()?.done === true);
  const sn = lp.locator(".set .sn").nth(2);
  await sn.evaluate((b) => b.scrollIntoView({ block: "center" })); // clear of the tab bar along the bottom
  const hit = await sn.evaluate((b) => {
    const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    // A 44px square around the 24px circle, from the sets' margin on its left to the reps box on its right.
    return [[cx - 25, cy], [cx + 17, cy], [cx, cy - 21], [cx, cy + 21]]
      .map(([x, y]) => [x - cx, y - cy, document.elementFromPoint(x, y)])
      .filter(([, , e]) => !b.contains(e))
      .map(([dx, dy, e]) => `${dx},${dy}: ${e?.tagName}.${e?.className}`);
  });
  check("a set's number is a 44px target", hit.length === 0, hit.join("; "));
  await sn.click();
  const menu = lp.locator(".setmenu");
  check("it opens the set's menu, with the kinds of set and an RPE field", (await menu.count()) === 1 && (await menu.locator(".seg button").allInnerTexts()).join("|") === "Working|To failure|Drop set" && (await menu.locator("input").count()) === 1);

  // --- a drop set: volume only, so the lift's third planned set is missing again and the tick goes
  await menu.locator("button", { hasText: "Drop set" }).click();
  await until(() => today()?.sets?.[2]?.type === "drop");
  check("set 3 saves as a drop set", today()?.sets?.[2]?.type === "drop", JSON.stringify(today()?.sets));
  check("its number says so: 3D", (await flat(sn)) === "3D");
  await until(() => today()?.done === false);
  check("a drop set doesn't count toward the planned sets: the tick it gave goes", today()?.done === false);
  check("the menu says what a drop set counts toward", /volume, not to its planned sets or a record/.test(await flat(menu)));

  // --- to failure, with an RPE: counts again, and the tick comes back
  await menu.locator("button", { hasText: "To failure" }).click();
  await menu.locator("input").fill("10");
  await until(() => today()?.sets?.[2]?.type === "failure" && today()?.sets?.[2]?.rpe === 10);
  check("set 3 saves as to failure, RPE 10", today()?.sets?.[2]?.type === "failure" && today()?.sets?.[2]?.rpe === 10, JSON.stringify(today()?.sets?.[2]));
  await until(() => today()?.done === true);
  check("a set to failure counts toward the planned sets, so the tick is back", today()?.done === true);
  check("its number says so: 3F", (await flat(sn)) === "3F");
  await menu.locator("input").fill("11");
  check("an RPE over 10 is refused, and says the range", (await flat(menu.locator(".warn"))) === "RPE is 1 to 10." && today()?.sets?.[2]?.rpe === 10);
  await menu.locator("input").fill("");
  await until(() => today()?.sets?.[2]?.rpe === undefined);
  check("clearing it removes the RPE", !("rpe" in (today()?.sets?.[2] ?? {})));
  await menu.locator("input").fill("9.5");
  await until(() => today()?.sets?.[2]?.rpe === 9.5);

  // --- typing into a set keeps its kind and effort
  await lp.locator('input[data-set$=":2:reps"]').fill("8");
  await until(() => today()?.sets?.[2]?.reps === 8);
  check("changing its reps keeps its kind and RPE", today()?.sets?.[2]?.type === "failure" && today()?.sets?.[2]?.rpe === 9.5, JSON.stringify(today()?.sets?.[2]));
  await sn.click();
  check("tapping the number again closes the menu", (await menu.count()) === 0);

  // --- the CSV says each set's kind and effort
  await openTab(page, "settings");
  const [csv] = await Promise.all([page.waitForEvent("download"), page.click("#csvBtn")]);
  const text = fs.readFileSync(await csv.path(), "utf8");
  check(
    "CSV: a kind column and an RPE column",
    text.startsWith("day,session,lift,set,reps,kg,type,rpe,rir,") && text.includes(`${K(28)},Legs,Leg Press,1,10,50,working,,,false,,`) && text.includes(`${K(28)},Legs,Leg Press,3,8,50,failure,9.5,,false,,`),
    text,
  );

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
