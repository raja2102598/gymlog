// Health Connect data as the website shows it, once the Android app has synced it to health_days:
// steps and weight fill in Train until you type your own, the day's sleep and workouts on Home's timeline, the Health
// tab (rings, tiles, water) and its metric pages (Day / Week / Month / Year), and the flags in Progress.
import { K, flat, open, openSetting, openTab, ready, savedPlan, session, until } from "./harness.mjs";

export const covers = [
  "src/components/health/HealthView.tsx",
  "src/components/health/HealthDetail.tsx",
  "src/components/health/Rings.tsx",
  "src/components/health/Bars.tsx",
  "src/components/health/Trend.tsx",
  "src/lib/scale.ts",
];

function data() {
  const logs = {}, health = {};
  for (let n = 0; n <= 28; n++) logs[K(n)] = { exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "" };
  logs[K(27)].steps = 9500; // Tuesday: typed by hand, and Health Connect has a different count
  for (let n = 14; n <= 28; n++) {
    health[K(n)] = { steps: 6000 + n * 100, weight: Math.round((84 - n * 0.1) * 10) / 10, restingHr: n >= 21 ? 68 : 60, sleepMin: n >= 22 ? 330 : 420, activeKcal: 300 + n };
  }
  health[K(28)] = {
    steps: 8421,
    weight: 81.2,
    restingHr: 61,
    hrAvg: 78,
    sleepMin: 432,
    sleepStages: { deep: 80, rem: 95, light: 257, awake: 12 },
    activeKcal: 412,
    workouts: [{ type: "strengthTraining", start: "2026-09-23T07:10:00", end: "2026-09-23T08:02:00", min: 52, kcal: 310, source: "Samsung Health" }],
  };
  return { logs, health };
}

