// First run: a new account (nothing logged, no plan saved) chooses a plan before Home, blank or a 3, 4 or 5-day
// template, and never sees Home or Train on a plan that isn't its own first. An account with logs and no saved plan
// goes to Home on the default plan, as before. And the plan editor can start over from a template.
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { HOST, answerAsk, flat, lastAsked, open, openSetting, openTab, planDone, ready, session, shot, until, TAB_VIEWS } from "./harness.mjs";

const template = (id) => JSON.parse(fs.readFileSync(new URL(`../../src/data/templates/${id}.json`, import.meta.url), "utf8"));
const NAMES = "Blank plan|Full body, 3 days|Upper and lower, 4 days|Five-day split";
const day = (steps) => ({ exercises: {}, warmup: [], cardio: false, steps, weight: null, note: "" });

/** Records in the page which of these screens were ever on show, however briefly: `app` for Home or Train (the old
 *  Today, mounted only while shown), `chooseView` for the plan picker (always there, hidden when not in use). */
const watchScreens = (page) =>
  page.addInitScript(() => {
    window.__shown = {};
    new MutationObserver(() => {
      if (document.getElementById("homeView") || document.getElementById("trainView")) window.__shown.app = true;
      if (document.getElementById("chooseView")?.hidden === false) window.__shown.chooseView = true;
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
  });
/** Home or Train is on screen. */
const inApp = (page) => page.evaluate(() => !!(document.getElementById("homeView") || document.getElementById("trainView")));
/** The lifts in Train's session card, by the names their rows show. */
const trainLifts = (page) => page.$$eval("#liftRows .lrow-main:not(#cardioRow) .row-tt", (els) => els.map((e) => e.textContent.trim()));

/** Holds back Supabase's answer about the account's saved plan until the returned function is called. */
async function holdPlan(page) {
  let release;
  const held = new Promise((r) => (release = r));
  await page.route(
    (u) => u.href.startsWith(HOST) && u.pathname === "/rest/v1/plans",
    async (route) => {
      if (route.request().method() === "GET") await held;
      await route.fallback();
    },
  );
  return release;
}

export default async function firstRun({ browser, base, check }) {
  // ---------- A new account: the plan picker, then Home on the plan it picked ----------
  {
    const db = { logs: {}, plan: null };
    const auth = session("00000000-0000-4000-8000-000000000071", "2026-09-23T06:00:00Z", "new@example.com");
    const { ctx, page } = await open(browser, base, { auth, db, width: 360, height: 800, url: null });
    await watchScreens(page);
    const release = await holdPlan(page);
    const logsBack = page.waitForResponse((r) => new URL(r.url()).pathname === "/rest/v1/logs");
    await page.goto(base);
    await logsBack;
    await page.waitForTimeout(250);
    const waiting = await page.evaluate(() => [!document.getElementById("bootView").hidden, !!document.getElementById("homeView"), !document.getElementById("chooseView").hidden]);
    check("until Supabase says whether the account has a plan: the loading placeholder, not Home", waiting.join() === "true,false,false", waiting.join());
    release();
    await page.waitForSelector("#chooseView:not([hidden])", { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    check("a new account sees Choose a plan instead of Home, with no tabs", (await flat(page.locator("#chooseView h1"))) === "Choose a plan" && !(await inApp(page)) && (await page.locator(".tabbar").count()) === 0);
    check("Home never showed first", !(await page.evaluate(() => window.__shown.app)));
    const cards = await page.$$eval("#chooseView .tpl", (els) => els.map((e) => ({ name: e.querySelector("h3").textContent, sub: e.querySelector(".sub").textContent, id: e.querySelector("button").dataset.template })));
    check(
      "one card per template, blank first, each with a summary and a button",
      cards.map((c) => c.name).join("|") === NAMES && cards.map((c) => c.id).join() === "blank,full-body-3,upper-lower-4,five-day" && cards[1].sub === "3 days a week, 5 lifts a session: Monday, Wednesday and Friday.",
      JSON.stringify(cards),
    );
    const small = await page.$$eval("#chooseView button", (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h < 44));
    check("its buttons are at least 44px tall", small.length === 0, small.join(","));
    const named = await page
      .getByRole("button", { name: "Use this plan Upper and lower, 4 days", exact: true })
      .getAttribute("data-template", { timeout: 3000 })
      .catch(() => null);
    check("each button's name says which plan it uses", named === "upper-lower-4", String(named));
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check("it fits at 360px: no sideways scroll", w.sw <= w.cw, JSON.stringify(w));
    const words = (await flat(page.locator("#chooseView"))) + " " + (await flat(page.locator("#tagline")));
    check("its words have no em or en dash, and the tagline no longer promises a 5-day split", !/[\u2013\u2014]/.test(words) && !/5-day/.test(words), words);
    check("nothing is saved before a plan is chosen", db.writes.plans === 0 && db.plan === null);
    await shot(page, "firstrun-picker", { fullPage: true });

    await page.click('#chooseView [data-template="full-body-3"]');
    await ready(page);
    const homeName = await flat(page.locator("#todayName"));
    const homeKnee = await page.locator("[data-knee], #kneeNote").count();
    // Home's strip names each day's session in its label; Train has the day's lifts.
    const mon = await page.locator("#week .wd").nth(0).getAttribute("aria-label"), tue = await page.locator("#week .wd").nth(1).getAttribute("aria-label");
    await openTab(page, "train");
    const lifts = await trainLifts(page);
    check(
      "picking one lands on Home with that plan's session for the day (Wednesday: Full body B), its lifts in Train",
      (await page.locator("#chooseView").isHidden()) && homeName === "Full body B" && (await flat(page.locator("#sessName"))) === "Full body B" && lifts.join("|") === template("full-body-3").days[2].exercises.map((x) => x.name).join("|"),
      `${homeName} / ${lifts.join("|")}`,
    );
    check("its week shows in the strip: Monday Full body A, Tuesday Rest", mon.includes(", Full body A") && tue.includes(", Rest") && (await page.locator("#dayChips .dchip").nth(1).getAttribute("aria-label")).includes(", Rest"), `${mon} / ${tue}`);
    check("no knee scores and no tempo note: they aren't part of this plan", homeKnee === 0 && (await page.locator("[data-knee]").count()) === 0 && (await page.locator("#kneeCard").count()) === 0 && (await page.locator("#tempoNote").count()) === 0);
    await until(() => db.plan != null);
    check("the choice is saved as the account's plan", isDeepStrictEqual(db.plan, template("full-body-3")) && db.writes.plans === 1, JSON.stringify(db.plan)?.slice(0, 200));
    await shot(page, "firstrun-today", { fullPage: true });

    // The next launch: the phone has the account's plan, so Home doesn't wait on Supabase's answer about it.
    await openTab(page, "home");
    const releaseAgain = await holdPlan(page);
    await page.reload();
    await ready(page);
    check("the next launch goes straight to Home on the chosen plan, without waiting to hear about it", (await flat(page.locator("#todayName"))) === "Full body B" && !(await page.evaluate(() => window.__shown.chooseView)));
    releaseAgain();
    await page.waitForTimeout(300);
    check("and stays there once Supabase answers", (await page.locator("#homeView").isVisible()) && !(await page.evaluate(() => window.__shown.chooseView)));
    check("only the expected endpoints", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // ---------- The picker says who's signed in, and Sign out leaves without saving a plan ----------
  {
    const db = { logs: {}, plan: null };
    const { ctx, page } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000072", "2026-09-23T06:00:00Z", "other@example.com"), db });
    await page.waitForSelector("#chooseView:not([hidden])", { timeout: 15000 });
    check("the picker names the account", (await flat(page.locator("#chooseWho"))) === "other@example.com");
    await page.click("#chooseSignOut");
    await page.waitForSelector("#loginView:not([hidden])");
    check("Sign out goes back to the sign-in screen, and no plan was saved", (await page.locator("#chooseView").isHidden()) && db.writes.plans === 0);
    await ctx.close();
  }

  // ---------- Moving from another copy of Gym Log: Restore a backup, on the picker ----------
  const jsonFile = (v) => ({ name: "gym-log.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(v)) });
  {
    const db = { logs: {}, plan: null };
    const { ctx, page } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000075", "2026-09-23T06:00:00Z", "moving@example.com"), db });
    await page.waitForSelector("#chooseView:not([hidden])", { timeout: 15000 });
    const row = page.locator("#chooseView .tpl-list ~ .choose-row").first();
    const offer = `${await flat(row.locator(".sub"))} | ${await flat(row.locator("button"))}`;
    check("under the templates: Moving from another copy of Gym Log? Restore a backup", offer === "Moving from another copy of Gym Log? | Restore a backup" && (await row.locator("#chooseRestore").count()) === 1, offer);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 3000 }).catch(() => null), page.click("#chooseRestore")]);
    check("it opens the file picker for .json files, as Settings' Import does", !!chooser && (await chooser.element().getAttribute("accept")) === "application/json,.json");
    await chooser?.setFiles(jsonFile({ hello: "world" }));
    // "Restoring…" shows while the file is read; wait for what the picker says once it's done with it.
    await until(async () => !["", "Restoring…"].includes(await flat(page.locator("#chooseMsg"))));
    check(
      "a file that isn't a backup: the picker says why, in its own status line, and stays up",
      (await flat(page.locator("#chooseMsg"))) === "That file couldn’t be imported: it isn’t a Gym Log export. Choose a .json file exported from Gym Log." &&
        (await page.getAttribute("#chooseMsg", "role")) === "status" &&
        (await page.locator("#chooseView").isVisible()) &&
        !(await inApp(page)),
      await flat(page.locator("#chooseMsg")),
    );
    check("nothing is saved to plans before a choice, and no days", db.writes.plans === 0 && db.plan === null && db.writes.logs === 0);

    // The first exports, a list of days and no plan: the days come in, and the plan stays the default, unsaved
    await page.setInputFiles("#restoreFile", jsonFile([{ day: "2026-09-21", data: day(9000) }]));
    await page.waitForSelector("#settingsView", { timeout: 15000 });
    await until(() => db.logs["2026-09-21"] != null);
    check("an older export: its days restored, and Settings says so", (await page.textContent("#dataMsg")) === "Imported 1 day." && db.logs["2026-09-21"].steps === 9000, await page.textContent("#dataMsg"));
    const asked = await lastAsked(page);
    check("the picker's restore never asks, and a file without a plan saves none", asked === "" && db.writes.plans === 0 && db.plan === null, asked);
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }
  {
    const db = { logs: {}, plan: null };
    const { ctx, page } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000076", "2026-09-23T06:00:00Z", "backup@example.com"), db, url: null });
    await watchScreens(page);
    await page.goto(base);
    await page.waitForSelector("#chooseView:not([hidden])", { timeout: 15000 });
    // Offline: the days and the plan go in and wait to sync, but the Health Connect days need a connection.
    const backup = {
      format: "gymlog-backup",
      version: 1,
      exportedAt: "2026-09-20T08:00:00.000Z",
      plan: template("upper-lower-4"),
      logs: [{ day: "2026-09-21", data: { ...day(8000), exercises: { "Flat DB Press": { done: true, kg: 30, sets: [{ reps: 10, kg: 30 }] } } } }],
      healthDays: { "2026-09-22": { steps: 7000 } },
    };
    await ctx.setOffline(true);
    await page.setInputFiles("#restoreFile", jsonFile(backup));
    await page.waitForSelector("#settingsView", { timeout: 15000 });
    const partial = "Imported 1 day and the plan. The Health Connect days couldn’t be saved: import the file again when you’re online.";
    await until(async () => (await page.textContent("#dataMsg")) === partial);
    // Settings is a pushed screen: its header on top, no tab bar below. Export & backup unfolds by itself.
    const where = await page.evaluate(() => {
      const d = document.getElementById("setData").getBoundingClientRect(), bar = document.querySelector("header.push").getBoundingClientRect();
      return { top: Math.round(d.top), bottom: Math.round(d.bottom), barBottom: Math.round(bar.bottom), vh: innerHeight, focused: document.activeElement?.id, open: document.getElementById("setDataH").getAttribute("aria-expanded") };
    });
    check(
      "a backup leaves the picker for Settings, at Export & backup (open), in view and focused on what came in",
      where.top >= where.barBottom - 1 && where.bottom <= where.vh && where.focused === "dataMsg" && where.open === "true" && (await page.locator("#chooseView").isHidden()),
      JSON.stringify(where),
    );
    check("the partial result says what came in and what to do about the rest", (await page.textContent("#dataMsg")) === partial, await page.textContent("#dataMsg"));
    check("on the way, Home never showed, and the picker didn't come back", !(await page.evaluate(() => window.__shown.app)) && (await page.locator("#chooseView").isHidden()));
    await ctx.setOffline(false);
    await until(() => db.logs["2026-09-21"] != null && db.plan?.days?.[0]?.name === "Upper A", 10000);
    check("back online, the restored day and plan sync", db.logs["2026-09-21"]?.exercises["Flat DB Press"]?.kg === 30 && db.plan?.days?.[0]?.name === "Upper A", JSON.stringify(db.plan?.days?.map((d) => d.name)));
    check("and the partial result is still there to read", (await page.textContent("#dataMsg")) === partial && (await page.locator("#dataMsg").isVisible()), await page.textContent("#dataMsg"));
    // Settings is a pushed screen: its back chevron leaves it, for Home.
    await page.click("#backBtn");
    await page.waitForSelector(TAB_VIEWS); // Settings closes onto the tab it was opened from
    await openTab(page, "settings");
    await openSetting(page, "setData");
    check("once read and left, Settings doesn't show it again", (await page.textContent("#dataMsg")) === "", await page.textContent("#dataMsg"));
    await ctx.close();
  }

  // ---------- An account with logs and no saved plan: Home on the default plan, as before ----------
  {
    const db = { logs: { "2026-09-22": day(6000) }, plan: null };
    const { ctx, page } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000073"), db, url: null });
    await watchScreens(page);
    await page.goto(base);
    await ready(page);
    check("an account with logs but no saved plan: Home on the default plan, never the picker", (await flat(page.locator("#todayName"))) === "Legs" && !(await page.evaluate(() => window.__shown.chooseView)));
    check("and nothing is saved to its plan", db.writes.plans === 0 && db.plan === null);
    await ctx.close();
  }

  // ---------- Start from a template, in the plan editor ----------
  {
    const db = { logs: { "2026-09-21": day(9000) }, plan: null };
    const { ctx, page } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000074"), db });
    await ready(page);
    await openTab(page, "settings");
    await page.click("#planBtn");
    await page.waitForSelector("#planView");
    await page.fill("#pe_goal", "12000"); // a goal of the account's own, which a template keeps
    await until(() => db.plan?.stepGoal === 12000);
    check(
      "Start from a template sits next to Reset to the default plan, folded",
      (await flat(page.locator("#pe_tpl"))) === "Start from a template" && (await page.getAttribute("#pe_tpl", "aria-expanded")) === "false" && (await page.locator("#peTemplates").isHidden()) && (await page.locator("#pe_tpl + #pe_reset").count()) === 1,
    );
    await page.click("#pe_tpl");
    const names = await page.$$eval("#peTemplates .tpl h3", (els) => els.map((e) => e.textContent).join("|"));
    check("it lists the same templates as a new account's first screen", names === NAMES && (await page.locator("#peTemplates").isVisible()) && (await page.getAttribute("#pe_tpl", "aria-expanded")) === "true", names);
    await shot(page.locator("#planGeneral"), "firstrun-editor-templates");

    await answerAsk(page, "cancel");
    await page.click('#peTemplates [data-template="upper-lower-4"]');
    await until(async () => (await lastAsked(page)) !== "");
    const asked = await lastAsked(page);
    check("it asks first, saying what's replaced and what's kept", asked === "Replace your sessions, lifts, warm-ups and tempo with “Upper and lower, 4 days”? Your goals and the days you’ve already logged are kept.", asked);
    await until(async () => (await page.locator("#askDialog[open]").count()) === 0);
    check("No leaves the plan as it was", (await page.locator("#planDays .dchip").first().getAttribute("aria-label")) === "Edit Mon, Push" && db.plan.days[0].name === "Push");

    await page.click('#peTemplates [data-template="upper-lower-4"]');
    await until(() => db.plan?.days?.[0]?.name === "Upper A");
    const want = template("upper-lower-4");
    check(
      "Yes replaces the plan with the template's sessions, lifts, warm-ups and tempo, and saves it",
      isDeepStrictEqual(db.plan.days, want.days) && isDeepStrictEqual(db.plan.warmups, want.warmups) && db.plan.tempo === want.tempo,
      JSON.stringify(db.plan.days.map((d) => d.name)),
    );
    check("and keeps the goals", db.plan.stepGoal === 12000 && (await page.inputValue("#pe_goal")) === "12000");
    const chips = await page.$$eval("#planDays .dchip", (els) => els.map((e) => e.getAttribute("aria-label").replace(/^Edit \w+, /, "")).join("|"));
    check(
      "the editor shows the new plan, with the list folded again",
      chips === "Upper A|Lower A|Rest|Upper B|Lower B|Rest|Rest" && (await page.inputValue("#pe_name")) === "Rest" && (await page.locator("#peTemplates").isHidden()),
      chips,
    );
    await planDone(page);
    // Done goes back to Settings, and its back chevron to Home.
    await page.waitForSelector("#settingsView");
    await page.click("#backBtn");
    await page.waitForSelector(TAB_VIEWS); // Settings closes onto the tab it was opened from
    // Today in Home's week strip opens Train at today.
    await page.click("#week .wd.today");
    await page.waitForSelector("#trainView");
    check(
      "Train follows: Wednesday is now a rest day, Monday Upper A",
      (await flat(page.locator("#sessName"))) === "Rest day" && (await page.locator("#dayChips .dchip").first().getAttribute("aria-label")).includes(", Upper A"),
      await flat(page.locator("#sessName")),
    );
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }
}
