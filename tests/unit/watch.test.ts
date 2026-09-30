import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The watch (docs/watch.md): what the phone sends Gym Log's Wear OS app (lib/watch.ts's watchState), sending it through
// the app's Watch plugin (native/watch.ts), and applying what's done on the watch. The plugin's own side, keeping the
// commands while the app is closed, is android/app/src/test/.../WatchLogicTest.kt.
vi.mock("@capacitor/core", async () => (await import("./nativeMocks")).capacitorCore);
vi.mock("@capacitor/app", async () => ({ App: (await import("./nativeMocks")).app }));

import { addDays, wdIndex } from "@/lib/dates";
import type { GymStore, RestTimer } from "@/lib/store";
import type { DayLog, LiftLog } from "@/lib/types";
import { applyWatchCommand, watchState, type WatchCommand, type WatchLift } from "@/lib/watch";
import { clearRun, currentRun, endRun, finishWorkout, keepRunsInMemory, pauseRun, restartRun, resumeRun, runsFor, startRun } from "@/lib/workout";
import { ACK_MS, APPLIED_KEPT, PUBLISH_MS, startWatch, WATCH_KEY } from "@/native/watch";
import { atWednesdayNoon, day, LAST, lift, memoryStorage, storeWith, WED } from "./helpers";
import { app, watch } from "./nativeMocks";

atWednesdayNoon();
const NOON = new Date(`${WED}T12:00:00`).getTime(), SEC = 1000, MIN = 60_000;
/** A number the Android apps' Kotlin holds, `const val name = N` in the file at `path` under android/. */
const kotlinConst = (path: string, name: string) => Number(readFileSync(new URL(`../../android/${path}`, import.meta.url), "utf8").match(new RegExp(`const val ${name} = (\\d+)`))?.[1]);
/** The most commands the plugin keeps for JavaScript (WatchLogic.kt). */
const QUEUE_MAX = kotlinConst("app/src/main/java/io/github/raja2102598/gymlog/WatchLogic.kt", "QUEUE_MAX");
/** Each watch started, stopped after its test whether or not it passed. */
const started: (() => void)[] = [];
function watching(s: GymStore) {
  const stop = startWatch(s);
  started.push(stop);
  return stop;
}
beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { onLine: true, vibrate: vi.fn(() => true) });
  keepRunsInMemory(false);
  runsFor("u");
  watch.queue = [];
  watch.publish.mockClear();
  watch.pending.mockClear();
  watch.ack.mockClear();
  watch.forget();
  app.forget();
});
afterEach(() => {
  while (started.length) started.pop()!();
  vi.unstubAllGlobals();
});

/** Last Wednesday: Hamstring Curl topped its range (go up to 32.5 kg), Leg Press didn't (45 kg again). Made afresh
 *  for each store, which keeps its days in the object it's given. */
const lastWeek = () => ({ [LAST]: day({ exercises: { "Hamstring Curl": lift([[12, 30], [12, 30], [12, 30]]), "Leg Press": lift([[10, 45], [10, 45], [8, 45]]) } }) });
/** A real account, signed in with its days loaded. */
function signedIn(logs = {}) {
  const s = storeWith({ ...lastWeek(), ...logs });
  s.auth = "signedIn";
  return s;
}
/** Day `date`'s lift `key`, as the watch is sent it. */
const liftSent = (s: GymStore, key: string, date = WED): WatchLift | undefined =>
  watchState(s, []).days.find((d) => d.date === date)?.blocks.flat().find((l) => l.key === key);
const skippedLift = { done: false, kg: null, skipped: true } as unknown as LiftLog;

