// The exercise library (RAJ-55): the plan editor adds lifts from it, searched by name and filtered by muscle and
// equipment, makes lifts of your own, and points a plan lift at another library lift; a plan saved before the
// library is asked once about each lift the library may know; the workout swaps a lift for one from it, and a
// free-form workout in Train adds lifts from it (Add exercise). Muscles are chips (data-muscle), and each row has a
// + button (button.lib-add[data-lib]) that toggles it (aria-pressed) when adding several, or picks it.
import { K, flat, open, openTab, openWorkout, planDone, ready, savedPlan, session, shot, until } from "./harness.mjs";

export default async function library({ browser, base, check }) {
  const day = { exercises: {}, warmup: [], cardio: false, steps: 6000, weight: null, note: "" };
  const isOpen = (page) => page.evaluate(() => document.querySelector("#libDialog")?.open === true);
  // A row's name, without its tags ("Yours", "Not in my gym").
  const rows = (page) => page.locator("#libList .lib-n").evaluateAll((els) => els.map((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").replace(/\s+/g, " ").trim()));
  /** A row's button is on: chosen, or already added. */
  const pressed = async (page, id) => (await page.getAttribute(`[data-lib="${id}"]`, "aria-pressed")) === "true";
  /** The muscle chip that's on ("" for All). */
  const muscle = (page) => page.locator('[data-muscle][aria-pressed="true"]').getAttribute("data-muscle");
  const focused = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute("data-plib"));
  const lifts = (db, name) => (db.plan?.days ?? []).flatMap((d) => d.exercises).filter((x) => x.name === name);

  // ---------- a plan the app comes with: every lift known; lifts added from the library, and of your own
  {
    const auth = session("00000000-0000-4000-8000-000000000055", "2026-08-26T05:00:00Z", "t@example.com");
    // A day logged four weeks ago, so the account keeps the default plan (Legs on Wednesdays) with no first-run step.
    const db = { logs: { [K(0)]: day }, plan: null };
    const { ctx, page } = await open(browser, base, { auth, db });
    await ready(page);
    const legs = () => db.plan?.days?.[2]?.exercises ?? [];
    const today = () => db.logs[K(28)];
    await openTab(page, "settings");
    await page.click("#planBtn");
    check("a plan the app comes with has nothing to ask", (await page.locator("#peMatch").count()) === 0);
    check("each lift says what the library knows of it", (await flat(page.locator("#pe_x2_lib"))) === "Leg Extensions · Machines · Quads", await flat(page.locator("#pe_x2_lib")));
    check("without the library's name when it's the lift's own", (await flat(page.locator("#pe_x0_lib"))) === "Machines · Quads, with calves, glutes and hamstrings", await flat(page.locator("#pe_x0_lib")));

    // --- adding lifts from the library
    await page.click("#pe_lib");
    await until(() => isOpen(page));
    check("+ From the library opens it over the plan", (await isOpen(page)) && (await flat(page.locator("#libTitle"))) === "Add lifts to Legs");
    check("common lifts first", (await rows(page)).slice(0, 3).join("|") === "Barbell Squat|Barbell Bench Press - Medium Grip|Barbell Deadlift", (await rows(page)).slice(0, 3).join("|"));
    check("and how many there are", (await flat(page.locator("#libCount"))) === "657 lifts", await flat(page.locator("#libCount")));
    check(
      "the day's lifts show as added, by the library's name too",
      (await page.locator('[data-lib="Leg_Press"]').isDisabled()) && (await page.locator('[data-lib="Leg_Extensions"]').isDisabled()) && (await pressed(page, "Leg_Press")) && (await page.locator("#libList .lib-row.had", { has: page.locator('[data-lib="Leg_Press"]') }).count()) === 1,
    );
    await shot(page, "library-picker");
    await page.fill("#libSearch", "goblet");
    check("search narrows the list, and says by how much", (await rows(page)).join("|") === "Goblet Squat" && (await flat(page.locator("#libCount"))) === "1 lift of 657", (await rows(page)).join("|"));
    await page.click('[data-lib="Goblet_Squat"]');
    await page.fill("#libSearch", "hip thrust");
    await page.click('[data-lib="Barbell_Hip_Thrust"]');
    check("Add counts what's chosen, across searches", (await flat(page.locator("#libAdd"))) === "Add 2");
    await page.click("#libAdd");
    await until(() => legs().length === 7);
    check(
      "Add puts them after the day's lifts, pointing at the library, at 3 × 10-12 to start from",
      JSON.stringify(legs().slice(5).map((x) => [x.name, x.sets, x.reps, x.lib])) === JSON.stringify([["Goblet Squat", "3", "10-12", "Goblet_Squat"], ["Barbell Hip Thrust", "3", "10-12", "Barbell_Hip_Thrust"]]),
      JSON.stringify(legs().slice(5)),
    );
    await until(async () => (await focused(page)) === "pe_x5_name");
    check("the library closes and the first one's name has focus", !(await isOpen(page)) && (await focused(page)) === "pe_x5_name", await focused(page));

    // --- filters and order
    await page.click("#pe_lib");
    await page.click('[data-muscle="hamstrings"]');
    await page.selectOption("#libEquip", "machine");
    const subs = (await page.locator("#libList .lib-t > .row-d").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    check(
      "muscle and equipment filters: only machine lifts for the hamstrings",
      subs.length > 1 && subs.every((t) => /machines/i.test(t.split(" · ")[0]) && /hamstrings/i.test(t.split(" · ")[1].split(", with")[0])),
      subs.join(" | "),
    );
    check("Hamstring Curl is on the day as Lying Leg Curls", await page.locator('[data-lib="Lying_Leg_Curls"]').isDisabled());
    await page.selectOption("#libSort", "az");
    const az = await rows(page);
    check("A to Z", az.length > 1 && az.join("|") === [...az].sort((a, b) => a.localeCompare(b)).join("|"), az.join("|"));

    // --- a lift of your own
    await page.click('[data-muscle=""]');
    await page.selectOption("#libEquip", "");
    await page.fill("#libSearch", "sled push");
    check("nothing matches: it says what to do", (await flat(page.locator("#libList .empty"))) === "Nothing matches. Create it as a lift of your own?");
    await page.click("#libCreate");
    check("Create a lift starts from the search", (await page.inputValue("#libNewName")) === "sled push" && (await flat(page.locator("#libTitle"))) === "Create a lift");
    await page.fill("#libNewName", "leg press");
    await page.click("#libNewSave");
    check("a library lift's name is refused, saying which", (await flat(page.locator("#libNewMsg"))) === "The library has Leg Press: pick it from the list instead.");
    await page.fill("#libNewName", "Sled Push");
    await page.selectOption("#libNewEquip", "other");
    await page.selectOption("#libNewMuscle", "quadriceps");
    await page.check('[data-libsec="glutes"]');
    await shot(page, "library-create");
    await page.click("#libNewSave");
    await until(() => db.plan?.custom?.length === 1);
    check("it saves with the plan", JSON.stringify(db.plan?.custom) === JSON.stringify([{ name: "Sled Push", equip: ["other"], primary: ["quadriceps"], secondary: ["glutes"] }]), JSON.stringify(db.plan?.custom));
    const mine = page.locator("#libList .lib-row", { has: page.locator('[data-lib="custom:Sled Push"]') });
    check("and is chosen in the list, marked as yours", (await pressed(page, "custom:Sled Push")) && (await flat(mine.locator(".pill"))) === "Yours" && (await flat(page.locator("#libAdd"))) === "Add 1");
    await page.click("#libAdd");
    await until(() => legs().length === 8);
    check("added, found by its name", legs()[7]?.name === "Sled Push" && !("lib" in legs()[7]), JSON.stringify(legs()[7]));
    check("its line says it's yours", (await flat(page.locator("#pe_x7_lib"))) === "Your own lift · Other · Quads, with glutes" && (await flat(page.locator('[data-plib="7"]'))) === "Muscles…", await flat(page.locator("#pe_x7_lib")));
    await page.click('[data-plib="7"]');
    await until(() => page.locator("#libNew").isVisible());
    check("Muscles… opens its form, its name fixed", (await page.getAttribute("#libNewName", "readonly")) !== null && (await page.inputValue("#libNewEquip")) === "other" && (await flat(page.locator("#libTitle"))) === "Sled Push: your own lift");
    await page.uncheck('[data-libsec="glutes"]');
    await page.check('[data-libsec="hamstrings"]');
    await page.click("#libNewSave");
    await until(() => db.plan?.custom?.[0]?.secondary?.[0] === "hamstrings");
    check("a change saves", JSON.stringify(db.plan?.custom) === JSON.stringify([{ name: "Sled Push", equip: ["other"], primary: ["quadriceps"], secondary: ["hamstrings"] }]), JSON.stringify(db.plan?.custom));
    check("and shows", !(await isOpen(page)) && (await flat(page.locator("#pe_x7_lib"))) === "Your own lift · Other · Quads, with hamstrings");

    // --- another library lift for a plan lift: every day's lift of that name
    await page.click('[data-plib="3"]');
    check("Change… looks the lift up", (await flat(page.locator("#libTitle"))) === "Hamstring Curl in the library" && (await page.inputValue("#libSearch")) === "Hamstring Curl");
    await page.click('[data-lib="Seated_Leg_Curl"]');
    await until(() => lifts(db, "Hamstring Curl").every((x) => x.lib === "Seated_Leg_Curl"));
    check("a tap picks it for the lift, on every day it's on", lifts(db, "Hamstring Curl").length === 2 && lifts(db, "Hamstring Curl").every((x) => x.lib === "Seated_Leg_Curl"), JSON.stringify(lifts(db, "Hamstring Curl")));
    await until(async () => (await focused(page)) === "3");
    check("its line follows, and its button has focus", (await flat(page.locator("#pe_x3_lib"))) === "Seated Leg Curl · Machines · Hamstrings" && (await focused(page)) === "3", await flat(page.locator("#pe_x3_lib")));
    // A name typed over a linked lift's that is itself a library lift's: the old link goes.
    await page.fill("#pe_x5_name", "Front Barbell Squat");
    await until(() => legs()[5]?.name === "Front Barbell Squat");
    check(
      "typing a library lift's name over a lift makes it that lift",
      !("lib" in legs()[5]) && (await flat(page.locator("#pe_x5_lib"))) === "Barbell, squat rack · Quads, with calves, glutes and hamstrings",
      `${JSON.stringify(legs()[5])} ${await flat(page.locator("#pe_x5_lib"))}`,
    );
    await page.click("#pe_lib");
    await page.keyboard.press("Escape");
    await until(async () => !(await isOpen(page)));
    check("Escape closes it, adding nothing", !(await isOpen(page)) && legs().length === 8);
    await planDone(page);

    // --- the workout: a swap from the library (the lift's ··· menu → Swap → Library…)
    await page.click("#backBtn"); // Settings, back to Home
    await page.waitForSelector("#homeView");
    await openWorkout(page, "Leg Press");
    await page.click('[data-more="1"]');
    await page.click('[data-swapopen="1"]');
    await page.click('[data-swaplib="1"]');
    check("Library… in a swap shows lifts for the same muscle", (await flat(page.locator("#libTitle"))) === "Swap Leg Press for" && (await muscle(page)) === "quadriceps", await muscle(page));
    check("not the lift itself", await page.locator('[data-lib="Leg_Press"]').isDisabled());
    await page.click('[data-lib="Barbell_Squat"]');
    await until(() => today()?.exercises?.["Leg Press"]?.swap === "Barbell Squat");
    check("a tap swaps it", today()?.exercises?.["Leg Press"]?.swap === "Barbell Squat" && !(await isOpen(page)), JSON.stringify(today()?.exercises?.["Leg Press"]));

    // --- a free-form workout in Train: lifts from the library, your own among them
    await page.click("#closeWorkout");
    await page.waitForSelector("#trainView");
    await page.click("#freeStart");
    await until(() => !!today()?.free);
    await page.click("#addExercise");
    check("Add exercise adds to the workout", (await flat(page.locator("#libTitle"))) === "Add to this workout");
    await page.fill("#libSearch", "sled push");
    await page.click('[data-lib="custom:Sled Push"]');
    await page.fill("#libSearch", "barbell curl");
    await page.click('[data-lib="Barbell_Curl"]');
    await page.click("#libAdd");
    await until(() => today()?.free?.lifts?.length === 2);
    check("Add puts them in the workout, in one go", JSON.stringify(today()?.free?.lifts) === '["Sled Push","Barbell Curl"]', JSON.stringify(today()?.free));
    await until(async () => (await focused(page)) === "addExercise");
    check("and Add exercise has focus again, for more", (await focused(page)) === "addExercise", await focused(page));

    check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // ---------- a plan saved before the library: each lift it may know asked about once
  {
    const auth = session("00000000-0000-4000-8000-000000000155", "2026-08-26T05:00:00Z", "t@example.com");
    const old = savedPlan();
    for (const d of old.days) for (const x of d.exercises) delete x.lib;
    const db = { logs: { [K(0)]: day }, plan: old };
    const { ctx, page } = await open(browser, base, { auth, db });
    await ready(page);
    await openTab(page, "settings");
    await page.click("#planBtn");
    const asked = () => page.locator("#peMatch li[data-match]").evaluateAll((els) => els.map((e) => e.dataset.match));
    check(
      "four of its lifts are asked about at a time, in the plan's order",
      (await asked()).join("|") === "Incline Machine Press|Chest Press Machine|Machine Shoulder Press|DB Lateral Raises",
      (await asked()).join("|"),
    );
    check(
      "each with the library lift it may be",
      (await flat(page.locator('#peMatch li[data-match="Incline Machine Press"] p'))) === "Incline Machine Press: the same as Leverage Incline Chest Press? Machines · Chest, with shoulders and triceps",
      await flat(page.locator('#peMatch li[data-match="Incline Machine Press"] p')),
    );
    check("and how many more there are", (await flat(page.locator("#peMatch p.note").last())) === "19 more after these.", await flat(page.locator("#peMatch p.note").last()));
    await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
    await shot(page.locator("#peMatch"), "library-match");
    await page.click('[data-same="Incline Machine Press"]');
    await until(() => lifts(db, "Incline Machine Press").every((x) => x.lib === "Leverage_Incline_Chest_Press"));
    check("Same lift points it at the library", lifts(db, "Incline Machine Press").length > 0 && lifts(db, "Incline Machine Press").every((x) => x.lib === "Leverage_Incline_Chest_Press"));
    check("and the next one is asked", (await asked()).join("|") === "Chest Press Machine|Machine Shoulder Press|DB Lateral Raises|Cable Triceps Pushdown", (await asked()).join("|"));
    await page.click('[data-mine="Chest Press Machine"]');
    await until(() => db.plan?.custom?.length === 1);
    check("It's my own keeps it as yours, with no muscles guessed", JSON.stringify(db.plan?.custom) === JSON.stringify([{ name: "Chest Press Machine", equip: [], primary: [], secondary: [] }]), JSON.stringify(db.plan?.custom));
    await page.click('[data-another="Machine Shoulder Press"]');
    check("Another one… looks it up", (await flat(page.locator("#libTitle"))) === "Machine Shoulder Press in the library" && (await page.inputValue("#libSearch")) === "Machine Shoulder Press");
    await page.click('[data-lib="Machine_Shoulder_Military_Press"]');
    await until(() => lifts(db, "Machine Shoulder Press").every((x) => x.lib === "Machine_Shoulder_Military_Press"));
    check("and points it at the one picked", lifts(db, "Machine Shoulder Press").length > 0 && lifts(db, "Machine Shoulder Press").every((x) => x.lib === "Machine_Shoulder_Military_Press"));
    check("none of the three is asked about again", !(await asked()).some((n) => ["Incline Machine Press", "Chest Press Machine", "Machine Shoulder Press"].includes(n)), (await asked()).join("|"));

    // Push, Monday: the lift kept as yours gets its muscles.
    await page.locator("#planDays .dchip").first().click();
    check("a lift kept as yours has no muscles yet", (await flat(page.locator("#pe_x1_lib"))) === "Your own lift · no muscles given yet" && (await flat(page.locator('[data-plib="1"]'))) === "Muscles…", await flat(page.locator("#pe_x1_lib")));
    await page.click('[data-plib="1"]');
    check("Muscles… opens its form", (await flat(page.locator("#libTitle"))) === "Chest Press Machine: your own lift" && (await page.inputValue("#libNewName")) === "Chest Press Machine");
    await page.selectOption("#libNewEquip", "machine");
    await page.selectOption("#libNewMuscle", "chest");
    await page.check('[data-libsec="triceps"]');
    await page.click("#libNewSave");
    await until(() => db.plan?.custom?.[0]?.primary?.[0] === "chest");
    check("its muscles save", JSON.stringify(db.plan?.custom) === JSON.stringify([{ name: "Chest Press Machine", equip: ["machine"], primary: ["chest"], secondary: ["triceps"] }]), JSON.stringify(db.plan?.custom));
    check("and show", (await flat(page.locator("#pe_x1_lib"))) === "Your own lift · Machines · Chest, with triceps", await flat(page.locator("#pe_x1_lib")));
    check("a lift answered with Same lift shows the library's", (await flat(page.locator("#pe_x0_lib"))) === "Leverage Incline Chest Press · Machines · Chest, with shoulders and triceps", await flat(page.locator("#pe_x0_lib")));
    await planDone(page);

    check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }
}
