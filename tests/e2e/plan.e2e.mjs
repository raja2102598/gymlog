// Renaming a lift in the plan editor (RAJ-34): carrying its logged history over to the new name, refusing a
// name that already has history of its own or clashes with another lift on the same day, and the plain rename
// when there's no history yet to lose.
import fs from "node:fs";
import { K, flat, liftEl, open, openTab, planDone, ready, session, until } from "./harness.mjs";

// It opens a renamed lift's page, so it runs with the other suites that do when that page or its charts change.
export const covers = ["src/components/dashboard/LiftDetail.tsx", "src/components/health/Bars.tsx", "src/components/health/Trend.tsx", "src/lib/scale.ts"];

function history() {
  const logs = {};
  for (let n = 0; n <= 28; n++) logs[K(n)] = { exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "" };
  const lift = (n, name, a) => {
    logs[K(n)].exercises[name] = { done: true, kg: Math.max(...a.map((s) => s[1])), sets: a.map(([reps, kg]) => ({ reps, kg })) };
  };
  lift(0, "Leg Press", [[10, 40], [10, 40], [10, 40]]);
  lift(14, "Leg Press", [[10, 45], [10, 45], [10, 45]]);
  lift(21, "Leg Press", [[12, 50], [12, 50], [12, 50]]); // every set hit the top of 10-12: ready to go up
  lift(21, "Hack Squat", [[10, 20], [10, 20], [10, 20]]);
  lift(0, "Lat Pulldown", [[8, 60]]); // a Pull-day lift with its own history, for the "already has history" refusal
  lift(0, "Calf Raise", [[15, 10]]); // history on the lift used for the "same day" clash refusal
  return logs;
}

