// Screenshots for the README (docs/screenshots/): the built site (out/) in Chromium at phone size, signed in with
// Supabase mocked and four weeks of made-up history, so nothing real is called. `npm run build`, then
// `npm run screenshots` with NEXT_PUBLIC_SUPABASE_URL set to what the build used (or in .env.local).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { serve } from "./serve.mjs";
import { K, open, openTab, ready, session, settled } from "../tests/e2e/harness.mjs";

const OUT = path.resolve("docs/screenshots");
fs.mkdirSync(OUT, { recursive: true });
const server = await serve(path.resolve("out"), 4175);
const base = "http://127.0.0.1:4175/";

// K(n): n = 0 is Wed 26 Aug 2026, n = 28 is today (Wed 23 Sep). Weekday by n % 7: 0 Wed, 1 Thu, 2 Fri, 3 Sat, 4 Sun, 5 Mon, 6 Tue.
const PLAN = {
  5: [["Incline Machine Press", 30, 9], ["Chest Press Machine", 40, 11], ["Machine Shoulder Press", 25, 9], ["DB Lateral Raises", 8, 14], ["Cable Triceps Pushdown", 20, 14], ["Overhead Rope Extension", 17.5, 14]],
  6: [["Lat Pulldown", 45, 9], ["Chest-Supported Row", 35, 9], ["Seated Row", 40, 11], ["Rear Delt Fly", 12.5, 14], ["Dumbbell Curls", 10, 11], ["Cable Curls", 15, 11]],
  0: [["Hack Squat", 20, 9], ["Leg Press", 40, 11], ["Leg Extension", 25, 14], ["Hamstring Curl", 27.5, 11], ["Calf Raise", 30, 14]],
  2: [["Flat DB Press", 18, 7], ["Cable Chest Fly", 10, 14], ["Lat Pulldown (Neutral Grip)", 45, 11], ["Seated Row", 40, 11], ["Cable Bicep Curls", 15, 14], ["Cable Rope Pushdown", 20, 14]],
  3: [["DB Shoulder Press", 14, 7], ["Lateral Raises", 8, 14], ["Hip Thrust (machine or barbell)", 50, 9], ["Hamstring Curl", 27.5, 11], ["Leg Extension", 25, 14]],
};
const logs = {}, health = {};
for (let n = 0; n <= 28; n++) {
  const e = { exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "" };
  const week = Math.floor(n / 7), lifts = PLAN[n % 7];
  if (n % 3 !== 2 && n < 28) e.weight = Math.round((84.2 - 0.12 * n + (((n * 7) % 5) - 2) * 0.12) * 10) / 10;
  if (n % 4 === 1 && n < 28) e.steps = 7000 + ((n * 1379) % 5000);
  if (lifts && n < 28 && n !== 17 && n !== 24) {
    for (const [name, kg0, reps] of lifts) {
      const kg = kg0 + 2.5 * week, sets = [0, 1, 2].map((i) => ({ reps: i === 2 ? reps - 1 : reps, kg }));
      e.exercises[name] = { done: true, kg, sets };
    }
    e.warmup = ["Treadmill walk 5 min", "Leg swings", "Light warm-up sets"];
    e.cardio = n % 7 !== 3;
    if (e.cardio) Object.assign(e, { cardioMin: 12, cardioSpeed: 5.5, cardioIncline: 6 });
    if (n % 7 === 0 || n % 7 === 3) Object.assign(e, { kneeBefore: 1 + (week % 2), kneeAfter: 2 + (week % 2) });
  }
  if (n % 7 === 1 && n > 0 && n < 28) e.kneeWake = 1;
  logs[K(n)] = e;
}
logs[K(0)].waist = 96;
logs[K(21)].waist = 94;
// Today: Legs, part-way through. Leg Press moved up to 52.5 kg for a record set; Leg Extension has one set in.
Object.assign(logs[K(28)], {
  exercises: {
    "Hack Squat": { done: true, kg: 30, sets: [{ reps: 10, kg: 30 }, { reps: 10, kg: 30 }, { reps: 9, kg: 30 }] },
    "Leg Press": { done: true, kg: 52.5, sets: [{ reps: 12, kg: 52.5 }, { reps: 12, kg: 52.5 }, { reps: 11, kg: 52.5 }] },
    "Leg Extension": { done: false, kg: 35, sets: [{ reps: 15, kg: 35 }, { reps: null, kg: null }, { reps: null, kg: null }] },
  },
  warmup: ["Treadmill walk 5 min", "Leg swings", "Light warm-up sets"],
  kneeBefore: 1,
});
for (let n = 8; n <= 28; n++) {
  const gym = PLAN[n % 7] && n !== 17 && n !== 24;
  const sleep = 400 + ((n * 37) % 70) - (n >= 25 ? 40 : 0);
  health[K(n)] = {
    steps: 6200 + ((n * 911) % 4800), km: Math.round((4.2 + ((n * 13) % 30) / 10) * 100) / 100, activeKcal: 320 + ((n * 53) % 160), eatenKcal: 1900 + ((n * 97) % 400),
    waterMl: 1500 + ((n * 250) % 1000), totalKcal: 2100 + ((n * 61) % 300), hrAvg: 74 + (n % 5), hrMin: 50 + (n % 4), hrMax: 140 + ((n * 7) % 25),
    restingHr: 58 + (n % 4) + (n >= 25 ? 3 : 0), hrv: 38 + ((n * 5) % 14), spo2: 96 + ((n * 3) % 3), respRate: 14 + (n % 3) * 0.4,
    weight: Math.round((84 - 0.12 * n) * 10) / 10, bodyFat: Math.round((25 - 0.04 * n) * 10) / 10,
    sleepMin: sleep, sleepStages: { light: Math.round(sleep * 0.52), deep: Math.round(sleep * 0.2), rem: Math.round(sleep * 0.23), awake: Math.round(sleep * 0.05) },
    bed: `${K(n - 1)}T22:${40 + (n % 3) * 5}:00Z`, wake: `${K(n)}T0${6 + (n % 2)}:${10 + (n % 4) * 5}:00Z`,
    workouts: gym ? [{ type: "strengthTraining", start: `${K(n)}T07:05:00Z`, end: `${K(n)}T07:58:00Z`, min: 53, kcal: 280 + (n % 5) * 12, source: "Samsung Health" }] : [],
  };
}
Object.assign(health[K(28)], { steps: 8421, stepsByHour: [0, 0, 0, 0, 0, 0, 640, 1810, 920, 310, 1240, 1560, 780, 420, 340, 400, 0, 0, 0, 0, 0, 0, 0, 0], bp: { sys: 118, dia: 76 } });

