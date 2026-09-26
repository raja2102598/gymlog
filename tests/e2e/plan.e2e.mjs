// The plan editor, beyond adding and moving lifts (today.e2e.mjs): renaming a lift and carrying its logged history over
// to the new name (RAJ-34), and each lift's progression rule and deload (RAJ-41), which the workout's hints, the grey
// numbers and Strength on Progress then follow. It opens a renamed lift's page, so it runs with the other suites that
// do when that page or its charts change.
import fs from "node:fs";
import { K, TAB_VIEWS, answerAsk, clearAsked, flat, lastAsked, open, openSetting, openTab, openWorkout, planDone, ready, session, until } from "./harness.mjs";

export const covers = ["src/components/dashboard/LiftDetail.tsx", "src/components/health/Bars.tsx", "src/components/health/Trend.tsx", "src/lib/scale.ts"];

// It opens a renamed lift's page, so it runs with the other suites that do when that page or its charts change.

function history() {
  const logs = {};
  for (let n = 0; n <= 28; n++) logs[K(n)] = { exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "" };
  const lift = (n, name, a) => {
    logs[K(n)].exercises[name] = { done: true, kg: Math.max(...a.map((s) => s[1])), sets: a.map(([reps, kg]) => ({ reps, kg })) };
  };
  lift(0, "Leg Press", [[10, 40], [10, 40], [10, 40]]);
  lift(14, "Leg Press", [[10, 45], [10, 45], [10, 45]]);
  lift(21, "Leg Press", [[12, 50], [12, 50], [12, 50]]); // every set hit the top of 10-12: ready to go up
  lift(21, "Hack Squat", [[10, 20], [10, 20], [10, 20]]);
  lift(0, "Lat Pulldown", [[8, 60]]); // a Pull-day lift with its own history, for the "already has history" refusal
  lift(0, "Calf Raise", [[15, 10]]); // history on the lift used for the "same day" clash refusal
  return logs;
}

// Legs, in the plan's order: the workout's steps, and the index its set boxes use (s<i>_<set>_k).
const LEGS = ["Hack Squat", "Leg Press", "Leg Extension", "Hamstring Curl", "Calf Raise"];

export default async function plan(t) {
  await renaming(t);
  await progressionRules(t);
}

