// First run: a new account (nothing logged, no plan saved) chooses a plan before Today, blank or a 3, 4 or 5-day
// template, and never sees Today on a plan that isn't its own first. An account with logs and no saved plan goes
// to Today on the default plan, as before. And the plan editor can start over from a template.
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { HOST, flat, open, openTab, planDone, ready, session, shot, until } from "./harness.mjs";

const template = (id) => JSON.parse(fs.readFileSync(new URL(`../../src/data/templates/${id}.json`, import.meta.url), "utf8"));
const NAMES = "Blank plan|Full body, 3 days|Upper and lower, 4 days|Five-day split";
const day = (steps) => ({ exercises: {}, warmup: [], cardio: false, steps, weight: null, note: "" });

/** Records in the page which of these screens were ever on show, however briefly. */
const watchScreens = (page) =>
  page.addInitScript(() => {
    window.__shown = {};
    new MutationObserver(() => {
      for (const id of ["appView", "chooseView"]) if (document.getElementById(id)?.hidden === false) window.__shown[id] = true;
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
  });

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
  // ---------- A new account: the plan picker, then Today on the plan it picked ----------
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
    const waiting = await page.evaluate(() => ["bootView", "appView", "chooseView"].map((id) => !document.getElementById(id).hidden));
    check("until Supabase says whether the account has a plan: the loading placeholder, not Today", waiting.join() === "true,false,false", waiting.join());
    release();
    await page.waitForSelector("#chooseView:not([hidden])", { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    check("a new account sees Choose a plan instead of Today, with no tabs", (await flat(page.locator("#chooseView h2"))) === "Choose a plan" && (await page.locator("#appView").isHidden()) && (await page.locator(".tabbar").count()) === 0);
    check("Today never showed first", !(await page.evaluate(() => window.__shown.appView)));
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
    const lifts = await page.$$eval("#session ul.ex:not(.cardio) .nm", (els) => els.map((e) => e.textContent.trim()));
    check(
      "picking one lands on Today with that plan's session for the day (Wednesday: Full body B)",
      (await page.locator("#chooseView").isHidden()) && (await page.textContent("#session h2")) === "Full body B" && lifts.join("|") === template("full-body-3").days[2].exercises.map((x) => x.name).join("|"),
      lifts.join("|"),
    );
    check("its week shows in the strip: Monday Full body A, Tuesday Rest", (await page.locator("#week .dchip").nth(0).getAttribute("aria-label")).includes(", Full body A") && (await page.locator("#week .dchip").nth(1).getAttribute("aria-label")).includes(", Rest"));
    check("no knee scores and no tempo note: they aren't part of this plan", (await page.locator("[data-knee]").count()) === 0 && (await page.locator("#tempoNote").isHidden()));
    await until(() => db.plan != null);
    check("the choice is saved as the account's plan", isDeepStrictEqual(db.plan, template("full-body-3")) && db.writes.plans === 1, JSON.stringify(db.plan)?.slice(0, 200));
    await shot(page, "firstrun-today", { fullPage: true });

    // The next launch: the phone has the account's plan, so Today doesn't wait on Supabase's answer about it.
    const releaseAgain = await holdPlan(page);
    await page.reload();
    await ready(page);
    check("the next launch goes straight to Today on the chosen plan, without waiting to hear about it", (await page.textContent("#session h2")) === "Full body B" && !(await page.evaluate(() => window.__shown.chooseView)));
    releaseAgain();
    await page.waitForTimeout(300);
    check("and stays there once Supabase answers", (await page.locator("#appView").isVisible()) && !(await page.evaluate(() => window.__shown.chooseView)));
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

  // ---------- An account with logs and no saved plan: Today on the default plan, as before ----------
  {
    const db = { logs: { "2026-09-22": day(6000) }, plan: null };
    const { ctx, page } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000073"), db, url: null });
    await watchScreens(page);
    await page.goto(base);
    await ready(page);
    check("an account with logs but no saved plan: Today on the default plan, never the picker", (await page.textContent("#session h2")) === "Legs" && !(await page.evaluate(() => window.__shown.chooseView)));
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
    await page.waitForSelector("#planView:not([hidden])");
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

    page.removeAllListeners("dialog");
    let asked = "";
    page.once("dialog", (d) => ((asked = d.message()), d.dismiss()));
    await page.click('#peTemplates [data-template="upper-lower-4"]');
    await until(() => asked !== "");
    check("it asks first, saying what's replaced and what's kept", asked === "Replace your sessions, lifts, warm-ups and tempo with “Upper and lower, 4 days”? Your goals and the days you’ve already logged are kept.", asked);
    check("No leaves the plan as it was", (await page.locator("#planDays .dchip").first().getAttribute("aria-label")) === "Edit Mon, Push" && db.plan.days[0].name === "Push");

    page.once("dialog", (d) => d.accept());
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
    page.on("dialog", (d) => d.accept());
    await planDone(page);
    await openTab(page, "today");
    check("Today follows: Wednesday is now a rest day, Monday Upper A", /Rest day/.test(await page.textContent("#liftPill")) && (await page.locator("#week .dchip").first().getAttribute("aria-label")).includes(", Upper A"));
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }
}
