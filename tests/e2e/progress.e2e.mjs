// Progress, and what four weeks of history shows across the app: the knee scores on Home and Train, next-weight
// hints and records in the workout, cardio and waist, and Progress itself (Overview and its pace flag, Body,
// Strength, Muscles, and a lift's own page).
import { K, flat, open, openTab, openWorkout, ready, session, shot, until } from "./harness.mjs";

export const covers = ["src/components/dashboard/LiftDetail.tsx", "src/components/health/Bars.tsx", "src/components/health/Trend.tsx", "src/lib/scale.ts"];

function history() {
  const logs = {};
  for (let n = 0; n <= 28; n++) {
    const e = { exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "" };
    if (n <= 22 && n % 3 !== 2) e.weight = Math.round((84 - 0.1 * n + (((n * 7) % 5) - 2) * 0.15) * 10) / 10; // last weigh-in 17 Sep
    if (n % 2 === 0 || n % 5 === 0) e.steps = 6000 + ((n * 1379) % 6000);
    logs[K(n)] = e;
  }
  const lift = (n, name, a) => {
    logs[K(n)].exercises[name] = { done: true, kg: Math.max(...a.map((s) => s[1])), sets: a.map(([reps, kg]) => ({ reps, kg })) };
  };
  for (const [n, a] of [
    [0, [[10, 40], [10, 40], [9, 40]]],
    [7, [[10, 45], [10, 45], [10, 45]]],
    [14, [[11, 45], [11, 45], [10, 45]]],
    [21, [[12, 50], [12, 50], [12, 50]]],
  ]) {
    lift(n, "Leg Press", a);
    lift(n, "Hack Squat", [[10, 20], [10, 20], [10, 20]]);
  }
  lift(21, "Hamstring Curl", [[12, 30], [12, 30], [12, 30]]);
  lift(26, "Chest Press Machine", [[12, 40], [12, 40], [12, 40]]); // ready, and untouched by the test today
  for (const [n, kg] of [[5, 30], [12, 32.5], [19, 35], [26, 35]]) lift(n, "Incline Machine Press", [[8, kg], [8, kg], [8, kg]]);
  Object.assign(logs[K(14)], { kneeBefore: 2, kneeAfter: 3 });
  logs[K(15)].kneeWake = 2;
  Object.assign(logs[K(21)], { kneeBefore: 2, kneeAfter: 6 }); // sore after 16 Sep,
  logs[K(22)].kneeWake = 3; // and not settled the next morning
  logs[K(0)].waist = 95;
  return logs;
}

/** The workout at a lift of today's session: from Train, its row (closing the workout first, if it's open). */
async function atLift(page, name) {
  if (await page.locator("#closeWorkout").count()) {
    await page.click("#closeWorkout");
    await page.waitForSelector("#trainView");
  }
  await openWorkout(page, name);
  return page.locator(".ex-card.lift", { has: page.locator(".ex-name", { hasText: name }) }).first();
}

// Daily weigh-ins from 26 Aug to today, changing by `perDay` kg.
const series = (perDay) => {
  const logs = {};
  for (let n = 0; n <= 28; n++) logs[K(n)] = { exercises: {}, warmup: [], cardio: false, steps: null, weight: Math.round((84 + perDay * n) * 10) / 10, note: "" };
  return logs;
};

export default async function progress(t) {
  await fourWeeks(t);
  await pace(t);
  await muscles(t);
}

