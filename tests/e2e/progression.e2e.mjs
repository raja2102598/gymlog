// Progression options per lift (RAJ-41): the plan editor picks each lift's rule (double progression, linear, or a
// percentage of a 1RM) and an optional deload, and Today's hint and grey numbers follow the rule, naming it;
// Strength on Progress lists a deload alongside the lifts ready for more weight.
import { K, flat, liftEl, open, openTab, planDone, ready, session, until } from "./harness.mjs";

export default async function progression({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000041", "2026-08-26T05:00:00Z", "t@example.com");
  const day = (more = {}) => ({ exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "", ...more });
  const lift = (a) => ({ done: true, kg: Math.max(...a.map((s) => s[1])), sets: a.map(([reps, kg]) => ({ reps, kg })) });
  const short = [[10, 50], [8, 50], [7, 50]];
  // The last two Wednesdays: Hamstring Curl fell short both times; Calf Raise hit 12s, the bottom of its 12-15;
  // Leg Press hit its 12s, but the knee was sore after.
  const db = {
    logs: {
      [K(0)]: day({ steps: 6000 }),
      [K(14)]: day({ exercises: { "Hamstring Curl": lift(short) } }),
      [K(21)]: day({
        exercises: { "Hamstring Curl": lift(short), "Calf Raise": lift([[12, 40], [12, 40], [12, 40]]), "Leg Press": lift([[12, 50], [12, 50], [12, 50]]) },
        kneeBefore: 2,
        kneeAfter: 7,
      }),
    },
    plan: null,
  };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);
  const legs = () => db.plan?.days?.[2]?.exercises ?? [];
  const hint = (name) => liftEl(page, name).locator(".prog");

  check("before any rule is set, Hamstring Curl has no hint: it fell short", (await hint("Hamstring Curl").count()) === 0);
  check("and Calf Raise waits for 15s under double progression", (await hint("Calf Raise").count()) === 0);

  // --- the plan editor, Legs
  await openTab(page, "settings");
  await page.click("#planBtn");
  const prog = (j) => page.locator(".pe-ex").nth(j).locator(".pe-prog");
  check("each lift's progression is folded, naming its rule", !(await prog(3).evaluate((d) => d.open)) && (await flat(prog(3).locator("summary"))) === "Progression: Double progression");
  // Hamstring Curl: a deload after two sessions short.
  await prog(3).locator("summary").click();
  await page.fill("#pe_x3_deloadAfter", "2");
  await until(() => legs()[3]?.deloadAfter === "2");
  check("a deload saves with the plan", legs()[3]?.deloadAfter === "2" && !("prog" in legs()[3]), JSON.stringify(legs()[3]));
  check("and the summary says so", (await flat(prog(3).locator("summary"))) === "Progression: Double progression, deload after 2 short");
  // Calf Raise: linear.
  await prog(4).locator("summary").click();
  await page.selectOption("#pe_x4_prog", "linear");
  await until(() => legs()[4]?.prog === "linear");
  check("linear saves with the plan", legs()[4]?.prog === "linear");
  check("what the rule does shows under it", (await flat(page.locator("#pe_x4_proghow"))) === "Add the step every session each set reaches the bottom of the rep range.");
  // Leg Extension: 75% of a 60 kg 1RM, never logged.
  await prog(2).locator("summary").click();
  check("the 1RM fields show only for a percentage", (await page.locator("#pe_x2_oneRm").count()) === 0);
  await page.selectOption("#pe_x2_prog", "percent");
  await page.fill("#pe_x2_oneRm", "60");
  await page.fill("#pe_x2_pct", "75");
  await until(() => legs()[2]?.pct === "75");
  check("a percentage saves its 1RM with it", legs()[2]?.prog === "percent" && legs()[2]?.oneRm === "60" && legs()[2]?.pct === "75", JSON.stringify(legs()[2]));
  await planDone(page);
  await openTab(page, "today");

  // --- Today: each hint names its rule
  const words = async (name) => [await flat(hint(name)), await hint(name).getAttribute("data-rule")];
  check("a deload after two sessions short", JSON.stringify(await words("Hamstring Curl")) === JSON.stringify(["Deload to 45 kg: 2 sessions in a row fell short, so 10% off 50 kg.", "deload"]), (await words("Hamstring Curl")).join(" | "));
  check("the deload is a warning", await hint("Hamstring Curl").evaluate((el) => el.classList.contains("warn")));
  check("linear, with its step", JSON.stringify(await words("Calf Raise")) === JSON.stringify(["Go up to 42.5 kg: linear, +2.5 kg a session while every set hits 12 reps.", "linear"]), (await words("Calf Raise")).join(" | "));
  check("a percentage of the 1RM, with no history", JSON.stringify(await words("Leg Extension")) === JSON.stringify(["Work at 45 kg: 75% of your 60 kg 1RM.", "percent"]), (await words("Leg Extension")).join(" | "));
  check("a sore knee still holds a knee lift", JSON.stringify(await words("Leg Press")) === JSON.stringify(["Hold 50 kg: your knee was sore after 16/09.", "hold"]), (await words("Leg Press")).join(" | "));
  const ph = (i) => page.locator(`input[data-set="${i}:0:kg"]`).getAttribute("placeholder");
  check("the grey numbers follow: the deload weight, the new weight, the percentage", (await ph(3)) === "45" && (await ph(4)) === "42.5" && (await ph(2)) === "45", [await ph(3), await ph(4), await ph(2)].join(" "));

  // --- Progress: the deload next to the lifts ready for more weight
  await openTab(page, "progress");
  const flags = await flat(page.locator("#dashFlags"));
  check("a note says a lift is due a deload", flags.includes("1 lift is due a deload. See Strength.") && flags.includes("1 lift is ready for more weight."), flags);
  const up = await page.locator('#dashStrength h3.dh:has-text("Ready to add weight") + ul.plain > li').allInnerTexts();
  const rows = up.map((t) => t.replace(/\s+/g, " ").trim());
  check("Strength lists it, and the linear lift", rows.includes("Calf Raise Legs: 40 → 42.5 kg") && rows.includes("Hamstring Curl Legs: 50 → 45 kg (deload)"), rows.join(" | "));
  check("a percentage with nothing logged to go up from isn't listed", !rows.some((r) => r.startsWith("Leg Extension")), rows.join(" | "));

  // --- back to double progression: the rule leaves the plan
  await openTab(page, "settings");
  await page.click("#planBtn");
  await prog(4).locator("summary").click();
  await page.selectOption("#pe_x4_prog", "double");
  await until(() => legs()[4] && !("prog" in legs()[4]));
  check("Double progression is the default, so it isn't stored", !("prog" in legs()[4]), JSON.stringify(legs()[4]));
  await planDone(page);
  await openTab(page, "today");
  check("and Calf Raise waits for 15s again", (await hint("Calf Raise").count()) === 0);

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