// Renaming a lift in the plan editor (RAJ-34): carrying its logged history over to the new name, refusing a
// name that already has history of its own or clashes with another lift on the same day, and the plain rename
// when there's no history yet to lose.
async function renaming({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000060", "2026-08-26T05:00:00Z", "t@example.com");
  const db = { logs: history(), plan: null };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);

  // --- open the plan editor: today (Wed 23 Sept) is a Legs day, so it opens there directly
  await openTab(page, "settings");
  await page.locator("#planBtn").click();
  check("plan editor opens on today's day", (await page.locator("#planView").isVisible()) && (await page.locator("#pe_name").inputValue()) === "Legs");
  check("Lift 2 is Leg Press, with history", (await page.locator("#pe_x1_name").inputValue()) === "Leg Press");

  // --- renaming a lift with history asks to carry it over, and carries it when you say yes
  await clearAsked(page);
  const name1 = page.locator("#pe_x1_name");
  await name1.click();
  await name1.fill("Leg Press Machine");
  await name1.blur();
  await until(() => db.plan?.days?.[2]?.exercises?.[1]?.name === "Leg Press Machine" && db.logs[K(0)]?.exercises?.["Leg Press Machine"]);
  let asked = await lastAsked(page);
  check(
    "asks to carry the history over, naming both, before doing it",
    asked === "Carry Leg Press’s history over to Leg Press Machine? Every logged day, and anything swapped for Leg Press, will show Leg Press Machine instead.",
    asked,
  );
  check(
    "says so once carried, over every day that had it",
    /Carried Leg Press’s history over to Leg Press Machine: 3 days\./.test(await flat(page.locator("#peRename"))),
    await flat(page.locator("#peRename")),
  );
  check(
    "every day it was logged moved to the new key, old key gone from all of them",
    Object.keys(db.logs[K(0)].exercises).includes("Leg Press Machine") &&
      !("Leg Press" in db.logs[K(0)].exercises) &&
      Object.keys(db.logs[K(14)].exercises).join() === "Leg Press Machine" &&
      Object.keys(db.logs[K(21)].exercises).sort().join("|") === "Hack Squat|Leg Press Machine",
    JSON.stringify([db.logs[K(0)].exercises, db.logs[K(21)].exercises]),
  );

  // --- Train and the workout: the renamed lift carries its numbers and its go-up hint, the old name is gone
  await planDone(page);
  await page.click("#backBtn");
  await page.waitForSelector(TAB_VIEWS); // Settings closes onto the tab it was opened from
  await openTab(page, "train");
  const todayNames = (await page.locator("#liftRows .lrow-main").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  check("the old name is gone from Train", todayNames.length > 0 && !todayNames.some((t) => /^Leg Press\b(?! Machine)/.test(t)), todayNames.join(", "));
  await openWorkout(page, "Leg Press Machine");
  const renamed = page.locator("#workoutView section.ex-card");
  check(
    "the workout shows it under the new name, with last time's sets carried over",
    (await flat(renamed.locator(".ex-name .nm"))) === "Leg Press Machine" && /Last 12, 12, 12 × 50 kg · 16\/09/.test(await flat(renamed.locator(".ex-meta .last"))),
    await flat(renamed.locator(".ex-meta .last")),
  );
  check(
    "the go-up hint still fires: it reads what that session was actually asked for, not a fresh start",
    /Go up to 52\.5 kg: every set hit 12 reps last time/.test(await flat(renamed.locator(".prog"))),
    await flat(renamed.locator(".prog")),
  );
  await page.click("#closeWorkout");
  await page.waitForSelector("#trainView");

  // --- Progress → Strength and the lift's own page: one continuous history under the new name
  await openTab(page, "progress");
  await page.click('#progTabs [data-seg="strength"]');
  await page.waitForSelector("#dashStrength");
  const st = await flat(page.locator("#dashStrength"));
  check("Strength lists it merged under the new name, not as two lifts", st.includes("Leg Press Machine") && !st.includes("Leg Press Legs"), st.slice(0, 300));
  await page.locator("#dashStrength .lifts li", { hasText: "Leg Press Machine" }).first().locator(".ln").click();
  await page.waitForSelector("#dashLift");
  check(
    "the lift's own page opens under the new name",
    (await page.textContent("#screenTitle")) === "Leg Press Machine" && page.url().endsWith("/#progress/lift/Leg%20Press%20Machine"),
    page.url(),
  );
  const kp = await flat(page.locator("#dashLift"));
  check(
    "lift page: all three sessions, before and after the rename, are one history",
    /50 kg ?heaviest set, 16 Sept/.test(kp) && /0\.8 ?sessions a week on average/.test(kp),
    kp,
  );
  // The heaviest-set chart (a trend chart, unsmoothed): one solid dot per session.
  await until(async () => (await page.locator("#liftTop svg circle.tc-dot").count()) > 0, 3000);
  check("lift page: a dot for each of the three sessions on the chart", (await page.locator("#liftTop svg circle.tc-dot").count()) === 3, `${await page.locator("#liftTop svg circle.tc-dot").count()} dots`);
  await page.click("#backBtn");
  await page.waitForSelector("#dashView");

  // --- CSV export (Settings → Export & backup): the days logged before the rename export under the new name too
  await openTab(page, "settings");
  await openSetting(page, "setData");
  const [csv] = await Promise.all([page.waitForEvent("download"), page.click("#csvBtn")]);
  const text = fs.readFileSync(await csv.path(), "utf8");
  check(
    "CSV: history from before the rename exports under the new name, never the old one",
    text.includes(`${K(0)},Legs,Leg Press Machine,`) && text.includes(`${K(21)},Legs,Leg Press Machine,`) && !text.includes(",Leg Press,"),
    text,
  );

  // --- refuses to carry history onto a name that already has its own, asking nothing. The lift is still renamed as
  // typed, since the plan saves as you type; only the history stays where it was.
  await page.locator("#planBtn").click();
  await clearAsked(page);
  const dialogFired = async () => (await lastAsked(page)) !== "";
  const name0 = page.locator("#pe_x0_name");
  await name0.click();
  await name0.fill("Lat Pulldown");
  await name0.blur();
  await until(async () => (await flat(page.locator("#peRename"))) !== "");
  check(
    "refuses when the new name already has its own history, without asking to confirm anything",
    !(await dialogFired()) && (await flat(page.locator("#peRename"))) === "“Lat Pulldown” already has its own history, so Hack Squat’s can’t be carried over there too.",
    await flat(page.locator("#peRename")),
  );
  await until(() => db.plan.days[2].exercises[0].name === "Lat Pulldown");
  check(
    "no history moved: Hack Squat's day keeps it, and Lat Pulldown's keeps its own",
    "Hack Squat" in db.logs[K(21)].exercises && !("Lat Pulldown" in db.logs[K(21)].exercises) && "Lat Pulldown" in db.logs[K(0)].exercises,
    JSON.stringify([db.logs[K(0)].exercises, db.logs[K(21)].exercises]),
  );
  // Typing the old name back is refused the same way (Hack Squat has history), and moves nothing either.
  await name0.click();
  await name0.fill("Hack Squat");
  await name0.blur();
  await until(() => db.plan.days[2].exercises[0].name === "Hack Squat");
  check(
    "typing the old name back renames it back, and moves no history",
    !(await dialogFired()) && "Hack Squat" in db.logs[K(21)].exercises && "Lat Pulldown" in db.logs[K(0)].exercises,
    await flat(page.locator("#peRename")),
  );

  // --- refuses a name already used by another lift the same day, asking nothing
  await clearAsked(page);
  const name4 = page.locator("#pe_x4_name");
  await name4.click();
  await name4.fill("Hamstring Curl");
  await name4.blur();
  await until(async () => (await flat(page.locator("#peRename"))) !== "");
  check(
    "refuses a name already used by another lift that day, without asking to confirm anything",
    !(await dialogFired()) && (await flat(page.locator("#peRename"))) === "Another lift on Wed is already called “Hamstring Curl”. Give them different names to carry Calf Raise’s history over.",
    await flat(page.locator("#peRename")),
  );
  check("no history moved there either", "Calf Raise" in db.logs[K(0)].exercises && !("Hamstring Curl" in db.logs[K(0)].exercises));
  // Back to Calf Raise: Hamstring Curl has no history here, so that's a plain rename, with nothing to ask.
  await name4.click();
  await name4.fill("Calf Raise");
  await name4.blur();
  await until(() => db.plan.days[2].exercises[4].name === "Calf Raise");
  check("renaming it back asks nothing", !(await dialogFired()));

  // --- saying no in the prompt still renames the lift; it just starts a fresh history
  await answerAsk(page, "cancel");
  await name0.click();
  await name0.fill("Hack Squat V2");
  await name0.blur();
  await until(async () => db.plan?.days?.[2]?.exercises?.[0]?.name === "Hack Squat V2" && (await dialogFired()) && (await page.locator("#askDialog[open]").count()) === 0);
  asked = await lastAsked(page);
  check(
    "declining the carry-over still renames the lift, without moving its old history",
    asked.startsWith("Carry Hack Squat’s history over to Hack Squat V2?") && "Hack Squat" in db.logs[K(21)].exercises && !("Hack Squat V2" in db.logs[K(21)].exercises),
    asked,
  );

  // --- a lift with no history yet needs no prompt at all: it's just a rename
  await clearAsked(page);
  const name2 = page.locator("#pe_x2_name");
  await name2.click();
  await name2.fill("Leg Extension V2");
  await name2.blur();
  await until(() => db.plan?.days?.[2]?.exercises?.[2]?.name === "Leg Extension V2");
  check("a lift with no history renames without any prompt or message", !(await dialogFired()) && (await flat(page.locator("#peRename"))) === "");

  // --- the plan changing on another phone while "Remove …?" is up: Remove takes the lift it asked about, wherever
  // it is now, not whichever lift has moved into its place
  await until(async () => (await flat(page.locator("#planMsg"))) === "Saved");
  const liftNames = () => page.locator('#planView input[id$="_name"]:not(#pe_name)').evaluateAll((els) => els.map((e) => e.value));
  await answerAsk(page, "leave");
  await page.locator('button[data-pdel="0"]').click();
  await page.waitForSelector("#askDialog[open]");
  const removing = await lastAsked(page);
  db.plan = { ...db.plan, days: db.plan.days.map((d, n) => (n === 2 ? { ...d, exercises: [{ name: "Walking Lunge", sets: 3, reps: "10-12" }, ...d.exercises] } : d)) };
  db.planAt = "2026-09-23T12:30:00.000Z";
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await until(async () => (await liftNames())[0] === "Walking Lunge");
  await page.click("#askDialog [data-choice]");
  await until(() => !db.plan.days[2].exercises.some((x) => x.name === "Hack Squat V2"));
  check(
    "Remove, after the plan changed while it asked, takes the lift it asked about",
    removing === "Remove Hack Squat V2 from Wed? Days you’ve already logged keep it." && (await liftNames()).join(",") === "Walking Lunge,Leg Press Machine,Leg Extension V2,Hamstring Curl,Calf Raise" && db.plan.days[2].exercises[0].name === "Walking Lunge",
    `${removing} / ${(await liftNames()).join(",")}`,
  );

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}

// Progression options per lift (RAJ-41): the plan editor picks each lift's rule (double progression, linear, or a
// percentage of a 1RM) and an optional deload, and the workout's hint and grey numbers follow the rule, naming it;
// Strength on Progress lists a deload alongside the lifts ready for more weight.
async function progressionRules({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000041", "2026-08-26T05:00:00Z", "t@example.com");
  const day = (more = {}) => ({ exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "", ...more });
  const lift = (a) => ({ done: true, kg: Math.max(...a.map((s) => s[1])), sets: a.map(([reps, kg]) => ({ reps, kg })) });
  const short = [[10, 50], [8, 50], [7, 50]];
  // The last two Wednesdays: Hamstring Curl fell short both times; Calf Raise hit 12s, the bottom of its 12-15;
  // Leg Press hit its 12s, but the knee was sore after.
  const db = {
    logs: {
      [K(0)]: day({ steps: 6000 }),
      [K(14)]: day({ exercises: { "Hamstring Curl": lift(short) } }),
      [K(21)]: day({
        exercises: { "Hamstring Curl": lift(short), "Calf Raise": lift([[12, 40], [12, 40], [12, 40]]), "Leg Press": lift([[12, 50], [12, 50], [12, 50]]) },
        kneeBefore: 2,
        kneeAfter: 7,
      }),
    },
    plan: null,
  };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);
  const legs = () => db.plan?.days?.[2]?.exercises ?? [];
  /** Shows a lift in the workout, by its step along the top, and returns its card. */
  const at = async (name) => {
    await page.locator("ol.wprog li button").nth(LEGS.indexOf(name)).click();
    await until(async () => (await flat(page.locator("#workoutView .ex-name .nm"))) === name);
    return page.locator("#workoutView section.ex-card");
  };
  const hint = async (name) => (await at(name)).locator(".prog");
  /** Leaves the workout for Train, then opens the plan editor from its Change plan. */
  const editPlan = async () => {
    await page.click("#closeWorkout");
    await page.waitForSelector("#trainView");
    await page.click("#changePlan");
    await page.waitForSelector("#planView");
  };

  await openWorkout(page, "Hamstring Curl");
  check("before any rule is set, Hamstring Curl has no hint: it fell short", (await (await hint("Hamstring Curl")).count()) === 0);
  check("and Calf Raise waits for 15s under double progression", (await (await hint("Calf Raise")).count()) === 0);

  // --- the plan editor, Legs
  await editPlan();
  const prog = (j) => page.locator(".pe-ex").nth(j).locator(".pe-prog");
  check("each lift's progression is folded, naming its rule", !(await prog(3).evaluate((d) => d.open)) && (await flat(prog(3).locator("summary"))) === "Progression: Double progression");
  // Hamstring Curl: a deload after two sessions short.
  await prog(3).locator("summary").click();
  await page.fill("#pe_x3_deloadAfter", "2");
  await until(() => legs()[3]?.deloadAfter === "2");
  check("a deload saves with the plan", legs()[3]?.deloadAfter === "2" && !("prog" in legs()[3]), JSON.stringify(legs()[3]));
  check("and the summary says so", (await flat(prog(3).locator("summary"))) === "Progression: Double progression, deload after 2 short");
  // Calf Raise: linear.
  await prog(4).locator("summary").click();
  await page.selectOption("#pe_x4_prog", "linear");
  await until(() => legs()[4]?.prog === "linear");
  check("linear saves with the plan", legs()[4]?.prog === "linear");
  check("what the rule does shows under it", (await flat(page.locator("#pe_x4_proghow"))) === "Add the step every session each set reaches the bottom of the rep range.");
  // Leg Extension: 75% of a 60 kg 1RM, never logged.
  await prog(2).locator("summary").click();
  check("the 1RM fields show only for a percentage", (await page.locator("#pe_x2_oneRm").count()) === 0);
  await page.selectOption("#pe_x2_prog", "percent");
  await page.fill("#pe_x2_oneRm", "60");
  await page.fill("#pe_x2_pct", "75");
  await until(() => legs()[2]?.pct === "75");
  check("a percentage saves its 1RM with it", legs()[2]?.prog === "percent" && legs()[2]?.oneRm === "60" && legs()[2]?.pct === "75", JSON.stringify(legs()[2]));
  await planDone(page);
  await openWorkout(page, "Hamstring Curl");

  // --- the workout: each lift's hint names its rule
  const words = async (name) => {
    const h = await hint(name);
    return [await flat(h), await h.getAttribute("data-rule")];
  };
  check("a deload after two sessions short", JSON.stringify(await words("Hamstring Curl")) === JSON.stringify(["Deload to 45 kg: 2 sessions in a row fell short, so 10% off 50 kg.", "deload"]), (await words("Hamstring Curl")).join(" | "));
  check("the deload is a warning", await (await hint("Hamstring Curl")).evaluate((el) => el.classList.contains("warn")));
  check("linear, with its step", JSON.stringify(await words("Calf Raise")) === JSON.stringify(["Go up to 42.5 kg: linear, +2.5 kg a session while every set hits 12 reps.", "linear"]), (await words("Calf Raise")).join(" | "));
  check("a percentage of the 1RM, with no history", JSON.stringify(await words("Leg Extension")) === JSON.stringify(["Work at 45 kg: 75% of your 60 kg 1RM.", "percent"]), (await words("Leg Extension")).join(" | "));
  check("a sore knee still holds a knee lift", JSON.stringify(await words("Leg Press")) === JSON.stringify(["Hold 50 kg: your knee was sore after 16/09.", "hold"]), (await words("Leg Press")).join(" | "));
  const ph = async (name) => {
    await at(name);
    return page.locator(`#s${LEGS.indexOf(name)}_0_k`).getAttribute("placeholder");
  };
  const grey = [await ph("Hamstring Curl"), await ph("Calf Raise"), await ph("Leg Extension")];
  check("the grey numbers follow: the deload weight, the new weight, the percentage", grey.join(" ") === "45 42.5 45", grey.join(" "));

  // --- Progress: the deload next to the lifts ready for more weight
  await page.click("#closeWorkout");
  await page.waitForSelector("#trainView");
  await openTab(page, "progress");
  // Overview shows the two most pressing notes. Here the sore knee comes first and the lift ready for more weight
  // second, so the deload's own note (same priority, after it) waits its turn: Strength lists it below.
  const flags = await flat(page.locator("#dashFlags"));
  check(
    "Overview's notes point to Strength for the lifts that change weight (two notes at most)",
    flags.includes("1 lift is ready for more weight. See Strength.") && (await page.locator("#dashFlags > *").count()) <= 2,
    flags,
  );
  await page.click('#progTabs button[data-seg="strength"]');
  await page.waitForSelector("#dashStrength");
  const up = await page.locator('#dashStrength h3.dh:has-text("Ready to add weight") + ul.plain > li').allInnerTexts();
  const rows = up.map((t) => t.replace(/\s+/g, " ").trim());
  check("Strength lists it, and the linear lift", rows.includes("Calf Raise Legs: 40 → 42.5 kg") && rows.includes("Hamstring Curl Legs: 50 → 45 kg (deload)"), rows.join(" | "));
  check("a percentage with nothing logged to go up from isn't listed", !rows.some((r) => r.startsWith("Leg Extension")), rows.join(" | "));

  // --- back to double progression: the rule leaves the plan
  await openTab(page, "train");
  await page.click("#changePlan");
  await page.waitForSelector("#planView");
  await prog(4).locator("summary").click();
  await page.selectOption("#pe_x4_prog", "double");
  await until(() => legs()[4] && !("prog" in legs()[4]));
  check("Double progression is the default, so it isn't stored", !("prog" in legs()[4]), JSON.stringify(legs()[4]));
  await planDone(page);
  await openWorkout(page, "Calf Raise");
  check("and Calf Raise waits for 15s again", (await (await hint("Calf Raise")).count()) === 0);

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