// Knee scores (Home and Train), next-weight hints and records (the workout), cardio and waist, home-screen shortcuts,
// and Progress (Overview, Body, Strength, a lift's page), on four weeks of history.
async function fourWeeks({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000002", "2026-08-26T05:00:00Z", "t@example.com");
  const db = { logs: history(), plan: null };

  {
    const { ctx, page } = await open(browser, base, { auth, db });
    await ready(page);
    // --- the knee before the session, asked on Home's workout card
    await page.locator('#todayCard button[data-knee="kneeBefore:3"]').click();
    await until(() => db.logs["2026-09-23"].kneeBefore === 3);
    await page.waitForSelector("#kneeNote");
    check("knee before saved and folded to one line", db.logs["2026-09-23"].kneeBefore === 3 && /Knee 3\/10 today/.test(await flat(page.locator("#kneeNote"))) && (await page.locator("#todayCard button[data-knee]").count()) === 0, await flat(page.locator("#todayCard")));
    await page.click("#kneeNote");
    check("tapping it reopens the scale with the score picked", (await page.locator('#todayCard button[data-knee="kneeBefore:3"]').getAttribute("aria-checked")) === "true");
    await until(() => page.evaluate(() => document.activeElement?.dataset.knee === "kneeBefore:3"));
    check("…and moves focus to the scale", await page.evaluate(() => document.activeElement?.dataset.knee?.startsWith("kneeBefore:")));

    // --- Train's day log: knee before and after
    await openTab(page, "train");
    check("knee scales shown on a knee day", (await page.locator("#kneeCard .pain").count()) === 2);
    await page.locator('#kneeCard button[data-knee="kneeBefore:3"]').click();
    await until(() => db.logs["2026-09-23"].kneeBefore === undefined);
    check("tapping the score again clears it", db.logs["2026-09-23"].kneeBefore === undefined && (await page.locator('#kneeCard button[data-knee="kneeBefore:3"]').getAttribute("aria-checked")) === "false");
    await page.locator('#kneeCard button[data-knee="kneeAfter:7"]').click();
    check("score above limit warns", /Above your limit/.test(await flat(page.locator("#kneeCard"))));

    // --- next-weight hints, knee hold, placeholders, in the workout
    let ham = await atLift(page, "Hamstring Curl");
    check("ready lift says go up", /Go up to 32\.5 kg: every set hit 12 reps last time/.test(await flat(ham.locator(".prog"))), await flat(ham.locator(".prog")));
    check("placeholders show new weight at the bottom of the range", (await ham.locator('input[data-set$=":0:kg"]').getAttribute("placeholder")) === "32.5" && (await ham.locator('input[data-set$=":0:reps"]').getAttribute("placeholder")) === "10");
    // --- live record badge
    await ham.locator('input[data-set$=":0:reps"]').fill("10");
    await ham.locator('input[data-set$=":0:kg"]').fill("32.5");
    const set0 = ham.locator(".srow.set").first();
    await until(async () => (await set0.getAttribute("class")).includes("pr"));
    check("heavier set gets a PR badge while typing", (await set0.getAttribute("class")).includes("pr") && /heaviest yet/.test(await set0.locator(".prb").getAttribute("title")));
    check("second set without a record has no badge", !(await ham.locator(".srow.set").nth(1).getAttribute("class")).includes("pr"));
    const lp = await atLift(page, "Leg Press");
    const lpHint = await flat(lp.locator(".prog"));
    const hs = await atLift(page, "Hack Squat");
    check("knee-sensitive lift is held after a sore day", /Hold 50 kg: your knee was sore after 16\/09/.test(lpHint) && /Hold 20 kg/.test(await flat(hs.locator(".prog"))), lpHint);
    // --- cardio minutes (the workout's last step) and waist (Train)
    await page.click("#closeWorkout");
    await page.waitForSelector("#trainView");
    await page.click("#cardioRow");
    await page.waitForSelector("#cMin");
    await page.locator("#cMin").fill("20");
    check("cardio minutes tick the finisher", await page.locator("#cardio").isChecked());
    await page.locator("#cKmh").fill("5.5");
    await page.locator("#cInc").fill("8");
    await page.click("#closeWorkout");
    await page.waitForSelector("#trainView");
    await page.locator("#waist").fill("93.5");
    await until(() => db.logs["2026-09-23"].waist === 93.5 && db.logs["2026-09-23"].cardioIncline === 8);
    const t = db.logs["2026-09-23"];
    check("cardio details and waist saved", t.cardio === true && t.cardioMin === 20 && t.cardioKmh === 5.5 && t.cardioIncline === 8 && t.waist === 93.5, JSON.stringify(t));
    // --- the next morning asks about the knee
    await page.locator("#dayChips .dchip").nth(3).click();
    check("next morning asks about the knee", /Knee on waking ?after Legs/.test(await flat(page.locator("#kneeCard .pain").first())), await flat(page.locator("#kneeCard")));
    await page.locator('#kneeCard button[data-knee="kneeWake:2"]').click();
    await until(() => db.logs["2026-09-24"]?.kneeWake === 2);
    check("morning score saved on the next day", db.logs["2026-09-24"]?.kneeWake === 2 && /Not settled since yesterday/.test(await flat(page.locator("#kneeCard"))));
    await page.locator("#dayChips .dchip").nth(2).click();
    // --- Home: the last weigh-in, six days ago
    await openTab(page, "home");
    check("Home shows the last weigh-in", (await flat(page.locator("#weightToday"))) === "82.1 kg", await flat(page.locator("#weightToday")));

    // --- Progress: Overview
    await openTab(page, "progress");
    check(
      "Progress opens on Overview, its tab marked as the current one",
      (await page.locator("#dashView").isVisible()) && (await page.locator("#homeView, #trainView").count()) === 0 && (await page.getAttribute("#tabProgress", "aria-current")) === "page" && (await page.textContent("#screenTitle")) === "Progress" && (await page.getAttribute('#progTabs [data-seg="overview"]', "aria-selected")) === "true",
    );
    // Overview shows the two most pressing flags; lifts ready for more weight are listed in Strength.
    const flags = await flat(page.locator("#dashFlags"));
    check("flags: sore knee today", /Knee was above your limit after Legs on 23 Sept/.test(flags), flags);
    check("flags: weigh-in gap", /No weigh-in for 6 days/.test(flags), flags);
    check("flags: at most two, the warnings first", (await page.locator("#dashFlags .callout").count()) === 2 && (await page.locator("#dashFlags .callout.caution").count()) === 2, flags);
    const stats = await flat(page.locator("#dashStats"));
    check("the week in three numbers: sessions, average steps, weight change", /\d+ ?of \d+ ?sessions/.test(stats) && /avg steps/.test(stats) && /kg this week/.test(stats), stats);
    const p = await flat(page.locator("#dashPlan"));
    check("consistency: 14 days as squares, today marked, the week, streak and share", (await page.locator("#dashPlan .cons .cell").count()) === 14 && (await page.locator("#dashPlan .cons .cell.now").count()) === 1 && /\d+ of \d+ this week · .*in a row · \d+% of sessions/.test(p), p.slice(0, 200));
    const s = await flat(page.locator("#dashSteps"));
    check("steps card: weekly bars against the goal", /Steps by week/.test(s) && (await page.locator("#dashSteps svg rect.bar").count()) >= 4 && (await page.locator("#dashSteps .bc-goal").count()) === 1, s.slice(0, 120));
    // Charts further down draw when they're scrolled to, not all at once as the screen opens.
    const below = await page.$eval("#dashSteps .bchart", (e) => ({ under: e.getBoundingClientRect().top > innerHeight, drawn: e.classList.contains("in") }));
    await page.locator("#dashSteps .bchart").scrollIntoViewIfNeeded();
    const drawn = await until(() => page.$eval("#dashSteps .bchart", (e) => e.classList.contains("in")));
    check("steps by week, below the fold, waits to be scrolled to, then draws", below.under && !below.drawn && drawn, JSON.stringify({ ...below, drawn }));
    const pinned = await page.$$eval("#pinned a", (els) => els.map((e) => e.getAttribute("href")));
    check("pinned lifts link to their pages", pinned.length === 3 && pinned.every((h) => h.startsWith("#progress/lift/")), pinned.join(" "));
    await shot(page, "d2-dashboard", { fullPage: true });

    // --- Body: the weight trend and the knee
    await page.click('#progTabs [data-seg="body"]');
    await page.waitForSelector("#dashWeightBody");
    const w = await flat(page.locator("#dashWeightBody"));
    check("weight card: trend, weekly rate and changes", /kg ?trend weight · weighed 6 days ago/.test(w) && /−0\.\d\d kg ?a week \(−0\.\d\d% of body weight\)/.test(w) && /Change over 1 wk/.test(w), w.slice(0, 220));
    check("weight chart: trend line and one dot per weigh-in", (await page.locator("#dashWeightBody svg path.tc-line").count()) === 1 && (await page.locator("#dashWeightBody svg circle.tc-dot").count()) === Object.values(db.logs).filter((e) => e.weight != null).length);
    const vb = await page.$eval("#dashWeightBody svg", (s) => ({ vb: s.viewBox.baseVal.width, w: s.getBoundingClientRect().width }));
    check("weight chart is drawn at its real width", Math.abs(vb.vb - vb.w) < 1, JSON.stringify(vb));
    check("waist change over four weeks", /Waist 93\.5 cm on 23 Sept · −1\.5 cm since 26 Aug/.test(w), w);
    check("goal prompt before a goal is set", /no goal weight yet/.test(w) && (await page.locator('#dashWeightBody [data-goto="pe_goalw"]').count()) === 1);
    const kn = await flat(page.locator("#dashKnee"));
    check("knee card: sessions with before/after/next morning", (await page.locator("#dashKnee tbody tr").count()) >= 3 && (await page.locator("#dashKnee td.hi").count()) >= 3, kn.slice(0, 200));

    // --- Strength
    await page.click('#progTabs [data-seg="strength"]');
    await page.waitForSelector("#dashStrength");
    const st = await flat(page.locator("#dashStrength"));
    check("strength: every lift, not only each day's first, with 1RM trends", (await page.locator("#dashStrength .lifts li").count()) === 25 && /Incline Machine Press Push .*43 kg ?\+17% since 31 Aug/.test(st), st.slice(0, 260));
    const seated = page.locator("#dashStrength .lifts li", { hasText: "Seated Row" });
    check("strength: a lift kept on two days is one row, naming both", (await seated.count()) === 1 && /^Seated Row Pull, Upper/.test(await flat(seated)), await flat(seated));
    check("strength: ready and held lists", /Chest Press Machine Push: 40 → 42\.5 kg/.test(st) && /Leg Press Legs: hold 50 kg \(knee\)/.test(st) && !/Hamstring Curl Legs:/.test(st), st.slice(st.indexOf("Ready"), st.indexOf("Ready") + 200));
    check("strength: records in the last 30 days", /Leg Press 12 × 50 kg heaviest yet, best estimated 1RM/.test(st) && /Hamstring Curl 10 × 32\.5 kg heaviest yet/.test(st));
    await shot(page, "d2c-strength", { fullPage: true });

    // --- a lift's own page, opened from Strength
    await page.locator("#dashStrength .lifts li", { hasText: "Incline Machine Press" }).first().locator(".ln").click();
    await page.waitForSelector("#dashLift");
    check(
      "Strength: a lift's name opens its own page, titled and addressed by name",
      (await page.textContent("#screenTitle")) === "Incline Machine Press" && page.url().endsWith("/#progress/lift/Incline%20Machine%20Press"),
      page.url(),
    );
    const kp = await flat(page.locator("#dashLift"));
    check(
      "lift page: heaviest set, best 1RM, total volume and sessions a week, with the plan's rep range",
      /Part of Push, 8-10 reps\./.test(kp) &&
        /35 kg ?heaviest set, 14 Sept/.test(kp) &&
        /43 kg ?best estimated 1RM, 14 Sept/.test(kp) &&
        /3,180 kg ?total volume lifted/.test(kp) &&
        /1\.2 ?sessions a week on average/.test(kp),
      kp,
    );
    const tops = await page.$$eval("#liftTop .sr-only td", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ")));
    check(
      "lift page: a dot for each session on the 1RM chart, and each session, with its reps, in a table for screen readers",
      (await page.locator("#liftE1rm svg circle.tc-dot").count()) === 4 && tops.length === 4 && tops[3] === "Mon, 21 Sept: 35 kg × 8",
      tops.join(" | "),
    );
    const bubble = async () => ((await page.locator("#liftTop .bc-bubble").textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    await page.locator("#liftTop .tchart").focus();
    await page.keyboard.press("Home");
    check("lift page: arrow keys (Home: the first) read a session out in a bubble, as a Health chart does", /31 Aug: 30 kg × 8$/.test(await bubble()), await bubble());
    await page.keyboard.press("ArrowRight");
    check("…and step to the next session", /7 Sept: 32\.5 kg × 8$/.test(await bubble()), await bubble());
    await page.locator("#liftTop .tchart").blur();
    // A press on the chart reads out the nearest session while it's held.
    const svg = await page.locator("#liftTop svg").boundingBox();
    await page.mouse.move(svg.x + 4, svg.y + svg.height / 2);
    await page.mouse.down();
    const held = await bubble();
    await page.mouse.up();
    check("lift page: pressing an earlier point reads it out, letting go hides it", /31 Aug: 30 kg × 8$/.test(held) && (await page.locator("#liftTop .bc-bubble").count()) === 0, held);
    check("lift page: volume a session, bars for each of the 4 sessions", (await page.locator("#liftVolume svg rect.bar").count()) === 4);
    await shot(page, "d2b-lift", { fullPage: true });
    await page.click("#backBtn");
    await page.waitForSelector("#dashStrength");
    check("lift page: Back returns to Progress, on Strength where it was opened", page.url().endsWith("/#progress") && (await page.locator("#dashStrength").isVisible()));
    // The whole row should be the tap area, not just the name: a tap on its sparkline opens the lift too. Tapped
    // through the row at the sparkline's spot, so the row is scrolled into view first (Back may leave it off screen).
    const [spark, li] = [await seated.locator(".spark").boundingBox(), await seated.boundingBox()];
    await seated.click({ position: { x: spark.x - li.x + spark.width / 2, y: spark.y - li.y + spark.height / 2 } });
    await page.waitForSelector("#dashLift", { timeout: 2000 }).catch(() => {});
    check(
      "strength: a tap anywhere on a row opens its lift, whose page names both its days",
      (await page.locator("#dashLift").count()) === 1 && (await page.textContent("#screenTitle")) === "Seated Row" && (await flat(page.locator("#liftPlan"))) === "Part of Pull and Upper, 10-12 reps.",
      JSON.stringify({ title: await page.textContent("#screenTitle"), url: page.url() }),
    );
    if (await page.locator("#dashLift").count()) await page.click("#backBtn");
    else await seated.locator(".ln").click().then(() => page.click("#backBtn"));
    await page.waitForSelector("#dashStrength");
    const linkH = await seated.locator(".ln").evaluate((a) => a.getBoundingClientRect().height);
    check("strength: each row's lift link is at least 44px tall", linkH >= 44, String(linkH));

    // --- plan settings feed the dashboard
    await page.click('#progTabs [data-seg="body"]');
    await page.locator('#dashWeightBody [data-goto="pe_goalw"]').click();
    await page.waitForSelector("#planView");
    await until(() => page.evaluate(() => document.activeElement?.id === "pe_goalw"));
    check("Set a goal opens the plan at the goal field", (await page.locator("#planView").isVisible()) && (await page.evaluate(() => document.activeElement?.id === "pe_goalw")));
    await page.locator("#planDays .dchip").nth(2).click(); // Wed
    check("plan editor: knee-sensitive ticked from the KNEE NOTE", (await page.locator("#pe_x0_knee").isChecked()) && !(await page.locator("#pe_x3_knee").isChecked()));
    await page.locator("#pe_x3_step").fill("5");
    await page.locator("#pe_goalw").fill("78");
    await page.locator("#pe_rate").fill("0.7");
    await until(() => db.plan?.goalWeight === 78 && db.plan?.weeklyRatePct === 0.7 && db.plan?.days?.[2]?.exercises?.[3]?.step === "5");
    check("settings saved to the plan", db.plan?.goalWeight === 78 && db.plan?.weeklyRatePct === 0.7 && db.plan.days[2].exercises[0].knee === true && db.plan.days[2].exercises[3].step === "5");
    await page.click("#planDone");
    await page.waitForSelector("#dashView");
    check("Done goes back to Progress, where the goal was set", await page.locator("#dashWeightBody").isVisible());
    check("goal date appears", /goal 78 kg at this pace/.test(await flat(page.locator("#dashWeightBody"))), await flat(page.locator("#dashWeightBody .kpis")));
    ham = await atLift(page, "Hamstring Curl");
    check("step change shows in the hint", /Go up to 35 kg/.test(await flat(ham.locator(".prog"))), await flat(ham.locator(".prog")));
    check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
    check("no console errors (light)", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // --- Progress in dark mode
  {
    const { ctx, page } = await open(browser, base, { auth, db, scheme: "dark" });
    await ready(page);
    await openTab(page, "progress");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check("dark mode colours", bg === "rgb(14, 15, 17)", bg);
    await shot(page, "d3-dashboard-dark", { fullPage: true });
    check("no console errors (dark)", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }
}

// Progress pace flags (Overview): the weekly loss against the target set in the plan editor.
async function pace({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000003", "2026-08-26T05:00:00Z", "t@example.com");
  const flags = async (logs, plan) => {
    const { ctx, page } = await open(browser, base, { auth, db: { logs, plan }, mobile: false });
    await ready(page);
    await openTab(page, "progress");
    const text = (await page.locator("#dashFlags").textContent()).replace(/\s+/g, " ").trim(), errors = page.errors;
    await ctx.close();
    return { text, errors };
  };
  // Each way the pace can read is in tests/unit/progress.test.ts; here, that Overview shows it.
  const r = await flags(series(-0.1), { weeklyRatePct: 0.4 });
  check("a pace off the plan's weekly target is flagged on Overview", /Losing 0\.\d\d% a week, faster than your 0\.4% target\./.test(r.text) && !r.errors.length, r.text || "(no flags)");
}

// Weekly sets per muscle on Progress → Muscles (RAJ-56): four weeks of working sets per muscle from the library's
// muscles, warm-ups and drop sets left out, a note on last week, untagged lifts listed apart, and a set logged in the
// workout adding to this week's total.
async function muscles({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000056", "2026-08-26T05:00:00Z", "t@example.com");
  const sets = (n, more = []) => [...Array.from({ length: n }, () => ({ reps: 10, kg: 40 })), ...more];
  const lift = (n, more = [], x = {}) => ({ done: true, kg: 40, sets: sets(n, more), ...x });
  const day = (exercises) => ({ exercises, warmup: [], cardio: false, steps: 6000, weight: null, note: "" });
  const db = {
    logs: {
      // Two weeks ago, Leg Extension swapped for Hack Squat: quads, with calves, glutes and hamstrings.
      [K(14)]: day({ "Leg Extension": lift(2, [], { swap: "Hack Squat" }) }),
      // Last week: a warm-up and a drop set that don't count, and a lift the library doesn't know.
      [K(21)]: day({
        "Leg Extension": lift(3, [{ reps: 8, kg: 20, type: "warmup" }, { reps: 12, kg: 30, type: "drop" }]),
        "Leg Press": lift(3),
        "Hamstring Curl": lift(4),
        "Mystery Press": lift(2),
      }),
      [K(28)]: day({ "Leg Extension": { done: false, kg: 40, sets: sets(2) } }),
    },
    plan: null,
  };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);
  const row = (m) => page.locator(`#dashMuscles tr[data-muscle="${m}"]`);
  const cells = async (m) => (await row(m).locator("td").allInnerTexts()).map((t) => t.trim());

  await openTab(page, "progress");
  await page.click('#progTabs [data-seg="muscles"]');
  await page.waitForSelector("#dashMuscles");
  const heads = (await page.locator("#dashMuscles thead th").allInnerTexts()).map((t) => t.trim());
  check("four weeks, this one last", heads.length === 5 && heads[0] === "Muscle" && heads[4] === "This week", heads.join(" | "));
  check("quads: a swap counts as the lift done, and last week leaves out the warm-up and the drop set", JSON.stringify(await cells("quadriceps")) === '["-","2","6","2"]', JSON.stringify(await cells("quadriceps")));
  check("hamstrings: a set each from a main lift, a half from others", JSON.stringify(await cells("hamstrings")) === '["-","1","5.5","-"]', JSON.stringify(await cells("hamstrings")));
  check("most sets first", (await page.locator("#dashMuscles tbody tr").first().getAttribute("data-muscle")) === "quadriceps");
  check("under 10 last week is noted", (await flat(row("quadriceps").locator(".musc-n"))) === "Under 10 last week");
  check("but not for a muscle only worked on the side", (await row("glutes").locator(".musc-n").count()) === 0);
  const untagged = await flat(page.locator("#muscUntagged"));
  check("a lift with no muscles is listed apart, not guessed", untagged.startsWith("Untagged, so not counted: Mystery Press (2 sets)."), untagged);
  await page.locator("#dashMuscles").scrollIntoViewIfNeeded();
  await shot(page, "muscles");
  // It fits a small phone, with no sideways scroll.
  await page.setViewportSize({ width: 320, height: 700 });
  const fit = await page.evaluate(() => {
    const card = document.querySelector("#dashMuscles");
    return { page: document.documentElement.scrollWidth, card: card.scrollWidth, room: card.clientWidth };
  });
  check("the table fits a 320px screen", fit.page <= 320 && fit.card <= fit.room, JSON.stringify(fit));
  await shot(page, "muscles-320");
  await page.setViewportSize({ width: 390, height: 844 });

  // A set logged in the workout adds to this week's total (Progress remembers its Muscles section).
  await openWorkout(page, "Leg Extension");
  await page.locator('#workoutView input[data-set$=":2:reps"]').fill("10");
  await until(() => db.logs[K(28)]?.exercises?.["Leg Extension"]?.sets?.[2]?.reps === 10);
  await page.click("#closeWorkout");
  await page.waitForSelector("#trainView");
  await openTab(page, "progress");
  await page.waitForSelector("#dashMuscles");
  check("a set logged today counts this week", (await cells("quadriceps"))[3] === "3", JSON.stringify(await cells("quadriceps")));

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
