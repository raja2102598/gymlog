// Getting around (Vercel's Web Interface Guidelines, and the phone's Back): the tabs and pushed pages (Settings, a
// Health metric, the plan editor) in the address and the browser's history, landmarks and a skip link, focus rings
// you can see, hover and touch, the avatar for Settings in the same place on every tab, opening a screen from its
// address, a home-screen shortcut or the widget, and moving between screens: sliding in and out, crossfading between
// tabs, and not at all with Reduce motion.
import { K, open, openTab, ready, session, settled, until } from "./harness.mjs";

export const covers = ["src/components/health/HealthView.tsx", "src/components/health/HealthDetail.tsx", "src/components/health/Rings.tsx", "src/components/health/Bars.tsx", "src/components/health/Trend.tsx", "src/lib/scale.ts", "src/lib/pageTransition.ts", "src/components/ds/ProfileButton.tsx"];

function logs() {
  const l = {};
  for (let n = 0; n <= 28; n++) l[K(n)] = { exercises: {}, warmup: [], cardio: false, steps: 8000, weight: Math.round((84 - 0.1 * n) * 10) / 10, note: "" };
  l[K(21)].exercises["Leg Press"] = { done: true, kg: 45, sets: [{ reps: 10, kg: 45 }, { reps: 10, kg: 45 }, { reps: 8, kg: 45 }] };
  return l;
}

