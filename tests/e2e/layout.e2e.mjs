// Layout and readability on a small phone (360 x 800): the fixes from the UI audit, in the redesign's Home, Train,
// the workout, Settings and Progress; and very long names, a plan with no warm-ups and no tempo.
import fs from "node:fs";
import { flat, K, open, openSetting, openTab, openWorkout, ready, session, settled, until, TAB_VIEWS } from "./harness.mjs";

const PLAN = JSON.parse(fs.readFileSync(new URL("../../src/data/plan.json", import.meta.url), "utf8"));

function logs() {
  const l = {};
  for (let n = 0; n <= 28; n++) l[K(n)] = { exercises: {}, warmup: [], cardio: false, steps: 8000, weight: Math.round((84 - 0.1 * n) * 10) / 10, note: "" };
  l[K(21)].exercises["Leg Press"] = { done: true, kg: 45, sets: [{ reps: 10, kg: 45 }, { reps: 10, kg: 45 }, { reps: 8, kg: 45 }] };
  return l;
}

const today = () => ({
  "2026-09-23": {
    exercises: { "Hack Squat": { done: true, kg: 0 }, "Leg Press": { done: true, kg: 50 }, "Leg Extension": { done: true, kg: 27 }, "Hamstring Curl": { done: true, kg: 27 }, "Calf Raise": { done: true, kg: 17.5 } },
    warmup: ["Jumping jacks", "Light warm-up sets"],
    cardio: true,
    steps: 7351,
    weight: 81,
    note: "Day 1. 65 jumping jacks. Hack squat 3x10 with just the empty machine sled (no plates added). Cycling 20 min. Leg press pending - machine was busy.",
  },
});

// Light theme tokens (src/styles/tokens.css).
const INK = "rgb(21, 23, 27)", MUTED = "rgb(95, 101, 112)";