describe("what the watch is sent", () => {
  it("is today and the next six days, each as the phone's workout has it: its session, cardio, and lifts in order", () => {
    const s = signedIn();
    const sent = watchState(s, ["c-1"]);
    expect(sent).toMatchObject({ v: 1, sentAt: NOON, signedIn: true, account: "u", applied: ["c-1"], run: null, rest: null });
    expect(sent.days.map((d) => d.date)).toEqual(["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"]);
    const [wed, thu] = sent.days;
    expect({ ...wed, blocks: wed.blocks.map((b) => b.map((l) => l.key)) }).toEqual({
      date: WED,
      title: "Legs",
      skipped: false,
      cardio: "Cycling - 15-20 min",
      cardioDone: false,
      blocks: [["Hack Squat"], ["Leg Press"], ["Leg Extension"], ["Hamstring Curl"], ["Calf Raise"]],
    });
    // Thursday rests: its walk is the whole workout, as on the phone.
    expect(thu).toEqual({ date: "2026-09-24", title: "Rest", skipped: false, cardio: "Walk - hit 10,000 steps", cardioDone: false, blocks: [] });
  });

  it("gives each lift the rows its card shows, with what Complete set N would log in each: the suggestion, or the set logged before it", () => {
    const s = signedIn({
      [WED]: day({ cardio: true, exercises: { "Leg Press": { done: false, kg: 50, sets: [{ reps: 10, kg: 50 }] } } }),
      "2026-09-09": day({ exercises: { "Leg Extension": { done: false, kg: 30, sets: [{ reps: 0, kg: 30 }] } } }),
    });
    expect(liftSent(s, "Hamstring Curl")).toEqual({
      key: "Hamstring Curl",
      name: "Hamstring Curl",
      done: false,
      skipped: false,
      restSec: 90,
      inc: 2.5,
      cue: "Hips down, curl smoothly, squeeze at bottom.",
      rows: Array(3).fill({ reps: null, kg: null, type: null, sugReps: 10, sugKg: 32.5 }),
    });
    // Leg Press's first set went 10 × 50 kg rather than the suggested 45: the sets after it repeat it, not last
    // week's (10, then 8, at 45).
    expect(liftSent(s, "Leg Press")?.rows).toEqual([
      { reps: 10, kg: 50, type: null, sugReps: 10, sugKg: 45 },
      { reps: null, kg: null, type: null, sugReps: 10, sugKg: 50 },
      { reps: null, kg: null, type: null, sugReps: 10, sugKg: 50 },
    ]);
    expect(watchState(s, []).days[0].cardioDone).toBe(true);
    // Never done: the bottom of its range, and no weight to suggest.
    expect(liftSent(s, "Calf Raise")?.rows[0]).toEqual({ reps: null, kg: null, type: null, sugReps: 12, sugKg: null });
    // Last time's set had no reps (the 9th's Leg Extension): nothing to suggest, as Complete set N would log none (it
    // puts the cursor there).
    expect(liftSent(s, "Leg Extension")?.rows[0]).toEqual({ reps: null, kg: null, type: null, sugReps: null, sugKg: 30 });
  });

  it("leaves out warm-ups, keeps a set's kind, and shows a set added past the plan, and a lift logged outside it", () => {
    const s = signedIn({
      [WED]: day({
        exercises: {
          "Hack Squat": { done: true, kg: 40, sets: [{ reps: 8, kg: 20, type: "warmup" }, { reps: 10, kg: 40 }, { reps: 10, kg: 40 }, { reps: 9, kg: 40 }, { reps: 12, kg: 25, type: "drop" }] },
          "Goblet Squat": lift([[12, 20]]),
        },
      }),
    });
    const hack = liftSent(s, "Hack Squat")!;
    expect(hack.done).toBe(true);
    expect(hack.rows.map((r) => [r.reps, r.kg, r.type])).toEqual([[10, 40, null], [10, 40, null], [9, 40, null], [12, 25, "drop"]]);
    expect(watchState(s, []).days[0].blocks.at(-1)).toEqual([expect.objectContaining({ key: "Goblet Squat", done: true, rows: [expect.objectContaining({ reps: 12, kg: 20 })] })]);
  });

  it("names a swapped lift for what it's done as, under the day's name for it, and gives a skipped lift no rows", () => {
    const s = signedIn({ [WED]: day({ exercises: { "Leg Press": { done: false, kg: null, swap: "Smith Squat" }, "Calf Raise": skippedLift } }) });
    expect(liftSent(s, "Leg Press")).toMatchObject({ key: "Leg Press", name: "Smith Squat", cue: "" });
    expect(liftSent(s, "Calf Raise")).toMatchObject({ skipped: true, rows: [] });
  });

  it("makes a superset one step, its lifts resting for the round: the longest rest of those not skipped", () => {
    const s = signedIn();
    s.plan.days[wdIndex(WED)].exercises[3].superset = true; // Hamstring Curl joins Leg Extension
    s.plan.days[wdIndex(WED)].exercises[3].rest = "120";
    const ss = () => watchState(s, []).days[0].blocks[2].map((l) => [l.key, l.restSec, l.rows.length]);
    expect(ss()).toEqual([["Leg Extension", 120, 3], ["Hamstring Curl", 120, 3]]);
    s.logs[WED] = day({ exercises: { "Hamstring Curl": skippedLift } });
    expect(ss()).toEqual([["Leg Extension", 90, 3], ["Hamstring Curl", 90, 0]]);
  });

  it("says a day was skipped, and names a free workout for itself, with its lifts and no cardio", () => {
    const s = signedIn({ [WED]: day({ skip: "travelling" }), "2026-09-24": day({ free: { name: "Hotel gym", lifts: ["Goblet Squat", "Leg Press"] } }) });
    const [wed, thu] = watchState(s, []).days;
    expect([wed.title, wed.skipped]).toEqual(["Legs", true]);
    expect({ ...thu, blocks: thu.blocks.map((b) => b.map((l) => l.key)) }).toEqual({
      date: "2026-09-24",
      title: "Hotel gym",
      skipped: false,
      cardio: null,
      cardioDone: false,
      blocks: [["Goblet Squat"], ["Leg Press"]],
    });
  });

  it("gives it the workout's clock and the rest timer, as they are", () => {
    const s = signedIn();
    startRun(WED, NOON - 30 * MIN);
    pauseRun(WED, NOON - 10 * MIN);
    s.startRest(WED, "Leg Press", 90);
    expect(watchState(s, [])).toMatchObject({
      run: { day: WED, startedAt: NOON - 30 * MIN, pausedAt: NOON - 10 * MIN, pausedMs: 0, endedAt: null },
      rest: { day: WED, lift: "Leg Press", endAt: NOON + 90 * SEC, pausedAt: null, sec: 90, startedAt: NOON },
      restChangedAt: NOON, // when the rest timer last changed, skipped too
    });
    // Once resumed, the pause goes with the run, from and to: the watch leaves its heart rate readings in it out.
    expect(watchState(s, []).run?.pauses).toEqual([]);
    resumeRun(WED, NOON - 5 * MIN);
    expect(watchState(s, []).run).toMatchObject({ pausedAt: null, pausedMs: 5 * MIN, pauses: [[NOON - 10 * MIN, NOON - 5 * MIN]] });
    // A timer kept from before rests had a start: sent as not known.
    s.rest = { day: WED, lift: "Leg Press", endAt: NOON + 90 * SEC, pausedAt: null, ended: false, sec: 90 };
    expect(watchState(s, []).rest?.startedAt).toBeNull();
  });

  it("puts a workout for another day first: one started before midnight stays the one it's on, paused too, until finished or left behind", () => {
    const TUE = "2026-09-22", late = new Date(`${WED}T00:30:00`).getTime();
    vi.setSystemTime(late);
    const s = signedIn();
    startRun(TUE, late - 50 * MIN); // Tuesday's Pull, started at 23:40
    expect(watchState(s, []).days.map((d) => d.date).slice(0, 2)).toEqual([TUE, WED]);
    expect(watchState(s, []).days[0]).toMatchObject({ title: "Pull", blocks: expect.arrayContaining([[expect.objectContaining({ key: "Lat Pulldown" })]]) });
    pauseRun(TUE, late); // paused at 00:30: still Tuesday's workout
    expect(watchState(s, []).days[0].date).toBe(TUE);
    resumeRun(TUE, late);
    vi.setSystemTime(late + 3 * 60 * MIN); // left running for three hours: over
    expect(watchState(s, []).days[0].date).toBe(WED);
    vi.setSystemTime(late);
    endRun(TUE, late); // finished
    expect(watchState(s, []).days[0].date).toBe(WED);
  });

  it("fits in a Data Layer item, 100 KB, with a week of full workouts and every id the phone's queue can hold", () => {
    // Every day of the plan's week logged in full, five sets a lift, with its cardio, the workout of the day before
    // still under way (an eighth day) and a rest, and as many applied ids as the phone's queue holds, each as the
    // watch makes them (OverlayLogic.newId: "c-" and 16 characters of base64url).
    const s = signedIn();
    for (let n = -1; n < 7; n++) {
      const date = addDays(WED, n);
      for (const it of s.liftBlocks(date).flat()) s.editLift(date, it.name, (r) => void (r.sets = Array.from({ length: 5 }, () => ({ reps: 10, kg: 102.5 }))), false);
      s.editDay(date, (d) => void (d.cardio = true), false);
    }
    startRun(addDays(WED, -1), NOON - 60 * MIN);
    s.startRest(WED, "Leg Press", 90);
    const ids = Array.from({ length: APPLIED_KEPT }, () => "c-" + Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url"));
    const state = watchState(s, ids), bytes = new TextEncoder().encode(JSON.stringify(state)).length;
    expect(state.days).toHaveLength(8);
    expect(state.days.every((d) => d.blocks.flat().every((l) => l.rows.length === 5 && l.rows.every((r) => r.reps === 10)))).toBe(true);
    expect(bytes).toBeLessThan(100 * 1024);
  });

  it("lists as many applied ids as the phone's queue holds and the watch keeps waiting", () => {
    // The three have to agree: the watch stops showing a command as its own only once it's listed.
    expect(APPLIED_KEPT).toBe(QUEUE_MAX);
    expect(kotlinConst("wear/src/main/java/io/github/raja2102598/gymlog/wear/OverlayLogic.kt", "KEPT")).toBe(QUEUE_MAX);
  });

  it("says only that no one is signed in, signed out or trying the sample data", () => {
    const out = storeWith();
    out.auth = "signedOut";
    const empty = { v: 1, sentAt: NOON, signedIn: false, account: null, applied: [], run: null, rest: null, restChangedAt: null, days: [] };
    expect(watchState(out, [])).toEqual(empty);
    const demo = storeWith();
    demo.auth = "signedOut";
    demo.user = null;
    demo.startDemo();
    expect(watchState(demo, [])).toEqual(empty);
  });
});

describe("sending it", () => {
  it("sends it once the account is known, a moment after a change, and again only when what it says changes", async () => {
    const s = storeWith(lastWeek());
    s.auth = "starting";
    const stop = watching(s);
    await vi.advanceTimersByTimeAsync(PUBLISH_MS);
    expect(watch.publish).not.toHaveBeenCalled();

    s.auth = "signedIn";
    s.setStatus("Synced"); // any store change tells listeners
    const changed = Date.now();
    await vi.advanceTimersByTimeAsync(PUBLISH_MS - 1);
    expect(watch.publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(watch.publish).toHaveBeenCalledTimes(1);
    expect(watch.sent()).toMatchObject({ v: 1, sentAt: changed + PUBLISH_MS, signedIn: true, days: expect.arrayContaining([expect.objectContaining({ date: WED })]) });

    // A change that touches nothing the watch shows: nothing sent, however long after.
    s.setStatus("Saving…");
    await vi.advanceTimersByTimeAsync(10 * PUBLISH_MS);
    expect(watch.publish).toHaveBeenCalledTimes(1);

    // A set's digits going in, one after another: sent once, with all of them.
    s.editLift(WED, "Leg Press", (r) => void (r.sets = [{ reps: 1, kg: 50 }]), false);
    await vi.advanceTimersByTimeAsync(PUBLISH_MS / 2);
    s.editLift(WED, "Leg Press", (r) => void (r.sets = [{ reps: 12, kg: 50 }]), false);
    await vi.advanceTimersByTimeAsync(PUBLISH_MS / 2);
    expect(watch.publish).toHaveBeenCalledTimes(2);
    expect(watch.sent().days[0].blocks[1][0].rows[0]).toMatchObject({ reps: 12, kg: 50 });

    // The workout's clock changes outside the store.
    const clockFrom = startRun(WED).startedAt;
    await vi.advanceTimersByTimeAsync(PUBLISH_MS);
    expect(watch.publish).toHaveBeenCalledTimes(3);
    expect(watch.sent().run).toMatchObject({ day: WED, startedAt: clockFrom });

    // Signed out: the watch is told to sign in on the phone.
    s.auth = "signedOut";
    s.setStatus("");
    await vi.advanceTimersByTimeAsync(PUBLISH_MS);
    expect(watch.sent()).toMatchObject({ signedIn: false, days: [] });
    stop();
  });

  it("sends nothing from the demo, nor applies anything to it, and tries a send that failed again on the next change", async () => {
    const demo = storeWith();
    demo.auth = "signedOut";
    demo.user = null;
    const stopDemo = watching(demo);
    await vi.advanceTimersByTimeAsync(PUBLISH_MS);
    watch.publish.mockClear();
    demo.startDemo();
    watch.arrive({ v: 1, id: "c-demo", at: Date.now(), type: "cardioDone", day: WED, done: true, baseDone: false });
    await vi.advanceTimersByTimeAsync(PUBLISH_MS);
    expect(watch.publish).not.toHaveBeenCalled();
    expect(demo.entry(WED).cardio).toBe(false);
    expect(watch.queue).toHaveLength(1); // left for a real account
    stopDemo();

    const s = signedIn();
    watch.publish.mockRejectedValueOnce(new Error("no Wear OS on this phone"));
    const stop = watching(s);
    await vi.advanceTimersByTimeAsync(PUBLISH_MS);
    expect(watch.publish).toHaveBeenCalledTimes(1);
    s.setStatus("Synced");
    await vi.advanceTimersByTimeAsync(PUBLISH_MS);
    expect(watch.publish).toHaveBeenCalledTimes(2);
    stop();
  });

  it("moves on to the next seven days once a new one begins, even with nothing else changing", async () => {
    const s = signedIn();
    const stop = watching(s);
    await vi.advanceTimersByTimeAsync(PUBLISH_MS);
    vi.setSystemTime(new Date("2026-09-24T00:01:00"));
    await vi.advanceTimersByTimeAsync(5 * MIN + PUBLISH_MS);
    expect(watch.sent().days[0].date).toBe("2026-09-24");
    stop();
  });
});

describe("what the watch sends back", () => {
  /** A command from the watch, done `ago` ms before now, under the account signed in (storeWith's). */
  let n = 0;
  const cmd = (type: string, fields: Record<string, unknown> = {}, ago = 0): WatchCommand => ({ v: 1, id: `c-${++n}`, at: Date.now() - ago, type, account: "u", ...fields });
  /** A rest button pressed on the watch for rest `r`, the one it showed: named by its day, lift and start. */
  const restCmd = (type: string, r: Pick<RestTimer, "day" | "lift" | "startedAt"> | null, fields: Record<string, unknown> = {}, ago = 0) =>
    cmd(type, { day: r?.day, lift: r?.lift, restStartedAt: r?.startedAt ?? null, ...fields }, ago);
  const sets = (s: GymStore, name: string) => s.entry(WED).exercises[name]?.sets;
  /** The watch app running with the phone's: a real account, its days loaded, taking commands as they arrive. */
  async function running(s = signedIn()) {
    const stop = watching(s);
    await vi.advanceTimersByTimeAsync(0);
    return { s, stop };
  }

  it("logs a set as Complete set N does, weight then reps, and starts the rest from when it was done", async () => {
    const { s, stop } = await running();
    watch.arrive(cmd("set", { day: WED, lift: "Hamstring Curl", set: 0, reps: 11, kg: 35 }, 20 * SEC));
    await vi.advanceTimersByTimeAsync(0);
    expect(sets(s, "Hamstring Curl")).toEqual([{ reps: 11, kg: 35 }]);
    expect(s.rest).toMatchObject({ lift: "Hamstring Curl", endAt: NOON + 70 * SEC, sec: 90 });
    // With no weight, the reps take the one Complete set N would: the set before it's.
    watch.arrive(cmd("set", { day: WED, lift: "Hamstring Curl", set: 1, reps: 10, kg: null }));
    await vi.advanceTimersByTimeAsync(0);
    expect(sets(s, "Hamstring Curl")).toEqual([{ reps: 11, kg: 35 }, { reps: 10, kg: 35 }]);
    // The check's undo, for the set as the watch had it: the reps go, and the rest isn't started again.
    s.skipRest();
    watch.arrive(cmd("set", { day: WED, lift: "Hamstring Curl", set: 1, reps: null, kg: null, baseReps: 10, baseKg: 35 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(sets(s, "Hamstring Curl")).toEqual([{ reps: 11, kg: 35 }, { reps: null, kg: 35 }]);
    expect(s.rest).toBeNull();
    stop();
  });

  it("starts no rest for a set done longer ago than its rest, or before a rest started since, and in a superset only once the round is complete", async () => {
    const { s, stop } = await running();
    watch.arrive(cmd("set", { day: WED, lift: "Leg Press", set: 0, reps: 10, kg: 45 }, 91 * SEC));
    await vi.advanceTimersByTimeAsync(0);
    expect(sets(s, "Leg Press")).toEqual([{ reps: 10, kg: 45 }]);
    expect(s.rest).toBeNull();
    watch.arrive(cmd("set", { day: WED, lift: "Leg Press", set: 1, reps: 10, kg: 45 }, 90 * SEC));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toMatchObject({ lift: "Leg Press", endAt: NOON });

    s.skipRest();
    s.plan.days[wdIndex(WED)].exercises[3].superset = true; // Hamstring Curl joins Leg Extension
    watch.arrive(cmd("set", { day: WED, lift: "Leg Extension", set: 0, reps: 12, kg: 30 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toBeNull();
    watch.arrive(cmd("set", { day: WED, lift: "Hamstring Curl", set: 0, reps: 10, kg: 32.5 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toMatchObject({ lift: "Hamstring Curl", endAt: NOON + 90 * SEC });

    // Set 3 done on the watch at 12:00:10, arriving after Calf Raise's rest was started on the phone at 12:00:20: the
    // set is logged, and the newer rest stays.
    s.skipRest();
    await vi.advanceTimersByTimeAsync(20 * SEC);
    s.startRest(WED, "Calf Raise", 60);
    watch.arrive(cmd("set", { day: WED, lift: "Leg Press", set: 2, reps: 8, kg: 45 }, 10 * SEC));
    await vi.advanceTimersByTimeAsync(0);
    expect(sets(s, "Leg Press")).toEqual([{ reps: 10, kg: 45 }, { reps: 10, kg: 45 }, { reps: 8, kg: 45 }]);
    expect(s.rest).toMatchObject({ lift: "Calf Raise", startedAt: NOON + 20 * SEC, endAt: NOON + 80 * SEC });
    // One done after that rest started replaces it, as ever.
    await vi.advanceTimersByTimeAsync(10 * SEC);
    watch.arrive(cmd("set", { day: WED, lift: "Hack Squat", set: 0, reps: 10, kg: 40 }, 5 * SEC));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toMatchObject({ lift: "Hack Squat", startedAt: NOON + 25 * SEC, endAt: NOON + 115 * SEC });
    // A set logged on the phone now starts its own, even over a rest the watch started "later" by its clock, a little
    // ahead of the phone's.
    watch.arrive(cmd("set", { day: WED, lift: "Hack Squat", set: 1, reps: 10, kg: 40 }, -5 * SEC));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toMatchObject({ lift: "Hack Squat", startedAt: NOON + 35 * SEC });
    s.startRest(WED, "Calf Raise", 60);
    expect(s.rest).toMatchObject({ lift: "Calf Raise", startedAt: NOON + 30 * SEC });
    stop();
  });

  it("applies each command once, in the order it was done, then says so in applied and acks it", async () => {
    const { s, stop } = await running();
    // Arrived out of order: set 1 logged, then taken back (from the set as the first left it).
    const logged = cmd("set", { day: WED, lift: "Leg Press", set: 0, reps: 10, kg: 45 }, 30 * SEC);
    const undone = cmd("set", { day: WED, lift: "Leg Press", set: 0, reps: null, kg: null, baseReps: 10, baseKg: 45 }, 10 * SEC);
    watch.arrive(undone, logged);
    await vi.advanceTimersByTimeAsync(0);
    expect(sets(s, "Leg Press")).toEqual([{ reps: null, kg: 45 }]);
    expect(watch.sent().applied).toEqual([logged.id, undone.id]);
    expect(JSON.parse(localStorage.getItem(WATCH_KEY)!)).toEqual({ applied: [logged.id, undone.id] });
    // Acked a while after, not straight away.
    expect(watch.ack).not.toHaveBeenCalled();
    // Handed over again before then (the plugin saying more have come): acked again, not applied again.
    watch.arrive(cmd("restAdd", { sec: 15 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(sets(s, "Leg Press")).toEqual([{ reps: null, kg: 45 }]);
    await vi.advanceTimersByTimeAsync(ACK_MS);
    expect(watch.ack).toHaveBeenCalledWith({ ids: [logged.id, undone.id] });
    expect(watch.queue).toEqual([]);
    stop();

    // Android killed the app before the acks landed: started again, it knows what it applied.
    watch.queue = [logged];
    s.editLift(WED, "Leg Press", (r) => void (r.sets = []), true);
    const again = await running(s);
    expect(sets(s, "Leg Press")).toEqual([]);
    await vi.advanceTimersByTimeAsync(ACK_MS);
    expect(watch.queue).toEqual([]);
    again.stop();
  });

  it("logs a set only over the row as the watch had it: a change made on the phone since wins, and the watch's own follow one another", async () => {
    const { s, stop } = await running();
    watch.arrive(cmd("set", { day: WED, lift: "Leg Press", set: 0, reps: 10, kg: 45, baseReps: null, baseKg: null }, 60 * SEC));
    await vi.advanceTimersByTimeAsync(0);
    expect(sets(s, "Leg Press")).toEqual([{ reps: 10, kg: 45 }]);
    // Set 1 corrected on the phone to 12 × 50, while the watch, out of reach, corrected it to 11 and then undid it,
    // each from the 10 × 45 it had: the phone's correction stays, and both are acked.
    s.editLift(WED, "Leg Press", (r) => void (r.sets = [{ reps: 12, kg: 50 }]), true);
    const fix = cmd("set", { day: WED, lift: "Leg Press", set: 0, reps: 11, kg: 45, baseReps: 10, baseKg: 45 }, 40 * SEC);
    const undo = cmd("set", { day: WED, lift: "Leg Press", set: 0, reps: null, kg: 45, baseReps: 10, baseKg: 45 }, 30 * SEC);
    watch.arrive(fix, undo);
    await vi.advanceTimersByTimeAsync(0);
    expect(sets(s, "Leg Press")).toEqual([{ reps: 12, kg: 50 }]);
    expect(watch.sent().applied).toEqual(expect.arrayContaining([fix.id, undo.id]));
    // Set 2 logged on the watch and corrected there before either reached the phone: the correction's row is the
    // first one's, so both apply, in the order they were done, however they arrive.
    const logged = cmd("set", { day: WED, lift: "Leg Press", set: 1, reps: 10, kg: 50, baseReps: null, baseKg: null }, 20 * SEC);
    const corrected = cmd("set", { day: WED, lift: "Leg Press", set: 1, reps: 9, kg: 47.5, baseReps: 10, baseKg: 50 }, 10 * SEC);
    watch.arrive(corrected, logged);
    await vi.advanceTimersByTimeAsync(0);
    expect(sets(s, "Leg Press")).toEqual([{ reps: 12, kg: 50 }, { reps: 9, kg: 47.5 }]);
    // One the row already has, typed on the phone too, is done, not dropped; weights are compared to the half kg, as
    // the phone keeps them (a watch's 21.25 is the phone's 21.5).
    s.editLift(WED, "Leg Press", (r) => void (r.sets = [...r.sets!, { reps: 8, kg: 21.5 }]), true);
    const same = cmd("set", { day: WED, lift: "Leg Press", set: 2, reps: 8, kg: 21.25, baseReps: null, baseKg: null });
    expect(applyWatchCommand(s, same)).toBe(true);
    expect(applyWatchCommand(s, { ...same, reps: null, baseReps: null })).toBe(false); // an undo from an empty row
    watch.arrive(cmd("set", { day: WED, lift: "Leg Press", set: 2, reps: 9, kg: 21.25, baseReps: 8, baseKg: 21.25 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(sets(s, "Leg Press")?.[2]).toEqual({ reps: 9, kg: 21.5 });
    stop();
  });

  it("drops what it can't apply, but still acks it and lists it as applied", async () => {
    const { s, stop } = await running(signedIn({ [WED]: day({ exercises: { "Calf Raise": skippedLift } }) }));
    s.startRest(WED, "Leg Press", 90);
    const before = JSON.stringify([s.logs, s.rest]);
    const cant = [
      cmd("set", { day: WED, lift: "Bench Press", set: 0, reps: 10, kg: 60 }), // not on Wednesday
      cmd("set", { day: WED, lift: "Leg Press", set: 3, reps: 10, kg: 45 }), // past its 3 rows
      cmd("set", { day: WED, lift: "Calf Raise", set: 0, reps: 15, kg: 30 }), // skipped: no sets to log
      cmd("set", { day: WED, lift: "Leg Press", set: 0, reps: 0, kg: 45 }),
      cmd("set", { day: WED, lift: "Leg Press", set: 0, reps: 10, kg: -5 }),
      cmd("set", { day: "Wednesday", lift: "Leg Press", set: 0, reps: 10, kg: 45 }),
      cmd("skipLift", { day: WED, lift: "Bench Press" }),
      cmd("cardioDone", { day: "2026-09-24", done: "yes", baseDone: false }),
      restCmd("restAdd", s.rest, { sec: -15 }),
      // Made under another account, before the phone signed out and into this one with the watch out of reach, and
      // made under none: each would otherwise log Leg Press's set 1, or skip its rest.
      cmd("set", { day: WED, lift: "Leg Press", set: 0, reps: 10, kg: 45, account: "someone-else" }),
      restCmd("restSkip", s.rest, { account: "someone-else" }),
      cmd("set", { day: WED, lift: "Leg Press", set: 0, reps: 10, kg: 45, account: undefined }),
      cmd("hr", { day: WED, avg: 128, max: 165, samples: 0 }), // nothing measured
      cmd("hr", { day: WED, avg: 170, max: 165, samples: 60 }), // an average over the highest
      cmd("hr", { day: WED, avg: 128, max: 300, samples: 60 }),
      cmd("hr", { day: WED, avg: "128", max: 165, samples: 60 }),
      cmd("hr", { avg: 128, max: 165, samples: 60 }),
      cmd("startRun", {}),
      cmd("teleport", { day: WED }),
      { ...cmd("cardioDone", { day: WED, done: true, baseDone: false }), v: 2 }, // a version this phone doesn't know
    ];
    watch.arrive(...cant);
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.stringify([s.logs, s.rest])).toBe(before);
    expect(currentRun()).toBeNull();
    expect(watch.sent().applied).toEqual(cant.map((c) => c.id));
    await vi.advanceTimersByTimeAsync(ACK_MS);
    expect(watch.queue).toEqual([]);
    stop();
  });

  it("runs the workout's clock from when it was started, paused and resumed on the watch, and Finish ends it and the day's rest", async () => {
    const { s, stop } = await running();
    // The phone keeps one run. Tuesday's, started on the watch at 11:30 out of reach, never replaces Wednesday's,
    // started on the phone at 11:35: it's dropped, and acked. Over one started before it (11:25), it starts, as ever.
    const TUE = "2026-09-22", tuesday = cmd("startRun", { day: TUE }, 30 * MIN);
    startRun(WED, NOON - 25 * MIN);
    watch.arrive(tuesday);
    await vi.advanceTimersByTimeAsync(0);
    expect(currentRun()).toMatchObject({ day: WED, startedAt: NOON - 25 * MIN });
    expect(watch.sent().applied).toContain(tuesday.id);
    restartRun(WED, NOON - 35 * MIN);
    watch.arrive(cmd("startRun", { day: TUE }, 30 * MIN));
    await vi.advanceTimersByTimeAsync(0);
    expect(currentRun()).toMatchObject({ day: TUE, startedAt: NOON - 30 * MIN });
    clearRun();

    // Pause, resume and Finish name the run the watch showed, by its start.
    const run = { day: WED, runStartedAt: NOON - 20 * MIN };
    watch.arrive(cmd("startRun", { day: WED }, 20 * MIN), cmd("pauseRun", run, 10 * MIN));
    await vi.advanceTimersByTimeAsync(0);
    expect(currentRun()).toMatchObject({ day: WED, startedAt: NOON - 20 * MIN, pausedAt: NOON - 10 * MIN });
    watch.arrive(cmd("resumeRun", run, 5 * MIN), cmd("startRun", { day: WED }));
    await vi.advanceTimersByTimeAsync(0);
    expect(currentRun()).toMatchObject({ startedAt: NOON - 20 * MIN, pausedMs: 5 * MIN }); // already running: carries on
    expect(currentRun()?.pausedAt).toBeUndefined();

    // Paused on the watch out of reach at 11:57, while on the phone the clock was paused and started again from 0:00
    // (↺) at 11:58: that pause, finish too, was for the run before, and the new one runs on.
    const pause = cmd("pauseRun", run, 3 * MIN), finish = cmd("finish", run, 3 * MIN);
    restartRun(WED, NOON - 2 * MIN);
    watch.arrive(pause, finish);
    await vi.advanceTimersByTimeAsync(0);
    expect(currentRun()).toEqual({ day: WED, startedAt: NOON - 2 * MIN, user: "u" });
    expect(watch.sent().applied).toEqual(expect.arrayContaining([pause.id, finish.id])); // dropped, and acked
    // A day with no clock yet: Finish from the watch, which showed none, still ends the day's rest; with a clock
    // started on the phone since, it's dropped.
    clearRun();
    s.startRest(WED, "Calf Raise", 90);
    watch.arrive(cmd("finish", { day: WED }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toBeNull();
    startRun(WED, NOON - MIN);
    watch.arrive(cmd("finish", { day: WED }));
    await vi.advanceTimersByTimeAsync(0);
    expect(currentRun()?.endedAt).toBeUndefined();

    // Finished on the watch 30 s ago, a minute into Calf Raise's rest: the clock ends then, and the rest with it.
    s.startRest(WED, "Calf Raise", 90);
    await vi.advanceTimersByTimeAsync(60 * SEC);
    watch.arrive(cmd("finish", { day: WED, runStartedAt: NOON - MIN }, 30 * SEC));
    await vi.advanceTimersByTimeAsync(0);
    expect(currentRun()).toMatchObject({ endedAt: NOON + 30 * SEC });
    expect(s.rest).toBeNull();
    // Another day's rest isn't this workout's.
    s.startRest("2026-09-22", "Lat Pulldown", 90);
    watch.arrive(cmd("finish", { day: WED, runStartedAt: NOON - MIN }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).not.toBeNull();
    stop();
  });

  describe("late, over what the phone changed after it was done: nothing newer is undone", () => {
    /** The watch's command is done at 11:59:20 (`AGO` before noon), over a rest or run from 11:59:10 (`S`), and the
     *  phone changes what it acts on at 11:59:40 (`P`), before the command arrives. */
    const S = NOON - 50 * SEC, P = NOON - 20 * SEC, AGO = 40 * SEC;
    const firstSet = () => cmd("set", { day: WED, lift: "Leg Press", set: 0, reps: 10, kg: 45, baseReps: null, baseKg: null, baseName: "Leg Press" }, AGO);
    const swap = (s: GymStore) => s.editLift(WED, "Leg Press", (r) => void (r.swap = "Hack Squat"), true);
    const rows: { name: string; before?: (s: GymStore) => void; command: (s: GymStore) => WatchCommand; after: (s: GymStore) => void; left: (s: GymStore) => void }[] = [
      {
        name: "set: a row corrected on the phone keeps the correction",
        command: firstSet,
        after: (s) => s.editLift(WED, "Leg Press", (r) => void (r.sets = [{ reps: 12, kg: 50 }]), true),
        left: (s) => expect(sets(s, "Leg Press")).toEqual([{ reps: 12, kg: 50 }]),
      },
      {
        name: "set: a rest skipped on the phone isn't started again",
        before: (s) => s.startRest(WED, "Calf Raise", 90, S),
        command: firstSet,
        after: (s) => s.skipRest(P),
        left: (s) => {
          expect(sets(s, "Leg Press")).toEqual([{ reps: 10, kg: 45 }]);
          expect(s.rest).toBeNull();
        },
      },
      {
        name: "set: no rest starts after the workout was finished on the phone",
        before: () => startRun(WED, S),
        command: firstSet,
        after: (s) => finishWorkout(s, WED, P),
        left: (s) => {
          expect(sets(s, "Leg Press")).toEqual([{ reps: 10, kg: 45 }]);
          expect(s.rest).toBeNull();
        },
      },
      {
        name: "set: a lift swapped on the phone after it isn't given the set, nor its rest",
        command: firstSet,
        after: swap,
        left: (s) => {
          expect(s.entry(WED).exercises["Leg Press"]).toMatchObject({ swap: "Hack Squat" });
          expect(sets(s, "Leg Press") ?? []).toEqual([]);
          expect(s.rest).toBeNull();
        },
      },
      {
        name: "set: a lift unticked on the phone after it stays unticked",
        before: (s) => s.editLift(WED, "Leg Press", (r) => void Object.assign(r, { sets: [{ reps: 10, kg: 45 }, { reps: 10, kg: 45 }, { reps: 10, kg: 45 }], done: true, autoDone: true }), true),
        command: () => cmd("set", { day: WED, lift: "Leg Press", set: 2, reps: 8, kg: 45, baseReps: 10, baseKg: 45, baseDone: true }, AGO),
        after: (s) => s.editLift(WED, "Leg Press", (r) => void Object.assign(r, { done: false, autoDone: undefined }), true),
        left: (s) => {
          expect(sets(s, "Leg Press")?.[2]).toEqual({ reps: 8, kg: 45 });
          expect(s.entry(WED).exercises["Leg Press"].done).toBe(false);
        },
      },
      {
        name: "skipLift: a lift logged on the phone after it isn't skipped",
        command: () => cmd("skipLift", { day: WED, lift: "Leg Press", baseDone: false, baseSkipped: false, baseLogged: 0 }, AGO),
        after: (s) => s.editLift(WED, "Leg Press", (r) => void (r.sets = [{ reps: 10, kg: 45 }]), true),
        left: (s) => {
          expect(sets(s, "Leg Press")).toEqual([{ reps: 10, kg: 45 }]);
          expect(s.entry(WED).exercises["Leg Press"].skipped).toBeFalsy();
        },
      },
      {
        name: "skipLift: a lift swapped on the phone after it isn't skipped",
        command: () => cmd("skipLift", { day: WED, lift: "Leg Press", baseName: "Leg Press", baseDone: false, baseSkipped: false, baseLogged: 0 }, AGO),
        after: swap,
        left: (s) => {
          expect(s.entry(WED).exercises["Leg Press"].swap).toBe("Hack Squat");
          expect(s.entry(WED).exercises["Leg Press"].skipped).toBeFalsy();
        },
      },
      {
        name: "skipLift: a lift ticked done on the phone after it isn't skipped",
        command: () => cmd("skipLift", { day: WED, lift: "Leg Press", baseDone: false, baseSkipped: false, baseLogged: 0 }, AGO),
        after: (s) => s.editLift(WED, "Leg Press", (r) => void (r.done = true), true),
        left: (s) => {
          expect(s.entry(WED).exercises["Leg Press"].done).toBe(true);
          expect(s.entry(WED).exercises["Leg Press"].skipped).toBeFalsy();
        },
      },
      {
        name: "startRun: a run started before it and finished on the phone after it stays finished",
        before: () => startRun(WED, S),
        command: () => cmd("startRun", { day: WED }, AGO),
        after: () => endRun(WED, P),
        left: () => expect(currentRun()).toMatchObject({ startedAt: S, endedAt: P }),
      },
      {
        name: "startRun: another day's run started on the phone after it stays",
        command: () => cmd("startRun", { day: "2026-09-22" }, AGO),
        after: () => startRun(WED, P),
        left: () => expect(currentRun()).toMatchObject({ day: WED, startedAt: P }),
      },
      {
        name: "pauseRun: the run paused and resumed on the phone after it keeps running",
        before: () => startRun(WED, S),
        command: () => cmd("pauseRun", { day: WED, runStartedAt: S }, AGO),
        after: () => {
          pauseRun(WED, P - 5 * SEC);
          resumeRun(WED, P);
        },
        left: () => expect(currentRun()).toEqual({ day: WED, startedAt: S, pausedMs: 5 * SEC, pauses: [[P - 5 * SEC, P]], user: "u" }),
      },
      {
        name: "resumeRun: the run resumed and paused again on the phone after it stays paused",
        before: () => {
          startRun(WED, S);
          pauseRun(WED, S + SEC);
        },
        command: () => cmd("resumeRun", { day: WED, runStartedAt: S }, AGO),
        after: () => {
          resumeRun(WED, P - 5 * SEC);
          pauseRun(WED, P);
        },
        left: () => expect(currentRun()).toMatchObject({ pausedAt: P, pausedMs: P - 5 * SEC - (S + SEC) }),
      },
      {
        name: "finish: a rest started on the phone after it stays, and the run still ends",
        before: () => startRun(WED, S),
        command: () => cmd("finish", { day: WED, runStartedAt: S }, AGO),
        after: (s) => s.startRest(WED, "Calf Raise", 90),
        left: (s) => {
          expect(currentRun()?.endedAt).toBe(NOON - AGO);
          expect(s.rest).toMatchObject({ lift: "Calf Raise", startedAt: NOON });
        },
      },
      {
        name: "finish: the run paused on the phone after it isn't finished",
        before: () => startRun(WED, S),
        command: () => cmd("finish", { day: WED, runStartedAt: S }, AGO),
        after: () => pauseRun(WED, P),
        left: () => {
          expect(currentRun()).toMatchObject({ pausedAt: P });
          expect(currentRun()?.endedAt).toBeUndefined();
        },
      },
      {
        name: "restSkip: a rest made longer on the phone after it stays",
        before: (s) => s.startRest(WED, "Leg Press", 90, S),
        command: (s) => restCmd("restSkip", s.rest, {}, AGO),
        after: (s) => s.addRestTime(15, P),
        left: (s) => expect(s.rest).toMatchObject({ endAt: S + 105 * SEC }),
      },
      {
        name: "restAdd: a rest paused on the phone after it keeps what it had left",
        before: (s) => s.startRest(WED, "Leg Press", 90, S),
        command: (s) => restCmd("restAdd", s.rest, { sec: 15 }, AGO),
        after: (s) => s.pauseRest(P),
        left: (s) => expect(s.rest).toMatchObject({ pausedAt: P, endAt: S + 90 * SEC }),
      },
      {
        name: "restPause: a rest paused and resumed on the phone after it keeps running",
        before: (s) => s.startRest(WED, "Leg Press", 90, S),
        command: (s) => restCmd("restPause", s.rest, {}, AGO),
        after: (s) => {
          s.pauseRest(P - 5 * SEC);
          s.resumeRest(P);
        },
        left: (s) => expect(s.rest).toMatchObject({ pausedAt: null, endAt: S + 95 * SEC }),
      },
      {
        name: "restResume: a rest resumed and paused again on the phone after it stays paused",
        before: (s) => {
          s.startRest(WED, "Leg Press", 90, S);
          s.pauseRest(S + 5 * SEC);
        },
        command: (s) => restCmd("restResume", s.rest, {}, AGO),
        after: (s) => {
          s.resumeRest(P - 5 * SEC);
          s.pauseRest(P);
        },
        left: (s) => expect(s.rest).toMatchObject({ pausedAt: P }),
      },
      {
        name: "cardioDone: made over the cardio ticked, taken back on the phone after it, changes nothing",
        before: (s) => s.editDay(WED, (d) => void (d.cardio = true), true),
        command: () => cmd("cardioDone", { day: WED, done: true, baseDone: true }, AGO),
        after: (s) => s.editDay(WED, (d) => void (d.cardio = false), true),
        left: (s) => expect(s.entry(WED).cardio).toBe(false),
      },
      {
        name: "hr: the day's fuller heart rate, from a later snapshot, stays",
        command: () => cmd("hr", { day: WED, avg: 110, max: 140, samples: 30 }, AGO),
        after: (s) => s.editDay(WED, (d) => void (d.hr = { avg: 125, max: 160, samples: 90 }), true),
        left: (s) => expect(s.entry(WED).hr).toEqual({ avg: 125, max: 160, samples: 90 }),
      },
      {
        name: "any: one made under the account signed out of since changes nothing",
        command: () => ({ ...firstSet(), account: "someone-else" }),
        after: () => {},
        left: (s) => expect(sets(s, "Leg Press")).toBeUndefined(),
      },
    ];
    it.each(rows)("$name", async ({ before, command, after, left }) => {
      const { s, stop } = await running();
      before?.(s);
      const c = command(s);
      after(s);
      watch.arrive(c);
      await vi.advanceTimersByTimeAsync(0);
      left(s);
      expect(watch.sent().applied).toContain(c.id); // dropped, or done as far as it can be, and acked either way
      stop();
    });
  });

  it("pauses, resumes, adds to and skips the rest as of when each was pressed, skips a lift and ticks the cardio", async () => {
    const { s, stop } = await running();
    s.startRest(WED, "Leg Press", 90);
    const shown = { ...s.rest! };
    // Paused on the watch at 12:00:05, reaching the phone at 12:00:08: what was left at 12:00:05 is kept.
    await vi.advanceTimersByTimeAsync(8 * SEC);
    watch.arrive(restCmd("restPause", shown, {}, 3 * SEC));
    await vi.advanceTimersByTimeAsync(7 * SEC);
    expect(s.rest).toMatchObject({ pausedAt: NOON + 5 * SEC });
    expect(s.restRemaining()).toBe(85);
    // Resumed and 15 s added at 12:00:15, reaching the phone at 12:00:20: it has counted down since 12:00:15.
    await vi.advanceTimersByTimeAsync(5 * SEC);
    watch.arrive(restCmd("restResume", shown, {}, 5 * SEC), restCmd("restAdd", shown, { sec: 15 }, 5 * SEC));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toMatchObject({ pausedAt: null, endAt: NOON + 115 * SEC });
    expect(s.restRemaining()).toBe(95);
    // Still the rest it was, paused, resumed and 15 s longer: the watch's next button is for it too.
    expect(s.rest?.startedAt).toBe(NOON);

    // +15s pressed 5 s before the rest ended, reaching the phone 5 s after: 15 s more from its end.
    await vi.advanceTimersByTimeAsync(100 * SEC);
    expect(s.rest?.ended).toBe(true);
    watch.arrive(restCmd("restAdd", shown, { sec: 15 }, 10 * SEC));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toMatchObject({ ended: false, endAt: NOON + 130 * SEC });
    // Pressed once that was over too, at 12:02:15, and reaching the phone at 12:02:40, when even 15 s more would be
    // over: nothing changes, and it's acked.
    await vi.advanceTimersByTimeAsync(40 * SEC);
    const over = { ...s.rest! }, late = restCmd("restAdd", shown, { sec: 15 }, 25 * SEC);
    watch.arrive(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toEqual(over);
    expect(watch.sent().applied).toContain(late.id);
    // A pause pressed 5 s before the end, arriving after it: paused with those 5 s, no longer over.
    s.addRestTime(15);
    await vi.advanceTimersByTimeAsync(20 * SEC);
    expect(s.rest).toMatchObject({ endAt: NOON + 175 * SEC, ended: true });
    watch.arrive(restCmd("restPause", shown, {}, 10 * SEC));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toMatchObject({ pausedAt: NOON + 170 * SEC, ended: false });
    expect(s.restRemaining()).toBe(5);
    watch.arrive(restCmd("restSkip", shown));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toBeNull();

    watch.arrive(cmd("skipLift", { day: WED, lift: "Leg Extension", baseDone: false, baseSkipped: false, baseLogged: 0 }), cmd("cardioDone", { day: WED, done: true, baseDone: false }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.entry(WED).exercises["Leg Extension"]).toMatchObject({ skipped: true, done: false });
    expect(s.entry(WED).cardio).toBe(true);
    // A free workout has no cardio to tick.
    s.logs["2026-09-24"] = day({ free: { name: "Hotel gym", lifts: [] } });
    watch.arrive(cmd("cardioDone", { day: "2026-09-24", done: true, baseDone: false }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.entry("2026-09-24").cardio).toBe(false);
    stop();
  });

  it("drops a rest button pressed for a rest that's been replaced since, however late it arrives, but not for the same rest 15 s longer", async () => {
    const { s, stop } = await running();
    s.startRest(WED, "Leg Press", 90);
    // Skip and +15s pressed on the watch out of the phone's reach, for set 1's rest...
    const first = { ...s.rest! }, skip = restCmd("restSkip", first), add = restCmd("restAdd", first, { sec: 15 });
    // ...while set 2, logged on the phone, started the lift's next rest: the same day and lift, started later.
    await vi.advanceTimersByTimeAsync(30 * SEC);
    s.startRest(WED, "Leg Press", 90);
    watch.arrive(skip, add);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toMatchObject({ lift: "Leg Press", startedAt: NOON + 30 * SEC, endAt: NOON + 120 * SEC, pausedAt: null });
    expect(watch.sent().applied).toEqual([skip.id, add.id]); // dropped, and acked all the same
    // The watch's pause for that newer rest, late too, after +15s on the phone: still the same rest, so paused.
    const pause = restCmd("restPause", s.rest);
    s.addRestTime(15);
    watch.arrive(pause);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toMatchObject({ startedAt: NOON + 30 * SEC, pausedAt: NOON + 30 * SEC });
    expect(s.restRemaining()).toBe(105);

    // A rest the watch started itself, for a set done there, has the watch's time as its start, even with the
    // watch's clock a little ahead of the phone's: the watch's own Skip for it is for this rest.
    const done = cmd("set", { day: WED, lift: "Hamstring Curl", set: 0, reps: 10, kg: 32.5 }, -2 * SEC);
    watch.arrive(done);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toMatchObject({ lift: "Hamstring Curl", startedAt: done.at, endAt: NOON + 120 * SEC });
    watch.arrive(restCmd("restSkip", { day: WED, lift: "Hamstring Curl", startedAt: done.at as number }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toBeNull();

    // A timer kept from before rests had a start is known by its day and lift alone, as is one named by a command
    // without it.
    s.rest = { day: WED, lift: "Leg Press", endAt: NOON + 60 * SEC, pausedAt: null, ended: false, sec: 90 };
    watch.arrive(restCmd("restAdd", { day: WED, lift: "Calf Raise", startedAt: NOON }, { sec: 15 }), restCmd("restAdd", { day: "2026-09-22", lift: "Leg Press", startedAt: NOON }, { sec: 15 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest?.endAt).toBe(NOON + 60 * SEC);
    watch.arrive(restCmd("restAdd", { day: WED, lift: "Leg Press", startedAt: NOON }, { sec: 15 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest?.endAt).toBe(NOON + 75 * SEC);
    s.startRest(WED, "Leg Press", 90);
    watch.arrive(restCmd("restSkip", { day: WED, lift: "Leg Press" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rest).toBeNull();
    stop();
  });

  it("keeps the workout's heart rate on its day, the latest replacing the one before, through the day's later edits", async () => {
    const { s, stop } = await running();
    watch.arrive(cmd("hr", { day: WED, avg: 118.4, max: 151, samples: 60 }, 5 * MIN), cmd("hr", { day: WED, avg: 128, max: 165, samples: 240 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.entry(WED).hr).toEqual({ avg: 128, max: 165, samples: 240 });
    expect(s.pending[WED].hr).toEqual({ avg: 128, max: 165, samples: 240 }); // on its way to Supabase with the day
    expect(watch.sent().applied).toHaveLength(2);
    // Everything else done to the day since keeps it, as does the day as it comes back from Supabase (one kept before
    // it had its count too).
    s.editDay(WED, (n) => void (n.kneeAfter = 3), true);
    s.editLift(WED, "Leg Press", (r) => void (r.sets = [{ reps: 10, kg: 45 }]), true);
    expect(s.entry(WED).hr).toEqual({ avg: 128, max: 165, samples: 240 });
    expect(storeWith({ [WED]: { ...day(), hr: { avg: 131, max: 170, samples: 300 } } }).entry(WED).hr).toEqual({ avg: 131, max: 170, samples: 300 });
    expect(storeWith({ [WED]: { ...day(), hr: { avg: 131, max: 170 } } }).entry(WED).hr).toEqual({ avg: 131, max: 170 });
    expect(storeWith({ [WED]: { ...day(), hr: { avg: "fast" } } as unknown as DayLog }).entry(WED).hr).toBeUndefined();
    // An older snapshot handed over after it, a batch later (each is its own item, in no set order): it covers fewer
    // readings, so the day keeps the fuller one. One over as many replaces it.
    watch.arrive(cmd("hr", { day: WED, avg: 121, max: 158, samples: 180 }, 2 * MIN));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.entry(WED).hr).toEqual({ avg: 128, max: 165, samples: 240 });
    expect(watch.sent().applied).toHaveLength(3); // dropped, and acked all the same
    watch.arrive(cmd("hr", { day: WED, avg: 127, max: 165, samples: 240 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.entry(WED).hr).toEqual({ avg: 127, max: 165, samples: 240 });
    // Rounded, as a whole beat, whatever the watch sends.
    watch.arrive(cmd("hr", { day: WED, avg: 130.6, max: 171.2, samples: 300 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.entry(WED).hr).toEqual({ avg: 131, max: 171, samples: 300 });
    // A day kept before it had a count takes the watch's next, whatever its count.
    s.editDay(WED, (n) => void (n.hr = { avg: 140, max: 180 }), true);
    watch.arrive(cmd("hr", { day: WED, avg: 125, max: 160, samples: 30 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.entry(WED).hr).toEqual({ avg: 125, max: 160, samples: 30 });
    stop();
  });

  it("waits, with the commands left in the plugin, until a real account's days are loaded; then takes them on arriving and coming back", async () => {
    const s = storeWith(lastWeek());
    s.auth = "signedOut";
    const stop = watching(s);
    watch.arrive(cmd("restSkip"));
    await vi.advanceTimersByTimeAsync(0);
    expect(watch.pending).not.toHaveBeenCalled();
    s.auth = "signedIn";
    s.firstLoad = true;
    s.setStatus("Loading…");
    await vi.advanceTimersByTimeAsync(0);
    expect(watch.pending).not.toHaveBeenCalled();
    s.firstLoad = false;
    s.setStatus("Synced");
    await vi.advanceTimersByTimeAsync(0);
    expect(watch.sent().applied).toHaveLength(1);

    // Taken in by the plugin while the app was in the background, without a word: applied on coming back.
    watch.queue.push(cmd("cardioDone", { day: WED, done: true, baseDone: false }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.entry(WED).cardio).toBe(false);
    app.fire("resume");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.entry(WED).cardio).toBe(true);
    stop();
  });

  it("lists every command the plugin's queue can hold, taken all at once before the watch hears from the phone, then the latest", async () => {
    const { stop } = await running();
    const many = Array.from({ length: QUEUE_MAX + 1 }, () => cmd("restSkip"));
    watch.arrive(...many.slice(0, QUEUE_MAX));
    await vi.advanceTimersByTimeAsync(0);
    expect(watch.sent().applied).toEqual(many.slice(0, QUEUE_MAX).map((c) => c.id));
    watch.arrive(many[QUEUE_MAX]);
    await vi.advanceTimersByTimeAsync(0);
    expect(watch.sent().applied).toEqual(many.slice(1).map((c) => c.id));
    stop();
  });
});