export default async function healthSuite({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000051", "2026-08-26T05:00:00Z", "t@example.com");
  const { logs, health } = data();
  const db = { logs, plan: null, health };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);

  // Home: last night's sleep and the morning's workout on the day's timeline
  const tl = await flat(page.locator("#timeline"));
  check("Home's timeline: last night's sleep and the workout Health Connect recorded", /7 h 12 min sleep/.test(tl) && /7:10\s?am ?Strength training · 52 min/i.test(tl), tl);

  // Train: Health Connect's numbers in grey until you type your own, and one line under the boxes says so
  await openTab(page, "train");
  const steps = await page.$eval("#steps", (e) => ({ ph: e.placeholder, v: e.value, note: e.getAttribute("aria-describedby") }));
  check("steps: Health Connect's count in grey, described by the note", steps.ph === "8421" && steps.v === "" && steps.note === "hcNote", JSON.stringify(steps));
  const bar = await page.$eval('label[for="steps"] .meter i', (e) => e.style.width);
  check("steps meter counts Health Connect's steps", bar === "84.21%", bar);
  const weight = await page.$eval("#weight", (e) => ({ ph: e.placeholder, note: e.getAttribute("aria-describedby") }));
  check("weight: Health Connect's weigh-in in grey, described by the note", weight.ph === "81.2" && weight.note === "hcNote", JSON.stringify(weight));
  const hcNote = await flat(page.locator("#hcNote"));
  check("the note says which numbers came from Health Connect", hcNote === "From Health Connect: 8,421 steps, 81.2 kg. Type your own to replace them.", hcNote);
  const boxes = await page.$$eval("#steps, #weight", (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  check("the steps and weight boxes line up", boxes[0] === boxes[1], boxes.join(" vs "));
  await page.fill("#steps", "9000");
  await until(() => db.logs["2026-09-23"].steps === 9000);
  const after = await flat(page.locator("#hcNote"));
  check(
    "typing your own steps replaces Health Connect's, and the note drops them",
    db.logs["2026-09-23"].steps === 9000 && after === "From Health Connect: 81.2 kg. Type your own to replace it." && !(await page.$eval("#steps", (e) => e.hasAttribute("aria-describedby"))),
    after,
  );
  check("the website never writes health data", !db.writes.health);

  // A day with no Health Connect data looks as before
  await page.locator("#dayChips .dchip").nth(3).click();
  check("a day with no data: no note, the usual placeholders", (await page.locator("#hcNote").count()) === 0 && (await page.$eval("#steps", (e) => e.placeholder)) === "0");
  await page.locator("#dayChips .dchip").nth(2).click();

  // History (in Progress) and the steps average use Health Connect where you typed nothing
  await openTab(page, "progress");
  const hist = await flat(page.locator("#hist"));
  // Mon 21 has nothing typed: Health Connect's 8,600 steps and 81.4 kg. Tue 22 has 9,500 typed over its 8,700.
  check("history: Health Connect's steps and weight on days with nothing typed", /Mon 21 ?Push ?0\/6 ?– ?8,600 ?81\.4/.test(hist), hist.slice(0, 200));
  check("history: a count you typed wins", /Tue 22 ?Pull ?0\/6 ?– ?9,500 ?81\.3/.test(hist), hist.slice(0, 300));
  const stats = await flat(page.locator("#dashStats"));
  // The last 7 days: Health Connect's 8,200 to 8,600 (Thu 17 to Mon 21), Tue 9,500 (typed), Wed 9,000 (typed just now).
  check("the week's average steps include Health Connect's", /8,643 ?avg steps/.test(stats), stats);

  // Settings on the website: where the data comes from
  await openTab(page, "settings");
  await openSetting(page, "setHealth");
  const hcStatus = await flat(page.locator("#hcStatus"));
  check("Settings: says the data comes from the Android app, and when it synced", /^Health Connect data comes from the Gym Log Android app, last synced at \d{1,2}:\d\d (am|pm)\.$/i.test(hcStatus), hcStatus);
  check("Settings: no Connect or background sync on the website", (await page.locator("#hcConnect, #hcSync, #bgSync").count()) === 0);
  await page.click("#backBtn");
  await page.waitForSelector("#dashView");

  // The Health tab: the day's rings and a tile for each kind of data
  await openTab(page, "health");
  const rings = (await page.getAttribute("#activity svg.rings", "aria-label")).replace(/\s+/g, " ");
  check("rings: steps (the 9,000 you typed), active time and active calories against their goals", rings === "Steps 9,000 of 10,000, 90%; Active time 52 of 30 min, 173%; Active calories 412 of 500 kcal, 82%", JSON.stringify(rings));
  check("the Active time ring's legend opens the exercise page", (await page.getAttribute("#ringExercise", "href")) === "#health/exercise" && /52/.test(await flat(page.locator("#ringExercise"))));
  // Text as laid out, so the lines of a tile read as separate words.
  const text = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
  const tile = text;
  // SVG text (a chart's goal pill, its bubble) has no layout text: its content.
  const svgText = async (sel) => ((await page.locator(sel).first().textContent()) || "").replace(/\s+/g, " ").trim();
  check("sleep tile: hours asleep the night before", /^Sleep 7 h 12 min the night before$/.test(await tile("#tileSleep")), await tile("#tileSleep"));
  check("heart tile: the resting rate", /^Heart 61 bpm resting$/.test(await tile("#tileHeart")), await tile("#tileHeart"));
  check("calories tile: what was burned moving", /^Calories 412 kcal burned moving$/.test(await tile("#tileEnergy")), await tile("#tileEnergy"));
  check("body tile: Health Connect's weigh-in, and the week's change", /^Body 81\.2 kg body weight ↓ 0\.6 kg this week$/.test(await tile("#tileBody")), await tile("#tileBody"));
  check("where it comes from, and when", /^Health Connect · synced at \d{1,2}:\d\d (am|pm)$/i.test(await flat(page.locator("#healthNote"))), await flat(page.locator("#healthNote")));
  // Water: Health Connect has none today, and it's loggable here, saved on the day.
  check("water: none yet, against the goal, and nothing to remove", /^Water 0 ml of 2,500 ml/.test(await tile("#tileWaterBox")) && (await page.locator("#waterMinus").isDisabled()), await tile("#tileWaterBox"));
  await page.click("#waterPlus");
  await until(() => db.logs["2026-09-23"].water === 250);
  check("+ adds 250 ml to the day", db.logs["2026-09-23"].water === 250 && /^250/.test(await flat(page.locator("#waterValue"))), await flat(page.locator("#waterValue")));
  await page.click("#waterMinus");
  await until(() => !db.logs["2026-09-23"].water);
  check("− takes it off again", !db.logs["2026-09-23"].water && /^0/.test(await flat(page.locator("#waterValue"))), JSON.stringify(db.logs["2026-09-23"].water));
  await page.click("#hPrev");
  check("the day switch moves to yesterday, with its date", (await flat(page.locator("#activity .dayswitch .label"))) === "Yesterday 22 Sept" && (await page.getAttribute("#activity svg.rings", "aria-label")).startsWith("Steps 9,500 of 10,000"));
  await page.click("#hNext");
  check("and back to today, no further", (await flat(page.locator("#activity .dayswitch .label"))) === "Today 23 Sept" && (await page.locator("#hNext").isDisabled()));
  // The avatar opens Settings over Health, and its back chevron returns to Health, not Home.
  await page.click("#settingsBtn");
  await page.waitForSelector("#signOutBtn");
  check("its back chevron says where it goes", (await page.getAttribute("#backBtn", "aria-label")) === "Back to Health");
  await page.click("#backBtn");
  await page.waitForSelector("#activity");
  check("Settings opened from Health goes back to Health", new URL(page.url()).hash === "#health" && (await page.locator("#homeView").count()) === 0, page.url());

  // Sleep's page: the week as bars against the goal, then one night
  await page.click("#tileSleep");
  await page.waitForSelector("#hChart");
  check("Sleep opens as a page with its own address, the week picked", page.url().endsWith("/#health/sleep") && (await page.textContent("#screenTitle")) === "Sleep" && (await page.getAttribute('#hRange [data-seg="week"]', "aria-selected")) === "true");
  check("a bar for each night of the week", (await page.locator("#hChart .bchart rect.bar").count()) === 7);
  check("the average and the nights at the goal", (await text("#hChart .cc-v")) === "5 h 45 min" && (await text("#hGoalDays .v")) === "1 of 7", `${await text("#hChart .cc-v")} | ${await text("#hGoalDays")}`);
  const summary = await page.getAttribute("#hChart .bchart", "aria-label");
  check("the chart has a goal line marked 7 h, and says in a sentence which night reached it", (await svgText("#hChart .bc-gtext")) === "7 h" && /^Sleep a night, 17 Sept to 23 Sept\. Goal reached on Wednesday\./.test(summary), summary);
  const tips = await page.$$eval("#hChart .bchart .sr-only td", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ")));
  check("each night is in a table for screen readers", tips.length === 7 && tips[6] === "Wed, 23 Sept · 7 h 12 min", tips.join(" | "));
  await page.locator("#hChart .bchart").focus();
  await page.keyboard.press("ArrowLeft");
  check("arrow keys move along the nights, read out in a bubble", (await svgText("#hChart .bc-bubble")) === "Tue, 22 Sept · 5 h 30 min", await svgText("#hChart .bc-bubble").catch(() => "no bubble"));
  await page.click('#hRange [data-seg="day"]');
  await page.waitForSelector("#hHero");
  check(
    "one night: hours, the stages with their minutes, and the goal",
    (await text("#hHero .cc-v")) === "7 h 12 min asleep" && (await text("#hHero .lanes-full")) === "Awake 12 min REM 95 min Light 257 min Deep 80 min" && (await text("#hGoal")) === "12 min over your 7 h goal.",
    `${await text("#hHero")} | ${await text("#hGoal")}`,
  );
  check("the day's page says which day it is", /^Today, 23 Sept · (\d{1,2}:\d\d (am|pm) – \d{1,2}:\d\d (am|pm)|the night before)$/i.test(await text("#hDate")), await text("#hDate"));
  // A day with nothing: its date and ‹ › stay, so another day is a tap away.
  for (let i = 0; i < 40 && !(await page.locator("#hEmpty").count()); i++) await page.click("#hPrev");
  const emptyDate = await text("#hDate");
  check("a night with no sleep still shows its date and the way to other days", (await page.locator("#hEmpty").count()) === 1 && /^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]+$/.test(emptyDate) && (await page.locator("#hPrev").isEnabled()) && (await page.locator("#hNext").isEnabled()), emptyDate);
  await page.click("#hNext");
  check("and › moves on from it", (await text("#hDate")) !== emptyDate, await text("#hDate"));
  while (await page.locator("#hNext").isEnabled()) await page.click("#hNext"); // back to today
  await page.click("#backBtn");
  await page.waitForSelector("#activity");
  check("the back arrow returns to Health", page.url().endsWith("/#health"), page.url());

  // Heart's page: each day's range with the resting rate as a dot
  await page.click("#tileHeart");
  await page.waitForSelector("#hChart");
  check(
    "heart: a resting dot for each day, and the week's average and lowest",
    (await page.locator("#hChart circle.rg-dot").count()) === 7 && (await text("#hChart .cc-v")) === "67 bpm" && /^61 bpm lowest resting/.test(await text(".detail .stats3 .stat")),
    `${await text("#hChart .cc-v")} | ${await text(".detail .stats3")}`,
  );
  await page.click("#backBtn");
  await page.waitForSelector("#activity");

  // Exercise's page, from the Active time ring: the workout, with its time, length, calories and app
  await page.click("#ringExercise");
  await page.waitForSelector("#hChart");
  const sessions = await flat(page.locator("#hSessions"));
  check("exercise: the workout, with its day, time, length, calories and app", page.url().endsWith("/#health/exercise") && /Strength training ?Wed, 23 Sept · 7:10\s?am · 52 min · 310 kcal · Samsung Health/i.test(sessions), sessions);
  await page.click("#backBtn");
  await page.waitForSelector("#activity");

  // Progress: sleep and resting heart rate still raise flags there
  await openTab(page, "progress");
  check("Progress has no health card now: its charts are in Health", (await page.locator("#dashHealth").count()) === 0);
  const flags = await flat(page.locator("#dashFlags"));
  check("Progress: short sleep and a higher resting heart rate are pointed out", /Sleeping 5 h 45 min a night on average this week/.test(flags) && /Resting heart rate is 6 bpm higher than last week/.test(flags), flags);
  const s = await flat(page.locator("#dashSteps"));
  check("steps by week use Health Connect's steps", (await page.locator("#dashSteps rect.bar").count()) >= 2 && !/Log your daily steps/.test(s), s.slice(0, 120));
  const w14 = await flat(page.locator("#dashWeight"));
  check("the 14-day weight trend uses Health Connect's weigh-ins", /Body weight ?81\.2 ?kg/.test(w14) && (await page.locator("#dashWeight svg circle.tc-dot").count()) === 14, w14.slice(0, 120));
  await page.click('#progTabs [data-seg="body"]');
  await page.waitForSelector("#dashWeightBody");
  const w = await flat(page.locator("#dashWeightBody"));
  check("Body: the weight trend uses Health Connect's weigh-ins", /kg ?trend weight/.test(w) && (await page.locator("#dashWeightBody svg circle.tc-dot").count()) === 15, w.slice(0, 120));
  check("only the expected endpoints", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();

  // No Health Connect data at all: Health and Settings say where it would come from
  {
    // Nothing logged, but a saved plan: an existing account, so Home rather than the plan picker.
    const { ctx, page } = await open(browser, base, { auth, db: { logs: {}, plan: savedPlan() } });
    await ready(page);
    await openTab(page, "health");
    check("Health with no data: points to the Android app", /It comes through the Gym Log Android app/.test(await flat(page.locator("#healthEmpty"))) && (await flat(page.locator("#healthNote"))) === "Logged in Gym Log");
    await openTab(page, "settings");
    await openSetting(page, "setHealth");
    check("Settings with no data: says where it would come from", (await flat(page.locator("#hcStatus"))) === "Health Connect data comes from the Gym Log Android app. Connect it there, and it shows here too.");
    await ctx.close();
  }

  {
    // A watch that gives each day's heart rate range and average, but no resting rate.
    const health = {};
    for (const [n, lo, hi, avg] of [[24, 58, 131, 80], [25, 62, 118, 76], [26, 55, 140, 84], [27, 60, 150, 90]]) health[K(n)] = { hrMin: lo, hrMax: hi, hrAvg: avg, steps: 5000 };
    const { ctx, page } = await open(browser, base, { auth, db: { logs: {}, plan: savedPlan(), health } });
    await ready(page);
    await page.goto(base + "#health/heart");
    await page.waitForSelector("#hChart .rg-cap", { state: "attached" });
    const t = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
    check("heart week with no resting rate: the average instead of a dash", /^Average · /.test(await t("#hChart .label, #hChart .cc-t .label")) && (await t("#hChart .cc-v")) === "83 bpm", `${await t("#hChart .cc-t")}`);
    check("its lowest, and every day with a reading counted", /^55 bpm lowest$/.test(await t("#hLowest")) && /^4 of 7 days measured$/.test(await t("#hMeasured")), `${await t("#hLowest")} | ${await t("#hMeasured")}`);
    const fit = await page.evaluate(() => {
      const base = Number(document.querySelector("#hChart .bc-base").getAttribute("y1"));
      return [...document.querySelectorAll("#hChart .rg-cap")].every((l) => Number(l.getAttribute("y2")) + Number(l.getAttribute("stroke-width")) / 2 <= base + 0.5);
    });
    check("every range, round ends included, sits above the baseline", fit);
    check("and the chart's text says what it shows", /from 55 to 150 bpm across 4 days/.test(await page.getAttribute("#hChart .bchart", "aria-label")), await page.getAttribute("#hChart .bchart", "aria-label"));
    await ctx.close();
  }
}