export default async function layout({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000005", "2026-09-23T05:00:00Z", "t@example.com");
  const box = (page, sel) => page.locator(sel).first().boundingBox();

  // ---------- Home, Train and the workout at 360 x 800, the account as it is now ----------
  {
    const db = { logs: today(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db, width: 360, height: 800 });
    await ready(page);
    await page.evaluate(() => document.fonts.ready);
    // Home's header: the greeting and the avatar (Settings) share one row; the sync state is for screen readers.
    const h1 = await box(page, "#screenTitle"), avatar = await box(page, "#settingsBtn");
    check("header: the screen's title and the Settings avatar share one row", Math.abs(h1.y + h1.height / 2 - (avatar.y + avatar.height / 2)) < 24, `title y ${Math.round(h1.y)}, avatar y ${Math.round(avatar.y)}`);
    check(
      "header: a greeting under today's date, no tagline once signed in, sync announced",
      /^Good (morning|afternoon|evening)/.test(await page.textContent("#screenTitle")) && /Wednesday,? 23 September/.test(await page.textContent("#homeView .eyebrow")) && !(await page.locator("#tagline").isVisible()) && (await page.textContent("#status")) === "Synced",
      `${await page.textContent("#screenTitle")} | ${await page.textContent("#homeView .eyebrow")}`,
    );
    const bar = await box(page, ".tabbar"), tabs = await page.$$eval(".tabbar a", (els) => els.map((e) => [e.id, e.getAttribute("aria-current"), Math.round(e.getBoundingClientRect().height)]));
    check("four tabs along the bottom of the screen, Home current", Math.round(bar.y + bar.height) === 800 && tabs.map((t) => t[0]).join() === "tabHome,tabTrain,tabProgress,tabHealth" && tabs[0][1] === "page" && tabs.every((t) => t[2] >= 44), JSON.stringify(tabs));
    const barGaps = await page.evaluate(() => {
      const bar = document.querySelector(".tabbar").getBoundingClientRect(), tab = document.querySelector("#tabHome");
      const r = document.createRange();
      r.selectNodeContents([...tab.childNodes].at(-1));
      return { height: bar.height, above: tab.querySelector(".tab-pill").getBoundingClientRect().top - bar.top, below: bar.bottom - r.getBoundingClientRect().bottom };
    });
    check("the tabs sit in the middle of a bar no taller than they need, with no inset to keep clear", barGaps.height <= 60 && Math.abs(barGaps.above - barGaps.below) <= 2, JSON.stringify(barGaps));
    const start = await box(page, "#startWorkout");
    check("today's workout and its Start button are on the first screen", start && start.y + start.height < bar.y, `bottom ${Math.round(start?.y + start?.height)}px, tabs at ${Math.round(bar.y)}`);
    const wed = page.locator("#week .wd").nth(2);
    check("week strip: today is marked, and a day with every lift done says so, whatever the steps", /\btoday\b/.test(await wed.getAttribute("class")) && /, done, today$/.test(await wed.getAttribute("aria-label")) && (await wed.getAttribute("aria-current")) === "date", await wed.getAttribute("aria-label"));
    const gaps = await page.evaluate(() => {
      const s = [...document.querySelectorAll("#homeView .screen > *")].filter((e) => e.getClientRects().length);
      return s.slice(1).map((e, i) => Math.round(e.getBoundingClientRect().top - s[i].getBoundingClientRect().bottom));
    });
    check("cards have space between them", gaps.length >= 4 && gaps.every((g) => g >= 12), gaps.join(","));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const last = await page.evaluate(() => [...document.querySelectorAll("#homeView .screen > *")].filter((e) => e.getClientRects().length).pop().getBoundingClientRect().bottom);
    check("the end of the page scrolls clear of the tabs", last <= bar.y + 1, `last ${Math.round(last)}, tabs at ${Math.round(bar.y)}`);
    await page.evaluate(() => window.scrollTo(0, 0));

    // Train: the day's session and its log.
    await openTab(page, "train");
    const chip = page.locator("#dayChips .dchip").nth(2);
    check("day chips: a day with every lift done is done, whatever the steps", /\bdone\b/.test(await chip.getAttribute("class")) && (await chip.getAttribute("aria-label")).endsWith(", done, today") && (await chip.getAttribute("aria-pressed")) === "true", await chip.getAttribute("aria-label"));
    check("day chips: days before the account started have no status", !/done|part|miss/.test(await page.locator("#dayChips .dchip").first().getAttribute("class")));
    check("week label is words, no en dash", (await page.textContent("#weekLabel")) === "This week", await page.textContent("#weekLabel"));
    const lift = await box(page, "#liftRows .lrow");
    check("first lift starts on the first screen", lift.y < 800, `top ${Math.round(lift.y)}px`);
    // A lift's row (its name, sets and weight, the drag handle) fits inside the session card, with no page scrolling sideways.
    const spill = await page.$$eval("#session", (cards) =>
      cards.flatMap((c) => {
        const right = c.getBoundingClientRect().right;
        return [...c.querySelectorAll("*")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > right + 0.5).map((e) => e.className || e.tagName);
      }),
    );
    check("every lift's row and the session's buttons stay inside its card", spill.length === 0 && (await page.evaluate(() => document.documentElement.scrollWidth)) <= 360, spill.slice(0, 4).join(", "));
    // The keyboard coming up: the visible part of the page shrinks while a box has focus.
    const tabBar = await box(page, ".tabbar");
    await page.focus("#steps");
    await page.setViewportSize({ width: 360, height: 480 });
    await until(() => page.locator(".tabbar").isHidden());
    check("typing: the tabs step aside for the keyboard", await page.locator(".tabbar").isHidden());
    await page.setViewportSize({ width: 360, height: 800 });
    await until(() => page.locator(".tabbar").isVisible());
    check("the keyboard closed (Back) with the box still focused: the tabs come back", (await page.locator(".tabbar").isVisible()) && (await page.evaluate(() => document.activeElement.id)) === "steps");
    await page.evaluate(() => document.activeElement.blur());
    check("warm-up starts folded", (await page.locator("#wuChips").isHidden()) && (await page.getAttribute("#wuToggle", "aria-expanded")) === "false" && /Warm-up ?2 of 13 done/.test(await flat(page.locator("#wuToggle"))), await flat(page.locator("#wuToggle")));
    await page.click("#wuToggle");
    check("warm-up opens with its chips", (await page.locator("#wuChips").isVisible()) && (await page.getAttribute("#wuToggle", "aria-expanded")) === "true");
    await page.locator("#wuChips .chip", { hasText: "Cycling 5 min" }).click();
    await until(() => db.logs["2026-09-23"].warmup.includes("Cycling 5 min"));
    check("ticking a warm-up keeps the list open", (await page.locator("#wuChips").isVisible()) && db.logs["2026-09-23"].warmup.includes("Cycling 5 min"));
    await page.click("#wuToggle");
    const st = await box(page, "#steps"), wt = await box(page, "#weight");
    check("Steps and Body weight boxes line up", Math.abs(st.y - wt.y) < 1 && Math.abs(st.height - wt.height) < 1, `${Math.round(st.y)}/${Math.round(wt.y)}, ${Math.round(st.height)}/${Math.round(wt.height)}`);
    const note = await page.$eval("#note", (e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
    check("note box grows to show the whole note", note.sh <= note.ch + 2, JSON.stringify(note));
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("#session button, #session input:not([type=checkbox]), #session select, #trainView header a, #trainView header button, #dayChips button, .weeknav button")]
        .filter((e) => e.getClientRects().length && getComputedStyle(e).opacity !== "0")
        .map((e) => ({ id: e.id || e.className, h: Math.round(e.getBoundingClientRect().height) }))
        .filter((x) => x.h < 44),
    );
    check("controls on Train are at least 44px tall", !small.length, JSON.stringify(small.slice(0, 5)));
    const tabsNow = await box(page, ".tabbar");
    check("the tab bar stays put", Math.abs(tabsNow.y - tabBar.y) < 1);
    await page.locator("#dayChips .dchip").nth(3).click(); // Thursday: rest
    check("rest days skip the warm-up", (await page.locator("#trainView .wu").count()) === 0);
    await page.locator("#dayChips .dchip").nth(2).click();

    // The workout: one lift at a time, its set table inside its card.
    await openWorkout(page, 0);
    const wspill = await page.$$eval(".ex-card", (cards) =>
      cards.flatMap((c) => {
        const right = c.getBoundingClientRect().right;
        return [...c.querySelectorAll("*")].filter((e) => e.getClientRects().length && getComputedStyle(e).position !== "absolute" && e.getBoundingClientRect().right > right + 0.5).map((e) => e.className || e.tagName);
      }),
    );
    check("the workout: a lift's sets and buttons stay inside its card", wspill.length === 0 && (await page.evaluate(() => document.documentElement.scrollWidth)) <= 360, wspill.slice(0, 4).join(", "));
    const ph = await page.$eval("#s0_1_r", (e) => getComputedStyle(e, "::placeholder").color);
    check("suggested numbers use the muted colour (4.5:1 or better)", ph === MUTED, ph);
    const hs = page.locator(".ex-card.lift").first();
    check("no set is marked logged before reps are entered", (await hs.locator(".srow.set.logged").count()) === 0);
    await page.fill("#s0_0_r", "10");
    await page.locator("#s0_0_r").blur();
    await until(async () => (await hs.locator(".srow.set").first().getAttribute("class")).includes("logged"));
    check("entering reps marks the set as logged", (await hs.locator(".srow.set").first().getAttribute("class")).includes("logged"));
    await page.evaluate(settled); // the row's tint fades in
    const typed = await page.$eval("#s0_0_r", (e) => ({ w: getComputedStyle(e).fontWeight, c: getComputedStyle(e).color, row: getComputedStyle(e.closest(".srow")).backgroundColor }));
    const later = await page.$eval("#s0_2_r", (e) => getComputedStyle(e, "::placeholder").color);
    check("typed numbers are heavy ink on the logged row's tint, unlike later sets' muted suggestions", typed.w === "900" && typed.c === INK && typed.row === "rgb(255, 244, 238)" && later === MUTED, JSON.stringify({ typed, later }));
    await page.click("#closeWorkout");
    await page.waitForSelector("#trainView");

    // Settings: Import is a real, focusable button that opens the file picker.
    await openTab(page, "settings");
    await openSetting(page, "setData");
    check("Import is a button", (await page.$eval("#importBtn", (e) => e.tagName)) === "BUTTON");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 3000 }).catch(() => null), page.click("#importBtn")]);
    check("Import opens the file picker", !!chooser);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    check("Settings fits at 360px (no sideways scroll)", wide <= 360, `${wide}px`);
    await page.click("#backBtn");
    await page.waitForSelector(TAB_VIEWS); // Settings closes onto the tab it was opened from

    // Progress on a new account
    await openTab(page, "progress");
    const k = await page.$$eval("#dashStats .stat", (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    check("Progress: the week's three numbers sit in one row at 360px", k.length === 3 && k.every((t) => t === k[0]), k.join(","));
    const hist = await page.$eval("#hist", (e) => ({ sw: e.scrollWidth, cw: e.clientWidth, cols: e.querySelectorAll("th").length }));
    check("history fits at 360px (no sideways scroll)", hist.sw <= hist.cw + 1 && hist.cols === 5, JSON.stringify(hist));
    await page.click('#progTabs [data-seg="body"]');
    await page.waitForSelector("#dashWeightBody");
    const kp = await page.$$eval("#dashWeightBody .kpi", (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    check("Body: the weight numbers sit two to a row at 360px", kp.length >= 2 && kp[0] === kp[1] && (kp.length < 3 || kp[2] > kp[0]), kp.join(","));
    await page.click('#progTabs [data-seg="strength"]');
    await page.waitForSelector("#dashStrength");
    const str = await flat(page.locator("#dashStrength"));
    check("strength: never-logged lifts say so", /Incline Machine Press Push - not logged yet/.test(str), str.slice(0, 160));
    check("strength: a lift logged without a usable set says why", /Hack Squat Legs - no estimate yet: needs a set with weight and 1-12 reps/.test(str), str.slice(0, 300));
    check("fonts come from this site: no requests off-site", db.external.length === 0, db.external.slice(0, 2).join(", "));
    const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`));
    check("font loaded: Nunito, from this site", fonts.some((x) => /nunito/i.test(x) && !/fallback/i.test(x)), fonts.join(", "));
    const fams = await page.evaluate(() => ["h1", "body", "#dashStrength .lv", "#dashStrength .ln"].map((s) => getComputedStyle(document.querySelector(s)).fontFamily.split(",")[0]));
    check("headings, text and numbers all use Nunito, the one family", fams.every((f) => /nunito/i.test(f) && !/oswald|plex/i.test(f)), fams.join(" | "));
    const titleCase = await page.evaluate(() => getComputedStyle(document.querySelector("h1")).textTransform);
    check("titles aren't set in capitals", titleCase === "none", titleCase);
    check("no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // ---------- A month of history: day chips, dashboard warnings, catch-up, knee sizes ----------
  {
    const logs = {};
    for (let n = 0; n <= 28; n++) logs[K(n)] = { exercises: {}, warmup: [], cardio: false, steps: 8000, weight: n <= 22 ? 84 - 0.1 * n : null, note: "" };
    logs[K(26)].exercises["Chest Press Machine"] = { done: true, kg: 40, sets: [{ reps: 12, kg: 40 }] }; // Mon 21: part of Push
    Object.assign(logs[K(21)], { kneeBefore: 2, kneeAfter: 7 });
    logs[K(21)].exercises["Leg Press"] = { done: true, kg: 50, sets: [{ reps: 10, kg: 50 }] };
    const { ctx, page } = await open(browser, base, { auth: { ...auth, user: { ...auth.user, created_at: "2026-08-26T05:00:00Z" } }, db: { logs, plan: null }, width: 360, height: 800, mobile: false });
    await ready(page);
    const wd = await page.$$eval("#week .wd", (els) => els.map((e) => e.className));
    check("Home's week: part done (Mon)", /\bpart\b/.test(wd[0]), wd.slice(0, 3).join(" | "));
    // Today is a knee day with no score yet: Home asks, on a 0-10 scale in one row.
    // The scale is one row of 11 cells: each is 44px tall, and narrow, but spaced so each keeps a 24px target of its
    // own (WCAG 2.5.8: a 24px circle on each cell's centre misses its neighbours).
    const knee = await box(page, '#todayCard button[data-knee="kneeBefore:0"]'), knee1 = await box(page, '#todayCard button[data-knee="kneeBefore:1"]');
    const pitch = knee1.x + knee1.width / 2 - (knee.x + knee.width / 2);
    check("knee buttons at 360px: one row, 44px tall, 24px apart or more", Math.abs(knee.y - knee1.y) < 1 && knee.height >= 44 && pitch >= 24, `${Math.round(knee.width * 10) / 10}x${Math.round(knee.height)}, ${Math.round(pitch * 10) / 10}px apart`);
    await openTab(page, "train");
    const cls = await page.$$eval("#dayChips .dchip", (els) => els.map((e) => e.className));
    check("day chips: part (Mon), missed (Tue)", /\bpart\b/.test(cls[0]) && /\bmiss\b/.test(cls[1]), cls.slice(0, 3).join(" | "));
    check("missed day says so to screen readers", (await page.locator("#dayChips .dchip").nth(1).getAttribute("aria-label")).endsWith(", missed"));
    await page.locator("#dayChips .dchip").nth(3).click(); // Thursday: rest, with Push and Pull missed this week
    const cu = await page.$eval(".catchup .callout", (e) => ({ cls: e.className, bg: getComputedStyle(e).backgroundColor, c: getComputedStyle(e).color }));
    check("catch-up suggestion is an insight, not a warning", !/caution|warn/.test(cu.cls) && cu.bg === "rgb(232, 242, 253)" && cu.c === "rgb(28, 58, 94)", JSON.stringify(cu));
    await openTab(page, "progress");
    const warn = await page.$eval("#dashFlags .callout.caution", (e) => ({ c: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor }));
    check("Progress warnings: dark amber text on the warning tint (7:1)", warn.c === "rgb(146, 64, 14)" && warn.bg === "rgb(254, 243, 199)", JSON.stringify(warn));
    const part = await page.$eval("#dashPlan .legend i.part", (e) => getComputedStyle(e).backgroundColor);
    check("consistency: some-lifts days are a lighter brand, not the full workout colour", part === "rgb(255, 210, 184)", part);
    const monCell = await page.$eval("#dashPlan .cons .cell:nth-child(12)", (e) => e.className);
    check("consistency: Monday's cell is part done", /\bpart\b/.test(monCell), monCell);
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
    const wide = () =>
      page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
        over: [...document.querySelectorAll("body *")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).map((e) => e.id || e.closest("[id]")?.id).slice(0, 2),
      }));
    const home = await wide();
    check("very long names wrap on Home: no sideways scroll at 360px", home.sw <= home.cw && (await page.textContent("#todayName")) === "Legsandglutesandcalvesdayextralongname", JSON.stringify(home));
    await openTab(page, "train");
    const train = await wide();
    check("…and in Train, with the swap and the skip reason", train.sw <= train.cw && /Smithmachinesquat/.test(await flat(page.locator("#liftRows"))) && /machinewasbusy/.test(await flat(page.locator("#liftRows"))), JSON.stringify(train));
    check("a plan with no warm-ups shows no warm-up card", (await page.locator(".wu").count()) === 0);
    check("no tempo, no empty tempo note", await page.locator("#tempoNote").isHidden());
    await openWorkout(page, 0);
    const workout = await wide();
    // (The next exercise, under Complete set, is the swapped lift's long name.)
    check("…and in the workout", workout.sw <= workout.cw && /Supercalifragilistic/.test(await flat(page.locator(".ex-name"))), JSON.stringify(workout));
    await ctx.close();
  }

  await setTable({ browser, base, check });
}

/** The workout's set table as a person sees it, on the card on show: across the screen, the centre of each column's
 *  heading and of what each set row shows under it (its number or A1, last time's set, the two boxes, a record's
 *  badge, the check), each set row's height, the boxes' widths, and anything cut short or running outside the card. */
const tableOf = (page) =>
  page.$eval("#workoutView .ex-card", (card) => {
    // Text by where its letters are, not its box: a heading's box is its whole column however its text sits in it.
    const text = (e) => {
      const r = document.createRange();
      r.selectNodeContents(e);
      const b = r.getBoundingClientRect();
      return b.width ? b.left + b.width / 2 : null;
    };
    const mid = (e) => {
      const b = e.getBoundingClientRect();
      return b.left + b.width / 2;
    };
    const cardBox = card.getBoundingClientRect();
    const head = [...card.querySelectorAll(".shead > span")].map(text);
    const rows = [...card.querySelectorAll(".srow.set")].map((row) => {
      const q = (s) => row.querySelector(s), kg = q('[data-set$=":kg"]'), reps = q('[data-set$=":reps"]'), chk = q(".chk").getBoundingClientRect(), prb = q(".prb");
      return {
        set: text(q(".sn span")),
        last: text(q(".last")),
        kg: mid(kg),
        reps: mid(reps),
        pr: getComputedStyle(prb).display === "none" ? null : mid(prb),
        chk: chk.left + chk.width / 2,
        chkY: chk.top + chk.height / 2,
        h: row.getBoundingClientRect().height,
        kgW: kg.getBoundingClientRect().width,
        repsW: reps.getBoundingClientRect().width,
        active: row.classList.contains("active"),
        // In a superset, the round it's in: a round's heading comes between rounds.
        group: [...row.parentElement.parentElement.children].indexOf(row.parentElement),
      };
    });
    const lastW = card.querySelector(".shead > span:nth-child(2)").getBoundingClientRect().width;
    // Text wider than its box (both widths rounded to whole pixels): ellipsed, or scrolled out of sight in a box.
    const cut = [...card.querySelectorAll(".srow .last, .srow input")].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.dataset.set || e.textContent);
    const out = [...card.querySelectorAll(".sets *")].filter((e) => e.getClientRects().length && (e.getBoundingClientRect().left < cardBox.left - 0.5 || e.getBoundingClientRect().right > cardBox.right + 0.5)).map((e) => e.className || e.tagName);
    return { head, rows, lastW, cut, out };
  });

// The workout's set table on a small phone (360 x 800), and on a large one: each column's heading over what's under it,
// the active row's boxes and the plain numbers of the other rows in the same places and widths, one check column with
// evenly spaced rows, and a long name, a 3-digit weight, 2-digit reps and last time's "102.5 × 10" all fitting; in a
// superset's rounds too.
async function setTable({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000006", "2026-09-01T05:00:00Z", "t@example.com");
  const plan = JSON.parse(JSON.stringify(PLAN));
  // Each with a cue, so each has How to beside ···: two buttons for its name and numbers to make room for.
  const lift = (name, sets, reps, more = {}) => ({ name, sets, reps, cue: "Slow and controlled.", flag: "", ...more });
  plan.days[2].exercises = [lift("Single-Arm Dumbbell Row", "3", "10-12"), lift("Lat Pulldown", "3", "8-10"), lift("Seated Row", "3", "10-12", { superset: true })];
  const day = (exercises) => ({ exercises, warmup: [], cardio: false, steps: null, weight: null, note: "" });
  const logs = {
    [K(21)]: day({
      "Single-Arm Dumbbell Row": { done: true, kg: 102.5, sets: [{ reps: 10, kg: 102.5 }, { reps: 10, kg: 100 }, { reps: 8, kg: 100 }] },
      "Lat Pulldown": { done: true, kg: 65, sets: [{ reps: 10, kg: 65 }, { reps: 9, kg: 65 }, { reps: 8, kg: 65 }] },
      "Seated Row": { done: true, kg: 60, sets: [{ reps: 12, kg: 60 }, { reps: 11, kg: 60 }, { reps: 10, kg: 60 }] },
    }),
    // Today's first set, heavier than ever: a record.
    [K(28)]: day({ "Single-Arm Dumbbell Row": { done: false, kg: 105, sets: [{ reps: 12, kg: 105 }] } }),
  };
  const { ctx, page } = await open(browser, base, { auth, db: { logs, plan }, width: 360, height: 800 });
  await ready(page);
  await page.evaluate(() => document.fonts.ready);
  await openWorkout(page, 0);
  // The second set is the one being done: a 3-digit weight typed in its box.
  await page.fill("#s0_1_k", "102.5");
  await until(async () => (await page.locator("#workoutView .srow.set.pr").count()) === 1);

  const spread = (xs) => {
    const v = xs.filter((x) => x != null);
    return Math.round((Math.max(...v) - Math.min(...v)) * 10) / 10;
  };
  const tableChecks = async (where, { record }) => {
    await page.evaluate(settled);
    const t = await tableOf(page), rows = t.rows;
    const cols = {
      Set: [t.head[0], ...rows.map((r) => r.set)],
      Last: [t.head[1], ...rows.map((r) => r.last)],
      kg: [t.head[2], ...rows.map((r) => r.kg), ...rows.map((r) => r.pr)],
      Reps: [t.head[3], ...rows.map((r) => r.reps)],
      check: rows.map((r) => r.chk),
    };
    const spreads = Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, spread(v)]));
    check(
      `${where}: each column's heading, the active row's boxes, the other rows' numbers and a record's badge share one centre`,
      rows.length >= 3 && rows.some((r) => r.active) && rows.some((r) => r.pr != null) === record && Object.values(spreads).every((s) => s <= 1),
      JSON.stringify(spreads),
    );
    const widths = { kg: rows.map((r) => Math.round(r.kgW * 10) / 10), reps: rows.map((r) => Math.round(r.repsW * 10) / 10), last: Math.round(t.lastW) };
    check(
      `${where}: the kg and Reps boxes are one width, in every row, and Last is no wide gap beside them`,
      spread([...rows.map((r) => r.kgW), ...rows.map((r) => r.repsW)]) <= 0.5 && t.lastW <= rows[0].kgW * 1.25,
      JSON.stringify(widths),
    );
    const gaps = rows.slice(1).flatMap((r, j) => (r.group === rows[j].group ? [r.chkY - rows[j].chkY] : []));
    check(
      `${where}: every set row is one height, so the checks run down one column evenly spaced`,
      spread(rows.map((r) => r.h)) <= 0.5 && spread(gaps) <= 0.5,
      JSON.stringify({ heights: rows.map((r) => r.h), gaps }),
    );
    check(`${where}: nothing in the set table is cut short or runs outside its card`, !t.cut.length && !t.out.length && (await page.evaluate(() => document.documentElement.scrollWidth)) <= page.viewportSize().width, JSON.stringify({ cut: t.cut, out: t.out.slice(0, 4) }));
  };

  await tableChecks("the lift at 360px", { record: true });
  // Its name runs the card's width under the buttons, and what it's asked for (sets, rest, tempo) stays on one line;
  // + Add set and Warm-up sets too. (A button's height can't tell: two lines of its words are 44px, as one line is.)
  const lines = (sel) =>
    page.$$eval(sel, (els) =>
      els.map((e) => {
        const r = document.createRange();
        r.selectNodeContents(e);
        return [e.textContent.trim(), Math.round(r.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight))];
      }),
    );
  const buttons = await page.evaluate(() => document.querySelector("#workoutView .ex-btns").getBoundingClientRect().bottom);
  const name = await page.evaluate(() => document.querySelector("#workoutView .ex-name").getBoundingClientRect().top);
  const meta = await lines("#workoutView .ex-meta .sr");
  check("the lift's name sits under its buttons, and its sets, rest and tempo on one line", name >= buttons - 0.5 && meta.length === 1 && meta[0][1] === 1, JSON.stringify({ name, buttons, meta }));
  const btns = await lines("#workoutView .setbtns > .btn, #workoutView .setbtns .wset-t");
  check("+ Add set and Warm-up sets each fit on one line", btns.length === 2 && btns.every(([, n]) => n === 1), JSON.stringify(btns));

  await page.click("#nextEx");
  await page.waitForSelector("#workoutView .ex-card.superset");
  await tableChecks("a superset's rounds at 360px", { record: false });

  await page.setViewportSize({ width: 412, height: 915 });
  await page.click("#workoutView .wprog li:first-child button");
  await page.waitForSelector("#s0_1_k");
  await tableChecks("the lift at 412px", { record: true });
  check("no page errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