/** Starts noting, frame by frame, the view-transition animations that run and the way <html> says the move goes. */
const watch = (page) =>
  page.evaluate(() => {
    const seen = new Set(), me = (window.__watching = (window.__watching ?? 0) + 1);
    window.__moves = [];
    let frames = 90;
    const tick = () => {
      if (window.__watching !== me) return; // a newer watch took over
      const nav = document.documentElement.dataset.nav ?? "-";
      for (const a of document.getAnimations()) {
        const pe = a.effect?.pseudoElement;
        if (pe?.startsWith("::view-transition-") && a.animationName) seen.add(`${nav} ${a.animationName} ${pe}`);
      }
      window.__moves = [...seen];
      if (--frames > 0) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const moves = async (page) => {
  await until(async () => (await page.evaluate(() => document.documentElement.dataset.nav)) === undefined, 3000);
  return page.evaluate(() => window.__moves);
};

export default async function navigation(t) {
  await tabsAndPages(t);
  await fromOutside(t);
  await moving(t);
}

async function tabsAndPages({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000041", "2026-08-26T05:00:00Z", "t@example.com");

  // ---------- A mouse and keyboard: landmarks, focus, hover, and screens in the address ----------
  {
    const db = { logs: logs(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db, mobile: false });
    await ready(page);
    const land = await page.evaluate(() => ({
      main: document.querySelectorAll("main").length,
      banner: [...document.querySelectorAll("header.head h1")].filter((e) => e.getClientRects().length).length,
      nav: document.querySelector("nav.tabbar")?.getAttribute("aria-label"),
      current: [...document.querySelectorAll(".tabbar [aria-current=page]")].map((e) => e.id),
    }));
    check("one main landmark, a header with the screen's name, the tabs a labelled nav with Home current", land.main === 1 && land.banner === 1 && land.nav === "Main" && land.current.join() === "tabHome", JSON.stringify(land));
    await page.keyboard.press("Tab");
    const skip = await page.evaluate(() => ({ cls: document.activeElement.className, w: document.activeElement.getBoundingClientRect().width, text: document.activeElement.textContent }));
    check("the first Tab shows a Skip to content link", /\bskip\b/.test(skip.cls) && skip.w > 40 && skip.text === "Skip to content", JSON.stringify(skip));
    await page.keyboard.press("Enter");
    check("the skip link moves focus to the main content, without changing the address", (await page.evaluate(() => document.activeElement.id)) === "main" && !page.url().includes("#"), page.url());
    check("the skip link hides again once focus moves on", (await page.$eval(".skip", (e) => e.getBoundingClientRect().width)) <= 1);

    // the tabs are links with addresses, and Back walks back the way you came
    const hrefs = await page.$$eval(".tabbar a", (els) => els.map((e) => e.getAttribute("href")));
    check("the tabs are real links, and so are Settings (the avatar) and the day's activity", hrefs.join(" ") === "./ #train #progress #health" && (await page.getAttribute("#settingsBtn", "href")) === "#settings" && (await page.getAttribute("#homeActivity", "href")) === "#health", hrefs.join(" "));
    const entries = await page.evaluate(() => history.length);
    await openTab(page, "progress");
    check("Progress: its own address, and its tab marked current", page.url().endsWith("/#progress") && (await page.getAttribute("#tabProgress", "aria-current")) === "page" && (await page.getAttribute("#tabHome", "aria-current")) === null, page.url());
    await page.goBack();
    await page.waitForSelector("#homeView");
    check("Back from a tab returns to Home (it used to close the app)", (await page.locator("#homeView").isVisible()) && !page.url().includes("#"), page.url());
    await page.goForward();
    await page.waitForSelector("#dashView");
    check("Forward opens Progress again", page.url().endsWith("/#progress"));
    await openTab(page, "health");
    check("one tab to another replaces it: no pile of entries", page.url().endsWith("/#health") && (await page.evaluate(() => history.length)) === entries + 1, page.url());
    await page.goBack();
    await page.waitForSelector("#homeView");
    check("so Back from the second tab goes to Home, not the first", !page.url().includes("#"), page.url());
    await page.goForward();
    await page.waitForSelector("#healthView");
    await openTab(page, "home");
    await until(() => !page.url().includes("#"));
    check("the Home tab steps back rather than adding an entry", (await page.locator("#homeView").isVisible()) && (await page.evaluate(() => history.length)) === entries + 1, page.url());
    await page.goForward();
    await page.waitForSelector("#healthView");
    check("after the Home tab, Forward still reopens the tab you left", page.url().endsWith("/#health"));

    // a page under a tab: its own address, a back arrow, no tabs; Back returns to the tab
    await page.goto(base + "#health/sleep");
    await page.waitForSelector("#healthView #hRange");
    check("a Health page: its title, a back arrow and no tabs", (await page.textContent("#screenTitle")) === "Sleep" && (await page.locator("#backBtn").isVisible()) && (await page.locator(".tabbar").count()) === 0);
    await page.click("#backBtn");
    await page.waitForSelector(".tabbar");
    check("its back arrow goes to Health", page.url().endsWith("/#health") && (await page.textContent("#screenTitle")) === "Health", page.url());

    // Train: the selected day is announced as pressed, and keyboard focus on another day doesn't look the same
    await openTab(page, "train");
    const pressed = await page.$$eval("#dayChips .dchip", (els) => els.map((e) => e.getAttribute("aria-pressed")));
    check("the selected day is marked pressed for screen readers", pressed.filter((p) => p === "true").length === 1 && pressed[2] === "true", pressed.join(","));
    await page.focus("#dayChips .dchip:nth-child(1)");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    const rings = await page.evaluate(() => {
      const o = (e) => ({ c: getComputedStyle(e).outlineColor, s: getComputedStyle(e).outlineStyle, w: getComputedStyle(e).outlineWidth, off: getComputedStyle(e).outlineOffset });
      return { focused: o(document.activeElement), selected: o(document.querySelector("#dayChips .dchip.sel")), same: document.activeElement === document.querySelector("#dayChips .dchip.sel") };
    });
    check(
      "keyboard focus on another day: a 2px brand focus ring, set off by 2px; the selected day has none",
      !rings.same && rings.focused.c === "rgb(194, 65, 12)" && rings.focused.s === "solid" && rings.focused.w === "2px" && rings.focused.off === "2px" && rings.selected.s === "none",
      JSON.stringify(rings),
    );

    // the warm-up row's focus ring isn't clipped by its card
    await page.focus("#wuToggle");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const wu = await page.evaluate(() => ({ overflow: getComputedStyle(document.querySelector(".wu")).overflow, offset: getComputedStyle(document.querySelector("#wuToggle")).outlineOffset, style: getComputedStyle(document.querySelector("#wuToggle")).outlineStyle }));
    check("warm-up toggle: its focus ring shows inside the card", wu.overflow === "visible" && wu.offset === "-2px" && wu.style === "solid", JSON.stringify(wu));

    // hover and touch
    const look = (e) => `${getComputedStyle(e).backgroundColor} ${getComputedStyle(e).filter}`;
    const before = await page.$eval("#startBtn", look);
    await page.hover("#startBtn");
    await page.waitForTimeout(200);
    const after = await page.$eval("#startBtn", look);
    check("buttons change colour under the mouse", before !== after, `${before} → ${after}`);
    check("taps don't wait for a double-tap zoom", (await page.$eval("#startBtn", (e) => getComputedStyle(e).touchAction)) === "manipulation" && (await page.$eval("#dayChips .dchip", (e) => getComputedStyle(e).touchAction)) === "manipulation");

    // the plan editor: opened from Settings (the avatar, here on Train), Back saves and returns there
    await openTab(page, "settings");
    check("Settings is a page with a back arrow to the tab it came from, and no tabs", page.url().endsWith("/#settings") && (await page.getAttribute("#backBtn", "aria-label")) === "Back to Train" && (await page.locator(".tabbar").count()) === 0, page.url());
    check("Edit plan is a link to #plan", (await page.getAttribute("#planBtn", "href")) === "#plan");
    await page.click("#planBtn");
    await page.waitForSelector("#planView");
    check("Edit plan has its own address and a back arrow", page.url().endsWith("/#plan") && (await page.locator("#planView").isVisible()) && (await page.locator("#backBtn").isVisible()), page.url());
    await page.fill("#pe_tempo", "4:0:1:0");
    await page.goBack();
    await page.waitForSelector("#settingsView");
    await until(() => db.plan?.tempo === "4:0:1:0");
    check("Back from the plan editor returns to Settings and saves the plan", page.url().endsWith("/#settings") && db.plan?.tempo === "4:0:1:0", page.url());
    await page.click("#backBtn");
    await page.waitForSelector("#trainView");
    check("Settings' back arrow returns to the tab it was opened from", page.url().endsWith("/#train"), page.url());
    check("the edited plan shows in Train", /4:0:1:0/.test(await page.textContent("#tempoNote")));
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // ---------- The avatar for Settings, in the same place on every tab ----------
  {
    const { ctx, page } = await open(browser, base, { auth, db: { logs: {}, plan: {} } });
    await ready(page);
    // The avatar opens Settings from the same spot on every tab.
    const spots = [];
    for (const tab of ["home", "train", "progress", "health"]) {
      await openTab(page, tab);
      await page.evaluate(settled); // the view's fade-in moves it a few pixels
      const b = await page.locator("#settingsBtn").boundingBox();
      spots.push(b ? `${Math.round(b.x)},${Math.round(b.y)}` : "none");
    }
    check("every tab has the avatar for Settings, in the same place", spots.every((s) => s !== "none" && s === spots[0]), spots.join(" | "));

    await ctx.close();
  }
}

// Opening a screen from outside the app's own taps: its address, a home-screen shortcut, and the Android widget.
async function fromOutside({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000041", "2026-08-26T05:00:00Z", "t@example.com");

  // ---------- Opening a screen from its address ----------
  {
    const db = { logs: logs(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db, url: base + "#dashboard" });
    await page.waitForSelector("#dashView", { timeout: 15000 });
    check("the old #dashboard address opens Progress after sign-in", (await page.locator("#dashWeight").isVisible()) && (await page.getAttribute("#tabProgress", "aria-current")) === "page");
    await openTab(page, "home");
    await until(() => !page.url().includes("#"));
    check("Home from there cleans the address", (await page.locator("#homeView").isVisible()) && !page.url().includes("#"), page.url());
    await ctx.close();
  }
  {
    const db = { logs: logs(), plan: null, health: { "2026-09-23": { steps: 8421, sleepMin: 432 } } };
    const { ctx, page } = await open(browser, base, { auth, db, url: base + "#health/steps" });
    await page.waitForSelector("#healthView #hChart", { timeout: 15000 });
    check("a link to a Health page opens it after sign-in", (await page.textContent("#screenTitle")) === "Steps");
    await page.goBack();
    await page.waitForSelector(".tabbar");
    check("Back from it goes to Health, then Home, as if you'd tapped your way there", page.url().endsWith("/#health") && (await page.locator("#activity").isVisible()), page.url());
    await page.goBack();
    await page.waitForSelector("#homeView");
    check("…and then Home", !page.url().includes("#"), page.url());
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // --- a home-screen shortcut opens Train straight at the weight field
  {
    const db = { logs: logs(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db, url: base + "?go=weight" });
    await page.waitForSelector("#trainView", { timeout: 15000 });
    await until(async () => page.evaluate(() => document.activeElement?.id === "weight"));
    check("Log weight shortcut opens Train and focuses weight", await page.evaluate(() => document.activeElement?.id === "weight"));
    check("shortcut parameter removed from the address, which is Train's", !page.url().includes("go=") && page.url().endsWith("/#train"), page.url());
    await page.goBack();
    await page.waitForSelector("#homeView");
    check("with Home behind it: Back goes Home", !page.url().includes("#"), page.url());
    check("no console errors (shortcut)", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // --- the Android widget's taps (native/app.ts turns one into this window event): one that starts the app comes
  // before sign-in is known, and one can come while another tab is open
  {
    const db = { logs: logs(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db, url: "" });
    await page.addInitScript(() => {
      // A cold start: the tap is sent the moment the app listens for it, before sign-in has come back.
      const add = window.addEventListener;
      window.addEventListener = function (type, ...rest) {
        add.call(this, type, ...rest);
        if (type !== "gymlog:go" || window.__goSent) return;
        window.__goSent = true;
        window.dispatchEvent(new CustomEvent("gymlog:go", { detail: "weight" }));
      };
    });
    await page.goto(base);
    await page.waitForSelector("#trainView", { timeout: 15000 });
    const focused = () => page.evaluate(() => document.activeElement?.id);
    await until(async () => (await focused()) === "weight");
    check("widget's Log weight, starting the app, opens Train at weight", (await focused()) === "weight", await focused());
    await openTab(page, "progress");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("gymlog:go", { detail: "steps" })));
    await until(async () => (await focused()) === "steps");
    check("widget's Log steps, from Progress, opens Train at steps", (await page.locator("#trainView").isVisible()) && (await focused()) === "steps", await focused());
    check("no console errors (widget taps)", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }
}

// Moving between screens (lib/pageTransition.ts, shell.css), with the browser's view transitions on as on a phone:
// a page opened deeper slides in from the right, Back slides it out again, tabs crossfade, nothing animates twice,
// and with Reduce motion on the screen just changes.
async function moving({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-0000000000e1", "2026-08-26T05:00:00Z", "t@example.com");
  const { ctx, page } = await open(browser, base, { auth, db: { logs: {}, plan: {} }, transitions: true });
  await ready(page);
  check("the browser can slide screens, and says so on <html>", (await page.evaluate(() => typeof document.startViewTransition === "function" && "vt" in document.documentElement.dataset)) === true);

  // Deeper: Settings slides in from the right over Home, which drifts left and dims.
  await watch(page);
  await page.click("#settingsBtn");
  await page.waitForSelector("#settingsView");
  let seen = await moves(page);
  check(
    "opening Settings slides it in from the right over Home",
    seen.includes("forward pageIn ::view-transition-new(root)") && seen.includes("forward pageAway ::view-transition-old(root)"),
    seen.join(" | "),
  );
  check("and the screen's own fade-in doesn't run as well", (await page.$eval("#settingsView", (e) => getComputedStyle(e).animationName)) === "none");

  // Back: the same, in reverse.
  await watch(page);
  await page.click("#backBtn");
  await page.waitForSelector("#homeView");
  seen = await moves(page);
  check("Back slides it out to the right, Home coming back from the left", seen.includes("back pageOut ::view-transition-old(root)") && seen.includes("back pageBack ::view-transition-new(root)"), seen.join(" | "));

  // Across the tabs: a crossfade, no slide.
  await watch(page);
  await page.click("#tabHealth");
  await page.waitForSelector("#healthView");
  seen = await moves(page);
  check("switching tabs crossfades, without sliding", seen.some((m) => m.startsWith("across ")) && !seen.some((m) => /page(In|Out|Away|Back)/.test(m)), seen.join(" | "));

  // Reduce motion: the screen just changes.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await watch(page);
  await openTab(page, "train");
  seen = await moves(page);
  check("with Reduce motion on, screens change without moving", seen.length === 0, seen.join(" | "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
