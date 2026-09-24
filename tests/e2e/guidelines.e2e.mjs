// Vercel's Web Interface Guidelines: navigation that the Back button understands, landmarks and a skip
// link, focus rings you can see, long names, empty states, asking before replacing data, and the sticky
// sync bar keeping clear of a focused field.
import fs from "node:fs";
import { K, flat, open, ready, session, until } from "./harness.mjs";

const PLAN = JSON.parse(fs.readFileSync(new URL("../../src/data/plan.json", import.meta.url), "utf8"));

function logs() {
  const l = {};
  for (let n = 0; n <= 28; n++) l[K(n)] = { exercises: {}, warmup: [], cardio: false, steps: 8000, weight: Math.round((84 - 0.1 * n) * 10) / 10, note: "" };
  l[K(21)].exercises["Leg Press"] = { done: true, kg: 45, sets: [{ reps: 10, kg: 45 }, { reps: 10, kg: 45 }, { reps: 8, kg: 45 }] };
  return l;
}

export default async function guidelines({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000041", "2026-08-26T05:00:00Z", "t@example.com");

  // ---------- A mouse and keyboard: landmarks, focus, hover, and views in the address ----------
  {
    const db = { logs: logs(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db, mobile: false });
    await ready(page);
    const land = await page.evaluate(() => ({
      main: document.querySelectorAll("main").length,
      nav: document.querySelector("nav#menu")?.getAttribute("aria-label"),
      haspopup: document.querySelector("#menuBtn").getAttribute("aria-haspopup"),
      controls: document.querySelector("#menuBtn").getAttribute("aria-controls"),
    }));
    check("one main landmark; the menu is a labelled nav; Menu is a disclosure, not a popup menu", land.main === 1 && land.nav === "Menu" && land.haspopup === null && land.controls === "menu", JSON.stringify(land));
    await page.keyboard.press("Tab");
    const skip = await page.evaluate(() => ({ cls: document.activeElement.className, w: document.activeElement.getBoundingClientRect().width, text: document.activeElement.textContent }));
    check("the first Tab shows a Skip to content link", /\bskip\b/.test(skip.cls) && skip.w > 40 && skip.text === "Skip to content", JSON.stringify(skip));
    await page.keyboard.press("Enter");
    check("the skip link moves focus to the main content, without changing the address", (await page.evaluate(() => document.activeElement.id)) === "main" && !page.url().includes("#"), page.url());
    check("the skip link hides again once focus moves on", (await page.$eval(".skip", (e) => e.getBoundingClientRect().width)) <= 1);

    // the selected day is announced as pressed, and keyboard focus on another day doesn't look the same
    const pressed = await page.$$eval("#week .dchip", (els) => els.map((e) => e.getAttribute("aria-pressed")));
    check("the selected day is marked pressed for screen readers", pressed.filter((p) => p === "true").length === 1 && pressed[2] === "true", pressed.join(","));
    await page.focus("#week .dchip:nth-child(1)");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    const rings = await page.evaluate(() => {
      const c = (e) => getComputedStyle(e).outlineColor;
      return { focused: c(document.activeElement), selected: c(document.querySelector("#week .dchip.sel")), same: document.activeElement === document.querySelector("#week .dchip.sel") };
    });
    check("keyboard focus on another day: ink focus ring, the selected day's ring turns grey", !rings.same && rings.focused === "rgb(21, 23, 27)" && rings.selected === "rgb(138, 145, 156)", JSON.stringify(rings));

    // the warm-up row's focus ring isn't clipped by its card
    await page.focus("#wuToggle");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const wu = await page.evaluate(() => ({ overflow: getComputedStyle(document.querySelector(".wu")).overflow, offset: getComputedStyle(document.querySelector("#wuToggle")).outlineOffset, style: getComputedStyle(document.querySelector("#wuToggle")).outlineStyle }));
    check("warm-up toggle: its focus ring shows inside the card", wu.overflow === "visible" && wu.offset === "-2px" && wu.style === "solid", JSON.stringify(wu));

    // hover and touch
    const before = await page.$eval("#todayB", (e) => getComputedStyle(e).backgroundColor);
    await page.hover("#todayB");
    await page.waitForTimeout(200);
    const after = await page.$eval("#todayB", (e) => getComputedStyle(e).backgroundColor);
    check("buttons change colour under the mouse", before !== after, `${before} → ${after}`);
    check("taps don't wait for a double-tap zoom", (await page.$eval("#todayB", (e) => getComputedStyle(e).touchAction)) === "manipulation");

    // the dashboard has an address, and Back returns to Today
    check("view links are real links", (await page.getAttribute("#dashBtn", "href")) === "#dashboard" && (await page.getAttribute("#toDash", "href")) === "#dashboard");
    await page.click("#dashBtn");
    check("Dashboard: its own address, and the header link leads back to Today", page.url().endsWith("/#dashboard") && (await page.locator("#dashView").isVisible()) && (await page.getAttribute("#dashBtn", "href")) === "./", page.url());
    await page.goBack();
    await page.waitForSelector("#appView:not([hidden])");
    check("Back on the dashboard returns to Today (it used to close the app)", (await page.locator("#appView").isVisible()) && !page.url().includes("#"), page.url());
    await page.goForward();
    await page.waitForSelector("#dashView:not([hidden])");
    check("Forward opens the dashboard again", page.url().endsWith("/#dashboard"));
    const entries = await page.evaluate(() => history.length);
    await page.click("#dashBtn");
    await until(() => !page.url().includes("#"));
    const hist = await page.evaluate(() => ({ len: history.length, view: history.state?.gymView ?? null }));
    check("the Today link steps back rather than piling up entries", (await page.locator("#appView").isVisible()) && !page.url().includes("#") && hist.len === entries && hist.view === null, JSON.stringify({ entries, ...hist }));
    await page.goForward();
    await page.waitForSelector("#dashView:not([hidden])");
    check("after the Today link, Forward still reopens the dashboard", page.url().endsWith("/#dashboard"));
    await page.goBack();
    await page.waitForSelector("#appView:not([hidden])");

    // the plan editor: Back saves and returns to Today
    await page.click("#menuBtn");
    check("Edit plan is a link to #plan", (await page.getAttribute("#planBtn", "href")) === "#plan");
    await page.click("#planBtn");
    check("Edit plan has its own address", page.url().endsWith("/#plan") && (await page.locator("#planView").isVisible()), page.url());
    await page.fill("#pe_tempo", "4:0:1:0");
    await page.goBack();
    await page.waitForSelector("#appView:not([hidden])");
    await until(() => db.plan?.tempo === "4:0:1:0");
    check("Back from the plan editor returns to Today and saves the plan", (await page.locator("#appView").isVisible()) && db.plan?.tempo === "4:0:1:0" && /4:0:1:0/.test(await page.textContent("#tempoNote")));
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // ---------- Opening the dashboard from its address ----------
  {
    const db = { logs: logs(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db, url: base + "#dashboard" });
    await page.waitForSelector("#dashView:not([hidden])", { timeout: 15000 });
    check("a link to #dashboard opens the dashboard after sign-in", await page.locator("#dashWeight").isVisible());
    await page.click("#dashBtn");
    check("Today from there cleans the address", (await page.locator("#appView").isVisible()) && !page.url().includes("#"), page.url());
    await ctx.close();
  }

  // ---------- Long names, no warm-ups, no tempo ----------
  {
    const plan = JSON.parse(JSON.stringify(PLAN));
    plan.days[2].name = "Legsandglutesandcalvesdayextralongname";
    plan.days[2].exercises[0].name = "Supercalifragilisticexpialidocious-machine-squat";
    plan.warmups = [];
    plan.tempo = "";
    const l = logs();
    l["2026-09-23"].exercises["Leg Press"] = { swap: "Smithmachinesquatwithheelsraisedonplatesandalongname", done: false, sets: [] };
    l["2026-09-23"].exercises["Leg Extension"] = { skipped: true, reason: "machinewasbusyforthewholehoursoIskippeditentirely", done: false };
    const db = { logs: l, plan };
    const { ctx, page } = await open(browser, base, { auth, db, width: 360, height: 800 });
    await ready(page);
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check("very long names wrap: no sideways scroll at 360px", w.sw <= w.cw, JSON.stringify(w));
    check("a plan with no warm-ups shows no warm-up card", (await page.locator(".wu").count()) === 0);
    check("no tempo, no empty tempo note", await page.locator("#tempoNote").isHidden());
    await ctx.close();
  }

  // ---------- The menu's message, and importing over days already logged ----------
  {
    const db = { logs: logs(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db });
    await ready(page);
    await page.click("#menuBtn");
    const gap = await page.evaluate(() => {
      const m = document.querySelector("#menu"), rows = m.querySelectorAll(".menu-row");
      return Math.round(m.getBoundingClientRect().bottom - rows[rows.length - 1].getBoundingClientRect().bottom - parseFloat(getComputedStyle(m).paddingBottom));
    });
    check("menu: no blank line under the buttons while there's no message", gap <= 1, `${gap}px`);
    check("menu: export and import results are announced", (await page.getAttribute("#menuMsg", "role")) === "status");
    const file = (rows) => ({ name: "gym-log.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(rows)) });
    const changed = [{ day: "2026-09-22", data: { ...db.logs["2026-09-22"], steps: 1234 } }, { day: "2026-07-01", data: { exercises: {}, warmup: [], cardio: true, steps: 5000, weight: null, note: "" } }];
    page.removeAllListeners("dialog");
    let asked = "";
    page.once("dialog", (d) => ((asked = d.message()), d.dismiss()));
    await page.setInputFiles("#importFile", file(changed));
    await until(async () => (await page.textContent("#menuMsg")) !== "");
    check("import: asks before replacing a day already logged", /different entries for 1 day you’ve already logged/.test(asked), asked);
    check("import: cancelling changes nothing", (await page.textContent("#menuMsg")) === "Import cancelled. Nothing changed." && db.logs["2026-09-22"].steps === 8000 && !db.logs["2026-07-01"]);
    page.once("dialog", (d) => d.accept());
    await page.setInputFiles("#importFile", file(changed));
    await until(() => db.logs["2026-07-01"] != null);
    check("import: once accepted, the file's days go in", (await page.textContent("#menuMsg")) === "Imported 2 days." && db.logs["2026-09-22"].steps === 1234);
    page.once("dialog", () => (asked = "asked again"));
    await page.setInputFiles("#importFile", file(changed));
    await until(async () => (await page.textContent("#menuMsg")) === "Imported 2 days.");
    check("import: the same file again doesn't ask", asked !== "asked again");
    await page.setInputFiles("#importFile", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await until(async () => /couldn’t be imported/.test(await page.textContent("#menuMsg")));
    check("import: a wrong file says what to do next", /Choose a \.json file exported from Gym Log\.$/.test(await page.textContent("#menuMsg")), await page.textContent("#menuMsg"));
    page.on("dialog", (d) => d.accept());
    await page.click("#menuBtn");

    // removing a set asks only when the set has numbers in it
    await page.click('[data-addset="0"]');
    let removeAsk = "";
    page.removeAllListeners("dialog");
    page.on("dialog", (d) => ((removeAsk = d.message()), d.accept()));
    await page.click('[data-rmset="0"]');
    check("− Set on an empty set removes it without asking", removeAsk === "" && (await page.locator("#s0_3_r").count()) === 0);
    await page.click('[data-addset="0"]');
    await page.fill("#s0_3_r", "10");
    await page.fill("#s0_3_k", "20");
    page.removeAllListeners("dialog");
    page.once("dialog", (d) => ((removeAsk = d.message()), d.dismiss()));
    await page.click('[data-rmset="0"]');
    check("− Set on a set with numbers asks first, and No keeps it", removeAsk === "Remove set 4 (10 × 20 kg)?" && (await page.locator("#s0_3_r").count()) === 1, removeAsk);
    page.on("dialog", (d) => d.accept());
    await ctx.close();
  }

  // ---------- The sync bar keeps clear of the field you Tab to ----------
  {
    const db = { logs: logs(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db, mobile: false });
    await ready(page);
    db.failWrites = true;
    await page.fill("#s0_0_r", "10");
    await page.waitForSelector("#syncBar:not([hidden])", { timeout: 8000 });
    await page.evaluate(() => {
      const el = document.querySelector("#s1_0_r");
      window.scrollBy(0, el.getBoundingClientRect().top - 150);
      el.focus({ preventScroll: true });
    });
    await page.keyboard.press("Shift+Tab");
    const r = await page.evaluate(() => {
      const f = document.activeElement.getBoundingClientRect(), b = document.querySelector("#syncBar").getBoundingClientRect();
      return { focused: document.activeElement.getAttribute("aria-label"), top: Math.round(f.top), barBottom: Math.round(b.bottom) };
    });
    check("Shift+Tab to a control under the sync bar scrolls it into view", r.top >= r.barBottom, JSON.stringify(r));

    // with a mouse, skipping a lift puts the cursor in the reason box
    await page.click('[data-more="1"]');
    await page.click('[data-skip="1"]');
    await until(() => page.evaluate(() => document.activeElement?.dataset.reason !== undefined));
    check("with a mouse, skipping focuses the reason box", await page.evaluate(() => document.activeElement?.dataset.reason !== undefined));
    await ctx.close();
  }

  // ---------- Sign-in and the page's colours ----------
  {
    const { ctx, page } = await open(browser, base, { auth: null, scheme: "dark" });
    await page.waitForSelector("#loginView:not([hidden])");
    const email = await page.$eval("#email", (e) => ({ name: e.name, spell: e.getAttribute("spellcheck"), auto: e.autocomplete }));
    check("sign-in: the email box has a name, no spellcheck, email autofill", email.name === "email" && email.spell === "false" && email.auto === "email", JSON.stringify(email));
    check("sign-in: the button says what it does, in the second person", (await flat(page.locator("#loginBtn"))) === "Send sign-in link" && !/\bwe\b/i.test(await flat(page.locator("#loginView"))));
    const colours = await page.evaluate(() => ({ meta: document.querySelector('meta[name="theme-color"][media*="dark"]').content, bg: getComputedStyle(document.body).backgroundColor }));
    check("dark mode: the browser bar matches the page", colours.meta === "#121417" && colours.bg === "rgb(18, 20, 23)", JSON.stringify(colours));
    check("the app's name isn't machine-translated", (await page.getAttribute("h1", "translate")) === "no");
    await ctx.close();
  }
}
