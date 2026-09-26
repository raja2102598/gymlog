// Voice logging: the Log sets by voice switch in Settings → Voice, and a microphone on each lift's card in the workout
// that logs what's said the way typing it would. Chromium's own speech recognition is swapped for a fake that answers
// from a queue.
import { answerAsk, flat, lastAsked, open, openSetting, openTab, openWorkout, ready, session, settled, until, TAB_VIEWS } from "./harness.mjs";

const TODAY = "2026-09-23"; // Wednesday: Legs
const NB = "\u00a0";

// Last week's Legs, so today's sets have something to beat.
const logs = () => ({
  "2026-09-16": {
    exercises: {
      "Leg Press": { done: true, kg: 40, sets: [{ reps: 10, kg: 40 }, { reps: 10, kg: 40 }, { reps: 10, kg: 40 }] },
      "Hack Squat": { done: true, kg: 20, sets: [{ reps: 10, kg: 20 }, { reps: 10, kg: 20 }, { reps: 10, kg: 20 }] },
    },
    warmup: [],
    cardio: false,
    steps: 9000,
    weight: 82,
    note: "",
  },
});

/** Chromium has speech recognition of its own: without it, as in a browser that has none. */
function noSpeech() {
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
}

/** A recognizer that answers each start() after window.__wait ms with the next entry of window.__said: a list of
 *  guesses, or { error } to fail with that error; with nothing queued, "no-speech". Then onend. It records how it
 *  was set up in window.__setups, and each abort() in window.__aborts. */
function fakeSpeech() {
  window.__said = [];
  window.__setups = [];
  window.__aborts = 0;
  window.__wait = 60;
  class FakeRecognition {
    lang = "";
    continuous = true;
    interimResults = true;
    maxAlternatives = 1;
    onresult = null;
    onerror = null;
    onnomatch = null;
    onend = null;
    start() {
      window.__setups.push({ lang: this.lang, continuous: this.continuous, interimResults: this.interimResults, maxAlternatives: this.maxAlternatives });
      this.timer = setTimeout(() => {
        const next = window.__said.shift();
        if (!next) this.onerror?.({ error: "no-speech" });
        else if (next.error) this.onerror?.({ error: next.error });
        else this.onresult?.({ resultIndex: 0, results: [Object.assign(next.map((transcript) => ({ transcript, confidence: 0.9 })), { isFinal: true })] });
        this.onend?.();
      }, window.__wait);
    }
    stop() {}
    abort() {
      clearTimeout(this.timer);
      window.__aborts++;
      this.onerror?.({ error: "aborted" });
      this.onend?.();
    }
  }
  delete window.SpeechRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
}

/** A set row as it shows: its classes, its two boxes, and the PR badge's title when the badge shows. */
const rowOf = (lift, j) =>
  lift
    .locator(".srow.set")
    .nth(j)
    .evaluate((e) => {
      const b = e.querySelector(".prb");
      return { cls: e.className, reps: e.querySelector('[data-set$=":reps"]').value, kg: e.querySelector('[data-set$=":kg"]').value, pr: getComputedStyle(b).display === "none" ? "" : b.title };
    });

// Wednesday's Legs in the workout, one card at a time: each lift is its own step, in this order, then the cycling.
const LIFTS = ["Hack Squat", "Leg Press", "Leg Extension", "Hamstring Curl", "Calf Raise"];
/** The workout's card: the one lift on show. */
const cardOf = (page) => page.locator("#workoutView section.ex-card");
/** Moves the workout to a lift, with its step along the top, unless it's on show already. */
async function goTo(page, name) {
  const nm = page.locator("#workoutView .ex-name .nm");
  if ((await nm.count()) && (await flat(nm)) === name) return;
  await page.locator("#workoutView ol.wprog > li").nth(LIFTS.indexOf(name)).locator("button").click();
  await until(async () => (await nm.count()) > 0 && (await flat(nm)) === name);
}
/** The number of microphones on each lift's card, going through the workout's steps. */
async function micsPerLift(page) {
  const n = [];
  for (const name of LIFTS) {
    await goTo(page, name);
    n.push(await cardOf(page).locator("[data-voice]").count());
  }
  return n;
}

