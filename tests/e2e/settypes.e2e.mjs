// Set types and effort (RAJ-53): a set's number opens its menu, where it becomes a set to failure or a drop set
// and, with Settings' effort switched on, takes an RPE; the lift's tick follows what counts toward its planned
// sets, as it does when a set is cleared or taken off, and the CSV says both. Sets are logged in the workout, one
// lift at a time; the tick is the "Done" box in the lift's ··· menu.
import fs from "node:fs";
import { K, flat, open, openSetting, openTab, openWorkout, ready, session, until } from "./harness.mjs";

export default async function settypes({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000053", "2026-08-26T05:00:00Z", "t@example.com");
  // A day logged four weeks ago, so the account keeps the default plan (Legs on Wednesdays) with no first-run step.
  const db = { logs: { [K(0)]: { exercises: {}, warmup: [], cardio: false, steps: 6000, weight: null, note: "" } }, plan: null };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);
  const today = () => db.logs[K(28)]?.exercises?.["Leg Press"];
  /** Settings' Export & backup, then the CSV it downloads. */
  const csvText = async () => {
    await openTab(page, "settings");
    await openSetting(page, "setData");
    const [csv] = await Promise.all([page.waitForEvent("download"), page.click("#csvBtn")]);
    const text = fs.readFileSync(await csv.path(), "utf8");
    await page.click("#backBtn"); // back to Home
    await page.waitForSelector("#homeView");
    return text;
  };

  // --- effort is off until Settings (Rest timer & effort) says RPE or reps in reserve
  await openTab(page, "settings");
  await openSetting(page, "setTraining");
  const effort = page.locator('[aria-label="Effort per set"]');
  check("effort per set starts off", (await flat(effort.locator('[aria-selected="true"]'))) === "Off");
  await effort.locator('button[data-seg="rpe"]').click();
  await until(() => db.plan?.effort === "rpe");
  check("choosing RPE saves it with the plan", db.plan?.effort === "rpe");
  await page.click("#backBtn");
  await page.waitForSelector("#homeView");

  // --- a set's number opens its menu (Leg Press is the second lift on Legs: its boxes are s1_<set>_k and _r)
  await openWorkout(page, "Leg Press");
  const card = page.locator("#workoutView section.ex-card");
  const reps = (j) => page.locator(`#s1_${j}_r`), kg = (j) => page.locator(`#s1_${j}_k`);
  for (const [j, r, k] of [[0, "10", "50"], [1, "10", "50"], [2, "9", "50"]]) {
    await reps(j).fill(r);
    await kg(j).fill(k);
  }
  await until(() => today()?.done === true);
  check("three working sets tick the lift off", today()?.done === true);
  check("and the card shows it done", await card.evaluate((c) => c.classList.contains("checked")));
  const sn = card.locator(".srow.set .sn").nth(2);
  await sn.evaluate((b) => b.scrollIntoView({ block: "center" })); // clear of the buttons pinned along the bottom
  const hit = await sn.evaluate((b) => {
    const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    // The whole button, 44px tall, answers a tap: nothing sits over any part of it.
    const miss = [[r.left + 1, cy], [r.right - 1, cy], [cx, r.top + 1], [cx, r.bottom - 1]]
      .map(([x, y]) => [Math.round(x - cx), Math.round(y - cy), document.elementFromPoint(x, y)])
      .filter(([, , e]) => !b.contains(e))
      .map(([dx, dy, e]) => `${dx},${dy}: ${e?.tagName}.${e?.className}`);
    return { miss, w: Math.round(r.width), h: Math.round(r.height) };
  });
  check("a set's number is a full-height tap target (44px tall, its 30px column wide)", hit.miss.length === 0 && hit.h >= 44 && hit.w >= 24, `${hit.w}x${hit.h} ${hit.miss.join("; ")}`);
  await sn.click();
  const menu = card.locator(".setmenu");
  check(
    "it opens the set's menu, with the kinds of set and an RPE field",
    (await menu.count()) === 1 && (await sn.getAttribute("aria-expanded")) === "true" && (await menu.locator(".seg button").allInnerTexts()).join("|") === "Working|To failure|Drop set" && (await menu.locator("input").count()) === 1,
  );

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
  check("an RPE over 10 is refused, and says the range", (await flat(menu.locator(".err"))) === "RPE is 1 to 10." && today()?.sets?.[2]?.rpe === 10);
  await menu.locator("input").fill("");
  await until(() => today()?.sets?.[2]?.rpe === undefined);
  check("clearing it removes the RPE", !("rpe" in (today()?.sets?.[2] ?? {})));
  await menu.locator("input").fill("9.5");
  await until(() => today()?.sets?.[2]?.rpe === 9.5);

  // --- typing into a set keeps its kind and effort
  await reps(2).fill("8");
  await until(() => today()?.sets?.[2]?.reps === 8);
  check("changing its reps keeps its kind and RPE", today()?.sets?.[2]?.type === "failure" && today()?.sets?.[2]?.rpe === 9.5, JSON.stringify(today()?.sets?.[2]));
  await sn.click();
  check("tapping the number again closes the menu", (await menu.count()) === 0);

  // --- the CSV says each set's kind and effort
  await page.click("#closeWorkout");
  await page.waitForSelector("#trainView");
  const text = await csvText();
  check(
    "CSV: a kind column and an RPE column",
    text.startsWith("day,session,lift,set,reps,kg,type,rpe,rir,") && text.includes(`${K(28)},Legs,Leg Press,1,10,50,working,,,false,,`) && text.includes(`${K(28)},Legs,Leg Press,3,8,50,failure,9.5,,false,,`),
    text,
  );

  // --- a tick the planned sets gave goes when one of them is cleared, or taken off with − Set, and comes back
  await openWorkout(page, "Leg Press");
  await reps(1).fill("");
  await until(() => today()?.sets?.[1]?.reps === null);
  check("clearing a set's reps takes back the tick the planned sets gave", today()?.done === false && !today()?.autoDone, JSON.stringify(today()));
  await reps(1).fill("10");
  await until(() => today()?.done === true);
  check("logging it again brings the tick back", today()?.done === true && today()?.autoDone === true);
  // A fourth set, with set 3 then made a drop set: sets 1, 2 and 4 still make the three that count…
  await card.locator("[data-addset]").click();
  await reps(3).fill("12");
  await kg(3).fill("30");
  await until(() => today()?.sets?.[3]?.kg === 30);
  await sn.click();
  await menu.locator("button", { hasText: "Drop set" }).click();
  await until(() => today()?.sets?.[2]?.type === "drop");
  check("with set 3 a drop set, sets 1, 2 and 4 still tick the lift off", today()?.done === true, JSON.stringify(today()));
  // …until − Set takes set 4 off (the harness says yes to its question), leaving two.
  await card.locator("[data-rmset]").click();
  await until(() => today()?.sets?.length === 3);
  check("− Set leaving two sets that count takes the tick back too", today()?.done === false && !today()?.autoDone, JSON.stringify(today()));

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
