// The measurements card on Today (chest, arms, thighs, hips, body fat): labels and touch targets, an
// implausible value refused with a message, logging all five, their trends and four-week change in
// Health → Body, the day view, and the export.
import fs from "node:fs";
import { flat, K, open, openTab, ready, session, until } from "./harness.mjs";

export const covers = [
  "src/components/health/HealthView.tsx",
  "src/components/health/HealthDetail.tsx",
  "src/components/health/Rings.tsx",
  "src/components/health/Bars.tsx",
  "src/components/health/Trend.tsx",
  "src/lib/scale.ts",
];

const FIELDS = ["chest", "arms", "thighs", "hips", "bodyFat"];

function history() {
  const logs = {};
  for (let n = 0; n <= 28; n++) logs[K(n)] = { exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "" };
  // A first round four weeks before today, so today's entries (filled in below) have a four-week change.
  Object.assign(logs[K(0)], { chest: 100, arms: 34, thighs: 58, hips: 96, bodyFat: 22 });
  return logs;
}

export default async function measurements({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000081", "2026-08-26T05:00:00Z", "t@example.com");
  const db = { logs: history(), plan: null };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);
  // Text as laid out, so a hero's separate blocks (value, then each stat) read as separate words.
  const text = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();

  // --- the card, its labels and touch targets, the weekly hint
  check("a Measurements card on Today", (await flat(page.locator("#measureCard h3"))) === "Measurements");
  const info = await page.$$eval(
    FIELDS.map((f) => `#${f}`).join(","),
    (els) => els.map((e) => ({ labels: e.labels.length, h: e.getBoundingClientRect().height })),
  );
  check("every field has its own label and is at least 44px tall", info.every((x) => x.labels === 1 && x.h >= 44), JSON.stringify(info));
  check("weekly is the hint, like waist", (await page.$eval("#chest", (e) => e.placeholder)) === "weekly");

  // --- validation: an implausible value is refused with a plain message, and not saved
  await page.fill("#chest", "9999");
  await until(async () => (await page.getAttribute("#chest", "aria-invalid")) === "true");
  check("an implausible chest measurement is marked invalid, described by its message", (await page.getAttribute("#chest", "aria-describedby")) === "chestErr");
  check("the message names the plausible range", (await flat(page.locator("#chestErr"))) === "From 50 to 200", await flat(page.locator("#chestErr")));
  check("the bad value isn't saved", db.logs[K(28)].chest === undefined);
  await page.fill("#bodyFat", "95");
  await until(async () => (await page.getAttribute("#bodyFat", "aria-invalid")) === "true");
  check("body fat has its own plausible range, refused the same way", db.logs[K(28)].bodyFat === undefined);

  // --- logging: a plausible value replaces the bad one, saves, and clears the error
  await page.fill("#chest", "105.5");
  await until(() => db.logs[K(28)].chest === 105.5);
  check("the error clears once the value is in range", (await page.getAttribute("#chest", "aria-invalid")) === null);
  await page.fill("#arms", "35.5");
  await page.fill("#thighs", "59.5");
  await page.fill("#hips", "97.5");
  await page.fill("#bodyFat", "21");
  await until(() => db.logs[K(28)].bodyFat === 21);
  const t = db.logs[K(28)];
  check("all five measurements saved", t.chest === 105.5 && t.arms === 35.5 && t.thighs === 59.5 && t.hips === 97.5 && t.bodyFat === 21, JSON.stringify(t));

  // --- Health with only typed measurements: the Body tile shows them, and the note says where they came from
  await openTab(page, "health");
  const tile = await text("#tileBody");
  check("with no weight, the Body tile shows today's measurements rather than no data", tile === "Body 21% body fat · 4 more", tile);
  const note = await flat(page.locator("#healthNote"));
  check("and the note doesn't credit Health Connect with them", /^Only the measurements you’ve typed on Today so far\. Steps, sleep, heart rate and the rest come from Health Connect, through the Gym Log Android app\.$/.test(note), note);

  // --- reading them back in Health → Body: a trend and the four-week change for each
  await page.click("#tileBody");
  await page.waitForSelector("#hChart");
  check("Body opens on the month, where these trends show", (await flat(page.locator(".seg-b.on"))) === "Month");
  check("a trend chart for each new measurement", (await page.locator("#hChest, #hArms, #hThighs, #hHips").count()) === 4);
  check("chest: the latest value and its change from four weeks back", (await flat(page.locator("#hChestChange"))) === "Chest 105.5 cm on 23 Sept · +5.5 cm since 26 Aug", await flat(page.locator("#hChestChange")));
  check("arms: same shape", (await flat(page.locator("#hArmsChange"))) === "Arms 35.5 cm on 23 Sept · +1.5 cm since 26 Aug", await flat(page.locator("#hArmsChange")));
  check("thighs: same shape", (await flat(page.locator("#hThighsChange"))) === "Thighs 59.5 cm on 23 Sept · +1.5 cm since 26 Aug", await flat(page.locator("#hThighsChange")));
  check("hips: same shape", (await flat(page.locator("#hHipsChange"))) === "Hips 97.5 cm on 23 Sept · +1.5 cm since 26 Aug", await flat(page.locator("#hHipsChange")));
  check("body fat: a change line next to Health Connect's existing Body fat chart", (await flat(page.locator("#hFatChange"))) === "Body fat 21% on 23 Sept · −1.0% since 26 Aug", await flat(page.locator("#hFatChange")));
  check("body fat still has only the one chart", (await page.locator("#hFat").count()) === 1);

  // --- the day view: today's measurements alongside weight and body fat
  await page.click(".seg-b >> text=Day");
  const hero = await text("#hHero");
  check(
    "the day view lists today's measurements too",
    hero.includes("105.5 cm chest") && hero.includes("35.5 cm arms") && hero.includes("59.5 cm thighs") && hero.includes("97.5 cm hips") && hero.includes("21% body fat"),
    hero,
  );
  // --- an earlier week: each note reads up to that week's last day, as its chart does, never a later reading
  await page.click(".seg-b >> text=Week");
  for (let i = 0; i < 4; i++) await page.click("#hPrev"); // the week ending 26 Aug, the first round's day
  await page.waitForSelector("#hChestChange");
  check("an earlier week's chest note stops at that week, like its chart", (await flat(page.locator("#hChestChange"))) === "Chest 100 cm on 26 Aug", await flat(page.locator("#hChestChange")));
  check("and body fat's too", (await flat(page.locator("#hFatChange"))) === "Body fat 22% on 26 Aug", await flat(page.locator("#hFatChange")));
  await page.click("#backBtn");
  await page.waitForSelector("#activity");

  // --- included in the export; an old day without any of these fields exports as before
  await openTab(page, "settings");
  const [json] = await Promise.all([page.waitForEvent("download"), page.click("#exportBtn")]);
  const backup = JSON.parse(fs.readFileSync(await json.path(), "utf8"));
  const byDay = Object.fromEntries(backup.logs.map((r) => [r.day, r.data]));
  check(
    "the new measurements are in the export",
    byDay[K(28)].chest === 105.5 && byDay[K(28)].bodyFat === 21 && byDay[K(0)].hips === 96,
    JSON.stringify(byDay[K(28)]),
  );
  check("an old day without them exports with no new keys", !("chest" in byDay[K(10)]) && !("bodyFat" in byDay[K(10)]), JSON.stringify(byDay[K(10)]));

  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
