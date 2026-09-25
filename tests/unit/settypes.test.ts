import { describe, expect, it } from "vitest";
import { effortValue } from "@/components/today/SetMenu";
import { setsSummary } from "@/lib/format";
import { DEFAULT_PLAN, normalizePlan } from "@/lib/plan";
import * as G from "@/lib/stats";
import { setsComplete } from "@/lib/store";
import type { SetLog } from "@/lib/types";

// Set types (RAJ-53): warm-ups count toward nothing, drop sets are volume only, sets to failure count as working
// sets do; and the optional RPE or reps in reserve.

const set = (reps: number, kg: number, type?: SetLog["type"]): SetLog => ({ reps, kg, ...(type ? { type } : {}) });

describe("set types", () => {
  it("don't let a drop set hold back the go-up rule, or a warm-up count toward it", () => {
    const sets = [set(8, 20, "warmup"), set(12, 50), set(12, 50), set(12, 50, "failure"), set(15, 30, "drop")];
    expect(G.readyToAdd(sets, "10-12", 3, 2.5)).toEqual({ from: 50, to: 52.5, top: 12 });
    // Without the drop set's exclusion, 15 reps at 30 kg would have broken "every set at one weight".
    expect(G.readyToAdd([set(12, 50), set(12, 50), set(15, 30, "drop")], "10-12", 3, 2.5)).toBeNull(); // only 2 count
  });

  it("count sets to failure toward the planned sets, and not drop sets or warm-ups", () => {
    expect(setsComplete([set(10, 50), set(9, 50, "failure"), set(12, 30, "drop")], 3)).toBe(false);
    expect(setsComplete([set(10, 50), set(9, 50, "failure"), set(8, 50)], 3)).toBe(true);
    expect(setsComplete([set(10, 20, "warmup"), set(10, 50), set(9, 50)], 3)).toBe(false);
  });

  it("never make a record of a drop set or a warm-up, but do of a set to failure", () => {
    const best: G.RecordFold = new Map();
    G.foldDay(best, { day: "2026-09-16", lifts: [{ name: "Leg Press", sets: [set(10, 50), set(10, 50)] }] });
    const found = G.checkDay(best, {
      day: "2026-09-23",
      lifts: [{ name: "Leg Press", sets: [set(10, 80, "warmup"), set(30, 20, "drop"), set(11, 50, "failure")] }],
    });
    expect(found.map((r) => [r.set, r.kinds])).toEqual([[2, ["e1rm", "reps"]]]);
    G.foldDay(best, { day: "2026-09-23", lifts: [{ name: "Leg Press", sets: [set(10, 80, "warmup"), set(30, 20, "drop")] }] });
    expect(best.get("Leg Press")!.kg).toBe(50);
  });

  it("mark sets to failure and drop sets in history, leaving plain working sets as they read before", () => {
    expect(setsSummary([set(10, 45), set(10, 45), set(8, 45)])).toBe("10, 10, 8 × 45 kg");
    expect(setsSummary([set(10, 45), set(8, 45, "failure")])).toBe("10, 8F × 45 kg");
    expect(setsSummary([set(10, 45), set(12, 30, "drop")])).toBe("10 × 45, 12D × 30 kg");
  });
});

describe("effort", () => {
  it("is off unless the plan says RPE or reps in reserve", () => {
    expect(normalizePlan({}, DEFAULT_PLAN).effort).toBe("off");
    expect(normalizePlan({ effort: "rpe" }, DEFAULT_PLAN).effort).toBe("rpe");
    expect(normalizePlan({ effort: "rir" }, DEFAULT_PLAN).effort).toBe("rir");
    expect(normalizePlan({ effort: "loud" }, DEFAULT_PLAN).effort).toBe("off");
  });

  it("takes RPE 1 to 10 in half steps and reps in reserve 0 to 10, clears on empty, and refuses the rest", () => {
    expect([effortValue("rpe", "8"), effortValue("rpe", "7.5"), effortValue("rpe", "8.3"), effortValue("rpe", "")]).toEqual([8, 7.5, 8.5, null]);
    expect([effortValue("rpe", "0"), effortValue("rpe", "11"), effortValue("rpe", "hard")]).toEqual([undefined, undefined, undefined]);
    expect([effortValue("rir", "0"), effortValue("rir", "2"), effortValue("rir", "2.4"), effortValue("rir", "12")]).toEqual([0, 2, 2, undefined]);
  });
});