export default async function plan({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000060", "2026-08-26T05:00:00Z", "t@example.com");
  const db = { logs: history(), plan: null };
  const { ctx, page } = await open(browser, base, { auth, db });
  await ready(page);

  // --- open the plan editor: today (Wed 23 Sept) is a Legs day, so it opens there directly
  await openTab(page, "settings");
  await page.locator("#planBtn").click();
  check("plan editor opens on today's day", (await page.locator("#planView").isVisible()) && (await page.locator("#pe_name").inputValue()) === "Legs");
  check("Lift 2 is Leg Press, with history", (await page.locator("#pe_x1_name").inputValue()) === "Leg Press");

  // --- renaming a lift with history asks to carry it over, and carries it when you say yes
  let asked = "";
  page.removeAllListeners("dialog");
  page.once("dialog", (d) => ((asked = d.message()), d.accept()));
  const name1 = page.locator("#pe_x1_name");
  await name1.click();
  await name1.fill("Leg Press Machine");
  await name1.blur();
  await until(() => db.plan?.days?.[2]?.exercises?.[1]?.name === "Leg Press Machine" && db.logs[K(0)]?.exercises?.["Leg Press Machine"]);
  check(
    "asks to carry the history over, naming both, before doing it",
    asked === "Carry Leg Press’s history over to Leg Press Machine? Every logged day, and anything swapped for Leg Press, will show Leg Press Machine instead.",
    asked,
  );
  check(
    "says so once carried, over every day that had it",
    /Carried Leg Press’s history over to Leg Press Machine: 3 days\./.test(await flat(page.locator("#peRename"))),
    await flat(page.locator("#peRename")),
  );
  check(
    "every day it was logged moved to the new key, old key gone from all of them",
    Object.keys(db.logs[K(0)].exercises).includes("Leg Press Machine") &&
      !("Leg Press" in db.logs[K(0)].exercises) &&
      Object.keys(db.logs[K(14)].exercises).join() === "Leg Press Machine" &&
      Object.keys(db.logs[K(21)].exercises).sort().join("|") === "Hack Squat|Leg Press Machine",
    JSON.stringify([db.logs[K(0)].exercises, db.logs[K(21)].exercises]),
  );
  page.on("dialog", (d) => d.accept());

  // --- Today: the renamed lift carries its numbers and its go-up hint, the old name is gone
  await planDone(page);
  await openTab(page, "today");
  const renamed = liftEl(page, "Leg Press Machine");
  check(
    "Today shows it under the new name, with last time's sets carried over",
    /Last 12, 12, 12 × 50 kg · 16\/09/.test(await flat(renamed.locator(".hint"))),
    await flat(renamed.locator(".hint")),
  );
  check(
    "the go-up hint still fires: it reads what that session was actually asked for, not a fresh start",
    /Go up to 52\.5 kg: every set hit 12 reps last time/.test(await flat(renamed.locator(".prog"))),
    await flat(renamed.locator(".prog")),
  );
  const todayNames = (await page.locator("#session .ex li .nm").allInnerTexts()).map((t) => t.trim());
  check("the old name is gone from Today", !todayNames.some((t) => /^Leg Press\b(?! Machine)/.test(t)), todayNames.join(", "));

  // --- Strength and the lift's own page: one continuous history under the new name
  await openTab(page, "progress");
  const st = await flat(page.locator("#dashStrength"));
  check("Strength lists it merged under the new name, not as two lifts", st.includes("Leg Press Machine") && !st.includes("Leg Press Legs"), st.slice(0, 300));
  await page.locator("#dashStrength .lifts li", { hasText: "Leg Press Machine" }).first().locator(".ln").click();
  await page.waitForSelector("#dashLift");
  check(
    "the lift's own page opens under the new name",
    (await page.textContent("#screenTitle")) === "Leg Press Machine" && page.url().endsWith("/#progress/lift/Leg%20Press%20Machine"),
    page.url(),
  );
  const kp = await flat(page.locator("#dashLift"));
  check(
    "lift page: all three sessions, before and after the rename, are one history",
    /50 kg ?heaviest set, 16 Sept/.test(kp) && /0\.8 ?sessions a week on average/.test(kp),
    kp,
  );
  check("lift page: a dot for each of the three sessions on the chart", (await page.locator("#liftTop svg circle.dot").count()) === 3);
  await page.click("#backBtn");

  // --- CSV export: the days logged before the rename export under the new name too
  await openTab(page, "settings");
  const [csv] = await Promise.all([page.waitForEvent("download"), page.click("#csvBtn")]);
  const text = fs.readFileSync(await csv.path(), "utf8");
  check(
    "CSV: history from before the rename exports under the new name, never the old one",
    text.includes(`${K(0)},Legs,Leg Press Machine,`) && text.includes(`${K(21)},Legs,Leg Press Machine,`) && !text.includes(",Leg Press,"),
    text,
  );

  // --- refuses to carry history onto a name that already has its own, asking nothing. The lift is still renamed as
  // typed, since the plan saves as you type; only the history stays where it was.
  await page.locator("#planBtn").click();
  let dialogFired = false;
  page.removeAllListeners("dialog");
  page.once("dialog", () => (dialogFired = true));
  const name0 = page.locator("#pe_x0_name");
  await name0.click();
  await name0.fill("Lat Pulldown");
  await name0.blur();
  await until(async () => (await flat(page.locator("#peRename"))) !== "");
  check(
    "refuses when the new name already has its own history, without asking to confirm anything",
    !dialogFired && (await flat(page.locator("#peRename"))) === "“Lat Pulldown” already has its own history, so Hack Squat’s can’t be carried over there too.",
    await flat(page.locator("#peRename")),
  );
  await until(() => db.plan.days[2].exercises[0].name === "Lat Pulldown");
  check(
    "no history moved: Hack Squat's day keeps it, and Lat Pulldown's keeps its own",
    "Hack Squat" in db.logs[K(21)].exercises && !("Lat Pulldown" in db.logs[K(21)].exercises) && "Lat Pulldown" in db.logs[K(0)].exercises,
    JSON.stringify([db.logs[K(0)].exercises, db.logs[K(21)].exercises]),
  );
  // Typing the old name back is refused the same way (Hack Squat has history), and moves nothing either.
  await name0.click();
  await name0.fill("Hack Squat");
  await name0.blur();
  await until(() => db.plan.days[2].exercises[0].name === "Hack Squat");
  check(
    "typing the old name back renames it back, and moves no history",
    !dialogFired && "Hack Squat" in db.logs[K(21)].exercises && "Lat Pulldown" in db.logs[K(0)].exercises,
    await flat(page.locator("#peRename")),
  );

  // --- refuses a name already used by another lift the same day, asking nothing
  page.removeAllListeners("dialog");
  page.once("dialog", () => (dialogFired = true));
  dialogFired = false;
  const name4 = page.locator("#pe_x4_name");
  await name4.click();
  await name4.fill("Hamstring Curl");
  await name4.blur();
  await until(async () => (await flat(page.locator("#peRename"))) !== "");
  check(
    "refuses a name already used by another lift that day, without asking to confirm anything",
    !dialogFired && (await flat(page.locator("#peRename"))) === "Another lift on Wed is already called “Hamstring Curl”. Give them different names to carry Calf Raise’s history over.",
    await flat(page.locator("#peRename")),
  );
  check("no history moved there either", "Calf Raise" in db.logs[K(0)].exercises && !("Hamstring Curl" in db.logs[K(0)].exercises));
  // Back to Calf Raise: Hamstring Curl has no history here, so that's a plain rename, with nothing to ask.
  await name4.click();
  await name4.fill("Calf Raise");
  await name4.blur();
  await until(() => db.plan.days[2].exercises[4].name === "Calf Raise");
  check("renaming it back asks nothing", !dialogFired);

  // --- saying no in the prompt still renames the lift; it just starts a fresh history
  page.removeAllListeners("dialog");
  page.once("dialog", (d) => ((asked = d.message()), d.dismiss()));
  await name0.click();
  await name0.fill("Hack Squat V2");
  await name0.blur();
  await until(() => db.plan?.days?.[2]?.exercises?.[0]?.name === "Hack Squat V2");
  check(
    "declining the carry-over still renames the lift, without moving its old history",
    asked.startsWith("Carry Hack Squat’s history over to Hack Squat V2?") && "Hack Squat" in db.logs[K(21)].exercises && !("Hack Squat V2" in db.logs[K(21)].exercises),
    asked,
  );
  page.on("dialog", (d) => d.accept());

  // --- a lift with no history yet needs no prompt at all: it's just a rename
  page.removeAllListeners("dialog");
  dialogFired = false;
  page.once("dialog", () => (dialogFired = true));
  const name2 = page.locator("#pe_x2_name");
  await name2.click();
  await name2.fill("Leg Extension V2");
  await name2.blur();
  await until(() => db.plan?.days?.[2]?.exercises?.[2]?.name === "Leg Extension V2");
  check("a lift with no history renames without any prompt or message", !dialogFired && (await flat(page.locator("#peRename"))) === "");
  page.on("dialog", (d) => d.accept());

  check("only logs/plans endpoints called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
