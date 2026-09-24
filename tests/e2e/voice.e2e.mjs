// Voice logging: the Log sets by voice switch in Settings, and a microphone on each lift that logs what's said the
// way typing it would. Chromium's own speech recognition is swapped for a fake that answers from a queue.
import { flat, liftEl, open, openTab, ready, session, until } from "./harness.mjs";

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
    .locator(".set")
    .nth(j)
    .evaluate((e) => {
      const b = e.querySelector(".prb");
      return { cls: e.className, reps: e.querySelector('[data-set$=":reps"]').value, kg: e.querySelector('[data-set$=":kg"]').value, pr: getComputedStyle(b).display === "none" ? "" : b.title };
    });

export default async function voice({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-000000000048");

  // ---------- A browser without speech recognition ----------
  {
    const { ctx, page, db } = await open(browser, base, { auth, db: { logs: logs(), plan: null }, url: null });
    await ctx.addInitScript(noSpeech);
    await ctx.addInitScript(() => localStorage.setItem("gymlog.voice.v1", "true"));
    await page.goto(base);
    await ready(page);
    check("no speech recognition: no microphones on Today, even with the switch left on", (await page.locator("[data-voice], .lift .said").count()) === 0);
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
    const lp = liftEl(page, "Leg Press");
    await page.evaluate(() => window.__said.push(["10 at 45"]));
    await lp.locator("[data-voice]").click();
    await until(async () => /^Heard/.test(await flat(lp.locator(".said"))));
    const setup = await page.evaluate(() => ({ lang: window.__setups[0]?.lang, browser: navigator.language }));
    check("a French browser: it listens in English, and logs the set", setup.browser === "fr-FR" && setup.lang === "en-US" && (await lp.locator(".set.logged").count()) === 1, JSON.stringify(setup));
    check("a French browser: no console errors", page.errors.length === 0 && db.unexpected.length === 0, [...page.errors, ...db.unexpected].join(" | "));
    await ctx.close();
  }

  // ---------- What typing 10 and 45 into Leg Press's first set gives, to compare with saying it ----------
  const typedDb = { logs: logs(), plan: null };
  let typed;
  {
    const { ctx, page } = await open(browser, base, { auth, db: typedDb });
    await ready(page);
    const lp = liftEl(page, "Leg Press");
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
  check("the switch starts off: no microphones on Today", (await page.locator("[data-voice], .lift .said").count()) === 0);

  await openTab(page, "settings");
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

  await openTab(page, "today");
  const lifts = await page.locator("#session ul.ex:not(.cardio) > li").count(), mics = page.locator("#session [data-voice]");
  check("switched on: one microphone per lift", lifts === 5 && (await mics.count()) === lifts, `${await mics.count()} for ${lifts} lifts`);
  const lp = liftEl(page, "Leg Press"), mic = lp.locator("[data-voice]"), line = lp.locator(".said");
  const box = await mic.boundingBox();
  check(
    "the microphone: named for its lift, not pressed, at least 44px, next to ···, with a polite live line",
    (await mic.getAttribute("aria-label")) === "Log a set of Leg Press by voice" &&
      (await mic.getAttribute("aria-pressed")) === "false" &&
      Math.round(box.width) >= 44 &&
      Math.round(box.height) >= 44 &&
      (await mic.evaluate((e) => e.nextElementSibling?.matches("[data-more]"))) &&
      (await line.getAttribute("aria-live")) === "polite" &&
      (await line.evaluate((e) => e.getBoundingClientRect().height)) === 0,
    JSON.stringify(box),
  );

  const say = (...guesses) => page.evaluate((g) => window.__said.push(g), guesses);
  const fail = (error) => page.evaluate((e) => window.__said.push({ error: e }), error);
  const heard = async (loc = line) => (await loc.textContent()) ?? "";
  /** Taps a lift's microphone and waits for the line under its sets to match. */
  const tap = async (lift, want) => {
    await lift.locator("[data-voice]").click();
    await until(async () => want.test(await heard(lift.locator(".said"))));
  };
  const saved = () => db.logs[TODAY]?.exercises["Leg Press"];

  // --- "10 at 45" logs set 1, as typing does
  await say("10 at 45");
  await tap(lp, /^Heard/);
  check("“10 at 45” fills set 1, and says so", (await heard()) === `Heard “10 at 45”: set${NB}1, 10${NB}×${NB}45${NB}kg.`, JSON.stringify(await heard()));
  const setup = await page.evaluate(() => ({ ...window.__setups[0], browser: navigator.language }));
  check("it listened once, for up to 5 guesses, without interim results, in the browser's English", setup.maxAlternatives === 5 && setup.interimResults === false && setup.continuous === false && setup.lang === setup.browser, JSON.stringify(setup));
  await until(() => saved()?.sets?.[0]?.kg === 45);
  const spoken = { row: await rowOf(lp, 0), saved: saved() };
  check("its row, PR badge and saved set are what typing 10 and 45 gives", JSON.stringify(spoken) === JSON.stringify(typed) && /\bpr\b/.test(spoken.row.cls) && /\blogged\b/.test(spoken.row.cls), `${JSON.stringify(spoken)} vs typed ${JSON.stringify(typed)}`);

  // --- "again" copies it into set 2
  await say("again");
  await tap(lp, /set.2/);
  const r2 = await rowOf(lp, 1);
  check("“again” fills set 2 the same", (await heard()) === `Heard “again”: set${NB}2, 10${NB}×${NB}45${NB}kg.` && r2.reps === "10" && r2.kg === "45" && /\blogged\b/.test(r2.cls), JSON.stringify([await heard(), r2]));
  await until(() => saved()?.sets?.length === 2);
  check("…and saves it", JSON.stringify(saved()?.sets) === JSON.stringify([{ reps: 10, kg: 45 }, { reps: 10, kg: 45 }]), JSON.stringify(saved()));

  // --- "undo" clears it again
  await say("undo");
  await tap(lp, /cleared/);
  const r2b = await rowOf(lp, 1);
  check("“undo” clears set 2", (await heard()) === `Heard “undo”: set${NB}2 cleared.` && r2b.reps === "" && r2b.kg === "" && !/\blogged\b/.test(r2b.cls), JSON.stringify([await heard(), r2b]));
  await until(() => saved()?.sets?.[1]?.reps === null);
  check("…and saves that", JSON.stringify(saved()?.sets) === JSON.stringify([{ reps: 10, kg: 45 }, { reps: null, kg: null }]) && saved()?.done === false, JSON.stringify(saved()));

  // --- "done" ticks the lift
  await say("done");
  await tap(lp, /marked done/);
  check("“done” ticks the lift", (await heard()) === "Heard “done”: marked done." && (await lp.locator("input.tick").isChecked()) && /\bchecked\b/.test(await lp.getAttribute("class")));
  await until(() => saved()?.done === true);
  check("…and saves it", saved()?.done === true, JSON.stringify(saved()));

  // --- "skip" skips it for today
  await say("skip it");
  await tap(lp, /skipped today/);
  check("“skip” skips the lift, with no reason", (await heard()) === "Heard “skip it”: skipped today." && (await flat(lp.locator(".skipnote"))) === "Skipped" && /\bskipped\b/.test(await lp.getAttribute("class")));
  await until(() => saved()?.skipped === true);
  check("…saved as skipped, not done, and no reason", saved()?.skipped === true && saved()?.done === false && !("reason" in saved()), JSON.stringify(saved()));
  check("a skipped lift has no microphone, and focus moves to its ···", (await lp.locator("[data-voice]").count()) === 0 && (await page.evaluate(() => document.activeElement?.getAttribute("data-more"))) === "1");
  check("the pill counts it as skipped", /0\/5 lifts · 1 skipped/.test(await page.locator("#liftPill").textContent()), await page.locator("#liftPill").textContent());

  // --- a phrase it can't read changes nothing and says how to put it
  const le = liftEl(page, "Leg Extension");
  const before = await page.evaluate(() => localStorage.getItem("gymlog.cache.v1"));
  await say("play some music", "play sum music");
  await tap(le, /^Heard/);
  check("an unknown phrase shows how to say it", (await heard(le.locator(".said"))) === `Heard “play some music”. Say it like “10${NB}at${NB}45”.`, JSON.stringify(await heard(le.locator(".said"))));
  check(
    "…and changes nothing",
    (await page.evaluate(() => localStorage.getItem("gymlog.cache.v1"))) === before && !db.logs[TODAY]?.exercises["Leg Extension"] && (await le.locator(".set.logged").count()) === 0 && (await le.locator("input.tick").isChecked()) === false,
  );

  // --- the best of the recognizer's guesses, and a set with only reps
  await say("turn at forty five", "ten at forty five");
  await tap(le, /set.1/);
  check("the first guess that reads as a set is used", (await heard(le.locator(".said"))) === `Heard “ten at forty five”: set${NB}1, 10${NB}×${NB}45${NB}kg.`, JSON.stringify(await heard(le.locator(".said"))));
  await say("8 reps");
  await tap(le, /set.2/);
  const e2 = await rowOf(le, 1);
  check("reps alone take the weight carried over from the set before, as typing reps does", (await heard(le.locator(".said"))) === `Heard “8 reps”: set${NB}2, 8${NB}×${NB}45${NB}kg.` && e2.reps === "8" && e2.kg === "45", JSON.stringify([await heard(le.locator(".said")), e2]));
  // Set 3 of 3 ticks the lift off, as typing it would; "undo" takes the set and the tick back.
  const leTicked = async () => (await le.locator("input.tick").isChecked()) && db.logs[TODAY]?.exercises["Leg Extension"]?.done === true;
  await say("8 reps");
  await tap(le, /set.3/);
  await until(leTicked);
  check("the last planned set ticks the lift off", await leTicked());
  await say("undo");
  await tap(le, /set.3 cleared/);
  await until(async () => db.logs[TODAY]?.exercises["Leg Extension"]?.done === false);
  check("“undo” of that set takes the tick back too", !(await le.locator("input.tick").isChecked()) && db.logs[TODAY].exercises["Leg Extension"].done === false, JSON.stringify(db.logs[TODAY].exercises["Leg Extension"]));
  const hc = liftEl(page, "Hamstring Curl");
  await say("twelve reps");
  await tap(hc, /set.1/);
  const h1 = await rowOf(hc, 0);
  check("…and with no weight before, the weight stays empty", (await heard(hc.locator(".said"))) === `Heard “twelve reps”: set${NB}1, 12${NB}reps.` && h1.reps === "12" && h1.kg === "", JSON.stringify([await heard(hc.locator(".said")), h1]));

  // --- every row filled: a row is added first, as + Set does; the planned sets tick the lift
  const hs = liftEl(page, "Hack Squat");
  for (const [phrase, n] of [["10 at 20", 1], ["again", 2], ["same again", 3]]) {
    await say(phrase);
    await tap(hs, new RegExp(`set.${n},`));
  }
  check("the planned 3 sets tick the lift, as typing them does", await hs.locator("input.tick").isChecked());
  await say("12 x 22.5");
  await tap(hs, /set.4/);
  const h4 = await rowOf(hs, 3);
  check("with every row filled, a 4th row is added for the set", (await hs.locator(".set").count()) === 4 && h4.reps === "12" && h4.kg === "22.5" && (await hs.locator("[data-rmset]").count()) === 1, JSON.stringify([await heard(hs.locator(".said")), h4]));
  await until(() => db.logs[TODAY]?.exercises["Hack Squat"]?.sets?.length === 4);
  check("…and all four are saved", JSON.stringify(db.logs[TODAY]?.exercises["Hack Squat"]?.sets) === JSON.stringify([{ reps: 10, kg: 20 }, { reps: 10, kg: 20 }, { reps: 10, kg: 20 }, { reps: 12, kg: 22.5 }]), JSON.stringify(db.logs[TODAY]?.exercises["Hack Squat"]));

  // --- silence, and a blocked microphone
  const cr = liftEl(page, "Calf Raise"), crLine = cr.locator(".said");
  await tap(cr, /./);
  check("silence: says it didn't hear anything", (await heard(crLine)) === "Didn’t hear anything. Try again.", JSON.stringify(await heard(crLine)));
  await fail("not-allowed");
  await tap(cr, /microphone/);
  check("a blocked microphone: says to allow it", (await heard(crLine)) === "Allow the microphone for this site to log by voice.", JSON.stringify(await heard(crLine)));

  // --- listening shows on the button, with a pulse unless motion is reduced; tapping again stops
  await page.evaluate(() => (window.__wait = 20000));
  await say("10 at 50");
  const crMic = cr.locator("[data-voice]");
  await crMic.click();
  await until(async () => (await crMic.getAttribute("aria-pressed")) === "true");
  const pulse = await crMic.evaluate((e) => getComputedStyle(e).animationName);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const still = await crMic.evaluate((e) => getComputedStyle(e).animationName);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  check("while listening: pressed, the line cleared, and a pulse that stops under reduced motion", (await heard(crLine)) === "" && pulse === "listen" && still === "none", `${pulse} / ${still}`);
  await crMic.click();
  await until(async () => (await crMic.getAttribute("aria-pressed")) === "false");
  await page.waitForTimeout(300);
  check(
    "tapping again stops listening, and nothing is logged",
    (await crMic.getAttribute("aria-pressed")) === "false" && (await page.evaluate(() => window.__aborts)) === 1 && (await heard(crLine)) === "" && (await cr.locator(".set.logged").count()) === 0,
    JSON.stringify([await crMic.getAttribute("aria-pressed"), await page.evaluate(() => window.__aborts), await heard(crLine)]),
  );
  // One card listens at a time: another card's microphone takes over.
  await page.evaluate(() => (window.__said = []));
  await crMic.click();
  await until(async () => (await crMic.getAttribute("aria-pressed")) === "true");
  await page.evaluate(() => ((window.__wait = 60), window.__said.push(["10 at 30"])));
  await tap(hc, /set.2/);
  check(
    "tapping another lift's microphone stops the first and listens for the second",
    (await crMic.getAttribute("aria-pressed")) === "false" && (await page.evaluate(() => window.__aborts)) === 2 && (await heard(crLine)) === "" && (await heard(hc.locator(".said"))) === `Heard “10 at 30”: set${NB}2, 10${NB}×${NB}30${NB}kg.`,
    JSON.stringify([await crMic.getAttribute("aria-pressed"), await page.evaluate(() => window.__aborts), await heard(crLine), await heard(hc.locator(".said"))]),
  );
  await page.evaluate(() => (window.__said = []));

  // --- Today stays mounted behind the other tabs: leaving it, or picking another day, stops listening, and what's
  // said then (37.5 kg, which nothing else here uses) isn't logged anywhere
  const hcMic = hc.locator("[data-voice]");
  const kgShown = () => page.locator('#session input[data-set$=":kg"]').evaluateAll((els) => els.map((e) => e.value));
  const logged375 = () => /"kg":37\.5\b/.test(JSON.stringify(db.logs));
  const aborted = await page.evaluate(() => window.__aborts);
  await page.evaluate(() => ((window.__wait = 1500), window.__said.push(["13 at 37.5"])));
  await hcMic.click();
  await until(async () => (await hcMic.getAttribute("aria-pressed")) === "true");
  await openTab(page, "progress");
  await page.waitForTimeout(1800);
  await openTab(page, "today");
  check(
    "leaving Today stops listening, and what's said on another tab isn't logged",
    (await hcMic.getAttribute("aria-pressed")) === "false" && (await page.evaluate(() => window.__aborts)) === aborted + 1 && !(await kgShown()).includes("37.5") && !logged375() && (await heard(hc.locator(".said"))) === "",
    JSON.stringify([await hcMic.getAttribute("aria-pressed"), (await page.evaluate(() => window.__aborts)) - aborted, await kgShown()]),
  );
  // Saturday has a Hamstring Curl in the same place, so its card stays: without stopping, Wednesday would get the set.
  await hcMic.click();
  await until(async () => (await hcMic.getAttribute("aria-pressed")) === "true");
  await page.locator("#week .dchip").nth(5).click();
  await until(async () => (await page.textContent("#session h2")) === "Shoulders + Legs");
  await page.waitForTimeout(1800);
  const onSat = await kgShown();
  await page.locator("#week .dchip").nth(2).click();
  await until(async () => (await page.textContent("#session h2")) === "Legs");
  check(
    "picking another day stops listening too, and nothing is logged on either day",
    (await page.evaluate(() => window.__aborts)) === aborted + 2 && !onSat.includes("37.5") && !(await kgShown()).includes("37.5") && !logged375(),
    JSON.stringify([(await page.evaluate(() => window.__aborts)) - aborted, onSat, await kgShown()]),
  );
  await page.evaluate(() => ((window.__wait = 60), (window.__said = [])));

  // --- the line goes after about 4 seconds
  await say("undo");
  await tap(le, /cleared/);
  const shown = Date.now();
  await page.waitForTimeout(2500);
  const stays = (await heard(le.locator(".said"))) !== "";
  await until(async () => (await heard(le.locator(".said"))) === "", 4000);
  const gone = Date.now() - shown;
  check("the line under the sets stays for about 4 seconds, then clears", stays && (await heard(le.locator(".said"))) === "" && gone > 3000 && gone < 5500, `stayed at 2.5 s: ${stays}, gone after ${gone} ms`);

  // --- the switch is remembered, and switching it off takes the microphones away
  await page.reload();
  await ready(page);
  check("after a reload the microphones are still there", (await page.locator("#session [data-voice]").count()) === 4, String(await page.locator("#session [data-voice]").count()));
  await openTab(page, "settings");
  await page.locator("#voiceLog").click();
  await openTab(page, "today");
  check("switched off: no microphones", (await page.locator("[data-voice], .lift .said").count()) === 0 && (await page.evaluate(() => localStorage.getItem("gymlog.voice.v1"))) === "false");

  check("only the expected endpoints were called", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}
