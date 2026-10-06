import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liftModel, logSet, nextSet } from "@/components/today/LiftItem";
import { wdIndex } from "@/lib/dates";
import { AWAKE_KEY, awakePref, keepScreenOn, setAwakePref } from "@/lib/awake";
import { dayBests, dayTotals, heartWords, liveWorkout, sessionDone, workoutUnderWay } from "@/lib/session";
import type { GymStore } from "@/lib/store";
import type { LiftLog } from "@/lib/types";
import { clearRun, dropStaleRun, endRun, keepRunsInMemory, pauseRun, restartRun, resumeRun, runOf, runSeconds, runsFor, STALE_RUN_MS, startRun } from "@/lib/workout";
import { day, LAST, lift, storeWith, WED } from "./helpers";

const mem = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
} as unknown as Storage;

describe("workout runs", () => {
  beforeEach(() => {
    mem.clear();
    keepRunsInMemory(false);
    runsFor("a");
  });

  it("keeps a run going for its day, and ends it once", () => {
    const r = startRun("2026-09-23", 1000);
    expect(startRun("2026-09-23", 5000)).toEqual(r);
    expect(endRun("2026-09-23", 9000)?.endedAt).toBe(9000);
    expect(endRun("2026-09-23", 12000)?.endedAt).toBe(9000);
    clearRun();
    expect(runOf("2026-09-23")).toBeNull();
  });

  it("starts the clock again from 0:00 when asked, or when it was left running for hours", () => {
    startRun("2026-09-23", 1000);
    expect(restartRun("2026-09-23", 60_000).startedAt).toBe(60_000);
    expect(startRun("2026-09-23", 60_000 + STALE_RUN_MS - 1).startedAt).toBe(60_000); // still the same workout
    expect(startRun("2026-09-23", 60_000 + STALE_RUN_MS).startedAt).toBe(60_000 + STALE_RUN_MS); // left behind
  });

  it("pauses: the clock stops where it is, the paused time never counts, and Finish while paused ends it there", () => {
    const d = "2026-09-23";
    startRun(d, 0);
    expect(pauseRun(d, 10 * 60_000)?.pausedAt).toBe(10 * 60_000);
    expect(pauseRun(d, 11 * 60_000)?.pausedAt).toBe(10 * 60_000); // already paused: unchanged
    expect(runSeconds(runOf(d)!, 25 * 60_000)).toBe(10 * 60); // stopped at 10:00
    expect(resumeRun(d, 25 * 60_000)).toMatchObject({ pausedMs: 15 * 60_000 });
    expect(runOf(d)?.pausedAt).toBeUndefined();
    expect(runSeconds(runOf(d)!, 30 * 60_000)).toBe(15 * 60); // 10 before, 5 since
    // Each pause is kept too, from and to, for the watch to leave its heart rate readings out.
    expect(runOf(d)?.pauses).toEqual([[10 * 60_000, 25 * 60_000]]);
    pauseRun(d, 40 * 60_000);
    expect(runSeconds(endRun(d, 50 * 60_000)!)).toBe(25 * 60); // finished while paused: 25:00, not 35:00
    expect(pauseRun(d, 60 * 60_000)?.pausedAt).toBe(40 * 60_000); // a finished run doesn't pause again
  });

  it("never counts a paused clock as left behind; one running for hours, less its pauses, is", () => {
    const d = "2026-09-23";
    startRun(d, 0);
    pauseRun(d, 60_000);
    expect(startRun(d, 10 * STALE_RUN_MS).startedAt).toBe(0); // paused on purpose: kept
    resumeRun(d, STALE_RUN_MS);
    // Counted: a minute before the pause, then from STALE_RUN_MS on.
    expect(startRun(d, 2 * STALE_RUN_MS - 2 * 60_000).startedAt).toBe(0);
    expect(startRun(d, 2 * STALE_RUN_MS).startedAt).toBe(2 * STALE_RUN_MS);
  });

  it("keeps a long workout's clock on screen and at Finish; drops one left behind only when a finished day is reviewed", () => {
    startRun("2026-09-23", 1000);
    expect(runOf("2026-09-23")?.startedAt).toBe(1000); // still open 3+ hours on: the clock carries on
    expect(endRun("2026-09-23", 1000 + STALE_RUN_MS + 60_000)?.endedAt).toBe(1000 + STALE_RUN_MS + 60_000);
    // A finished run keeps its duration, however long ago it ended, and reviewing doesn't drop it.
    dropStaleRun("2026-09-23", 1000 + 10 * STALE_RUN_MS);
    expect(runOf("2026-09-23")?.endedAt).toBe(1000 + STALE_RUN_MS + 60_000);
    // An unfinished one left behind is dropped when its finished day is opened to review it.
    startRun("2026-09-24", 5000);
    dropStaleRun("2026-09-24", 5000 + STALE_RUN_MS - 1);
    expect(runOf("2026-09-24")?.startedAt).toBe(5000);
    dropStaleRun("2026-09-24", 5000 + STALE_RUN_MS);
    expect(runOf("2026-09-24")).toBeNull();
  });

  it("clears only the given day's run: closing a reviewed day leaves another day's clock running", () => {
    startRun("2026-09-22", 1000);
    clearRun("2026-09-23");
    expect(runOf("2026-09-22")?.startedAt).toBe(1000);
    clearRun("2026-09-22");
    expect(runOf("2026-09-22")).toBeNull();
  });

  it("never hands one account's unfinished run to another signed in on the same phone", () => {
    startRun("2026-09-23", 1000);
    runsFor("b");
    expect(runOf("2026-09-23")).toBeNull();
    expect(startRun("2026-09-23", 7000).startedAt).toBe(7000);
    runsFor("a");
    expect(runOf("2026-09-23")).toBeNull();
  });

  it("starts each go at the sample data with no run, though every demo has the same user", () => {
    keepRunsInMemory(true);
    runsFor("demo");
    startRun("2026-09-23", 1000);
    expect(mem.size).toBe(0);
    keepRunsInMemory(false); // leaving the demo
    keepRunsInMemory(true);
    expect(runOf("2026-09-23")).toBeNull();
    startRun("2026-09-23", 1000);
    runsFor(null); // signed out, then the sample data again
    runsFor("demo");
    expect(runOf("2026-09-23")).toBeNull();
  });
});

