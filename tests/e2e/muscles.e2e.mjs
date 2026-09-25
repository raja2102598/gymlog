// Weekly sets per muscle on Progress (RAJ-56): four weeks of working sets per muscle from the library's muscles,
// warm-ups and drop sets left out, a note on last week, untagged lifts listed apart, and a set logged on Today
// adding to this week's total.
import { K, flat, liftEl, open, openTab, ready, session, shot, until } from "./harness.mjs";

export default async function muscles({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000056", "2026-08-26T05:00:00Z", "t@example.com");
  const sets = (n, more = []) => [...Array.from({ length: n }, () => ({ reps: 10, kg: 40 })), ...more];
  const lift = (n, more = [], x = {}) => ({ done: true, kg: 40, sets: sets(n, more), ...x });
  const day = (exercises) => ({ exercises, warmup: [], cardio: false, steps: 6000, weight: null, note: "" });
  const db = {
    logs: {
      // Two weeks ago, Leg Extension swapped for Hack Squat: quads, with calves, glutes and hamstrings.
      [K(14)]: day({ "Leg Extension": lift(2, [], { swap: "Hack Squat" }) }),
      // Last week: a warm-up and a drop set that don't count, and a lift the library doesn't know.
      [K(21)]: day({
        "Leg Extension": lift(3, [{ reps: 8, kg: 20, type: "warmup" }, { reps: 12, kg: 30, type: "drop" }]),
        "Leg Press": lift(3),
        "Hamstring Curl": lift(4),
        "Mystery Press": lift(2),
      }),
      [K(28)]: day({ "Leg Extension": { done: false, kg: 40, sets: sets(2) } }),
    },
    plan: null,
  };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);
  const row = (m) => page.locator(`#dashMuscles tr[data-muscle="${m}"]`);
  const cells = async (m) => (await row(m).locator("td").allInnerTexts()).map((t) => t.trim());

  await openTab(page, "progress");
  const heads = (await page.locator("#dashMuscles thead th").allInnerTexts()).map((t) => t.trim());
  check("four weeks, this one last", heads.length === 5 && heads[0] === "Muscle" && heads[4] === "This week", heads.join(" | "));
  check("quads: a swap counts as the lift done, and last week leaves out the warm-up and the drop set", JSON.stringify(await cells("quadriceps")) === '["-","2","6","2"]', JSON.stringify(await cells("quadriceps")));
  check("hamstrings: a set each from a main lift, a half from others", JSON.stringify(await cells("hamstrings")) === '["-","1","5.5","-"]', JSON.stringify(await cells("hamstrings")));
  check("most sets first", (await page.locator("#dashMuscles tbody tr").first().getAttribute("data-muscle")) === "quadriceps");
  check("under 10 last week is noted", (await flat(row("quadriceps").locator(".musc-n"))) === "Under 10 last week");
  check("but not for a muscle only worked on the side", (await row("glutes").locator(".musc-n").count()) === 0);
  const untagged = await flat(page.locator("#muscUntagged"));
  check("a lift with no muscles is listed apart, not guessed", untagged.startsWith("Untagged, so not counted: Mystery Press (2 sets)."), untagged);
  await page.locator("#dashMuscles").scrollIntoViewIfNeeded();
  await shot(page, "muscles");
  // It fits a small phone, with no sideways scroll.
  await page.setViewportSize({ width: 320, height: 700 });
  const fit = await page.evaluate(() => {
    const card = document.querySelector("#dashMuscles");
    return { page: document.documentElement.scrollWidth, card: card.scrollWidth, room: card.clientWidth };
  });
  check("the table fits a 320px screen", fit.page <= 320 && fit.card <= fit.room, JSON.stringify(fit));
  await shot(page, "muscles-320");
  await page.setViewportSize({ width: 390, height: 844 });

  // A set logged on Today adds to this week's total.
  await openTab(page, "today");
  await liftEl(page, "Leg Extension").locator('input[data-set$=":2:reps"]').fill("10");
  await until(() => db.logs[K(28)]?.exercises?.["Leg Extension"]?.sets?.[2]?.reps === 10);
  await openTab(page, "progress");
  check("a set logged today counts this week", (await cells("quadriceps"))[3] === "3", JSON.stringify(await cells("quadriceps")));

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
