import { beforeEach, describe, expect, it } from "vitest";
import { clearRun, dropStaleRun, endRun, keepRunsInMemory, restartRun, runOf, runsFor, STALE_RUN_MS, startRun } from "@/lib/workout";

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
