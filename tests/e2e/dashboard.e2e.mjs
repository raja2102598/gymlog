// Knee scores, next-weight hints, records, cardio and waist, home-screen shortcuts, and the dashboard,
// on four weeks of history.
import { flat, K, liftEl, open, openTab, planDone, ready, session, shot, until } from "./harness.mjs";

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

export default async function dashboard({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000002", "2026-08-26T05:00:00Z", "t@example.com");
  const db = { logs: history(), plan: null };

  {
    const { ctx, page } = await open(browser, base, { auth, db });
    await ready(page);
    // --- next-weight hints, knee hold, placeholders
    const ham = liftEl(page, "Hamstring Curl"), lp = liftEl(page, "Leg Press"), hs = liftEl(page, "Hack Squat");
    check("ready lift says go up", /Go up to 32\.5 kg: every set hit 12 reps last time/.test(await flat(ham.locator(".prog"))), await flat(ham.locator(".prog")));
    check("placeholders show new weight at the bottom of the range", (await ham.locator('input[data-set$=":0:kg"]').getAttribute("placeholder")) === "32.5" && (await ham.locator('input[data-set$=":0:reps"]').getAttribute("placeholder")) === "10");
    check("knee-sensitive lift is held after a sore day", /Hold 50 kg: your knee was sore after 16\/09/.test(await flat(lp.locator(".prog"))) && /Hold 20 kg/.test(await flat(hs.locator(".prog"))), await flat(lp.locator(".prog")));
    // --- live record badge
    await ham.locator('input[data-set$=":0:reps"]').fill("10");
    await ham.locator('input[data-set$=":0:kg"]').fill("32.5");
    const set0 = ham.locator(".set").first();
    check("heavier set gets a PR badge while typing", (await set0.getAttribute("class")).includes("pr") && /heaviest yet/.test(await set0.locator(".prb").getAttribute("title")));
    check("second set without a record has no badge", !(await ham.locator(".set").nth(1).getAttribute("class")).includes("pr"));
    // --- knee before and after
    check("knee rows shown on a knee day", (await page.locator(".knee").count()) === 2);
    const kb = await page.locator('button[data-knee="kneeBefore:0"]').boundingBox();
    check("knee buttons are big enough to tap", kb.width >= 40 && kb.height >= 44, `${Math.round(kb.width)}x${Math.round(kb.height)}`);
    await page.locator('button[data-knee="kneeBefore:3"]').click();
    await until(() => db.logs["2026-09-23"].kneeBefore === 3);
    const before = page.locator(".knee").first();
    check("knee before saved and folded to one line", db.logs["2026-09-23"].kneeBefore === 3 && /3\/10/.test(await flat(before)) && (await before.locator("button[data-knee]").count()) === 0);
    await before.locator("button[data-kneeedit]").click();
    check("Change reopens the scale with the score pressed", (await page.locator('button[data-knee="kneeBefore:3"]').getAttribute("aria-pressed")) === "true");
    check("Change moves focus to the scale", await page.evaluate(() => document.activeElement?.dataset.knee?.startsWith("kneeBefore:")));
    await page.locator('button[data-knee="kneeBefore:3"]').click();
    await until(() => db.logs["2026-09-23"].kneeBefore === undefined);
    check("tapping the score again clears it", db.logs["2026-09-23"].kneeBefore === undefined && (await page.locator('button[data-knee="kneeBefore:0"]').count()) === 1);
    await page.locator('button[data-knee="kneeAfter:7"]').click();
    check("score above limit warns", /Above your limit/.test(await flat(page.locator(".knee").last())));
    // --- cardio minutes and waist
    await page.locator("#cMin").fill("20");
    check("cardio minutes tick the finisher", await page.locator("#cardio").isChecked());
    await page.locator("#cKmh").fill("5.5");
    await page.locator("#cInc").fill("8");
    await page.locator("#waist").fill("93.5");
    await until(() => db.logs["2026-09-23"].waist === 93.5 && db.logs["2026-09-23"].cardioIncline === 8);
    const t = db.logs["2026-09-23"];
    check("cardio details and waist saved", t.cardio === true && t.cardioMin === 20 && t.cardioKmh === 5.5 && t.cardioIncline === 8 && t.waist === 93.5, JSON.stringify(t));
    check("Today shows a one-line trend", /trend, .* a week · weighed 6 days ago/.test(await flat(page.locator("#chart"))), await flat(page.locator("#chart")));
    // --- the next morning asks about the knee
    await page.locator("#week .dchip").nth(3).click();
    check("next morning asks about the knee", /Knee on waking after Legs yesterday/.test(await flat(page.locator(".knee").first())));
    await page.locator('button[data-knee="kneeWake:2"]').click();
    await until(() => db.logs["2026-09-24"]?.kneeWake === 2);
    check("morning score saved on the next day", db.logs["2026-09-24"]?.kneeWake === 2 && /Not settled since yesterday/.test(await flat(page.locator(".knee").first())));
    await page.locator("#todayB").click();

    // --- the dashboard, in the Progress tab
    await openTab(page, "progress");
    check(
      "Progress opens, its tab marked as the current one",
      (await page.locator("#dashView").isVisible()) && !(await page.locator("#appView").isVisible()) && (await page.getAttribute("#tabProgress", "aria-current")) === "page" && (await page.textContent("#screenTitle")) === "Progress",
    );
    const flags = await flat(page.locator("#dashFlags"));
    check("flags: sore knee today", /Knee was above your limit after Legs on 23 Sept/.test(flags), flags);
    check("flags: weigh-in gap", /No weigh-in for 6 days/.test(flags), flags);
    check("flags: lifts ready", /ready for more weight/.test(flags), flags);
    const w = await flat(page.locator("#dashWeight"));
    check("weight card: trend, weekly rate and changes", /kg ?trend weight/.test(w) && /−0\.\d\d kg ?a week \(−0\.\d\d% of body weight\)/.test(w) && /Change over 1 wk/.test(w), w.slice(0, 220));
    check("weight chart: trend line and one dot per weigh-in", (await page.locator("#dashWeight svg path.trendline").count()) === 1 && (await page.locator("#dashWeight svg circle.dot").count()) === Object.values(db.logs).filter((e) => e.weight != null).length);
    const vb = await page.$eval("#dashWeight svg", (s) => ({ vb: s.viewBox.baseVal.width, w: s.getBoundingClientRect().width }));
    check("weight chart is drawn at its real width", Math.abs(vb.vb - vb.w) < 1, JSON.stringify(vb));
    check("waist change over four weeks", /Waist 93\.5 cm on 23 Sept · −1\.5 cm since 26 Aug/.test(w), w);
    check("goal prompt before a goal is set", /no goal weight yet/.test(w) && (await page.locator('#dashWeight [data-goto="pe_goalw"]').count()) === 1);
    const p = await flat(page.locator("#dashPlan"));
    check("plan card: this week, streak, heatmap", /sessions this week/.test(p) && /20 min/.test(p) && (await page.locator("#dashPlan .heat i").count()) === 5 * 7, p.slice(0, 200));
    const s = await flat(page.locator("#dashSteps"));
    check("steps card: 7-day average and weekly bars", /7-day average/.test(s) && (await page.locator("#dashSteps svg rect.wbar").count()) >= 4, s.slice(0, 120));
    const st = await flat(page.locator("#dashStrength"));
    check("strength: every lift, not only each day's first, with 1RM trends", (await page.locator("#dashStrength .lifts li").count()) === 25 && /Incline Machine Press Push .*43 kg ?\+17% since 31 Aug/.test(st), st.slice(0, 260));
    const seated = page.locator("#dashStrength .lifts li", { hasText: "Seated Row" });
    check("strength: a lift kept on two days is one row, naming both", (await seated.count()) === 1 && /^Seated Row Pull, Upper/.test(await flat(seated)), await flat(seated));
    check("strength: ready and held lists", /Chest Press Machine Push: 40 → 42\.5 kg/.test(st) && /Leg Press Legs: hold 50 kg \(knee\)/.test(st) && !/Hamstring Curl Legs:/.test(st), st.slice(st.indexOf("Ready"), st.indexOf("Ready") + 200));
    check("strength: records in the last 30 days", /Leg Press 12 × 50 kg heaviest yet, best estimated 1RM/.test(st) && /Hamstring Curl 10 × 32\.5 kg heaviest yet/.test(st));
    const kn = await flat(page.locator("#dashKnee"));
    check("knee card: sessions with before/after/next morning", (await page.locator("#dashKnee tbody tr").count()) >= 3 && (await page.locator("#dashKnee td.hi").count()) >= 3, kn.slice(0, 200));
    await shot(page, "d2-dashboard", { fullPage: true });

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
    check(
      "lift page: a dot for each session on the 1RM chart, the last one read out with its reps",
      (await page.locator("#liftE1rm svg circle.dot").count()) === 4 && (await flat(page.locator("#liftTop .readout"))) === "Mon, 21 Sept: 35 kg × 8",
      await flat(page.locator("#liftTop .readout")),
    );
    await page.locator("#liftTop rect.hit").first().click();
    check("lift page: tapping an earlier point updates the readout, as a Health chart would", /31 Aug: 30 kg × 8$/.test(await flat(page.locator("#liftTop .readout"))), await flat(page.locator("#liftTop .readout")));
    check("lift page: volume a session, bars for each of the 4 sessions", (await page.locator("#liftVolume svg path.col").count()) === 4);
    await shot(page, "d2b-lift", { fullPage: true });
    await page.click("#backBtn");
    check("lift page: Back returns to Progress, where it was opened from", page.url().endsWith("/#progress") && (await page.locator("#dashStrength").isVisible()));
    // The whole row is the tap area, not just the name: a tap on its sparkline opens the lift too.
    const spark = await seated.locator(".spark").boundingBox();
    await page.mouse.click(spark.x + spark.width / 2, spark.y + spark.height / 2);
    await page.waitForSelector("#dashLift");
    check(
      "strength: a tap anywhere on a row opens its lift, whose page names both its days",
      (await page.textContent("#screenTitle")) === "Seated Row" && (await flat(page.locator("#liftPlan"))) === "Part of Pull and Upper, 10-12 reps.",
      JSON.stringify({ title: await page.textContent("#screenTitle"), plan: await flat(page.locator("#liftPlan")) }),
    );
    await page.click("#backBtn");
    const rowH = await seated.evaluate((li) => li.getBoundingClientRect().height);
    check("strength: each row, the lift link's tap area, is at least 44px tall", rowH >= 44, String(rowH));

    // --- plan settings feed the dashboard
    await page.locator('#dashWeight [data-goto="pe_goalw"]').click();
    check("Set a goal opens the plan at the goal field", (await page.locator("#planView").isVisible()) && (await page.evaluate(() => document.activeElement?.id === "pe_goalw")));
    await page.locator("#planDays .dchip").nth(2).click(); // Wed
    check("plan editor: knee-sensitive ticked from the KNEE NOTE", (await page.locator("#pe_x0_knee").isChecked()) && !(await page.locator("#pe_x3_knee").isChecked()));
    await page.locator("#pe_x3_step").fill("5");
    await page.locator("#pe_goalw").fill("78");
    await page.locator("#pe_rate").fill("0.7");
    await until(() => db.plan?.goalWeight === 78 && db.plan?.weeklyRatePct === 0.7 && db.plan?.days?.[2]?.exercises?.[3]?.step === "5");
    check("settings saved to the plan", db.plan?.goalWeight === 78 && db.plan?.weeklyRatePct === 0.7 && db.plan.days[2].exercises[0].knee === true && db.plan.days[2].exercises[3].step === "5");
    await planDone(page);
    check("Done goes back to Progress, where the goal was set", await page.locator("#dashView").isVisible());
    check("goal date appears", /goal 78 kg at this pace/.test(await flat(page.locator("#dashWeight"))), await flat(page.locator("#dashWeight .kpis")));
    await openTab(page, "today");
    check("step change shows in the hint", /Go up to 35 kg/.test(await flat(liftEl(page, "Hamstring Curl").locator(".prog"))));
    check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
    check("no console errors (light)", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // --- a shortcut opens straight into the weight field; the dashboard in dark mode
  {
    const { ctx, page } = await open(browser, base, { auth, db, scheme: "dark", url: base + "?go=weight" });
    await ready(page);
    await until(async () => page.evaluate(() => document.activeElement?.id === "weight"));
    check("Log weight shortcut focuses weight", await page.evaluate(() => document.activeElement?.id === "weight"));
    check("shortcut parameter removed from the address", !page.url().includes("go="), page.url());
    await openTab(page, "progress");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check("dark mode colours", bg === "rgb(18, 20, 23)", bg);
    await shot(page, "d3-dashboard-dark", { fullPage: true });
    check("no console errors (dark)", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }
}
