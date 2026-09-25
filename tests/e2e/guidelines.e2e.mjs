// Vercel's Web Interface Guidelines: tabs and pages the Back button understands, landmarks and a skip link,
// focus rings you can see, long names, empty states, asking before replacing data, a backup that restores an
// account, and the sticky sync bar keeping clear of a focused field.
import fs from "node:fs";
import { K, NOW, flat, open, openTab, ready, session, until } from "./harness.mjs";

export const covers = [
  "src/lib/healthView.ts",
  "src/components/health/HealthView.tsx",
  "src/components/health/HealthDetail.tsx",
  "src/components/health/Rings.tsx",
  "src/components/health/Bars.tsx",
  "src/components/health/Trend.tsx",
  "src/components/health/parts.tsx",
  "src/lib/scale.ts",
  "src/hooks/useChartWidth.ts",
  "src/components/shell/LoginView.tsx",
];

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
      banner: document.querySelectorAll("header.appbar h1").length,
      nav: document.querySelector("nav.tabbar")?.getAttribute("aria-label"),
      current: [...document.querySelectorAll(".tabbar [aria-current=page]")].map((e) => e.id),
    }));
    check("one main landmark, a header with the screen's name, the tabs a labelled nav with Today current", land.main === 1 && land.banner === 1 && land.nav === "Sections" && land.current.join() === "tabToday", JSON.stringify(land));
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

    // the tabs are links with addresses, and Back walks back the way you came
    const hrefs = await page.$$eval(".tabbar a", (els) => els.map((e) => e.getAttribute("href")));
    check("the tabs are real links", hrefs.join(" ") === "./ #health #progress #settings" && (await page.getAttribute("#toDash", "href")) === "#progress", hrefs.join(" "));
    const entries = await page.evaluate(() => history.length);
    await openTab(page, "progress");
    check("Progress: its own address, and its tab marked current", page.url().endsWith("/#progress") && (await page.getAttribute("#tabProgress", "aria-current")) === "page" && (await page.getAttribute("#tabToday", "aria-current")) === null, page.url());
    await page.goBack();
    await page.waitForSelector("#appView:not([hidden])");
    check("Back from a tab returns to Today (it used to close the app)", (await page.locator("#appView").isVisible()) && !page.url().includes("#"), page.url());
    await page.goForward();
    await page.waitForSelector("#dashView:not([hidden])");
    check("Forward opens Progress again", page.url().endsWith("/#progress"));
    await openTab(page, "health");
    check("one tab to another replaces it: no pile of entries", page.url().endsWith("/#health") && (await page.evaluate(() => history.length)) === entries + 1, page.url());
    await page.goBack();
    await page.waitForSelector("#appView:not([hidden])");
    check("so Back from the second tab goes to Today, not the first", !page.url().includes("#"), page.url());
    await page.goForward();
    await page.waitForSelector("#healthView:not([hidden])");
    await openTab(page, "today");
    await until(() => !page.url().includes("#"));
    check("the Today tab steps back rather than adding an entry", (await page.locator("#appView").isVisible()) && (await page.evaluate(() => history.length)) === entries + 1, page.url());
    await page.goForward();
    await page.waitForSelector("#healthView:not([hidden])");
    check("after the Today tab, Forward still reopens the tab you left", page.url().endsWith("/#health"));

    // a page under a tab: its own address, a back arrow, no tabs; Back returns to the tab
    check("with no Health Connect data, Health says where it comes from", /Gym Log Android app/.test(await flat(page.locator("#healthEmpty"))));
    await page.goto(base + "#health/sleep");
    await page.waitForSelector("#healthView:not([hidden])");
    check("a Health page: its title, a back arrow and no tabs", (await page.textContent("#screenTitle")) === "Sleep" && (await page.locator("#backBtn").isVisible()) && (await page.locator(".tabbar").count()) === 0);
    await page.click("#backBtn");
    await page.waitForSelector(".tabbar");
    check("its back arrow goes to Health", page.url().endsWith("/#health") && (await page.textContent("#screenTitle")) === "Health", page.url());

    // the plan editor: opened from Settings, Back saves and returns there
    await openTab(page, "settings");
    check("Edit plan is a link to #plan", (await page.getAttribute("#planBtn", "href")) === "#plan");
    await page.click("#planBtn");
    check("Edit plan has its own address and a back arrow, lit under Settings", page.url().endsWith("/#plan") && (await page.locator("#planView").isVisible()) && (await page.locator("#backBtn").isVisible()), page.url());
    await page.fill("#pe_tempo", "4:0:1:0");
    await page.goBack();
    await page.waitForSelector("#settingsView:not([hidden])");
    await until(() => db.plan?.tempo === "4:0:1:0");
    check("Back from the plan editor returns to Settings and saves the plan", page.url().endsWith("/#settings") && db.plan?.tempo === "4:0:1:0", page.url());
    await openTab(page, "today");
    check("the edited plan shows on Today", /4:0:1:0/.test(await page.textContent("#tempoNote")));
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // ---------- Opening a screen from its address ----------
  {
    const db = { logs: logs(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db, url: base + "#dashboard" });
    await page.waitForSelector("#dashView:not([hidden])", { timeout: 15000 });
    check("the old #dashboard address opens Progress after sign-in", (await page.locator("#dashWeight").isVisible()) && (await page.getAttribute("#tabProgress", "aria-current")) === "page");
    await openTab(page, "today");
    await until(() => !page.url().includes("#"));
    check("Today from there cleans the address", (await page.locator("#appView").isVisible()) && !page.url().includes("#"), page.url());
    await ctx.close();
  }
  {
    const db = { logs: logs(), plan: null, health: { "2026-09-23": { steps: 8421, sleepMin: 432 } } };
    const { ctx, page } = await open(browser, base, { auth, db, url: base + "#health/steps" });
    await page.waitForSelector("#healthView:not([hidden]) #hChart", { timeout: 15000 });
    check("a link to a Health page opens it after sign-in", (await page.textContent("#screenTitle")) === "Steps");
    await page.goBack();
    await page.waitForSelector(".tabbar");
    check("Back from it goes to Health, then Today, as if you'd tapped your way there", page.url().endsWith("/#health") && (await page.locator("#activity").isVisible()), page.url());
    await page.goBack();
    await page.waitForSelector("#appView:not([hidden])");
    check("…and then Today", !page.url().includes("#"), page.url());
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
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

  // ---------- Settings' message, and importing over days already logged ----------
  {
    const db = { logs: logs(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db });
    await ready(page);
    await openTab(page, "settings");
    const gap = await page.evaluate(() => Math.round(document.querySelector("#dataMsg").getBoundingClientRect().height));
    check("Settings: no blank row under Import while there's no message", gap === 0, `${gap}px`);
    check("Settings: export and import results are announced", (await page.getAttribute("#dataMsg", "role")) === "status");
    const file = (rows) => ({ name: "gym-log.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(rows)) });
    const changed = [{ day: "2026-09-22", data: { ...db.logs["2026-09-22"], steps: 1234 } }, { day: "2026-07-01", data: { exercises: {}, warmup: [], cardio: true, steps: 5000, weight: null, note: "" } }];
    page.removeAllListeners("dialog");
    let asked = "";
    page.once("dialog", (d) => ((asked = d.message()), d.dismiss()));
    await page.setInputFiles("#importFile", file(changed));
    await until(async () => (await page.textContent("#dataMsg")) !== "");
    check("import: asks before replacing a day already logged", /different entries for 1 day you’ve already logged/.test(asked), asked);
    check("import: cancelling changes nothing", (await page.textContent("#dataMsg")) === "Import cancelled. Nothing changed." && db.logs["2026-09-22"].steps === 8000 && !db.logs["2026-07-01"]);
    page.once("dialog", (d) => d.accept());
    await page.setInputFiles("#importFile", file(changed));
    // The message comes once every day is saved.
    await until(async () => db.logs["2026-07-01"] != null && (await page.textContent("#dataMsg")) === "Imported 2 days.");
    check("import: once accepted, the file's days go in", (await page.textContent("#dataMsg")) === "Imported 2 days." && db.logs["2026-09-22"].steps === 1234);
    page.once("dialog", () => (asked = "asked again"));
    await page.setInputFiles("#importFile", file(changed));
    await until(async () => (await page.textContent("#dataMsg")) === "Imported 2 days.");
    check("import: the same file again doesn't ask", asked !== "asked again");
    await page.setInputFiles("#importFile", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await until(async () => /couldn’t be imported/.test(await page.textContent("#dataMsg")));
    check("import: a wrong file says what to do next", /Choose a \.json file exported from Gym Log\.$/.test(await page.textContent("#dataMsg")), await page.textContent("#dataMsg"));
    page.on("dialog", (d) => d.accept());
    await openTab(page, "today");

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
    check("− Set on a set with numbers asks first, and No keeps it", removeAsk === "Remove set 4 (10\u00a0×\u00a020\u00a0kg)?" && (await page.locator("#s0_3_r").count()) === 1, removeAsk);
    page.on("dialog", (d) => d.accept());
    await ctx.close();
  }

  // ---------- A backup: the days, the plan and Health Connect days in one file, restored into a new account ----------
  {
    const jsonFile = (v) => ({ name: "gym-log.json", mimeType: "application/json", buffer: Buffer.from(typeof v === "string" ? v : JSON.stringify(v)) });
    const plan = JSON.parse(JSON.stringify(PLAN));
    plan.tempo = "4:0:1:0";
    plan.days[0].name = "Chest, shoulders";
    const l = logs();
    // Mon 21: a swap, two sets and a set logged before a skip, under a note with a comma and quotes
    Object.assign(l[K(26)], {
      note: 'Busy, "leg day" crowd',
      exercises: {
        "Chest Press Machine": { done: true, kg: 42.5, sets: [{ reps: 12, kg: 40 }, { reps: 10, kg: 42.5 }] },
        "Incline Machine Press": { done: true, kg: 30, swap: "Incline DB Press", sets: [{ reps: 10, kg: 30 }] },
        "Machine Shoulder Press": { done: false, kg: 20, skipped: true, reason: "shoulder", sets: [{ reps: 8, kg: 20 }] },
      },
    });
    let backupText = "";
    {
      const db = { logs: l, plan, health: { "2026-09-22": { steps: 6900 }, "2026-09-23": { steps: 8421, sleepMin: 432, restingHr: 61 } } };
      const { ctx, page } = await open(browser, base, { auth, db });
      await ready(page);
      await openTab(page, "settings");
      const [json] = await Promise.all([page.waitForEvent("download"), page.click("#exportBtn")]);
      backupText = fs.readFileSync(await json.path(), "utf8");
      const backup = JSON.parse(backupText);
      check(
        "export: one versioned file with the plan, every logged day and the Health Connect days",
        backup.format === "gymlog-backup" && backup.version === 1 && backup.exportedAt === NOW.toISOString() && backup.plan?.tempo === "4:0:1:0" && backup.logs.length === 29 && backup.logs[26].day === K(26) && backup.healthDays["2026-09-23"]?.sleepMin === 432,
        backupText.slice(0, 200),
      );
      check("export: named for the day, and says what it holds", json.suggestedFilename() === "gym-log-2026-09-23.json" && (await page.textContent("#dataMsg")) === "Exported 29 days, the plan and Health Connect data for 2 days.", await page.textContent("#dataMsg"));

      const [csv] = await Promise.all([page.waitForEvent("download"), page.click("#csvBtn")]);
      const text = fs.readFileSync(await csv.path(), "utf8"), note = '"Busy, ""leg day"" crowd"';
      const rows = [
        "day,session,lift,set,reps,kg,warmup,skipped,swapped_for,note",
        ...[10, 10, 8].map((reps, j) => `${K(21)},Legs,Leg Press,${j + 1},${reps},45,false,false,,`),
        `${K(26)},"Chest, shoulders",Incline Machine Press,1,10,30,false,false,Incline DB Press,${note}`,
        `${K(26)},"Chest, shoulders",Chest Press Machine,1,12,40,false,false,,${note}`,
        `${K(26)},"Chest, shoulders",Chest Press Machine,2,10,42.5,false,false,,${note}`,
        `${K(26)},"Chest, shoulders",Machine Shoulder Press,1,8,20,false,true,,${note}`,
      ];
      check("CSV: a row for each set, quoted where needed, with the swap and the skip", csv.suggestedFilename() === "gym-log-workouts-2026-09-23.csv" && text === rows.map((r) => r + "\r\n").join(""), JSON.stringify(text.slice(0, 400)));
      check("CSV: says how many sets", (await page.textContent("#dataMsg")) === "Exported 7 sets as CSV.", await page.textContent("#dataMsg"));

      // A file with another plan: asked first, and Cancel keeps yours
      page.removeAllListeners("dialog");
      let asked = "";
      page.once("dialog", (d) => ((asked = d.message()), d.dismiss()));
      await page.setInputFiles("#importFile", jsonFile({ ...backup, plan: { ...backup.plan, tempo: "2:0:2:0" } }));
      await until(async () => (await page.textContent("#dataMsg")) === "Import cancelled. Nothing changed.");
      check("import: asks before replacing a plan that differs, and Cancel keeps yours", asked === "The file has a different plan. Replace yours with the file’s version?" && db.plan.tempo === "4:0:1:0" && !db.writes.plans, asked);
      page.on("dialog", (d) => d.accept());
      check("no console errors", page.errors.length === 0, page.errors.join(" | "));
      await ctx.close();
    }
    {
      // A new account (nothing logged, no plan saved) starts on the plan picker, which restores a backup too.
      const db = { logs: {}, plan: null, health: { "2026-09-22": { steps: 7100 } } };
      const { ctx, page } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000042", "2026-09-01T00:00:00Z", "new@example.com"), db });
      await page.waitForSelector("#chooseView:not([hidden])", { timeout: 15000 });
      check("a new account: the plan picker, with Restore a backup, and no Health Connect card", (await page.locator("#chooseRestore").isVisible()) && (await page.locator("#healthToday").count()) === 0);
      page.removeAllListeners("dialog");
      let asked = "";
      page.on("dialog", (d) => ((asked = d.message()), d.accept()));
      const logWrites = db.writes.logs;
      await page.setInputFiles("#restoreFile", jsonFile(backupText));
      await page.waitForSelector("#settingsView:not([hidden])", { timeout: 15000 });
      await until(async () => /^Imported/.test(await page.textContent("#dataMsg")));
      await until(() => Object.keys(db.logs).length === 29 && db.plan?.tempo === "4:0:1:0");
      check("import: the picker's restore doesn't ask: a new account has nothing to replace", asked === "", asked);
      check(
        "import: the days and the plan are restored, and synced",
        Object.keys(db.logs).length === 29 && db.logs[K(26)].exercises["Incline Machine Press"].swap === "Incline DB Press" && db.plan?.tempo === "4:0:1:0" && db.plan.days[0].name === "Chest, shoulders",
      );
      check("import: the 29 days, all new to this account, are saved in one request", db.writes.logs === logWrites + 1, `${db.writes.logs - logWrites} requests`);
      check("import: says what came in", (await page.textContent("#dataMsg")) === "Imported 29 days, the plan and Health Connect data for 2 days.", await page.textContent("#dataMsg"));
      check(
        "import: Health Connect days go to the database, filling in the day it didn't have and leaving the one it had",
        db.writes.health === 1 && db.health["2026-09-23"]?.sleepMin === 432 && db.health["2026-09-22"].steps === 7100,
        JSON.stringify(db.health),
      );
      await openTab(page, "today");
      check("the restored plan and Health Connect day show on Today", /4:0:1:0/.test(await page.textContent("#tempoNote")) && (await page.locator("#healthToday").count()) === 1 && /7 h 12 min ?asleep/.test(await flat(page.locator("#healthToday"))));
      // It comes back from the database, with this device's copy cleared
      await page.evaluate(() => localStorage.removeItem("gymlog.health.v1"));
      await page.reload();
      await ready(page);
      await until(async () => (await page.locator("#healthToday").count()) === 1);
      check("the restored Health Connect day is still there after a reload, from the database", (await page.locator("#healthToday").count()) === 1 && /7 h 12 min ?asleep/.test(await flat(page.locator("#healthToday"))));

      // The first exports, a bare list of days, still import, and leave the plan alone
      await openTab(page, "settings");
      await page.setInputFiles("#importFile", jsonFile([{ day: "2026-07-01", data: { exercises: {}, warmup: [], cardio: true, steps: 5000, weight: null, note: "" } }]));
      await until(() => db.logs["2026-07-01"] != null);
      check("import: an older export, a list of days, still imports", (await page.textContent("#dataMsg")) === "Imported 1 day." && db.logs["2026-07-01"].steps === 5000 && db.plan.tempo === "4:0:1:0", await page.textContent("#dataMsg"));
      check("no console errors", page.errors.length === 0, page.errors.join(" | "));
      await ctx.close();
    }
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
