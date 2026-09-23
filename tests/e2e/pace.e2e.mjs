// Dashboard pace flags: the weekly loss against the target set in Edit plan.
import { K, open, ready, session } from "./harness.mjs";

// Daily weigh-ins from 26 Aug to today, changing by `perDay` kg.
const series = (perDay) => {
  const logs = {};
  for (let n = 0; n <= 28; n++) logs[K(n)] = { exercises: {}, warmup: [], cardio: false, steps: null, weight: Math.round((84 + perDay * n) * 10) / 10, note: "" };
  return logs;
};

export default async function pace({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000003", "2026-08-26T05:00:00Z", "t@example.com");
  const flags = async (logs, plan) => {
    const { ctx, page } = await open(browser, base, { auth, db: { logs, plan }, mobile: false });
    await ready(page);
    await page.click("#dashBtn");
    await page.waitForSelector("#dashView:not([hidden])");
    const text = (await page.locator("#dashFlags").textContent()).replace(/\s+/g, " ").trim(), errors = page.errors;
    await ctx.close();
    return { text, errors };
  };
  let r = await flags(series(-0.1), { weeklyRatePct: 0.7 });
  check("on pace (about 0.8% a week against 0.7%): no pace flag", !/a week/.test(r.text) && !r.errors.length, r.text || "(no flags)");
  r = await flags(series(-0.1), { weeklyRatePct: 2 });
  check("too slow: well under target", /Losing 0\.\d\d% a week, well under your 2% target\./.test(r.text), r.text);
  r = await flags(series(-0.1), { weeklyRatePct: 0.4 });
  check("too fast: faster than target", /Losing 0\.\d\d% a week, faster than your 0\.4% target\./.test(r.text), r.text);
  r = await flags(series(0.05), { weeklyRatePct: 0.7 });
  check("rising: says it isn't going down, no negative 'Losing'", /The trend isn't going down yet \(\+0\.\d\d% a week\) against your 0\.7% target\./.test(r.text) && !/Losing/.test(r.text), r.text);
  r = await flags(series(-0.1), {});
  check("no target set: no pace flag", !/a week/.test(r.text), r.text || "(no flags)");
}
