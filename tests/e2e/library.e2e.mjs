// The exercise library (RAJ-55) and each lift's how-to: the plan editor adds lifts from the library, searched by name and
// filtered by muscle and equipment, makes lifts of your own, and points a plan lift at another library lift; a plan
// saved before the library is asked once about each lift it may know; the workout swaps a lift for one from it, and a
// free-form workout adds lifts from it. And the photos and steps (free-exercise-db): a photo for every lift in Train,
// opening its sheet, the steps and photos in the library, behind a workout card's ?, and on a lift's page.
import { K, flat, open, openTab, openWorkout, planDone, ready, savedPlan, session, shot, until, onDefaultPlan } from "./harness.mjs";

export const covers = ["src/components/exercise/ExerciseThumb.tsx", "src/components/exercise/HowTo.tsx", "src/lib/exerciseMedia.ts", "scripts/build-exercise-media.mjs"];

const LEGS = ["Hack Squat", "Leg Press", "Leg Extension", "Hamstring Curl", "Calf Raise"];

export default async function library(t) {
  await addingLifts(t);
  await photosAndHowTo(t);
}

// The exercise library (RAJ-55): the plan editor adds lifts from it, searched by name and filtered by muscle and
// equipment, makes lifts of your own, and points a plan lift at another library lift; a plan saved before the
// library is asked once about each lift the library may know; the workout swaps a lift for one from it, and a
// free-form workout in Train adds lifts from it (Add exercise). Muscles are chips (data-muscle), and each row has a
// + button (button.lib-add[data-lib]) that toggles it (aria-pressed) when adding several, or picks it.
async function addingLifts({ browser, base, check }) {
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
    const db = onDefaultPlan();
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

// Exercise pictures and how-to (free-exercise-db): photos in place of one icon for every lift in Train and the
// library, the steps and photos behind a workout card's ? and on a lift's page. Also: the avatar in the same place
// on every tab, and a finished workout opened to review it starting no clock.
async function photosAndHowTo({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-00000000e0e0", "2026-09-01T00:00:00Z", "raja@example.com");

  {
    const { ctx, page, db } = await open(browser, base, { auth, db: { logs: {}, plan: {} } });
    await ready(page);

    // Train: a photo for each library lift, loaded from the app's own files.
    await openTab(page, "train");
    const thumbs = await page.$$eval("#liftRows .lrow-pic img.ex-thumb", (els) => els.map((e) => ({ src: e.getAttribute("src"), ok: e.complete && e.naturalWidth > 0, alt: e.getAttribute("alt") })));
    await until(async () => (await page.$$eval("#liftRows img.ex-thumb", (els) => els.every((e) => e.complete && e.naturalWidth > 0))) === true);
    check("Train: each lift the library knows shows its photo, not the one dumbbell icon", thumbs.length === LEGS.length && thumbs.every((t) => /^\/exercises\/thumbs\/[A-Za-z0-9_-]+\.webp$/.test(t.src)), JSON.stringify(thumbs));
    check("the photos load, and are decorative (the name is beside them)", (await page.$$eval("#liftRows img.ex-thumb", (els) => els.every((e) => e.naturalWidth > 0 && e.getAttribute("alt") === ""))) === true);
    // A photo pulls up everything about its lift from the bottom; the rest of the row still opens the workout.
    check("each photo is a button saying what it opens", (await page.getAttribute('#liftRows [data-about="0"]', "aria-label")) === `About ${LEGS[0]}: photos, muscles and how to do it`);
    await page.click('#liftRows [data-about="0"]');
    await page.waitForSelector("#exSheet[open] .howto-steps li");
    const facts = (await page.locator("#exSheet .xsheet-facts").innerText()).replace(/\s+/g, " ").trim();
    check(
      "it opens the lift's sheet: its name, today's sets, what it works and needs, then its photos, steps and videos",
      (await flat(page.locator("#exSheetT"))) === LEGS[0] && /^Today \d.+ Works .+ Needs .+$/.test(facts) && (await page.locator("#exSheet .howto-photos img").count()) === 2 && (await page.locator("#exSheet .howto-video").count()) === 1,
      facts,
    );
    await page.click("#exSheetClose");
    await until(async () => (await page.locator("#exSheet[open]").count()) === 0);
    check("× closes it, still on Train", (await page.locator("#trainView").count()) === 1 && (await page.locator("#workoutView").count()) === 0);

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
    check("with no credit line under the steps (public domain, so none is owed; the README credits it)", !/free-exercise-db|public domain/i.test(await flat(page.locator("#workoutView .cue-panel"))), await flat(page.locator("#workoutView .cue-panel")));
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
    const srcs = await page.$$eval("#liftRows .lrow-pic", (rows) => rows.map((r) => r.querySelector("img.ex-thumb")?.getAttribute("src") ?? "icon"));
    check(
      "unlinked lifts from an older plan get the photo of the lift picked for their name; a name nobody picked keeps the icon",
      srcs.join("|") === "/exercises/thumbs/Dumbbell_Shoulder_Press.webp|/exercises/thumbs/Side_Lateral_Raise.webp|/exercises/thumbs/Lying_Leg_Curls.webp|icon",
      srcs.join("|"),
    );
    await ctx.close();
  }

}
