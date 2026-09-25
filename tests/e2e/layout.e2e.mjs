// Layout and readability on a small phone (360 x 800): the fixes from the UI audit.
import { flat, K, open, openTab, ready, session, until } from "./harness.mjs";

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

export default async function layout({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000005", "2026-09-23T05:00:00Z", "t@example.com");
  const box = (page, sel) => page.locator(sel).first().boundingBox();

  // ---------- Today at 360 x 800, the account as it is now ----------
  {
    const db = { logs: today(), plan: null };
    const { ctx, page } = await open(browser, base, { auth, db, width: 360, height: 800 });
    await ready(page);
    await page.evaluate(() => document.fonts.ready);
    const h1 = await box(page, "h1"), status = await box(page, "#status");
    check("top bar: the screen's title and the sync state share one row", Math.abs(h1.y + h1.height / 2 - (status.y + status.height / 2)) < 24, `title y ${Math.round(h1.y)}, status y ${Math.round(status.y)}`);
    check("top bar: Today and the date, no tagline once signed in", (await page.textContent("#screenTitle")) === "Today" && (await page.locator("#tagline").count()) === 0 && (await page.textContent("#status")) === "Synced");
    const bar = await box(page, ".tabbar"), tabs = await page.$$eval(".tabbar a", (els) => els.map((e) => [e.id, e.getAttribute("aria-current"), Math.round(e.getBoundingClientRect().height)]));
    check("four tabs along the bottom of the screen, Today current", Math.round(bar.y + bar.height) === 800 && tabs.map((t) => t[0]).join() === "tabToday,tabHealth,tabProgress,tabSettings" && tabs[0][1] === "page" && tabs.every((t) => t[2] >= 48), JSON.stringify(tabs));
    // A lift's sets (reps, kg and the plates button) and its buttons fit inside its card, with no page scrolling sideways.
    const spill = await page.$$eval(".lift", (lifts) =>
      lifts.flatMap((l) => {
        const right = l.getBoundingClientRect().right;
        return [...l.querySelectorAll("*")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > right + 0.5).map((e) => e.className || e.tagName);
      }),
    );
    check("every lift's sets and buttons stay inside its card", spill.length === 0 && (await page.evaluate(() => document.documentElement.scrollWidth)) <= 360, spill.slice(0, 4).join(", "));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const last = await page.evaluate(() => [...document.querySelectorAll("#appView > *")].filter((e) => e.getClientRects().length).pop().getBoundingClientRect().bottom);
    check("the end of the page scrolls clear of the tabs", last <= bar.y + 1, `last ${Math.round(last)}, tabs at ${Math.round(bar.y)}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    // The keyboard coming up: the visible part of the page shrinks while a box has focus.
    await page.focus("#steps");
    await page.setViewportSize({ width: 360, height: 480 });
    await until(() => page.locator(".tabbar").isHidden());
    check("typing: the tabs step aside for the keyboard", await page.locator(".tabbar").isHidden());
    await page.setViewportSize({ width: 360, height: 800 });
    await until(() => page.locator(".tabbar").isVisible());
    check("the keyboard closed (Back) with the box still focused: the tabs come back", (await page.locator(".tabbar").isVisible()) && (await page.evaluate(() => document.activeElement.id)) === "steps");
    await page.evaluate(() => document.activeElement.blur());
    const lift = await box(page, "#session .ex li");
    check("first lift starts on the first screen", lift.y < 800, `top ${Math.round(lift.y)}px`);
    check("warm-up starts folded", (await page.locator("#wuChips").isHidden()) && (await page.getAttribute("#wuToggle", "aria-expanded")) === "false" && /Warm-up 2 of 13 done Show/.test(await flat(page.locator("#wuToggle"))), await flat(page.locator("#wuToggle")));
    await page.click("#wuToggle");
    check("warm-up opens with its chips", (await page.locator("#wuChips").isVisible()) && (await page.getAttribute("#wuToggle", "aria-expanded")) === "true" && /Hide/.test(await flat(page.locator("#wuToggle"))));
    await page.locator("#wuChips .chip", { hasText: "Cycling 5 min" }).click();
    await until(() => db.logs["2026-09-23"].warmup.includes("Cycling 5 min"));
    check("ticking a warm-up keeps the list open", (await page.locator("#wuChips").isVisible()) && db.logs["2026-09-23"].warmup.includes("Cycling 5 min"));
    await page.click("#wuToggle");
    const wed = page.locator("#week .dchip").nth(2);
    check("week strip: a day with every lift done is done, whatever the steps", /\bdone\b/.test(await wed.getAttribute("class")) && (await wed.getAttribute("aria-label")).endsWith(", done") && (await wed.getAttribute("aria-current")) === "date");
    check("week strip: days before the account started have no status", !/done|part|miss/.test(await page.locator("#week .dchip").first().getAttribute("class")));
    check("week label uses a hyphen, no en dash", (await page.textContent("#weekLabel")) === "21-27 Sept", await page.textContent("#weekLabel"));
    const hist = await page.$eval("#hist", (e) => ({ sw: e.scrollWidth, cw: e.clientWidth, cols: e.querySelectorAll("th").length }));
    check("history fits at 360px (no sideways scroll)", hist.sw <= hist.cw + 1 && hist.cols === 5, JSON.stringify(hist));
    const gaps = await page.evaluate(() => {
      const s = [...document.querySelectorAll("#appView > section")];
      return s.slice(1).map((e, i) => Math.round(e.getBoundingClientRect().top - s[i].getBoundingClientRect().bottom));
    });
    check("cards have space between them", gaps.length === 4 && gaps.every((g) => g >= 16), gaps.join(","));
    const st = await box(page, "#steps"), wt = await box(page, "#weight");
    check("Steps and Body weight boxes line up", Math.abs(st.y - wt.y) < 1 && Math.abs(st.height - wt.height) < 1, `${Math.round(st.y)}/${Math.round(wt.y)}, ${Math.round(st.height)}/${Math.round(wt.height)}`);
    const note = await page.$eval("#note", (e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
    check("note box grows to show the whole note", note.sh <= note.ch + 2, JSON.stringify(note));
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("#session button, #session input:not([type=checkbox]), #session select, header button, #week button")]
        .filter((e) => e.getClientRects().length && getComputedStyle(e).opacity !== "0")
        .map((e) => ({ id: e.id || e.className, h: Math.round(e.getBoundingClientRect().height) }))
        .filter((x) => x.h < 40),
    );
    check("controls on Today are at least 40px tall", !small.length, JSON.stringify(small.slice(0, 5)));
    const ph = await page.$eval("#s0_1_r", (e) => getComputedStyle(e, "::placeholder").color);
    check("suggested numbers use the muted colour (4.5:1 or better)", ph === "rgb(91, 98, 112)", ph);
    const hs = page.locator("#session .ex li").first();
    check("no set is marked logged before reps are entered", (await hs.locator(".set.logged").count()) === 0);
    await page.fill("#s0_0_r", "10");
    check("entering reps marks the set as logged", (await hs.locator(".set").first().getAttribute("class")).includes("logged"));
    const typed = await page.$eval("#s0_0_r", (e) => ({ w: getComputedStyle(e).fontWeight, bg: getComputedStyle(e).backgroundColor }));
    check("typed numbers are bold on white, unlike suggestions", typed.w === "600" && typed.bg === "rgb(255, 255, 255)", JSON.stringify(typed));
    await page.locator("#week .dchip").nth(3).click(); // Thursday: rest
    check("rest days skip the warm-up", (await page.locator("#session .wu").count()) === 0);
    await page.locator("#week .dchip").nth(2).click();
    // Settings: Import is a real, focusable button that opens the file picker.
    await openTab(page, "settings");
    check("Import is a button", (await page.$eval("#importBtn", (e) => e.tagName)) === "BUTTON");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 3000 }).catch(() => null), page.click("#importBtn")]);
    check("Import opens the file picker", !!chooser);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    check("Settings fits at 360px (no sideways scroll)", wide <= 360, `${wide}px`);
    // The dashboard on a new account
    await openTab(page, "progress");
    const k = await page.$$eval("#dashWeight .kpi", (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    check("dashboard numbers sit two to a row at 360px", k.length >= 2 && k[0] === k[1], k.join(","));
    const str = await flat(page.locator("#dashStrength"));
    check("strength: never-logged lifts say so", /Incline Machine Press Push - not logged yet/.test(str), str.slice(0, 120));
    check("strength: a lift logged without a usable set says why", /Hack Squat Legs - no estimate yet: needs a set with weight and 1-12 reps/.test(str), str.slice(0, 300));
    check("fonts come from this site: no requests off-site", db.external.length === 0, db.external.slice(0, 2).join(", "));
    const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`));
    check("fonts loaded: Oswald, IBM Plex Sans and Mono", ["oswald", "plexSans", "plexMono"].every((f) => fonts.some((x) => x.toLowerCase().includes(f.toLowerCase()) && !/fallback/i.test(x))), fonts.join(", "));
    const fams = await page.evaluate(() => ["h1", "body", "#stats .v", "#steps"].map((s) => getComputedStyle(document.querySelector(s)).fontFamily.split(",")[0]));
    check("headings, text and numbers use their fonts", /oswald/i.test(fams[0]) && /plexSans/i.test(fams[1]) && /oswald/i.test(fams[2]) && /plexMono/i.test(fams[3]), fams.join(" | "));
    check("no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // ---------- A month of history: week strip, dashboard warnings, catch-up, knee sizes ----------
  {
    const logs = {};
    for (let n = 0; n <= 28; n++) logs[K(n)] = { exercises: {}, warmup: [], cardio: false, steps: 8000, weight: n <= 22 ? 84 - 0.1 * n : null, note: "" };
    logs[K(26)].exercises["Chest Press Machine"] = { done: true, kg: 40, sets: [{ reps: 12, kg: 40 }] }; // Mon 21: part of Push
    Object.assign(logs[K(21)], { kneeBefore: 2, kneeAfter: 7 });
    logs[K(21)].exercises["Leg Press"] = { done: true, kg: 50, sets: [{ reps: 10, kg: 50 }] };
    const { ctx, page } = await open(browser, base, { auth: { ...auth, user: { ...auth.user, created_at: "2026-08-26T05:00:00Z" } }, db: { logs, plan: null }, width: 360, height: 800, mobile: false });
    await ready(page);
    const cls = await page.$$eval("#week .dchip", (els) => els.map((e) => e.className));
    check("week strip: part (Mon), missed (Tue)", /\bpart\b/.test(cls[0]) && /\bmiss\b/.test(cls[1]), cls.slice(0, 3).join(" | "));
    check("missed day says so to screen readers", (await page.locator("#week .dchip").nth(1).getAttribute("aria-label")).endsWith(", missed"));
    const knee = await box(page, 'button[data-knee="kneeBefore:0"]');
    check("knee buttons at 360px: two rows, at least 38 x 44", knee.width >= 38 && knee.height >= 44, `${Math.round(knee.width)}x${Math.round(knee.height)}`);
    await page.locator("#week .dchip").nth(3).click(); // Thursday: rest, with Push and Pull missed this week
    const cu = await page.$eval(".catchup", (e) => ({ bg: getComputedStyle(e).backgroundColor, c: getComputedStyle(e).color }));
    check("catch-up suggestion is neutral, not warning orange", cu.bg === "rgb(255, 255, 255)" && cu.c === "rgb(21, 23, 27)", JSON.stringify(cu));
    await openTab(page, "progress");
    const warn = await page.$eval("#dashFlags li.warn", (e) => ({ c: getComputedStyle(e).color, m: getComputedStyle(e).marginBottom }));
    check("dashboard warnings: dark text on the tint (was orange, 3.68:1)", warn.c === "rgb(21, 23, 27)" && warn.m === "0px", JSON.stringify(warn));
    const part = await page.$eval("#dashPlan .legend i.part", (e) => getComputedStyle(e).backgroundColor);
    check("calendar: some-lifts days are green-tinted, not orange", part === "rgb(220, 239, 227)", part);
    await ctx.close();
  }
}
