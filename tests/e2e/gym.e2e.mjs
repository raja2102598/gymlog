// My gym (RAJ-63): Settings → My gym turns equipment on and off, and lists lifts always or never offered; the
// library, a swap's suggestions and its library then leave out what the gym can't do, and the plan editor keeps a
// plan lift that needs what isn't there, saying so.
import { K, flat, open, openTab, planDone, ready, session, shot, until } from "./harness.mjs";

export default async function gym({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000063", "2026-08-26T05:00:00Z", "t@example.com");
  // A day logged four weeks ago, so the account keeps the default plan (Legs on Wednesdays) with no first-run step.
  const db = { logs: { [K(0)]: { exercises: {}, warmup: [], cardio: false, steps: 6000, weight: null, note: "" } }, plan: null };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);
  const legs = () => db.plan?.days?.[2]?.exercises ?? [];
  const rows = async () => (await page.locator("#libList .lib-n").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const switchOn = (e) => page.locator(`[data-equip="${e}"]`).getAttribute("aria-checked");

  // --- Settings → My gym
  await openTab(page, "settings");
  check("Settings says the gym has everything to begin with", (await flat(page.locator("#gymRowD"))) === "All the equipment: the library offers every lift");
  await page.click("#gymBtn");
  await page.waitForSelector("#gymView:not([hidden])");
  check("My gym opens as a page of its own", (await flat(page.locator("#screenTitle"))) === "My gym" && (await page.locator("nav.tabbar").count()) === 0);
  check("everything is on, and every lift offered", (await switchOn("barbell")) === "true" && (await flat(page.locator("#gymCount"))) === "The library offers all 657 of its lifts.");
  check("each piece of equipment says how many lifts use it", /^\d+ lifts use it$/.test(await flat(page.locator("#gq_barbellD"))), await flat(page.locator("#gq_barbellD")));
  await page.click('[data-equip="barbell"]');
  await until(() => JSON.stringify(db.plan?.gym?.off) === '["barbell"]');
  check("turning the barbell off saves with the plan", JSON.stringify(db.plan?.gym) === '{"off":["barbell"],"always":[],"never":[]}', JSON.stringify(db.plan?.gym));
  check("and the library offers fewer lifts", (await switchOn("barbell")) === "false" && (await flat(page.locator("#gymCount"))) === "The library offers 490 of its 657 lifts.", await flat(page.locator("#gymCount")));

  // Always and never: picked from every lift, whatever the gym has.
  await page.click('[data-gymadd="always"]');
  check("Add… shows every lift, with no Create", (await flat(page.locator("#libTitle"))) === "Always offer" && !(await page.isChecked("#libGym")) && (await page.locator("#libCreate").count()) === 0);
  await page.fill("#libSearch", "barbell curl");
  const tag = page.locator("#libList .lib-row", { has: page.locator('[data-lib="Barbell_Curl"]') }).locator(".lib-tag");
  check("a lift the gym can't do says so", (await flat(tag)) === "Not in my gym");
  await page.check('[data-lib="Barbell_Curl"]');
  await page.click("#libAdd");
  await until(() => db.plan?.gym?.always?.length === 1);
  await page.click('[data-gymadd="never"]');
  await page.fill("#libSearch", "pushups");
  await page.check('[data-lib="Pushups"]');
  await page.click("#libAdd");
  await until(() => db.plan?.gym?.never?.length === 1);
  check("the lists save with the plan", JSON.stringify(db.plan?.gym) === '{"off":["barbell"],"always":["Barbell_Curl"],"never":["Pushups"]}', JSON.stringify(db.plan?.gym));
  const listed = async (list) => (await page.locator(`#gym_${list} .gym-lifts li`).allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  check("and show their lifts", JSON.stringify([await listed("always"), await listed("never")]) === '[["Barbell Curl Barbell"],["Pushups Bodyweight"]]', JSON.stringify([await listed("always"), await listed("never")]));
  check("each count follows: one in, one out", (await flat(page.locator("#gymCount"))) === "The library offers 490 of its 657 lifts.");
  await shot(page, "gym");
  await page.click("#gymNone");
  await until(() => db.plan?.gym?.off?.length === 17);
  check("Clear all leaves lifts needing nothing, and the always list", (await flat(page.locator("#gymCount"))) === "The library offers 68 of its 657 lifts." && (await switchOn("dumbbell")) === "false", await flat(page.locator("#gymCount")));
  await page.click("#gymAll");
  await until(() => db.plan?.gym?.off?.length === 0);
  check("Select all brings everything back but the never list", (await flat(page.locator("#gymCount"))) === "The library offers 656 of its 657 lifts.");
  await page.click('[data-equip="barbell"]');
  await until(() => db.plan?.gym?.off?.length === 1);
  await page.click("#gymDone");
  await page.waitForSelector("#settingsView:not([hidden])");
  check("Done goes back to Settings, which says what's offered", (await flat(page.locator("#gymRowD"))) === "Your equipment: the library offers 490 of 657 lifts");

  // --- the library in the plan editor
  await page.click("#planBtn");
  await page.click("#pe_lib");
  check("the library offers what the gym can do, ticked My gym", (await page.isChecked("#libGym")) && (await flat(page.locator("#libCount"))) === "490 lifts");
  await page.fill("#libSearch", "barbell");
  const found = await rows();
  check("no barbell lifts but the one always offered", found.includes("Barbell Curl") && !found.includes("Barbell Squat") && !found.includes("Barbell Deadlift"), found.join(" | "));
  await page.fill("#libSearch", "barbell squat");
  const more = /^Nothing your gym can do matches: untick My gym for (\d+) lifts that need more\.$/.exec(await flat(page.locator("#libList .empty")));
  check("nothing matching says so, and how many more there are", !!more, await flat(page.locator("#libList .empty")));
  await page.uncheck("#libGym");
  const ids = () => page.locator("#libList [data-lib]").evaluateAll((els) => els.map((e) => e.dataset.lib));
  check("unticked, they're there", (await ids()).length === +more?.[1] && (await ids()).includes("Barbell_Squat") && (await flat(page.locator("#libCount"))) === `${more?.[1]} lifts of 657`, `${(await ids()).join(" | ")} ${await flat(page.locator("#libCount"))}`);
  check("marked as not in the gym", (await page.locator("#libList .lib-tag.away").count()) === +more?.[1]);
  await page.check('[data-lib="Barbell_Squat"]');
  await page.click("#libAdd");
  await until(() => legs().length === 6);
  check("and can still be added", legs()[5]?.name === "Barbell Squat");
  check("the plan editor says what it needs that the gym hasn't got", (await flat(page.locator("#pe_x5_gym"))) === "My gym has no barbell.", await flat(page.locator("#pe_x5_gym")));
  check("a lift the gym can do says nothing", (await page.locator("#pe_x0_gym").count()) === 0);
  await page.locator("#planDays .dchip").nth(5).click();
  check("a plan lift stays, flagged", (await page.locator("#pe_x2_name").inputValue()) === "Hip Thrust (machine or barbell)" && (await flat(page.locator("#pe_x2_gym"))) === "My gym has no barbell.");
  await planDone(page);

  // --- a swap on Today
  await openTab(page, "today");
  await page.click('[data-more="1"]');
  await page.click('[data-swapopen="1"]');
  const offered = await page.locator("#swapList option").evaluateAll((os) => os.map((o) => o.value));
  // Barbell Squat is in the plan now, so it's offered like the plan's other lifts.
  check(
    "a swap's suggestions leave out barbell lifts",
    !offered.includes("Front Barbell Squat") && !offered.includes("Wide Stance Barbell Squat") && offered.includes("Goblet Squat") && offered.includes("Hack Squat") && offered.includes("Barbell Squat"),
    offered.join(", "),
  );
  await page.click('[data-swaplib="1"]');
  check("and so does its library", (await page.locator('[data-lib="Barbell_Squat"]').count()) === 0 && (await page.locator('[data-lib="Goblet_Squat"]').count()) === 1);
  await page.click("#libClose");

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
