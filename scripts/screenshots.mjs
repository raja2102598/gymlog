// Screenshots for the README (docs/screenshots/): the built site (out/) in Chromium at phone size, signed in with
// Supabase mocked and four weeks of made-up history from lib/sampleData.js (the same generator the in-app demo
// uses), so nothing real is called. `npm run build`, then `npm run screenshots` with NEXT_PUBLIC_SUPABASE_URL set
// to what the build used (or in .env.local).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { sampleDays } from "../src/lib/sampleData.js";
import { serve } from "./serve.mjs";
import { open, openTab, ready, savedPlan, session, settled } from "../tests/e2e/harness.mjs";

const OUT = path.resolve("docs/screenshots");
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
