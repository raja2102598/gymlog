// Health Connect data as the website shows it, once the Android app has synced it to health_days:
// steps and weight fill in until you type your own, the day's sleep, heart and workouts, the Health tab and its
// pages, and the flags in Progress.
import { K, flat, open, openTab, ready, savedPlan, session, until } from "./harness.mjs";

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

  // Today: Health Connect's numbers in grey until you type your own, and one line under the boxes says so
  const steps = await page.$eval("#steps", (e) => ({ ph: e.placeholder, v: e.value, note: e.getAttribute("aria-describedby") }));
  check("steps: Health Connect's count in grey, described by the note", steps.ph === "8421" && steps.v === "" && steps.note === "hcNote", JSON.stringify(steps));
  const bar = await page.$eval(".inputs .bar i", (e) => e.style.width);
  check("steps bar counts Health Connect's steps", bar === "84.21%", bar);
  const weight = await page.$eval("#weight", (e) => ({ ph: e.placeholder, note: e.getAttribute("aria-describedby") }));
  check("weight: Health Connect's weigh-in in grey, described by the note", weight.ph === "81.2" && weight.note === "hcNote", JSON.stringify(weight));
  const hcNote = await flat(page.locator("#hcNote"));
  check("the note says which numbers came from Health Connect", hcNote === "From Health Connect: 8,421 steps, 81.2 kg. Type your own to replace them.", hcNote);
  const boxes = await page.$$eval("#steps, #weight", (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  check("the steps and weight boxes line up", boxes[0] === boxes[1], boxes.join(" vs "));
  const card = await flat(page.locator("#healthToday"));
  check(
    "the day's card: sleep, resting heart rate, active calories and the workout",
    /7 h 12 min ?asleep the night before/.test(card) && /61 ?resting heart rate, bpm/.test(card) && /412 ?active kcal/.test(card) && /52 min ?in 1 workout/.test(card),
    card,
  );
  check("the workout, with its time, length, calories and app", /Strength training 7:10\s?am · 52 min · 310 kcal · Samsung Health/i.test(card), card);
  await page.fill("#steps", "9000");
  await until(() => db.logs["2026-09-23"].steps === 9000);
  const after = await flat(page.locator("#hcNote"));
  check(
    "typing your own steps replaces Health Connect's, and the note drops them",
    db.logs["2026-09-23"].steps === 9000 && after === "From Health Connect: 81.2 kg. Type your own to replace it." && !(await page.$eval("#steps", (e) => e.hasAttribute("aria-describedby"))),
    after,
  );
  check("the website never writes health data", !db.writes.health);

  // History and the week use Health Connect where you typed nothing
  const hist = await flat(page.locator("#hist"));
  // Mon 21 has nothing typed: Health Connect's 8,600 steps and 81.4 kg. Tue 22 has 9,500 typed over its 8,700.
  check("history: Health Connect's steps and weight on days with nothing typed", /Mon 21 ?Push ?0\/6 ?- ?8,600 ?81\.4/.test(hist), hist.slice(0, 200));
  check("history: a count you typed wins", /Tue 22 ?Pull ?0\/6 ?- ?9,500 ?81\.3/.test(hist), hist.slice(0, 300));
  const stats = await flat(page.locator("#stats"));
  // Mon 8,600 (Health Connect) + Tue 9,500 (typed) + Wed 9,000 (typed just now).
  check("week so far: average and total steps include Health Connect's", /9,033 ?avg steps \/ logged day/.test(stats) && /27,100 ?total steps/.test(stats), stats);

  // A day with no Health Connect data looks as before
  await page.locator("#week .dchip").nth(3).click();
  check("a day with no data: no card or note, the usual placeholders", (await page.locator("#healthToday, #hcNote").count()) === 0 && (await page.$eval("#steps", (e) => e.placeholder)) === "0");

  // Settings on the website: where the data comes from
  await page.locator("#week .dchip").nth(2).click();
  await openTab(page, "settings");
  const hcStatus = await flat(page.locator("#hcStatus"));
  check("Settings: says the data comes from the Android app, and when it synced", /^Health Connect data comes from the Gym Log Android app, last synced at \d{1,2}:\d\d (am|pm)\.$/i.test(hcStatus), hcStatus);
  check("Settings: no Connect or background sync on the website", (await page.locator("#hcConnect, #hcSync, #bgSync").count()) === 0);

  // The Health tab: the day's rings and a tile for each kind of data
  await openTab(page, "health");
  const rings = (await page.getAttribute("#activity svg.rings", "aria-label")).replace(/\s+/g, " ");
  check("rings: steps (the 9,000 you typed), exercise and active calories against their goals", rings === "Steps 9,000 of 10,000, Exercise 52 of 30 min, Active 412 of 500 kcal", JSON.stringify(rings));
  // Text as laid out, so the lines of a tile read as separate words.
  const text = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
  const tile = text;
  check("sleep tile: hours asleep, and the stages for screen readers", /^Sleep 7 h 12 min asleep the night before Deep 80 min, Light 257 min, REM 95 min, Awake 12 min$/.test(await tile("#tileSleep")), await tile("#tileSleep"));
  check("heart tile: resting and average", /^Heart 61 bpm resting · avg 78$/.test(await tile("#tileHeart")), await tile("#tileHeart"));
  check("calories tile: what was burned moving", /^Calories 412 kcal burned moving$/.test(await tile("#tileEnergy")), await tile("#tileEnergy"));
  check("body tile: Health Connect's weigh-in", /^Body 81\.2 kg body weight$/.test(await tile("#tileBody")), await tile("#tileBody"));
  check("water tile: no data, and where it would come from", /^Water No data From a water-tracking app$/.test(await tile("#tileWater")), await tile("#tileWater"));
  check("exercise tile: minutes and the kind of workout", /^Exercise 52 min Strength training$/.test(await tile("#tileExercise")), await tile("#tileExercise"));
  check("where it comes from, and when", /^From Health Connect, synced at \d{1,2}:\d\d (am|pm)\.$/i.test(await flat(page.locator("#healthNote"))), await flat(page.locator("#healthNote")));
  await page.click("#hPrev");
  check("the day switch moves to yesterday", (await flat(page.locator(".dayswitch-l"))) === "Yesterday" && (await page.getAttribute("#activity svg.rings", "aria-label")).startsWith("Steps 9,500 of 10,000"));
  await page.click("#hNext");
  check("and back to today, no further", (await flat(page.locator(".dayswitch-l"))) === "Today" && (await page.locator("#hNext").isDisabled()));

  // Sleep's page: the week as bars against the goal, then one night
  await page.click("#tileSleep");
  await page.waitForSelector("#hChart");
  check("Sleep opens as a page with its own address", page.url().endsWith("/#health/sleep") && (await page.textContent("#screenTitle")) === "Sleep");
  check("a bar for each night of the week", (await page.locator("#hChart path.col").count()) === 7);
  check("the average and the nights at the goal", /^5 h 45 min a night on average/.test(await text(".hstat")) && (await text("#hGoalDays .v")) === "1", await text("#healthView > .hstats"));
  check("the goal and average lines are named in a key", (await flat(page.locator("#hChart .refkey"))) === "Goal 7 h Average 5 h 45 min", await flat(page.locator("#hChart .refkey")));
  check("the picked night is read out: the last one first", (await flat(page.locator("#hChart .readout"))) === "Wed, 23 Sept: 7 h 12 min", await flat(page.locator("#hChart .readout")));
  await page.locator("#hChart rect.hit").nth(6).focus();
  await page.keyboard.press("ArrowLeft");
  check("arrow keys move along the nights", (await flat(page.locator("#hChart .readout"))) === "Tue, 22 Sept: 5 h 30 min" && (await page.evaluate(() => document.activeElement.getAttribute("aria-label").replace(/\s+/g, " "))) === "Tue, 22 Sept: 5 h 30 min");
  await page.click(".seg-b >> text=Day");
  check("one night: hours, the stages with their minutes, and the goal", /^7 h 12 min asleep/.test(await text("#hHero")) && (await text("#hHero .stagekey")) === "Deep 80 min Light 257 min REM 95 min Awake 12 min" && (await text("#hGoal")) === "12 min over your 7 h goal.", await text("#hHero"));
  await page.click("#backBtn");
  await page.waitForSelector("#activity");
  check("the back arrow returns to Health", page.url().endsWith("/#health"), page.url());

  // Heart's page: resting heart rate as a line
  await page.click("#tileHeart");
  await page.waitForSelector("#hChart");
  check("heart: a dot for each day, and the week's average and lowest", (await page.locator("#hChart circle.dot").count()) === 7 && (await text("#healthView > .hstats")) === "67 resting bpm on average 61 lowest resting bpm", await text("#healthView > .hstats"));
  await page.click("#backBtn");
  await page.waitForSelector("#activity");

  // Progress: sleep and resting heart rate still raise flags there
  await openTab(page, "progress");
  check("Progress has no health card now: its charts are in Health", (await page.locator("#dashHealth").count()) === 0);
  const flags = await flat(page.locator("#dashFlags"));
  check("Progress: short sleep and a higher resting heart rate are pointed out", /Sleeping 5 h 45 min a night on average this week/.test(flags) && /Resting heart rate is 6 bpm higher than last week/.test(flags), flags);
  const w = await flat(page.locator("#dashWeight"));
  check("weight trend uses Health Connect's weigh-ins", /kg ?trend weight/.test(w) && (await page.locator("#dashWeight svg circle.dot").count()) === 15, w.slice(0, 120));
  const s = await flat(page.locator("#dashSteps"));
  check("steps card uses Health Connect's steps", /7-day average/.test(s) && !/Log your daily steps/.test(s), s.slice(0, 120));
  check("only the expected endpoints", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();

  // No Health Connect data at all: Health and Settings say where it would come from
  {
    // Nothing logged, but a saved plan: an existing account, so Today rather than the plan picker.
    const { ctx, page } = await open(browser, base, { auth, db: { logs: {}, plan: savedPlan() } });
    await ready(page);
    await openTab(page, "health");
    check("Health with no data: points to the Android app", /It comes from Health Connect, through the Gym Log Android app/.test(await flat(page.locator("#healthEmpty"))));
    await openTab(page, "settings");
    check("Settings with no data: says where it would come from", (await flat(page.locator("#hcStatus"))) === "Health Connect data comes from the Gym Log Android app. Connect it there, and it shows here too.");
    await ctx.close();
  }
}
