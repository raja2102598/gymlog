// Two phones on one account (two browser contexts answered from one `db`). Each day is saved over the version the
// phone last had, so neither overwrites the other unseen: the same thing changed on both asks which version to keep,
// and edits to different lifts merge. An edit waiting through a reload keeps the version it started from.
import { flat, liftEl, open, ready, session, shot, until } from "./harness.mjs";

const D = "2026-09-23";

export default async function sync({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000061", "2026-09-01T00:00:00Z", "t@example.com");
  const db = { logs: { [D]: { exercises: {}, warmup: [], cardio: false, steps: 7000, weight: null, note: "" } }, plan: null };
  const a = await open(browser, base, { auth, db, width: 360, height: 800 });
  const b = await open(browser, base, { auth, db, width: 360, height: 800 });
  await Promise.all([ready(a.page), ready(b.page)]);
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
  check("the top bar says the day isn't synced", (await b.page.textContent("#status")) === "Not synced yet", await b.page.textContent("#status"));
  await b.page.locator("#steps").blur();
  await shot(b.page, "8-sync-conflict");
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
  await liftEl(a.page, "Leg Press").locator('input[data-set$=":0:reps"]').fill("10");
  await until(() => db.logs[D].exercises["Leg Press"]?.sets?.[0]?.reps === 10);
  await liftEl(b.page, "Leg Extension").locator('input[data-set$=":0:reps"]').fill("12");
  await until(() => db.logs[D].exercises["Leg Extension"]?.sets?.[0]?.reps === 12, 8000);
  await b.page.waitForTimeout(300);
  check(
    "edits to different lifts on each phone are both kept, and nothing is asked",
    db.logs[D].exercises["Leg Press"]?.sets?.[0]?.reps === 10 && db.logs[D].steps === 9200 && (await b.page.locator("#syncBar").isHidden()),
    JSON.stringify(db.logs[D]),
  );
  check("the second phone shows the first one's lift too", (await liftEl(b.page, "Leg Press").locator('input[data-set$=":0:reps"]').inputValue()) === "10");

  // ---------- An edit waiting through a reload is saved over the version it started from, without asking ----------
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
