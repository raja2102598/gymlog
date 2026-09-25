// Poor signal and updates: the sync bar, launching from the offline copy, the loading placeholder, and
// how a new build reaches an installed copy. Today's steps are typed in Train's day log (#steps).
import fs from "node:fs";
import path from "node:path";
import { flat, open, openSetting, openTab, openWorkout, ready, session, until } from "./harness.mjs";

const today = () => ({ "2026-09-23": { exercises: {}, warmup: [], cardio: true, steps: 7351, weight: 81, note: "" } });

export default async function offline({ browser, base, copy, check }) {
  const auth = session("00000000-0000-4000-8000-000000000005", "2026-09-23T05:00:00Z", "t@example.com");
  const delay = (url, ms) => fetch(`${url}__delay?ms=${ms}`);

  // ---------- A failing save shows a bar that stays in view, and Retry now clears it ----------
  {
    const db = { logs: today(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db, width: 360, height: 800 });
    await ready(page);
    await openTab(page, "train");
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

  // ---------- A phone that won't keep a save (storage full or blocked) says so in the bar ----------
  {
    const db = { logs: today(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db, width: 360, height: 800 });
    await ready(page);
    await openTab(page, "train");
    // Every save on the phone now throws, as the browser's do when its storage is full.
    await page.evaluate(() => {
      window.__setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      };
    });
    await page.fill("#steps", "9300");
    await until(() => page.locator("#syncBar").isVisible(), 8000);
    check(
      "an edit the phone couldn't keep shows in the sync bar",
      (await flat(page.locator("#syncLocal"))) === "Couldn’t save on this phone: storage is full or blocked. Free up space, or export your data from Settings.",
      await flat(page.locator("#syncBar")),
    );
    await until(() => db.logs["2026-09-23"].steps === 9300, 8000);
    await page.waitForTimeout(300);
    check("the edit still syncs, and the line stays while the phone's copy is out of date", db.logs["2026-09-23"].steps === 9300 && (await page.locator("#syncLocal").isVisible()) && (await page.locator("#syncMsg").isHidden()));
    db.failWrites = true;
    await page.fill("#steps", "9350");
    await until(() => page.locator("#syncMsg").isVisible(), 8000);
    check(
      "a failed upload too: the bar doesn't claim the day is saved on this phone",
      (await flat(page.locator("#syncMsg"))) === "1 day not synced yet. Retrying every 15 seconds." && (await page.locator("#syncLocal").isVisible()),
      await flat(page.locator("#syncBar")),
    );
    db.failWrites = false;
    await page.click("#syncRetry");
    await until(async () => db.logs["2026-09-23"].steps === 9350 && (await page.locator("#syncMsg").isHidden()));
    check("Retry now still saves it", db.logs["2026-09-23"].steps === 9350 && (await page.locator("#syncLocal").isVisible()));
    await page.evaluate(() => (Storage.prototype.setItem = window.__setItem));
    await page.fill("#steps", "9400");
    await until(() => page.locator("#syncBar").isHidden());
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("gymlog.cache.v1")).logs["2026-09-23"].steps);
    check("once the phone saves again, the line goes", (await page.locator("#syncBar").isHidden()) && kept === 9400, `kept ${kept}`);
    const uncaught = page.errors.filter((e) => e.startsWith("pageerror"));
    check("no uncaught errors with storage full", uncaught.length === 0, uncaught.join(" | "));
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
    // sw.js lists every file of the built site (SHELL: the scripts, the one Nunito font, the icons, the pages).
    const cached = await page.evaluate(async () => {
      const shell = JSON.parse((await (await fetch("/sw.js")).text()).match(/const SHELL = (\[[\s\S]*?\]);/)[1]);
      const have = (await (await caches.open((await caches.keys())[0])).keys()).map((r) => new URL(r.url).pathname);
      return { shell: shell.length, have: have.length, missing: shell.filter((f) => !have.includes(f)) };
    });
    check("every file of the app is in the offline copy", cached.shell >= 15 && cached.missing.length === 0, JSON.stringify(cached));
    await delay(base, 2000);
    const t0 = Date.now();
    await page.goto(base, { waitUntil: "commit" });
    await page.waitForSelector("#homeView", { timeout: 30000 });
    const ms = Date.now() - t0;
    check("launch with 2 s per request is quick from the cache", ms < 1500, `${ms} ms`);
    await delay(base, 0);
    await ctx.setOffline(true);
    await page.goto(base + "?go=today", { waitUntil: "commit" });
    await page.waitForSelector("#homeView", { timeout: 10000 });
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
    const db = { logs: today(), plan: null };
    const { ctx, page } = await open(browser, copy.url, { auth, db, sw: "allow" });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await ready(page);
    check("no update notice before anything's changed", await page.locator("#swUpdateBar").isHidden());
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
    // The new service worker has just claimed this still-open tab (a controllerchange on a page that already had
    // one): a notice offers a reload, since this tab is still running the old code until then.
    await page.waitForSelector("#swUpdateBar:not([hidden])", { timeout: 5000 });
    check("a notice offers a reload once the new version takes over the open tab", (await flat(page.locator("#swUpdateMsg"))) === "Gym Log was updated.");
    // With the sync bar up too, scrolled: the two stack, neither covering the other's buttons. (A set's reps, typed
    // in the workout.)
    db.failWrites = true;
    await openWorkout(page, 0);
    await page.fill("#s0_0_r", "10");
    await page.waitForSelector("#syncBar:not([hidden])", { timeout: 8000 });
    await page.evaluate(() => window.scrollBy(0, 600));
    const bars = await page.evaluate(() => ["#syncBar", "#swUpdateBar"].map((s) => document.querySelector(s).getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom) })));
    check("the sync bar and a notice shown together stack, neither covering the other", bars[0].bottom <= bars[1].top || bars[1].bottom <= bars[0].top, JSON.stringify(bars));
    db.failWrites = false;
    // Those saves failed on purpose: what the browser and the app log about them isn't a page error.
    page.errors = page.errors.filter((e) => !/status of 503 \(Service Unavailable\)|\{message: unavailable\}/.test(e));
    // The reload, and the next launch, open where it was: the workout.
    const inWorkout = async () => {
      await page.waitForSelector("#workoutView .ex-card", { timeout: 15000 });
      await until(async () => (await page.locator("#status").textContent()) === "Synced");
    };
    await page.click("#swUpdateReload");
    await inWorkout();
    check("Reload runs the new version", await page.evaluate(() => window.__build === 2));
    await page.reload();
    await inWorkout();
    check("the next launch runs the new version", await page.evaluate(() => window.__build === 2), JSON.stringify({ before: v1, after: await page.evaluate(() => caches.keys()) }));
    check("no page errors across the update", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // ---------- Updates: a first visit left open still hears about the next build ----------
  {
    const { ctx, page } = await open(browser, copy.url, { auth, db: { logs: today(), plan: null }, sw: "allow" });
    await ready(page);
    // Its service worker installs and takes this tab over: that's the first install, not an update.
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
    check("a first visit's own install shows no update notice", await page.locator("#swUpdateBar").isHidden());
    // "Deploy" another build, and ask for it from Settings → About without leaving the page.
    const html = fs.readFileSync(path.join(copy.dir, "index.html"), "utf8");
    const chunk = html.match(/<script src="\/(_next\/static\/chunks\/[^"]+\.js)" async=""/)[1];
    fs.appendFileSync(path.join(copy.dir, chunk), "\n;window.__build = 3;\n");
    const swFile = path.join(copy.dir, "sw.js");
    fs.writeFileSync(swFile, fs.readFileSync(swFile, "utf8").replace(/const VERSION = "[^"]+"/, 'const VERSION = "gymlog-test-third"'));
    await openTab(page, "settings");
    await openSetting(page, "setAbout");
    await page.click("#updCheckWebBtn");
    await page.waitForSelector("#swUpdateBar:not([hidden])", { timeout: 10000 });
    check("a first visit left open still offers a reload once the next build takes over", (await flat(page.locator("#swUpdateMsg"))) === "Gym Log was updated.");
    await page.click("#swUpdateReload");
    // The reload opens where it was: Settings.
    await page.waitForSelector("#settingsView", { timeout: 15000 });
    check("…and Reload runs that build", await page.evaluate(() => window.__build === 3));
    check("no page errors across it", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }
}