export default async function voice({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000048");

  // ---------- A browser without speech recognition ----------
  {
    const { ctx, page, db } = await open(browser, base, { auth, db: { logs: logs(), plan: null }, url: null });
    await ctx.addInitScript(noSpeech);
    await ctx.addInitScript(() => localStorage.setItem("gymlog.voice.v1", "true"));
    await page.goto(base);
    await ready(page);
    await openWorkout(page, "Leg Press");
    check("no speech recognition: no microphones in the workout, even with the switch left on", (await page.locator("[data-voice], .ex-card .said").count()) === 0);
    await page.click("#closeWorkout");
    await page.waitForSelector("#trainView");
    await openTab(page, "settings");
    check("no speech recognition: no Log sets by voice in Settings", (await page.locator("#setVoice, #voiceLog").count()) === 0 && (await page.locator("#setLook").count()) === 1);
    check("no speech recognition: no console errors", page.errors.length === 0 && db.unexpected.length === 0, [...page.errors, ...db.unexpected].join(" | "));
    await ctx.close();
  }

  // ---------- A French browser: what's heard is read by an English parser, so it listens in English ----------
  {
    const { ctx, page, db } = await open(browser, base, { auth, db: { logs: logs(), plan: null }, url: null });
    await ctx.addInitScript(fakeSpeech);
    await ctx.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "language", { configurable: true, get: () => "fr-FR" });
      Object.defineProperty(Navigator.prototype, "languages", { configurable: true, get: () => ["fr-FR", "fr"] });
      localStorage.setItem("gymlog.voice.v1", "true");
    });
    await page.goto(base);
    await ready(page);
    await openWorkout(page, "Leg Press");
    const lp = cardOf(page);
    await page.evaluate(() => window.__said.push(["10 at 45"]));
    await lp.locator("[data-voice]").click();
    await until(async () => /^Heard/.test(await flat(lp.locator(".said"))));
    const setup = await page.evaluate(() => ({ lang: window.__setups[0]?.lang, browser: navigator.language }));
    check("a French browser: it listens in English, and logs the set", setup.browser === "fr-FR" && setup.lang === "en-US" && (await lp.locator(".srow.set.logged").count()) === 1, JSON.stringify(setup));
    check("a French browser: no console errors", page.errors.length === 0 && db.unexpected.length === 0, [...page.errors, ...db.unexpected].join(" | "));
    await ctx.close();
  }

  // ---------- What typing 10 and 45 into Leg Press's first set gives, to compare with saying it ----------
  const typedDb = { logs: logs(), plan: null };
  let typed;
  {
    const { ctx, page } = await open(browser, base, { auth, db: typedDb });
    await ready(page);
    await openWorkout(page, "Leg Press");
    const lp = cardOf(page);
    await lp.locator('input[data-set$=":0:reps"]').fill("10");
    await lp.locator('input[data-set$=":0:kg"]').fill("45");
    await until(() => typedDb.logs[TODAY]?.exercises["Leg Press"]?.sets?.[0]?.kg === 45);
    typed = { row: await rowOf(lp, 0), saved: typedDb.logs[TODAY]?.exercises["Leg Press"] };
    await ctx.close();
  }

  // ---------- Speech recognition, faked ----------
  const db = { logs: logs(), plan: null };
  const { ctx, page } = await open(browser, base, { auth, db, url: null });
  await ctx.addInitScript(fakeSpeech);
  await page.goto(base);
  await ready(page);
  await openWorkout(page, "Leg Press");
  check("the switch starts off: no microphones in the workout", (await page.locator("[data-voice], .ex-card .said").count()) === 0);
  await page.click("#closeWorkout");
  await page.waitForSelector("#trainView");

  await openTab(page, "settings");
  await openSetting(page, "setVoice");
  const sw = page.locator("#voiceLog");
  check(
    "Settings: Log sets by voice, a switch that starts off, and says where the words go",
    (await sw.getAttribute("role")) === "switch" &&
      (await sw.getAttribute("aria-checked")) === "false" &&
      (await flat(page.locator("#voiceT"))) === "Log sets by voice" &&
      (await flat(page.locator("#voiceD"))) === "Uses your browser’s speech recognition. In Chrome, what you say is sent to Google to be turned into text; Gym Log keeps only the numbers.",
    await flat(page.locator("#setVoice")),
  );
  await sw.click();
  check("switched on, and kept on this device", (await sw.getAttribute("aria-checked")) === "true" && (await page.evaluate(() => localStorage.getItem("gymlog.voice.v1"))) === "true");

  await page.click("#backBtn");
  await page.waitForSelector(TAB_VIEWS); // Settings closes onto the tab it was opened from
  await openWorkout(page, "Leg Press");
  const steps = await page.locator("#workoutView ol.wprog > li").count(), perLift = await micsPerLift(page);
  check("switched on: one microphone on each lift's card", steps === 6 && JSON.stringify(perLift) === "[1,1,1,1,1]", `${JSON.stringify(perLift)} over ${steps} steps`);
  await goTo(page, "Leg Press");
  const lp = cardOf(page), mic = lp.locator("[data-voice]"), line = lp.locator(".said");
  const box = await mic.boundingBox();
  check(
    "the microphone: named for its lift, not pressed, at least 44px, with the card's ···, with a polite live line",
    (await mic.getAttribute("aria-label")) === "Log a set of Leg Press by voice" &&
      (await mic.getAttribute("aria-pressed")) === "false" &&
      Math.round(box.width) >= 44 &&
      Math.round(box.height) >= 44 &&
      (await mic.evaluate((e) => !!e.parentElement?.querySelector(":scope > [data-more]"))) &&
      (await line.getAttribute("aria-live")) === "polite" &&
      (await line.evaluate((e) => e.getBoundingClientRect().height)) === 0,
    JSON.stringify(box),
  );

  const say = (...guesses) => page.evaluate((g) => window.__said.push(g), guesses);
  const fail = (error) => page.evaluate((e) => window.__said.push({ error: e }), error);
  const heard = async (loc = line) => (await loc.textContent()) ?? "";
  /** Moves to a lift, taps its microphone and waits for the line under its sets to match. */
  const tap = async (name, want) => {
    await goTo(page, name);
    await cardOf(page).locator("[data-voice]").click();
    await until(async () => want.test(await heard(cardOf(page).locator(".said"))));
  };
  /** Whether the card on show is ticked off (done). */
  const ticked = async () => /\bchecked\b/.test(await cardOf(page).getAttribute("class"));
  const saved = () => db.logs[TODAY]?.exercises["Leg Press"];

  // --- "10 at 45" logs set 1, as typing does
  await say("10 at 45");
  await tap("Leg Press", /^Heard/);
  check("“10 at 45” fills set 1, and says so", (await heard()) === `Heard “10 at 45”: set${NB}1, 10${NB}×${NB}45${NB}kg.`, JSON.stringify(await heard()));
  const setup = await page.evaluate(() => ({ ...window.__setups[0], browser: navigator.language }));
  check("it listened once, for up to 5 guesses, without interim results, in the browser's English", setup.maxAlternatives === 5 && setup.interimResults === false && setup.continuous === false && setup.lang === setup.browser, JSON.stringify(setup));
  await until(() => saved()?.sets?.[0]?.kg === 45);
  const spoken = { row: await rowOf(lp, 0), saved: saved() };
  check("its row, PR badge and saved set are what typing 10 and 45 gives", JSON.stringify(spoken) === JSON.stringify(typed) && /\bpr\b/.test(spoken.row.cls) && /\blogged\b/.test(spoken.row.cls), `${JSON.stringify(spoken)} vs typed ${JSON.stringify(typed)}`);

  // --- "again" copies it into set 2
  await say("again");
  await tap("Leg Press", /set.2/);
  const r2 = await rowOf(lp, 1);
  check("“again” fills set 2 the same", (await heard()) === `Heard “again”: set${NB}2, 10${NB}×${NB}45${NB}kg.` && r2.reps === "10" && r2.kg === "45" && /\blogged\b/.test(r2.cls), JSON.stringify([await heard(), r2]));
  await until(() => saved()?.sets?.length === 2);
  check("…and saves it", JSON.stringify(saved()?.sets) === JSON.stringify([{ reps: 10, kg: 45 }, { reps: 10, kg: 45 }]), JSON.stringify(saved()));

  // --- "undo" clears it again
  await say("undo");
  await tap("Leg Press", /cleared/);
  const r2b = await rowOf(lp, 1);
  check("“undo” clears set 2", (await heard()) === `Heard “undo”: set${NB}2 cleared.` && r2b.reps === "" && r2b.kg === "" && !/\blogged\b/.test(r2b.cls), JSON.stringify([await heard(), r2b]));
  await until(() => saved()?.sets?.[1]?.reps === null);
  check("…and saves that", JSON.stringify(saved()?.sets) === JSON.stringify([{ reps: 10, kg: 45 }, { reps: null, kg: null }]) && saved()?.done === false, JSON.stringify(saved()));

  // --- "done" ticks the lift: its card shows it done, as the Done box in its ··· menu says
  await say("done");
  await tap("Leg Press", /marked done/);
  await page.click('[data-more="1"]');
  const boxTicked = await page.locator("#ex1").isChecked();
  await page.click('[data-more="1"]');
  check("“done” ticks the lift", (await heard()) === "Heard “done”: marked done." && boxTicked && (await ticked()));
  await until(() => saved()?.done === true);
  check("…and saves it", saved()?.done === true, JSON.stringify(saved()));

  // --- "skip" skips it for today
  await say("skip it");
  await tap("Leg Press", /skipped today/);
  check("“skip” skips the lift, with no reason", (await heard()) === "Heard “skip it”: skipped today." && (await flat(lp.locator(".skipnote"))) === "Skipped" && /\bskipped\b/.test(await lp.getAttribute("class")));
  await until(() => saved()?.skipped === true);
  check("…saved as skipped, not done, and no reason", saved()?.skipped === true && saved()?.done === false && !("reason" in saved()), JSON.stringify(saved()));
  check("a skipped lift has no microphone, and focus moves to its ···", (await lp.locator("[data-voice]").count()) === 0 && (await page.evaluate(() => document.activeElement?.getAttribute("data-more"))) === "1");
  // Train's list of the day's lifts shows it skipped.
  await page.click("#closeWorkout");
  await page.waitForSelector("#trainView");
  const lpRow = page.locator("#liftRows li.lrow", { has: page.locator(".lrow-main", { hasText: "Leg Press" }) });
  check("Train's list shows it skipped", /\bskipped\b/.test(await lpRow.getAttribute("class")) && (await flat(lpRow.locator(".row-d"))) === "Skipped", await flat(lpRow));
  await openWorkout(page, "Leg Extension");

  // --- a phrase it can't read changes nothing and says how to put it
  const le = cardOf(page), leLine = le.locator(".said");
  const before = await page.evaluate(() => localStorage.getItem("gymlog.cache.v1"));
  await say("play some music", "play sum music");
  await tap("Leg Extension", /^Heard/);
  check("an unknown phrase shows how to say it", (await heard(leLine)) === `Heard “play some music”. Say it like “10${NB}at${NB}45”.`, JSON.stringify(await heard(leLine)));
  check(
    "…and changes nothing",
    (await page.evaluate(() => localStorage.getItem("gymlog.cache.v1"))) === before && !db.logs[TODAY]?.exercises["Leg Extension"] && (await le.locator(".srow.set.logged").count()) === 0 && !(await ticked()),
  );

  // --- the best of the recognizer's guesses, and a set with only reps
  await say("turn at forty five", "ten at forty five");
  await tap("Leg Extension", /set.1/);
  check("the first guess that reads as a set is used", (await heard(leLine)) === `Heard “ten at forty five”: set${NB}1, 10${NB}×${NB}45${NB}kg.`, JSON.stringify(await heard(leLine)));
  await say("8 reps");
  await tap("Leg Extension", /set.2/);
  const e2 = await rowOf(le, 1);
  check("reps alone take the weight carried over from the set before, as typing reps does", (await heard(leLine)) === `Heard “8 reps”: set${NB}2, 8${NB}×${NB}45${NB}kg.` && e2.reps === "8" && e2.kg === "45", JSON.stringify([await heard(leLine), e2]));
  // Set 3 of 3 ticks the lift off, as typing it would; "undo" takes the set and the tick back.
  const leTicked = async () => (await ticked()) && db.logs[TODAY]?.exercises["Leg Extension"]?.done === true;
  await say("8 reps");
  await tap("Leg Extension", /set.3/);
  await until(leTicked);
  check("the last planned set ticks the lift off", await leTicked());
  await say("undo");
  await tap("Leg Extension", /set.3 cleared/);
  await until(async () => db.logs[TODAY]?.exercises["Leg Extension"]?.done === false);
  check("“undo” of that set takes the tick back too", !(await ticked()) && db.logs[TODAY].exercises["Leg Extension"].done === false, JSON.stringify(db.logs[TODAY].exercises["Leg Extension"]));
  // A tick given before the planned sets are in is yours: "undo" clears the set and keeps it.
  await say("done");
  await tap("Leg Extension", /marked done/);
  await say("undo");
  await tap("Leg Extension", /set.2 cleared/);
  await page.waitForTimeout(300);
  check("“undo” keeps a tick you gave before the planned sets were in", (await ticked()) && (await rowOf(le, 1)).reps === "", JSON.stringify(await rowOf(le, 1)));
  // Ticked by hand, then filled up to the planned sets: the last set didn't tick it, so "undo" leaves the tick.
  await say("8 reps");
  await tap("Leg Extension", /set.2,/);
  await say("8 reps");
  await tap("Leg Extension", /set.3,/);
  await say("undo");
  await tap("Leg Extension", /set.3 cleared/);
  await page.waitForTimeout(300);
  check("“undo” of the last planned set keeps a tick given before it", (await ticked()) && (await rowOf(le, 2)).reps === "", JSON.stringify(await rowOf(le, 2)));
  // An automatic tick is saved as one, so "undo" still takes it back after another day and a reload. The tick comes
  // off by hand with the Done box in the ··· menu.
  await page.click('[data-more="2"]');
  await page.click("#ex2");
  await page.click('[data-more="2"]');
  await say("8 reps");
  await tap("Leg Extension", /set.3,/);
  await until(async () => db.logs[TODAY]?.exercises["Leg Extension"]?.autoDone === true);
  await page.click("#closeWorkout");
  await page.waitForSelector("#trainView");
  await page.locator("#dayChips .dchip").nth(1).click();
  await page.locator("#dayChips .dchip").nth(2).click();
  await openTab(page, "home");
  await page.reload();
  await ready(page);
  await openWorkout(page, "Leg Extension");
  await page.evaluate(() => window.__said.push(["undo"]));
  await tap("Leg Extension", /set.3 cleared/);
  await until(async () => db.logs[TODAY]?.exercises["Leg Extension"]?.done === false);
  check("after another day and a reload, “undo” still takes back the tick the last set gave", !(await ticked()) && !db.logs[TODAY].exercises["Leg Extension"].autoDone, JSON.stringify(db.logs[TODAY].exercises["Leg Extension"]));
  const hc = cardOf(page), hcLine = hc.locator(".said");
  await say("twelve reps");
  await tap("Hamstring Curl", /set.1/);
  const h1 = await rowOf(hc, 0);
  check("…and with no weight before, the weight stays empty", (await heard(hcLine)) === `Heard “twelve reps”: set${NB}1, 12${NB}reps.` && h1.reps === "12" && h1.kg === "", JSON.stringify([await heard(hcLine), h1]));

  // --- every row filled: a row is added first, as + Add set does; the planned sets tick the lift
  const hs = cardOf(page);
  for (const [phrase, n] of [["10 at 20", 1], ["again", 2], ["same again", 3]]) {
    await say(phrase);
    await tap("Hack Squat", new RegExp(`set.${n},`));
  }
  check("the planned 3 sets tick the lift, as typing them does", await ticked());
  await say("12 x 22.5");
  await tap("Hack Squat", /set.4/);
  const h4 = await rowOf(hs, 3);
  check("with every row filled, a 4th row is added for the set", (await hs.locator(".srow.set").count()) === 4 && h4.reps === "12" && h4.kg === "22.5" && (await hs.locator("[data-rmset]").count()) === 1, JSON.stringify([await heard(hs.locator(".said")), h4]));
  await until(() => db.logs[TODAY]?.exercises["Hack Squat"]?.sets?.length === 4);
  check("…and all four are saved", JSON.stringify(db.logs[TODAY]?.exercises["Hack Squat"]?.sets) === JSON.stringify([{ reps: 10, kg: 20 }, { reps: 10, kg: 20 }, { reps: 10, kg: 20 }, { reps: 12, kg: 22.5 }]), JSON.stringify(db.logs[TODAY]?.exercises["Hack Squat"]));

  // --- − Set asks about set 4; voice logs a 5th while the question is up: Remove then takes neither
  await page.evaluate(() => ((window.__wait = 600), window.__said.push(["8 at 25"])));
  await hs.locator("[data-voice]").click();
  await answerAsk(page, "leave");
  await hs.locator("[data-rmset]").click();
  await page.waitForSelector("#askDialog[open]");
  const askedSet = await lastAsked(page);
  await until(() => db.logs[TODAY]?.exercises["Hack Squat"]?.sets?.length === 5);
  await page.click("#askDialog [data-choice]");
  await page.waitForTimeout(300);
  const hsSets = () => JSON.stringify(db.logs[TODAY]?.exercises["Hack Squat"]?.sets.slice(3));
  check(
    "− Set, with a set logged by voice while it asked, removes nothing",
    askedSet === `Remove set 4 (12${NB}×${NB}22.5${NB}kg)?` && (await hs.locator(".srow.set").count()) === 5 && hsSets() === JSON.stringify([{ reps: 12, kg: 22.5 }, { reps: 8, kg: 25 }]),
    `${askedSet} / ${hsSets()}`,
  );
  // − Set again, asked about the 5th: that one goes.
  await page.evaluate(() => ((window.__wait = 60), (window.__said = [])));
  await hs.locator("[data-rmset]").click();
  await until(() => db.logs[TODAY]?.exercises["Hack Squat"]?.sets?.length === 4);
  check("and asked again, it removes the set it asks about", hsSets() === JSON.stringify([{ reps: 12, kg: 22.5 }]) && (await lastAsked(page)) === `Remove set 5 (8${NB}×${NB}25${NB}kg)?`, `${await lastAsked(page)} / ${hsSets()}`);

  // --- silence, and a blocked microphone
  const cr = cardOf(page), crLine = cr.locator(".said");
  await tap("Calf Raise", /./);
  check("silence: says it didn't hear anything", (await heard(crLine)) === "Didn’t hear anything. Try again.", JSON.stringify(await heard(crLine)));
  await fail("not-allowed");
  await tap("Calf Raise", /microphone/);
  check("a blocked microphone: says to allow it", (await heard(crLine)) === "Allow the microphone for this site to log by voice.", JSON.stringify(await heard(crLine)));

  // --- listening shows on the button, filled with the brand colour (light theme: #C2410C), and nothing moves
  // under reduced motion; tapping again stops
  await page.evaluate(() => (window.__wait = 20000));
  await say("10 at 50");
  const crMic = cr.locator("[data-voice]");
  // Read once the button's colour change has run its course.
  const fill = async () => (await page.evaluate(settled), await crMic.evaluate((e) => getComputedStyle(e).backgroundColor));
  const idle = await fill();
  await crMic.click();
  await until(async () => (await crMic.getAttribute("aria-pressed")) === "true");
  const lit = await fill();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const still = await crMic.evaluate((e) => getComputedStyle(e).animationName);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  check(
    "while listening: pressed, the line cleared, the button filled in brand, and still under reduced motion",
    (await heard(crLine)) === "" && lit === "rgb(194, 65, 12)" && idle !== lit && still === "none",
    `${idle} → ${lit} / ${still}`,
  );
  await crMic.click();
  await until(async () => (await crMic.getAttribute("aria-pressed")) === "false");
  await page.waitForTimeout(300);
  check(
    "tapping again stops listening, and nothing is logged",
    (await crMic.getAttribute("aria-pressed")) === "false" && (await page.evaluate(() => window.__aborts)) === 1 && (await heard(crLine)) === "" && (await cr.locator(".srow.set.logged").count()) === 0,
    JSON.stringify([await crMic.getAttribute("aria-pressed"), await page.evaluate(() => window.__aborts), await heard(crLine)]),
  );
  // One card listens at a time: going on to another lift stops the first, and the next lift's microphone listens
  // for that one.
  await page.evaluate(() => (window.__said = []));
  await crMic.click();
  await until(async () => (await crMic.getAttribute("aria-pressed")) === "true");
  await page.evaluate(() => ((window.__wait = 60), window.__said.push(["10 at 30"])));
  await tap("Hamstring Curl", /set.2/);
  const crLogged = () => (db.logs[TODAY]?.exercises["Calf Raise"]?.sets ?? []).some((s) => s.reps != null);
  check(
    "moving to another lift stops the first listening, and that lift's microphone listens for it",
    (await page.evaluate(() => window.__aborts)) === 2 && !crLogged() && (await heard(hcLine)) === `Heard “10 at 30”: set${NB}2, 10${NB}×${NB}30${NB}kg.`,
    JSON.stringify([await page.evaluate(() => window.__aborts), crLogged(), await heard(hcLine)]),
  );
  await page.evaluate(() => (window.__said = []));

  // --- leaving the workout, or going on to another lift, stops listening, and what's said then (37.5 kg, which
  // nothing else here uses) isn't logged anywhere
  const hcMic = hc.locator("[data-voice]");
  const kgShown = () => page.locator('#workoutView input[data-set$=":kg"]').evaluateAll((els) => els.map((e) => e.value));
  const logged375 = () => /"kg":37\.5\b/.test(JSON.stringify(db.logs));
  const aborted = await page.evaluate(() => window.__aborts);
  await page.evaluate(() => ((window.__wait = 1500), window.__said.push(["13 at 37.5"])));
  await hcMic.click();
  await until(async () => (await hcMic.getAttribute("aria-pressed")) === "true");
  await page.click("#closeWorkout");
  await page.waitForSelector("#trainView");
  await openTab(page, "progress");
  await page.waitForTimeout(1800);
  await openWorkout(page, "Hamstring Curl");
  check(
    "leaving the workout stops listening, and what's said on another tab isn't logged",
    (await hcMic.getAttribute("aria-pressed")) === "false" && (await page.evaluate(() => window.__aborts)) === aborted + 1 && !(await kgShown()).includes("37.5") && !logged375() && (await heard(hcLine)) === "",
    JSON.stringify([await hcMic.getAttribute("aria-pressed"), (await page.evaluate(() => window.__aborts)) - aborted, await kgShown()]),
  );
  // The next lift's card takes its place: without stopping, the Calf Raise, on show, would get the set.
  await page.evaluate(() => window.__said.push(["13 at 37.5"]));
  await hcMic.click();
  await until(async () => (await hcMic.getAttribute("aria-pressed")) === "true");
  await goTo(page, "Calf Raise");
  await page.waitForTimeout(1800);
  const onNext = await kgShown();
  await goTo(page, "Hamstring Curl");
  check(
    "going on to another lift stops listening too, and nothing is logged on either",
    (await page.evaluate(() => window.__aborts)) === aborted + 2 && !onNext.includes("37.5") && !(await kgShown()).includes("37.5") && !logged375(),
    JSON.stringify([(await page.evaluate(() => window.__aborts)) - aborted, onNext, await kgShown()]),
  );
  await page.evaluate(() => ((window.__wait = 60), (window.__said = [])));

  // --- the line goes after about 4 seconds
  await say("undo");
  await tap("Leg Extension", /cleared/);
  const shown = Date.now();
  await page.waitForTimeout(2500);
  const stays = (await heard(leLine)) !== "";
  await until(async () => (await heard(leLine)) === "", 4000);
  const gone = Date.now() - shown;
  check("the line under the sets stays for about 4 seconds, then clears", stays && (await heard(leLine)) === "" && gone > 3000 && gone < 5500, `stayed at 2.5 s: ${stays}, gone after ${gone} ms`);

  // --- the switch is remembered, and switching it off takes the microphones away
  await page.click("#closeWorkout");
  await page.waitForSelector("#trainView");
  await openTab(page, "home");
  await page.reload();
  await ready(page);
  await openWorkout(page, "Leg Extension");
  const afterReload = await micsPerLift(page);
  check("after a reload the microphones are still there, but for the skipped Leg Press", JSON.stringify(afterReload) === "[1,0,1,1,1]", JSON.stringify(afterReload));
  await page.click("#closeWorkout");
  await page.waitForSelector("#trainView");
  await openTab(page, "settings");
  await openSetting(page, "setVoice");
  await page.locator("#voiceLog").click();
  await page.click("#backBtn");
  await page.waitForSelector(TAB_VIEWS); // Settings closes onto the tab it was opened from
  await openWorkout(page, "Leg Extension");
  check("switched off: no microphones", JSON.stringify(await micsPerLift(page)) === "[0,0,0,0,0]" && (await page.locator(".ex-card .said").count()) === 0 && (await page.evaluate(() => localStorage.getItem("gymlog.voice.v1"))) === "false");

  check("only the expected endpoints were called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