// The workout's big button, Complete set N (WorkoutView.tsx): the set it's on, and what it logs there. On screen, a
// whole workout done with it is in tests/e2e/workout.e2e.mjs.
describe("Complete set N", () => {
  /** Wednesday's lift `name` as its card in the workout has it, `onReps` hearing of a set given its first reps. */
  const card = (s: GymStore, name: string, onReps: (j: number) => void = () => {}) => {
    const items = s.liftsFor(WED), i = items.findIndex((it) => it.name === name);
    return liftModel(s, WED, items[i], i, s.entry(WED), (_, j) => onReps(j));
  };
  const saved = (s: GymStore, name: string) => s.entry(WED).exercises[name]?.sets;
  // Last Wednesday: Hamstring Curl topped its range (go up to 32.5 kg), Leg Press didn't (45 kg again).
  const lastWeek = () => storeWith({ [LAST]: day({ exercises: { "Hamstring Curl": lift([[12, 30], [12, 30], [12, 30]]), "Leg Press": lift([[10, 45], [10, 45], [8, 45]]) } }) });

  it("logs the suggestion in the set's boxes when nothing's typed, the reps last, so the rest starts on the finished set", () => {
    const s = lastWeek(), heard: string[] = [];
    const m = card(s, "Hamstring Curl", (j) => heard.push(JSON.stringify(saved(s, "Hamstring Curl")![j])));
    expect([nextSet(m), s.placeholders(m.x, m.last, 0, m.next)]).toEqual([0, ["10", "32.5"]]);
    logSet(s, m, 0);
    expect(saved(s, "Hamstring Curl")).toEqual([{ reps: 10, kg: 32.5 }]);
    expect(heard).toEqual(['{"reps":10,"kg":32.5}']);
    expect(nextSet(card(s, "Hamstring Curl"))).toBe(1); // on to set 2
  });

  it("keeps what's typed, and the sets after a logged one repeat it over the suggestion", () => {
    const s = lastWeek();
    card(s, "Leg Press").setField(0, "kg", "50");
    for (let j = 0; j < 3; j++) logSet(s, card(s, "Leg Press"), j);
    // Set 1 takes last week's reps (10) at today's 50 kg rather than the suggested 45; sets 2 and 3 repeat it, not
    // last week's 10 and 8.
    expect(saved(s, "Leg Press")).toEqual([{ reps: 10, kg: 50 }, { reps: 10, kg: 50 }, { reps: 10, kg: 50 }]);
    // The planned sets are in: the lift is ticked off, and the button moves on.
    expect(s.entry(WED).exercises["Leg Press"]).toMatchObject({ done: true, autoDone: true });
    expect(nextSet(card(s, "Leg Press"))).toBe(-1);
  });

  it("repeats the last set logged, reps and weight, and passes over a drop set or a rest-pause burst", () => {
    const s = lastWeek(), m = () => card(s, "Leg Press");
    m().setField(0, "kg", "55");
    m().setField(0, "reps", "12");
    expect(m().sugFor(m().sets, 1)).toEqual(["12", "55"]); // what set 2's boxes show greyed
    m().setInfo(0, { type: "drop" }); // set 1 a drop set after all: lighter on purpose, so not repeated
    expect(m().sugFor(m().sets, 1)).toEqual(["10", "55"]); // last week's reps; the weight typed just before it
    m().setInfo(0, { type: "restpause" }); // a few reps after a short rest: not what the next set repeats either
    expect(m().sugFor(m().sets, 1)).toEqual(["10", "55"]);
    m().setInfo(0, { type: undefined });
    logSet(s, m(), 1);
    logSet(s, m(), 2);
    expect(saved(s, "Leg Press")).toEqual([{ reps: 12, kg: 55 }, { reps: 12, kg: 55 }, { reps: 12, kg: 55 }]);
  });

  it("logs the reps alone for a lift never done, which has no weight to suggest", () => {
    const s = storeWith();
    logSet(s, card(s, "Calf Raise"), 0);
    expect(saved(s, "Calf Raise")).toEqual([{ reps: 12, kg: null }]); // the bottom of its 12-15
  });

  it("puts the cursor in the reps box, and logs nothing, with no reps to suggest", () => {
    // A lift logged outside the plan, with only a weight so far: no range, and no earlier sets.
    const s = storeWith({ [WED]: day({ exercises: { "Goblet Squat": { done: false, kg: 20, sets: [{ reps: null, kg: 20 }] } } }) });
    const focused: string[] = [];
    vi.stubGlobal("document", { getElementById: (id: string) => ({ focus: () => focused.push(id) }) });
    try {
      const m = card(s, "Goblet Squat");
      logSet(s, m, 0);
      expect(focused).toEqual([`s${m.i}_0_r`]);
      expect(saved(s, "Goblet Squat")).toEqual([{ reps: null, kg: 20 }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// Workout complete (CompleteView.tsx): the day's numbers, the heart rate the watch measured, and whether the day's
// workout is done at all (Train's Review, and no clock started when it's opened again).
describe("what a session adds up to", () => {
  it("counts the working sets logged against the planned ones, and the kg lifted in every one of them, drop sets too, never a warm-up", () => {
    const s = storeWith({
      [WED]: day({
        exercises: {
          "Hack Squat": { done: true, kg: 40, sets: [{ reps: 8, kg: 20, type: "warmup" }, { reps: 10, kg: 40 }, { reps: 10, kg: 40 }, { reps: 9, kg: 40, type: "failure" }] },
          "Leg Press": { done: false, kg: null, skipped: true },
          // Asked for 4 sets that day, whatever the plan says now; a drop set after them.
          "Leg Extension": { done: true, kg: 27, target: { sets: "4", reps: "12-15" }, sets: [{ reps: 12, kg: 27 }, { reps: 12, kg: 27 }, { reps: 12, kg: 27 }, { reps: 15, kg: 15, type: "drop" }] },
          "Hamstring Curl": { done: false, kg: 30, sets: [{ reps: null, kg: 30 }] }, // a weight, but no reps yet
          "Goblet Squat": lift([[12, 20]]), // outside the plan: logged, but never planned
        },
      }),
    });
    expect(dayTotals(s, WED)).toEqual({
      sets: 3 + 4 + 1,
      planned: 3 + 4 + 3 + 3, // Hack Squat, Leg Extension (its own 4), Hamstring Curl, Calf Raise: not the skipped Leg Press
      kg: 1160 + 972 + 225 + 240,
    });
  });

  it("names each lift's best record of the day, by what was done: of its record sets, the best estimated 1RM", () => {
    const s = storeWith({
      [LAST]: day({
        exercises: { "Hack Squat": lift([[10, 40], [10, 40], [10, 40]]), "Leg Press": lift([[10, 20]], { swap: "Smith Squat" }), "Leg Extension": lift([[12, 30]]), "Hamstring Curl": lift([[10, 30]]) },
      }),
      [WED]: day({
        exercises: {
          // 45 × 6 is the heaviest yet, but 40 × 12 (most reps at 40, and an estimate of 57.6 kg) is the better set.
          "Hack Squat": lift([[10, 42.5], [6, 45], [12, 40]]),
          "Leg Press": lift([[10, 25]], { swap: "Smith Squat" }),
          "Leg Extension": lift([[10, 27]]), // lighter: no record
          "Hamstring Curl": { done: true, kg: 30, sets: [{ reps: 5, kg: 50, type: "warmup" }, { reps: 10, kg: 30 }] }, // a heavy warm-up is never one
          "Calf Raise": lift([[15, 30]]), // the first time: nothing to beat
        },
      }),
    });
    expect(dayBests(s, WED)).toEqual([
      { lift: "Hack Squat", kg: 40, reps: 12, kinds: ["e1rm", "reps"] },
      { lift: "Smith Squat", kg: 25, reps: 10, kinds: ["weight", "e1rm"] },
    ]);
  });

  it("gives the workout's heart rate from the watch as its average and highest, and nothing without one", () => {
    const s = storeWith({ [WED]: day({ hr: { avg: 128, max: 165 } }), [LAST]: day() });
    expect(heartWords(s.entry(WED))).toBe("Avg 128 bpm · max 165");
    expect(heartWords(s.entry(LAST))).toBeNull();
  });

  it("says the day's workout is done once every lift in it is done or skipped, and never for a day with none", () => {
    const all = (r: LiftLog) => Object.fromEntries(["Hack Squat", "Leg Press", "Leg Extension", "Hamstring Curl", "Calf Raise"].map((n) => [n, r]));
    const s = storeWith({ [WED]: day({ exercises: all(lift([[10, 20]])) }) });
    expect(sessionDone(s, WED)).toBe(true);
    s.logs[WED].exercises["Leg Press"] = { done: false, kg: null, skipped: true } as LiftLog;
    expect(sessionDone(s, WED)).toBe(true);
    s.logs[WED].exercises["Calf Raise"] = { done: false, kg: 30, sets: [{ reps: 10, kg: 30 }] };
    expect(sessionDone(s, WED)).toBe(false);
    expect(sessionDone(s, "2026-09-24")).toBe(false); // Thursday: a rest day
  });
});

// What the phone shows of a workout under way while Gym Log is out of sight: an Android 16 Live Update, on the lock
// screen and in the status bar (src/native/rest.ts sends it; tests/unit/rest.test.ts, when).
describe("the workout on the lock screen", () => {
  beforeEach(() => {
    mem.clear();
    keepRunsInMemory(false);
    runsFor("u");
  });
  const NOON = new Date(`${WED}T12:00:00`).getTime(), MIN = 60_000;
  const skipped = { done: false, kg: null, skipped: true } as unknown as LiftLog;

  it("names the session and how far it's got, and counts up from when it started, less its pauses", () => {
    const s = storeWith({ [WED]: day({ exercises: { "Hack Squat": lift([[8, 100]]), "Leg Press": skipped } }) });
    startRun(WED, NOON - 30 * MIN);
    pauseRun(WED, NOON - 20 * MIN);
    resumeRun(WED, NOON - 15 * MIN);
    expect(liveWorkout(s, WED, NOON)).toEqual({ title: "Legs", text: "2 of 5 exercises done", chip: "2/5 done", since: NOON - 25 * MIN, forMs: STALE_RUN_MS - 25 * MIN });
  });

  it("doesn't count a lift its last set's reps ticked off while that set is still being typed in", () => {
    const s = storeWith({ [WED]: day({ exercises: { "Hack Squat": lift([[8, 100], [8, 100], [8, 100]], { autoDone: true }) } }) });
    startRun(WED, NOON - MIN);
    s.typeIn({ day: WED, lift: "Hack Squat", set: 2 }); // the phone locked with the cursor in set 3's box
    expect(liveWorkout(s, WED, NOON)?.chip).toBe("0/5 done");
    s.typeOut();
    expect(liveWorkout(s, WED, NOON)?.chip).toBe("1/5 done");
    // Ticked off by hand, it's done whatever's being typed in it.
    s.logs[WED].exercises["Hack Squat"] = lift([[8, 100], [8, 100], [8, 100]]);
    s.typeIn({ day: WED, lift: "Hack Squat", set: 2 });
    expect(liveWorkout(s, WED, NOON)?.chip).toBe("1/5 done");
  });

  it("counts a superset as one exercise, done when all of it is, and names a free workout by its own name", () => {
    const s = storeWith({ [WED]: day({ exercises: { "Leg Extension": lift([[12, 40]]) } }) });
    s.plan.days[wdIndex(WED)].exercises[3].superset = true; // Hamstring Curl joins Leg Extension
    startRun(WED, NOON - MIN);
    expect(liveWorkout(s, WED, NOON)?.text).toBe("0 of 4 exercises done");
    s.logs[WED].exercises["Hamstring Curl"] = lift([[10, 30]]);
    expect(liveWorkout(s, WED, NOON)).toMatchObject({ text: "1 of 4 exercises done", chip: "1/4 done" });
    s.logs[WED] = day({ free: { name: "Hotel gym", lifts: ["Goblet Squat"] } });
    expect(liveWorkout(s, WED, NOON)).toMatchObject({ title: "Hotel gym", text: "0 of 1 exercise done" });
    s.logs[WED] = day({ free: { name: " ", lifts: [] } });
    expect(liveWorkout(s, WED, NOON)).toMatchObject({ title: "Free workout", text: "No exercises yet", chip: "" }); // Samsung's Now Bar: the app's name
  });

  it("shows nothing for a clock not started, paused, finished or left behind", () => {
    const s = storeWith();
    expect(liveWorkout(s, WED, NOON)).toBeNull();
    startRun(WED, NOON - STALE_RUN_MS);
    expect(liveWorkout(s, WED, NOON)).toBeNull(); // left running for three hours
    restartRun(WED, NOON - MIN);
    pauseRun(WED, NOON);
    expect(liveWorkout(s, WED, NOON)).toBeNull();
    resumeRun(WED, NOON);
    expect(liveWorkout(s, WED, NOON)).not.toBeNull();
    endRun(WED, NOON);
    expect(liveWorkout(s, WED, NOON)).toBeNull();
  });

  it("follows the clock whichever day it's for: one started before midnight stays, by the rules above", () => {
    const TUE = "2026-09-22", s = storeWith({ [TUE]: day({ exercises: { "Lat Pulldown": lift([[8, 50]]) } }) });
    const LATE = new Date(`${WED}T00:30:00`).getTime();
    expect(workoutUnderWay(s, LATE)).toBeNull();
    startRun(TUE, LATE - 50 * MIN); // Tuesday's Pull, started at 23:40
    expect(liveWorkout(s, WED, LATE)).toBeNull(); // the phone's day has moved on
    expect(workoutUnderWay(s, LATE)).toMatchObject({ title: "Pull", text: "1 of 6 exercises done", since: LATE - 50 * MIN });
    pauseRun(TUE, LATE);
    expect(workoutUnderWay(s, LATE)).toBeNull();
  });
});

describe("keeping the screen on", () => {
  /** A browser's Screen Wake Lock and page visibility: what's held now, and how many times it was asked for. */
  function screen() {
    const shown = new Set<() => void>(), held: { released: boolean; release: () => Promise<void> }[] = [];
    const doc = { hidden: false, addEventListener: (_: string, fn: () => void) => void shown.add(fn), removeEventListener: (_: string, fn: () => void) => void shown.delete(fn) };
    const request = vi.fn(async () => {
      const l = { released: false, release: async () => void (l.released = true) };
      held.push(l);
      return l;
    });
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", { wakeLock: { request } });
    const on = () => held.filter((l) => !l.released).length;
    return { doc, request, on, held, show: () => shown.forEach((fn) => fn()) };
  }
  beforeEach(() => mem.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("is on until switched off, and the switch is kept on the phone", () => {
    expect(awakePref()).toBe(true);
    setAwakePref(false);
    expect(awakePref()).toBe(false);
    expect(mem.get(AWAKE_KEY)).toBe("false");
    setAwakePref(true);
    expect(awakePref()).toBe(true);
  });

  it("holds the screen while the workout is open, takes it again when the page comes back, and lets go on leaving", async () => {
    const s = screen();
    const release = keepScreenOn();
    await vi.waitFor(() => expect(s.on()).toBe(1));
    // Hidden, the browser lets it go by itself; back on show, it's asked for again.
    s.held[0].released = true;
    s.doc.hidden = true;
    s.show();
    expect(s.request).toHaveBeenCalledTimes(1);
    s.doc.hidden = false;
    s.show();
    await vi.waitFor(() => expect(s.on()).toBe(1));
    expect(s.request).toHaveBeenCalledTimes(2);
    release();
    expect(s.on()).toBe(0);
    s.show(); // gone: coming back no longer takes it
    expect(s.request).toHaveBeenCalledTimes(2);
  });

  it("lets go of a hold that arrives after the workout closed", async () => {
    const s = screen();
    keepScreenOn()();
    await vi.waitFor(() => expect(s.held.length).toBe(1));
    expect(s.on()).toBe(0);
  });
});