const browser = await chromium.launch({ proxy: undefined });
const uid = "00000000-0000-4000-8000-0000000000aa";
const auth = () => session(uid, "2026-08-26T05:00:00Z", "you@example.com", "password");
const fresh = () => ({ logs: structuredClone(logs), plan: null, health: structuredClone(health), google: true, metadata: {} });
async function snap(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(settled);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png`, type: "png", animations: "disabled", caret: "hide" });
  console.log("shot", name);
}
for (const scheme of ["light", "dark"]) {
  const { ctx, page } = await open(browser, base, { auth: auth(), db: fresh(), scheme });
  await ready(page);
  await snap(page, `today-${scheme}`);
  for (const tab of ["health", "progress", "settings"]) {
    await openTab(page, tab);
    await snap(page, `${tab}-${scheme}`);
  }
  if (page.errors.length) console.log("page errors:", page.errors);
  await ctx.close();
}
{
  const { ctx, page } = await open(browser, base, { auth: auth(), db: fresh(), scheme: "light", url: base + "#health/sleep" });
  await page.waitForSelector("#appView:not([hidden]), #healthView:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(800);
  await snap(page, "sleep-light");
  await page.goto(base + "#plan");
  await page.waitForTimeout(800);
  await snap(page, "plan-light");
  await ctx.close();
}
{
  const { ctx, page } = await open(browser, base, { auth: null, db: fresh(), scheme: "light" });
  await page.waitForSelector("text=Continue with Google", { timeout: 15000 });
  await snap(page, "signin-light");
  await ctx.close();
}
await browser.close();
server.close?.();
process.exit(0);
