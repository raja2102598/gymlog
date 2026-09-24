// Health Connect data as the website shows it, once the Android app has synced it to health_days:
// steps and weight fill in until you type your own, the day's sleep, heart and workouts, and the dashboard.
import { K, flat, open, ready, session, until } from "./harness.mjs";

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

  // Menu on the website: where the data comes from
  await page.locator("#week .dchip").nth(2).click();
  await page.click("#menuBtn");
  const hcStatus = await flat(page.locator("#hcStatus"));
  check("menu: says the data comes from the Android app, and when it synced", /^Health Connect data comes from the Gym Log Android app, last synced at \d{1,2}:\d\d (am|pm)\.$/i.test(hcStatus), hcStatus);
  check("menu: no Connect button on the website", (await page.locator("#hcConnect, #hcSync").count()) === 0);
  await page.click("#menuBtn");

  // Dashboard
  await page.click("#dashBtn");
  const d = await flat(page.locator("#dashHealth"));
  // Last 7 nights: six of 5.5 h and 7 h 12 min; the 7 before, 7 h each. Resting: six of 68 and 61 (67), against 61.
  check("dashboard: sleep and resting heart rate, this week and the week before", /5 h 45 min ?asleep a night, last 7 days \(week before 7 h\)/.test(d) && /67 ?resting heart rate, bpm \(week before 61\)/.test(d), d);
  check("dashboard: workouts and active calories this week", /1 ?workout this week, 52 min/.test(d) && /1,065 ?active kcal this week/.test(d), d);
  check("dashboard: a bar for each of 14 nights, green from 7 hours", (await page.locator("#dashHealth svg rect.wbar").count()) === 14 && (await page.locator("#dashHealth svg rect.wbar.met").count()) === 8);
  const flags = await flat(page.locator("#dashFlags"));
  check("dashboard: short sleep and a higher resting heart rate are pointed out", /Sleeping 5 h 45 min a night on average this week/.test(flags) && /Resting heart rate is 6 bpm higher than last week/.test(flags), flags);
  const w = await flat(page.locator("#dashWeight"));
  check("weight trend uses Health Connect's weigh-ins", /kg ?trend weight/.test(w) && (await page.locator("#dashWeight svg circle.dot").count()) === 15, w.slice(0, 120));
  const s = await flat(page.locator("#dashSteps"));
  check("steps card uses Health Connect's steps", /7-day average/.test(s) && !/Log your daily steps/.test(s), s.slice(0, 120));
  check("only the expected endpoints", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();

  // No Health Connect data at all: the dashboard says where it would come from
  {
    const { ctx, page } = await open(browser, base, { auth, db: { logs: {}, plan: null } });
    await ready(page);
    await page.click("#dashBtn");
    check("dashboard with no data: points to the Android app", /come from Health Connect, through the Gym Log Android app/.test(await flat(page.locator("#dashHealth"))));
    await page.click("#dashBtn");
    await page.click("#menuBtn");
    check("menu with no data: no Health Connect line", (await page.locator("#hcStatus").count()) === 0);
    await ctx.close();
  }
}
