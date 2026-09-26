import { beforeEach, describe, expect, it } from "vitest";
import { wdIndex } from "@/lib/dates";
import { liveWorkout } from "@/lib/session";
import type { LiftLog } from "@/lib/types";
import { clearRun, dropStaleRun, endRun, keepRunsInMemory, pauseRun, restartRun, resumeRun, runOf, runSeconds, runsFor, STALE_RUN_MS, startRun } from "@/lib/workout";
import { day, lift, storeWith, WED } from "./helpers";

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

// What the phone shows of a workout under way while Gym Log is out of sight: an Android 16 Live Update, in Samsung's
// Now Bar, on the lock screen and in the status bar (src/native/rest.ts sends it; tests/unit/rest.test.ts, when).
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
    expect(liveWorkout(s, WED, NOON)).toEqual({ title: "Legs", text: "2 of 5 exercises done", since: NOON - 25 * MIN, forMs: STALE_RUN_MS - 25 * MIN });
  });

  it("counts a superset as one exercise, done when all of it is, and names a free workout by its own name", () => {
    const s = storeWith({ [WED]: day({ exercises: { "Leg Extension": lift([[12, 40]]) } }) });
    s.plan.days[wdIndex(WED)].exercises[3].superset = true; // Hamstring Curl joins Leg Extension
    startRun(WED, NOON - MIN);
    expect(liveWorkout(s, WED, NOON)?.text).toBe("0 of 4 exercises done");
    s.logs[WED].exercises["Hamstring Curl"] = lift([[10, 30]]);
    expect(liveWorkout(s, WED, NOON)?.text).toBe("1 of 4 exercises done");
    s.logs[WED] = day({ free: { name: "Hotel gym", lifts: ["Goblet Squat"] } });
    expect(liveWorkout(s, WED, NOON)).toMatchObject({ title: "Hotel gym", text: "0 of 1 exercise done" });
    s.logs[WED] = day({ free: { name: " ", lifts: [] } });
    expect(liveWorkout(s, WED, NOON)).toMatchObject({ title: "Free workout", text: "No exercises yet" });
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
});
