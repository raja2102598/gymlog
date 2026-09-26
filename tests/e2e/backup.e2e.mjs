// Export & backup, and restoring (Settings → Export & backup, and the plan picker): one file with the plan, every
// logged day and Health Connect's days, and the workouts as CSV; importing a file over what's there, asking first
// before it replaces a logged day or the plan; and a new account restoring a backup from the plan picker, online or
// offline. What an import keeps, merges or refuses, case by case, is in tests/unit/backup.test.ts.
import fs from "node:fs";
import { K, NOW, TAB_VIEWS, answerAsk, flat, lastAsked, open, openSetting, openTab, session, ready, until } from "./harness.mjs";

const PLAN = JSON.parse(fs.readFileSync(new URL("../../src/data/plan.json", import.meta.url), "utf8"));

function logs() {
  const l = {};
  for (let n = 0; n <= 28; n++) l[K(n)] = { exercises: {}, warmup: [], cardio: false, steps: 8000, weight: Math.round((84 - 0.1 * n) * 10) / 10, note: "" };
  l[K(21)].exercises["Leg Press"] = { done: true, kg: 45, sets: [{ reps: 10, kg: 45 }, { reps: 10, kg: 45 }, { reps: 8, kg: 45 }] };
  return l;
}

const template = (id) => JSON.parse(fs.readFileSync(new URL(`../../src/data/templates/${id}.json`, import.meta.url), "utf8"));
const day = (steps) => ({ exercises: {}, warmup: [], cardio: false, steps, weight: null, note: "" });
/** Records in the page which of these screens were ever on show: `app` for Home or Train. */
const watchScreens = (page) =>
  page.addInitScript(() => {
    window.__shown = {};
    new MutationObserver(() => {
      if (document.getElementById("homeView") || document.getElementById("trainView")) window.__shown.app = true;
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
  });
/** Home or Train is on screen. */
const inApp = (page) => page.evaluate(() => !!(document.getElementById("homeView") || document.getElementById("trainView")));

export default async function backup({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000041", "2026-08-26T05:00:00Z", "t@example.com");

  // ---------- Settings' message, and importing over days already logged ----------
  {
    const db = { logs: logs(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db });
    await ready(page);
    await openTab(page, "settings");
    await openSetting(page, "setData");
    const gap = await page.evaluate(() => Math.round(document.querySelector("#dataMsg").getBoundingClientRect().height));
    check("Settings: no blank row under Import while there's no message", gap === 0, `${gap}px`);
    check("Settings: export and import results are announced", (await page.getAttribute("#dataMsg", "role")) === "status");
    const file = (rows) => ({ name: "gym-log.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(rows)) });
    const changed = [{ day: "2026-09-22", data: { ...db.logs["2026-09-22"], steps: 1234 } }, { day: "2026-07-01", data: { exercises: {}, warmup: [], cardio: true, steps: 5000, weight: null, note: "" } }];
    await answerAsk(page, "cancel");
    await page.setInputFiles("#importFile", file(changed));
    await until(async () => (await page.textContent("#dataMsg")) !== "");
    const asked = await lastAsked(page);
    check("import: asks before replacing a day already logged", /different entries for 1 day you’ve already logged/.test(asked), asked);
    check("import: cancelling changes nothing", (await page.textContent("#dataMsg")) === "Import cancelled. Nothing changed." && db.logs["2026-09-22"].steps === 8000 && !db.logs["2026-07-01"]);
    await page.setInputFiles("#importFile", file(changed));
    // The message comes once every day is saved.
    await until(async () => db.logs["2026-07-01"] != null && (await page.textContent("#dataMsg")) === "Imported 2 days.");
    check("import: once accepted, the file's days go in", (await page.textContent("#dataMsg")) === "Imported 2 days." && db.logs["2026-09-22"].steps === 1234);
    await page.setInputFiles("#importFile", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await until(async () => /couldn’t be imported/.test(await page.textContent("#dataMsg")));
    check("import: a wrong file says what to do next", /Choose a \.json file exported from Gym Log\.$/.test(await page.textContent("#dataMsg")), await page.textContent("#dataMsg"));
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
      await openSetting(page, "setData");
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
        "day,session,lift,set,reps,kg,type,rpe,rir,skipped,swapped_for,note",
        ...[10, 10, 8].map((reps, j) => `${K(21)},Legs,Leg Press,${j + 1},${reps},45,working,,,false,,`),
        `${K(26)},"Chest, shoulders",Incline Machine Press,1,10,30,working,,,false,Incline DB Press,${note}`,
        `${K(26)},"Chest, shoulders",Chest Press Machine,1,12,40,working,,,false,,${note}`,
        `${K(26)},"Chest, shoulders",Chest Press Machine,2,10,42.5,working,,,false,,${note}`,
        `${K(26)},"Chest, shoulders",Machine Shoulder Press,1,8,20,working,,,true,,${note}`,
      ];
      check("CSV: a row for each set, quoted where needed, with the swap and the skip", csv.suggestedFilename() === "gym-log-workouts-2026-09-23.csv" && text === rows.map((r) => r + "\r\n").join(""), JSON.stringify(text.slice(0, 400)));
      check("CSV: says how many sets", (await page.textContent("#dataMsg")) === "Exported 7 sets as CSV.", await page.textContent("#dataMsg"));

      // A file with another plan: asked first, and Cancel keeps yours
      await answerAsk(page, "cancel");
      await page.setInputFiles("#importFile", jsonFile({ ...backup, plan: { ...backup.plan, tempo: "2:0:2:0" } }));
      await until(async () => (await page.textContent("#dataMsg")) === "Import cancelled. Nothing changed.");
      const asked = await lastAsked(page);
      check("import: asks before replacing a plan that differs, and Cancel keeps yours", asked === "Replace yours with the file’s version? The file has a different plan." && db.plan.tempo === "4:0:1:0" && !db.writes.plans, asked);
      check("no console errors", page.errors.length === 0, page.errors.join(" | "));
      await ctx.close();
    }
    {
      // A new account (nothing logged, no plan saved) starts on the plan picker, which restores a backup too.
      const db = { logs: {}, plan: null, health: { "2026-09-22": { steps: 7100 } } };
      const { ctx, page } = await open(browser, base, { auth: session("00000000-0000-4000-8000-000000000042", "2026-09-01T00:00:00Z", "new@example.com"), db });
      await page.waitForSelector("#chooseView:not([hidden])", { timeout: 15000 });
      const logWrites = db.writes.logs;
      await page.setInputFiles("#restoreFile", jsonFile(backupText));
      await page.waitForSelector("#settingsView", { timeout: 15000 });
      await until(async () => /^Imported/.test(await page.textContent("#dataMsg")));
      await until(() => Object.keys(db.logs).length === 29 && db.plan?.tempo === "4:0:1:0");
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
      // Home's timeline has last night's sleep, from the restored Health Connect day; Train has the plan's tempo.
      await page.click("#backBtn");
      await page.waitForSelector(TAB_VIEWS); // Settings closes onto the tab it was opened from
      const slept = async () => (await page.locator("#timeline").count()) === 1 && /7 h 12 min sleep/.test(await flat(page.locator("#timeline")));
      check("the restored Health Connect day shows on Home", await slept(), await flat(page.locator("#homeView")));
      await openTab(page, "train");
      check("the restored plan shows in Train", /4:0:1:0/.test(await page.textContent("#tempoNote")));
      // It comes back from the database, with this device's copy cleared
      await page.evaluate(() => localStorage.removeItem("gymlog.health.v1"));
      await page.reload();
      await page.waitForSelector("#trainView", { timeout: 15000 });
      await until(async () => (await page.locator("#status").textContent()) === "Synced");
      await openTab(page, "home");
      await until(slept);
      check("the restored Health Connect day is still there after a reload, from the database", await slept());

      check("no console errors", page.errors.length === 0, page.errors.join(" | "));
      await ctx.close();
    }
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
}
