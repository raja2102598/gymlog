// Today: sets, skip and swap, the plan editor, switching a day's workout, and history for a new account.
import { flat, liftEl, open, ready, session, shot, until } from "./harness.mjs";

// Today's real first entry (older format: one weight per lift, no sets).
const firstDay = () => ({
  exercises: { "Hack Squat": { done: true, kg: 0 }, "Leg Press": { done: true, kg: 50 }, "Leg Extension": { done: true, kg: 27 }, "Hamstring Curl": { done: true, kg: 27 }, "Calf Raise": { done: true, kg: 17.5 } },
  warmup: ["Jumping jacks", "Light warm-up sets"],
  cardio: true,
  steps: 7351,
  weight: 81,
  note: "Day 1.",
});

export default async function today({ browser, base, check }) {
  const db = {
    logs: {
      "2026-09-23": firstDay(),
      // Last week's Legs day in the new format, including a swap.
      "2026-09-16": {
        exercises: {
          "Leg Press": { done: true, kg: 45, sets: [{ reps: 10, kg: 45 }, { reps: 10, kg: 45 }, { reps: 8, kg: 45 }] },
          "Hack Squat": { done: true, kg: 20, swap: "Smith Squat", sets: [{ reps: 10, kg: 20 }] },
        },
        warmup: [],
        cardio: false,
        steps: 9000,
        weight: 82,
        note: "",
      },
    },
    plan: null,
  };
  const { ctx, page } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000001"), db });
  const lift = (name) => liftEl(page, name);
  await ready(page);
  check("signed-in app view shows", await page.locator("#appView").isVisible());
  check("today is Wed · Legs", (await page.locator("#session h2").textContent()) === "Legs");

  // --- an older entry shows as set 1; last week's sets drive hints and placeholders
  const lp = lift("Leg Press");
  check("legacy weight shows as set 1 kg", (await lp.locator('input[data-set$=":0:kg"]').inputValue()) === "50");
  check("3 set rows for a 3-set lift", (await lp.locator(".set").count()) === 3);
  check("hint shows last week's sets, and that today is heavier", /Last 10, 10, 8 × 45 kg · 16\/09 ↑/.test(await lp.locator(".hint").textContent()), await lp.locator(".hint").textContent());
  check("reps placeholder from last week", (await lp.locator('input[data-set$=":1:reps"]').getAttribute("placeholder")) === "10");
  check("pill counts today's lifts", /5\/5 lifts/.test(await page.locator("#liftPill").textContent()));
  check("progress bar: one segment per planned lift, filled when done", (await page.locator("#session .segs i").count()) === 5 && (await page.locator("#session .segs i.done").count()) === 5);
  // How to do a lift is folded until asked for; its warning note always shows.
  const how = lp.locator("button.howto");
  check("how-to note starts folded", (await lp.locator(".nt").count()) === 0 && (await how.getAttribute("aria-expanded")) === "false" && /KNEE NOTE/.test(await lp.locator(".ch").textContent()));
  await how.click();
  check("How to opens the note", /Feet high on the platform/.test(await lp.locator(".nt").textContent()) && (await how.getAttribute("aria-expanded")) === "true");
  await how.click();
  check("and folds it again", (await lp.locator(".nt").count()) === 0);
  await shot(page, "1-today-legs", { fullPage: true });

  // --- log sets on today's Leg Press
  await lp.locator('input[data-set$=":0:reps"]').fill("10");
  await lp.locator('input[data-set$=":1:reps"]').fill("10");
  check("next set copies previous weight", (await lp.locator('input[data-set$=":1:kg"]').inputValue()) === "50");
  await until(() => db.logs["2026-09-23"].exercises["Leg Press"].sets?.length === 2);
  const lps = db.logs["2026-09-23"].exercises["Leg Press"];
  check("sets saved with reps and kg", JSON.stringify(lps.sets) === JSON.stringify([{ reps: 10, kg: 50 }, { reps: 10, kg: 50 }]) && lps.kg === 50 && lps.done === true, JSON.stringify(lps));

  // --- a fresh day: Monday, Push
  await page.locator("#week .dchip").first().click();
  check("Monday shows Push", (await page.locator("#session h2").textContent()) === "Push");
  const inc = lift("Incline Machine Press");
  await inc.locator('input[data-set$=":0:reps"]').fill("8");
  await inc.locator('input[data-set$=":0:kg"]').fill("40");
  await inc.locator('input[data-set$=":1:reps"]').fill("8");
  check("not ticked before the planned 3 sets", !(await inc.locator('input[type="checkbox"]').isChecked()));
  await inc.locator('input[data-set$=":2:reps"]').fill("7");
  check("ticked after the planned 3 sets", await inc.locator('input[type="checkbox"]').isChecked());
  check("pill updates live", /1\/6 lifts/.test(await page.locator("#liftPill").textContent()));
  await inc.locator("button[data-addset]").click();
  check("+ Set adds a 4th row", (await lift("Incline Machine Press").locator(".set").count()) === 4);
  await lift("Incline Machine Press").locator("button[data-rmset]").click();
  check("− Set removes it again", (await lift("Incline Machine Press").locator(".set").count()) === 3);
  await until(() => db.logs["2026-09-21"]?.exercises["Incline Machine Press"]?.sets?.length === 3);
  const im = db.logs["2026-09-21"].exercises["Incline Machine Press"];
  check("Monday sets saved", JSON.stringify(im.sets) === JSON.stringify([{ reps: 8, kg: 40 }, { reps: 8, kg: 40 }, { reps: 7, kg: 40 }]) && im.done && im.kg === 40, JSON.stringify(im));

  // --- skip
  await lift("Chest Press Machine").locator("button[data-more]").click();
  await lift("Chest Press Machine").locator("button[data-skip]").click();
  check("reason box focused after skipping", await page.evaluate(() => document.activeElement?.dataset.reason !== undefined));
  await page.keyboard.type("machine busy");
  check("skip note shows reason", /Skipped · machine busy/.test(await lift("Chest Press Machine").locator(".skipnote").textContent()));
  check("pill counts skipped", /1\/6 lifts · 1 skipped/.test(await page.locator("#liftPill").textContent()));
  await until(() => db.logs["2026-09-21"].exercises["Chest Press Machine"]?.reason === "machine busy");
  const cp = db.logs["2026-09-21"].exercises["Chest Press Machine"];
  check("skip saved", cp.skipped === true && cp.done === false && cp.reason === "machine busy", JSON.stringify(cp));
  await shot(page, "2-monday-sets-and-skip", { fullPage: true });
  await lift("Chest Press Machine").locator("button[data-unskip]").click();
  await until(() => !db.logs["2026-09-21"].exercises["Chest Press Machine"].skipped);
  check("undo skip", !db.logs["2026-09-21"].exercises["Chest Press Machine"].skipped && !("reason" in db.logs["2026-09-21"].exercises["Chest Press Machine"]));

  // --- swap
  await lift("Machine Shoulder Press").locator("button[data-more]").click();
  await lift("Machine Shoulder Press").locator("button[data-swapopen]").click();
  const opts = await page.locator("#swapList option").evaluateAll((os) => os.map((o) => o.value));
  check("swap suggestions include past swaps and plan lifts", opts.includes("Smith Squat") && opts.includes("DB Shoulder Press") && !opts.includes("Machine Shoulder Press"));
  await page.locator("form[data-swapform] input").fill("DB Shoulder Press");
  await page.locator('form[data-swapform] button[type="submit"]').click();
  const sw = lift("DB Shoulder Press");
  check("swapped lift shows replacement name", /DB Shoulder Press instead of Machine Shoulder Press/.test(await sw.locator(".nm").textContent()));
  check("swapped lift hint is its own history", /First time/.test(await sw.locator(".hint").textContent()));
  await until(() => db.logs["2026-09-21"].exercises["Machine Shoulder Press"]?.swap === "DB Shoulder Press");
  check("swap saved under the planned lift", db.logs["2026-09-21"].exercises["Machine Shoulder Press"].swap === "DB Shoulder Press");
  await shot(page, "3-monday-swap", { fullPage: true });
  await sw.locator("button[data-more]").click();
  await sw.locator("button[data-unswap]").click();
  await until(() => !db.logs["2026-09-21"].exercises["Machine Shoulder Press"].swap);
  check("undo swap", !db.logs["2026-09-21"].exercises["Machine Shoulder Press"].swap && (await lift("Machine Shoulder Press").count()) === 1);

  // Back on Wednesday, last week's Smith Squat swap feeds the hint for a swap today.
  await page.locator("#todayB").click();
  await lift("Hack Squat").locator("button[data-more]").click();
  await lift("Hack Squat").locator("button[data-swapopen]").click();
  await page.locator("form[data-swapform] input").fill("Smith Squat");
  await page.locator("form[data-swapform] input").press("Enter");
  check("swap hint uses that exercise's past sets", /Last 10 × 20 kg · 16\/09/.test(await lift("Smith Squat").locator(".hint").textContent()), await lift("Smith Squat").locator(".hint").textContent());
  await lift("Smith Squat").locator("button[data-more]").click();
  await lift("Smith Squat").locator("button[data-unswap]").click();

  // --- plan editor
  await page.locator("#week .dchip").first().click(); // Monday
  await page.locator("#menuBtn").click();
  await page.locator("#planBtn").click();
  check("plan editor opens on the selected weekday", (await page.locator("#planView").isVisible()) && (await page.locator("#pe_name").inputValue()) === "Push");
  await page.locator("#pe_name").fill("Push A");
  await page.locator("#pe_add").click();
  check("new lift field focused", await page.evaluate(() => document.activeElement?.id === "pe_x6_name"));
  await page.keyboard.type("Cable Triceps Pushdown");
  check("duplicate name warning", /Two lifts are called “Cable Triceps Pushdown”/.test(await page.locator("#peWarn").textContent()) && (await page.locator("#peWarn").isVisible()));
  await page.locator("#pe_x6_name").fill("Cable Fly");
  check("warning clears", !(await page.locator("#peWarn").isVisible()));
  await page.locator("#pe_x6_sets").fill("3");
  await page.locator("#pe_x6_reps").fill("12-15");
  await page.locator("#pe_x6_cue").fill("Slight bend in the elbows.");
  await page.locator('button[data-pmove="6:-1"]').click();
  check("move up reorders", (await page.locator("#pe_x5_name").inputValue()) === "Cable Fly");
  await page.locator('button[data-pdel="0"]').click(); // remove Incline Machine Press (it has Monday data)
  check("remove deletes the lift", (await page.locator("#pe_x0_name").inputValue()) === "Chest Press Machine");
  await page.locator("#pe_warm").fill("Treadmill walk 5 min\nWrist circles\n\nArm circles");
  await page.locator("#pe_goal").fill("12000");
  await page.locator("#pe_tempo").fill("3:0:1:0");
  await shot(page, "4-plan-editor", { fullPage: true });
  await until(() => db.plan?.days?.[0]?.name === "Push A" && db.plan.tempo === "3:0:1:0" && db.plan.stepGoal === 12000);
  const pd = db.plan?.days?.[0];
  check(
    "plan saved to plans table",
    pd &&
      pd.name === "Push A" &&
      pd.exercises.map((x) => x.name).join("|") === "Chest Press Machine|Machine Shoulder Press|DB Lateral Raises|Cable Triceps Pushdown|Cable Fly|Overhead Rope Extension" &&
      JSON.stringify(db.plan.warmups) === JSON.stringify(["Treadmill walk 5 min", "Wrist circles", "Arm circles"]),
    JSON.stringify(pd?.exercises.map((x) => x.name)),
  );
  await page.locator("#planDone").click();

  check("day view uses the edited plan", (await page.locator("#session h2").textContent()) === "Push A" && (await lift("Cable Fly").count()) === 1);
  const extra = lift("Incline Machine Press");
  check("removed lift with logged sets still shows", (await extra.count()) === 1 && /Not in this workout/.test(await extra.textContent()) && (await extra.locator('input[data-set$=":2:reps"]').inputValue()) === "7");
  check("edited warm-ups show", (await page.locator("#session .chip", { hasText: "Wrist circles" }).count()) === 1);
  check("tempo note follows plan", /3:0:1:0/.test(await page.locator("#tempoNote").textContent()));
  check("week chip shows new day name", (await page.locator("#week .dchip").first().getAttribute("aria-label")).includes(", Push A"));
  await shot(page, "5-edited-monday", { fullPage: true });

  // --- reload: the plan comes back from the plans table
  await page.evaluate(() => localStorage.removeItem("gymlog.plan.v1"));
  await page.reload();
  await page.waitForSelector("#appView:not([hidden])");
  await until(async () => (await page.locator("#week .dchip").first().getAttribute("aria-label"))?.includes(", Push A"));
  check("plan loads from the plans table after reload", (await page.locator("#week .dchip").first().getAttribute("aria-label")).includes(", Push A"));

  // --- reset to the default plan
  await page.locator("#menuBtn").click();
  await page.locator("#planBtn").click();
  await page.locator("#pe_reset").click();
  await until(() => db.plan?.days?.[0]?.name === "Push");
  check("reset to default plan saved", db.plan.days[0].name === "Push" && db.plan.stepGoal === 10000 && db.plan.days[0].exercises.length === 6);
  await page.locator("#planDone").click();
  check("reload returns to today", (await page.locator("#session h2").textContent()) === "Legs");
  await page.locator("#week .dchip").first().click();
  check(
    "day view back on default plan",
    (await page.locator("#session h2").textContent()) === "Push" &&
      (await lift("Cable Fly").count()) === 0 &&
      (await lift("Incline Machine Press").count()) === 1 &&
      !/Not in this workout/.test(await lift("Incline Machine Press").textContent()),
  );

  // --- a rest day renders, and no stray requests or errors
  await page.locator("#week .dchip").nth(3).click();
  check("rest day renders", /Rest day/.test(await page.locator("#liftPill").textContent()));
  check("rest day: no empty lift list or progress bar", (await page.locator("#session ul.ex:not(.cardio)").count()) === 0 && (await page.locator("#session .segs").count()) === 0);
  check("only logs/plans endpoints were called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors or warnings", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();

  // --- a brand-new account that started today (Wed 23 Sep), like the real one
  const db2 = { logs: { "2026-09-23": firstDay() }, plan: null };
  const { ctx: ctx2, page: p2 } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000001", "2026-09-23T06:00:00Z"), db: db2 });
  await ready(p2);
  check("new account: history starts today", (await p2.locator("#hist tbody tr").count()) === 1 && (await p2.locator("#histTitle").textContent()) === "Today");
  check("today's picker shows its usual workout", (await p2.locator("#sessionSel option:checked").textContent()) === "Legs (Wed, usual)" && (await p2.locator(".moved").count()) === 0);
  check("week counts Legs once: 1/5", (await p2.locator("#stats .v").first().textContent()) === "1/5");
  check("no catch-up on a gym day", (await p2.locator(".catchup").count()) === 0);
  await p2.locator("#week .dchip").nth(3).click(); // Thursday, a rest day tomorrow
  check("Thursday offers missed Push and Pull", /Missed this week: Push \(Mon\), Pull \(Tue\)\. Do one on Thu\?/.test(await flat(p2.locator(".catchup"))), await flat(p2.locator(".catchup")));
  await shot(p2, "6-thursday-catchup");
  await p2.locator('button[data-catch="0"]').click();
  check("Thursday now shows Push", (await p2.locator("#session h2").textContent()) === "Push" && /Usually Rest/.test(await flat(p2.locator(".moved"))));
  check("week strip shows Push on Thursday", (await p2.locator("#week .dchip").nth(3).getAttribute("aria-label")).endsWith("Push"));
  await until(() => db2.logs["2026-09-24"]?.session === 0);
  check("choice saved with the day", db2.logs["2026-09-24"]?.session === 0, JSON.stringify(db2.logs["2026-09-24"]));
  await shot(p2, "7-thursday-push");
  await p2.locator("#week .dchip").nth(6).click(); // Sunday
  check("Sunday offers only Pull once Push is booked", /Missed this week: Pull \(Tue\)\. Do it on Sun\?/.test(await flat(p2.locator(".catchup"))), await flat(p2.locator(".catchup")));
  await p2.locator('button[data-catch="1"]').click();
  check("Sunday now shows Pull", (await p2.locator("#session h2").textContent()) === "Pull");
  await p2.locator("#week .dchip").nth(3).click();
  await p2.locator("#sessionSel").selectOption("3");
  check("switching back restores Rest", (await p2.locator("#session h2").textContent()) === "Rest");
  await until(() => db2.logs["2026-09-24"] && !("session" in db2.logs["2026-09-24"]));
  check("switching back clears the saved choice", !("session" in db2.logs["2026-09-24"]));
  check("Thursday offers Push again (Pull is booked on Sunday)", /Missed this week: Push \(Mon\)\. Do it on Thu\?/.test(await flat(p2.locator(".catchup"))), await flat(p2.locator(".catchup")));
  check("week still counts 1/5", (await p2.locator("#stats .v").first().textContent()) === "1/5");
  db2.logs["2026-09-21"] = { exercises: {}, warmup: [], cardio: false, steps: 4000, weight: null, note: "" };
  await p2.reload();
  await p2.waitForSelector("#appView:not([hidden])");
  await until(async () => (await p2.locator("#hist tbody tr").count()) === 3);
  check("history starts at the earliest log", (await p2.locator("#hist tbody tr").count()) === 3 && (await p2.locator("#histTitle").textContent()) === "Last 3 days");
  check("new account: no console errors", p2.errors.length === 0, p2.errors.join(" | "));
  await ctx2.close();
}
