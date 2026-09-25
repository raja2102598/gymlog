// Two phones on one account (two browser contexts answered from one `db`). Each day is saved over the version the
// phone last had, so neither overwrites the other unseen: the same thing changed on both asks which version to keep,
// and edits to different lifts merge. An edit waiting through a reload keeps the version it started from. Steps and
// weight are in Train's day log; sets are logged in the workout.
import { flat, open, openTab, openWorkout, ready, session, shot, until } from "./harness.mjs";

const D = "2026-09-23";

export default async function sync({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000061", "2026-09-01T00:00:00Z", "t@example.com");
  const db = { logs: { [D]: { exercises: {}, warmup: [], cardio: false, steps: 7000, weight: null, note: "" } }, plan: null };
  const a = await open(browser, base, { auth, db, width: 360, height: 800 });
  const b = await open(browser, base, { auth, db, width: 360, height: 800 });
  await Promise.all([ready(a.page), ready(b.page)]);
  await openTab(a.page, "train");
  await openTab(b.page, "train");
  const asked = (p) => p.locator("#syncConflict");

  // ---------- The same day changed on both: the second phone to save is asked, and either choice holds ----------
  await a.page.fill("#steps", "9100");
  await until(() => db.logs[D].steps === 9100);
  await b.page.fill("#steps", "9200");
  await until(() => asked(b.page).isVisible(), 8000);
  check(
    "the second phone to save the day is told, and nothing is overwritten",
    (await flat(b.page.locator("#conflictMsg"))) === "23 Sept was changed on another device." && db.logs[D].steps === 9100 && (await b.page.inputValue("#steps")) === "9200",
    await flat(b.page.locator("#syncBar")),
  );
  const buttons = await b.page.$$eval("#syncConflict button", (els) => els.map((e) => [e.textContent, Math.round(e.getBoundingClientRect().height)]));
  check(
    "it offers both versions, each a full-size button",
    buttons.map((x) => x[0]).join(" | ") === "Keep this phone’s version | Keep the other version" && buttons.every((x) => x[1] >= 44),
    JSON.stringify(buttons),
  );
  check("the sync status says the day isn't synced", (await b.page.textContent("#status")) === "Not synced yet", await b.page.textContent("#status"));
  await b.page.locator("#steps").blur();
  await shot(b.page, "8-sync-conflict");
  // The question makes the bar tall on a phone. Going back up through Train (the day log, then the session's lifts)
  // with Shift+Tab, each control lands below the bar, not under it.
  const from = await b.page.evaluate(() => {
    const boxes = document.querySelectorAll("#trainView input, #trainView textarea");
    boxes[boxes.length - 1].focus({ preventScroll: true });
    window.scrollTo(0, document.body.scrollHeight);
    return scrollY;
  });
  const under = [];
  for (let i = 0; i < 30; i++) {
    await b.page.keyboard.press("Shift+Tab");
    const r = await b.page.evaluate(() => {
      const a = document.activeElement, bar = document.querySelector("#syncBar").getBoundingClientRect();
      return { control: a.getAttribute("aria-label") || a.textContent.trim() || a.id, top: Math.round(a.getBoundingClientRect().top), barBottom: Math.round(bar.bottom) };
    });
    if (r.top < r.barBottom) under.push(r);
  }
  const to = await b.page.evaluate(() => scrollY);
  check("with the question up, each control reached with Shift+Tab lands below the bar", to < from && under.length === 0, JSON.stringify({ from, to, under }));
  await b.page.click("#keepMine");
  await until(async () => db.logs[D].steps === 9200 && (await b.page.locator("#syncBar").isHidden()) && (await b.page.textContent("#status")) === "Synced");
  check("Keep this phone's version saves it over the other, and the bar goes", db.logs[D].steps === 9200 && (await b.page.locator("#syncBar").isHidden()) && (await b.page.textContent("#status")) === "Synced");

  // The first phone is a version behind now, and changes the day again.
  await a.page.fill("#weight", "80.5");
  await until(() => asked(a.page).isVisible(), 8000);
  check("the first phone, now behind, is asked in turn", (await flat(a.page.locator("#conflictMsg"))) === "23 Sept was changed on another device." && db.logs[D].weight === null);
  const writes = db.writes.logs;
  await a.page.click("#keepTheirs");
  await until(async () => (await a.page.locator("#syncBar").isHidden()) && (await a.page.inputValue("#steps")) === "9200");
  check(
    "Keep the other version shows it on this phone, and writes nothing",
    (await a.page.inputValue("#steps")) === "9200" && (await a.page.inputValue("#weight")) === "" && db.logs[D].steps === 9200 && db.logs[D].weight === null && db.writes.logs === writes,
    JSON.stringify({ steps: await a.page.inputValue("#steps"), weight: await a.page.inputValue("#weight"), db: db.logs[D] }),
  );

  // ---------- Different lifts on each phone, from the same version: merged, nothing asked ----------
  // Leg Press is the day's lift 1, Leg Extension lift 2: the first set's reps (#s<lift>_0_r) of each, in the workout.
  await openWorkout(a.page, "Leg Press");
  await openWorkout(b.page, "Leg Extension");
  await a.page.fill("#s1_0_r", "10");
  await until(() => db.logs[D].exercises["Leg Press"]?.sets?.[0]?.reps === 10);
  await b.page.fill("#s2_0_r", "12");
  await until(() => db.logs[D].exercises["Leg Extension"]?.sets?.[0]?.reps === 12, 8000);
  await b.page.waitForTimeout(300);
  check(
    "edits to different lifts on each phone are both kept, and nothing is asked",
    db.logs[D].exercises["Leg Press"]?.sets?.[0]?.reps === 10 && db.logs[D].steps === 9200 && (await b.page.locator("#syncBar").isHidden()),
    JSON.stringify(db.logs[D]),
  );
  await b.page.click('ol.wprog button[aria-label="Go to exercise 2"]');
  await b.page.waitForSelector("#s1_0_r");
  check("the second phone shows the first one's lift too", (await b.page.inputValue("#s1_0_r")) === "10", await b.page.inputValue("#s1_0_r"));

  // ---------- An edit waiting through a reload is saved over the version it started from, without asking ----------
  await b.page.click("#closeWorkout");
  await b.page.waitForSelector("#trainView");
  db.failWrites = true;
  await b.page.fill("#steps", "9300");
  await until(() => b.page.locator("#syncMsg").isVisible(), 8000);
  db.failWrites = false;
  await b.page.reload();
  await until(() => db.logs[D].steps === 9300, 8000);
  await b.page.waitForTimeout(300);
  check("an edit waiting through a reload keeps its version: saved, nothing asked", db.logs[D].steps === 9300 && (await b.page.locator("#syncConflict").count()) === 0);

  for (const [name, { page }] of [["first", a], ["second", b]]) {
    // The mocked 503 and the app's note of it are expected; uncaught errors aren't.
    const uncaught = page.errors.filter((e) => e.startsWith("pageerror"));
    check(`no uncaught errors on the ${name} phone`, uncaught.length === 0, uncaught.join(" | "));
  }
  check("only the expected endpoints", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  await a.ctx.close();
  await b.ctx.close();
}
