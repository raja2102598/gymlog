// Screenshots of every screen in both themes (docs/screenshots/): the built site (out/) in Chromium at phone size,
// signed in with Supabase mocked and four weeks of made-up history from lib/sampleData.js (the same generator the
// in-app demo uses), so nothing real is called. `npm run build`, then `npm run screenshots` with
// NEXT_PUBLIC_SUPABASE_URL set to what the build used (or in .env.local). Pass --full for whole-page shots.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { sampleDays } from "../src/lib/sampleData.js";
import { serve } from "./serve.mjs";
import { open, openTab, ready, savedPlan, session, settled } from "../tests/e2e/harness.mjs";

const OUT = path.resolve(process.env.SHOTS_DIR || "docs/screenshots");
const FULL = process.argv.includes("--full");
fs.mkdirSync(OUT, { recursive: true });
const server = await serve(path.resolve("out"), 4175);
const base = "http://127.0.0.1:4175/";

// The day the end-to-end tests pin the browser's clock to (harness.mjs's NOW), so these screenshots' numbers don't
// drift between runs, and the plan they're built from: the app's own default (src/data/plan.json).
const TODAY = "2026-09-23";
const { logs, health } = sampleDays(TODAY, savedPlan().days);

const browser = await chromium.launch({ proxy: undefined });
const uid = "00000000-0000-4000-8000-0000000000aa";
const auth = () => session(uid, "2026-08-26T05:00:00Z", "you@example.com", "password");
const fresh = () => ({ logs: structuredClone(logs), plan: null, health: structuredClone(health), google: true, metadata: { full_name: "Sam Rivera" } });
async function snap(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(settled);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png`, type: "png", animations: "disabled", caret: "hide", fullPage: FULL });
  console.log("shot", name);
}
for (const scheme of ["dark", "light"]) {
  const { ctx, page } = await open(browser, base, { auth: auth(), db: fresh(), scheme });
  await ready(page);
  await snap(page, `home-${scheme}`);
  for (const tab of ["train", "progress", "health"]) {
    await openTab(page, tab);
    await snap(page, `${tab}-${scheme}`);
  }
  await page.click("#tileSteps");
  await page.waitForSelector("#hChart");
  await snap(page, `steps-${scheme}`);
  await page.click("#backBtn");
  await page.waitForSelector("#healthView #activity");
  await openTab(page, "settings");
  await snap(page, `settings-${scheme}`);
  await page.goto(base + "#train");
  await page.waitForSelector("#trainView");
  await page.click("#libTile");
  await page.waitForSelector("#libList");
  await snap(page, `library-${scheme}`);
  await page.keyboard.press("Escape");
  // The workout: today's session, a set in, resting.
  await page.click("#startBtn");
  await page.waitForSelector("#workoutView");
  await page.click("#completeSet");
  await page.waitForSelector("#restCard");
  await snap(page, `workout-${scheme}`);
  await page.click("#finishBtn");
  await page.waitForSelector(".complete");
  await snap(page, `complete-${scheme}`);
  if (page.errors.length) console.log("page errors:", page.errors);
  await ctx.close();
  {
    const { ctx, page } = await open(browser, base, { auth: null, db: fresh(), scheme });
    await page.waitForSelector("#loginView:not([hidden])", { timeout: 15000 });
    await snap(page, `signin-${scheme}`);
    await ctx.close();
  }
}
await browser.close();
server.close?.();
process.exit(0);
