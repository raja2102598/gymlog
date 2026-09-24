// Poor signal and updates: the sync bar, launching from the offline copy, the loading placeholder, and
// how a new build reaches an installed copy.
import fs from "node:fs";
import path from "node:path";
import { flat, open, ready, session, until } from "./harness.mjs";

const today = () => ({ "2026-09-23": { exercises: {}, warmup: [], cardio: true, steps: 7351, weight: 81, note: "" } });

export default async function offline({ browser, base, copy, check }) {
  const auth = session("00000000-0000-4000-8000-000000000005", "2026-09-23T05:00:00Z", "t@example.com");
  const delay = (url, ms) => fetch(`${url}__delay?ms=${ms}`);

  // ---------- A failing save shows a bar that stays in view, and Retry now clears it ----------
  {
    const db = { logs: today(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db, width: 360, height: 800 });
    await ready(page);
    db.failWrites = true;
    await page.fill("#steps", "9100");
    await until(() => page.locator("#syncBar").isVisible(), 8000);
    check("failed save shows the sync bar", (await page.locator("#syncBar").isVisible()) && /1 day not synced yet\. Saved on this phone; retrying every 15 seconds\./.test(await flat(page.locator("#syncMsg"))), await flat(page.locator("#syncMsg")));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const bar = await page.locator("#syncBar").boundingBox();
    check("the bar stays on screen while scrolled down", bar.y >= 0 && bar.y < 100, `y ${Math.round(bar.y)}`);
    db.failWrites = false;
    await page.click("#syncRetry");
    await until(async () => page.locator("#syncBar").isHidden());
    check("Retry now saves and hides the bar", (await page.locator("#syncBar").isHidden()) && db.logs["2026-09-23"].steps === 9100);
    await ctx.setOffline(true);
    await page.fill("#steps", "9200");
    await until(() => page.locator("#syncBar").isVisible());
    check("offline with an edit: the bar says it will sync later, no retry button", /they’ll sync when you’re back online/.test(await flat(page.locator("#syncMsg"))) && (await page.locator("#syncRetry").isHidden()));
    await ctx.setOffline(false);
    await until(async () => (await page.locator("#syncBar").isHidden()) && db.logs["2026-09-23"].steps === 9200, 8000);
    check("back online: it syncs and the bar goes", (await page.locator("#syncBar").isHidden()) && db.logs["2026-09-23"].steps === 9200);
    // The mocked 503 and the app's note of it in the console are expected; uncaught errors aren't.
    const uncaught = page.errors.filter((e) => e.startsWith("pageerror"));
    check("no uncaught errors", uncaught.length === 0, uncaught.join(" | "));
    await ctx.close();
  }

  // ---------- Launching from the offline copy: quick on weak signal, and with no signal ----------
  {
    await delay(base, 0);
    const { ctx, page } = await open(browser, base, { auth, db: { logs: today(), plan: null }, width: 360, height: 800, sw: "allow" });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await ready(page);
    check("service worker controls the page", await page.evaluate(() => !!navigator.serviceWorker.controller));
    const cached = await page.evaluate(async () => (await caches.open((await caches.keys())[0])).keys().then((ks) => ks.length));
    check("every file of the app is in the offline copy", cached >= 15, `${cached} files`);
    await delay(base, 2000);
    const t0 = Date.now();
    await page.goto(base, { waitUntil: "commit" });
    await page.waitForSelector("#appView:not([hidden])", { timeout: 30000 });
    const ms = Date.now() - t0;
    check("launch with 2 s per request is quick from the cache", ms < 1500, `${ms} ms`);
    await delay(base, 0);
    await ctx.setOffline(true);
    await page.goto(base + "?go=today", { waitUntil: "commit" });
    await page.waitForSelector("#appView:not([hidden])", { timeout: 10000 });
    check("still opens offline", true);
    await ctx.close();
  }

  // ---------- First visit ever: the page shows a placeholder until its script runs ----------
  {
    const { ctx, page } = await open(browser, base, { width: 360, height: 800, url: null });
    await page.route("**/*.js", (r) => r.abort()); // the script never arrives
    await page.goto(base, { waitUntil: "load" });
    const boot = await page.evaluate(() => {
      const b = document.getElementById("bootView");
      return !!b && !b.hidden && b.getBoundingClientRect().height > 50 && !!document.querySelector("h1");
    });
    check("before the script loads, the page shows the header and a loading placeholder, not a blank page", boot);
    await page.unroute("**/*.js");
    await page.reload();
    await page.waitForFunction(() => document.getElementById("bootView").hidden, null, { timeout: 15000 });
    check("the placeholder goes once the app shows a view", (await page.locator("#bootView").isHidden()) && (await page.locator("#loginView").isVisible()));
    await ctx.close();
  }

  // ---------- Updates: a new build reaches an installed copy by the next launch ----------
  {
    const { ctx, page } = await open(browser, copy.url, { auth, db: { logs: today(), plan: null }, sw: "allow" });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await ready(page);
    const v1 = await page.evaluate(() => caches.keys());
    // "Deploy" a new build: changed app code, and so a new VERSION in sw.js.
    const html = fs.readFileSync(path.join(copy.dir, "index.html"), "utf8");
    const chunk = html.match(/<script src="\/(_next\/static\/chunks\/[^"]+\.js)" async=""/)[1];
    fs.appendFileSync(path.join(copy.dir, chunk), "\n;window.__build = 2;\n");
    const swFile = path.join(copy.dir, "sw.js");
    fs.writeFileSync(swFile, fs.readFileSync(swFile, "utf8").replace(/const VERSION = "[^"]+"/, 'const VERSION = "gymlog-test-next"'));
    await page.reload();
    await ready(page);
    check("the launch right after a deploy still runs the cached version (no half-updated mix)", await page.evaluate(() => window.__build === undefined));
    await until(async () => (await page.evaluate(() => caches.keys())).includes("gymlog-test-next"), 10000);
    await until(async () => (await page.evaluate(() => caches.keys())).length === 1, 10000);
    await page.reload();
    await ready(page);
    check("the next launch runs the new version", await page.evaluate(() => window.__build === 2), JSON.stringify({ before: v1, after: await page.evaluate(() => caches.keys()) }));
    check("no page errors across the update", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }
}
