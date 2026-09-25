import { describe, expect, it } from "vitest";
import * as G from "@/lib/stats";
import type { LiftDay, LiftRecord, RecordKind } from "@/lib/stats";
import type { SetLog } from "@/lib/types";

const near = (a: number | null, b: number, eps: number) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThanOrEqual(eps);
};
const days = (start: string, count: number, f: (i: number) => number): [string, number][] =>
  Array.from({ length: count }, (_, i) => [G.keyOfNum(G.dayNum(start) + i), f(i)]);

describe("weight trend", () => {
  it("is flat for a constant weight", () => {
    const s = G.weightTrend(days("2026-09-01", 20, () => 80));
    expect(s).toHaveLength(20);
    s.forEach((p) => near(p.trend, 80, 1e-9));
    near(G.weeklyRate(s), 0, 1e-9);
  });

  it("fills gaps with straight lines and marks them", () => {
    const s = G.weightTrend([
      ["2026-09-05", 78],
      ["2026-09-01", 80],
    ]);
    expect(s.map((p) => p.day)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
    expect(s.map((p) => p.weight)).toEqual([80, 79.5, 79, 78.5, 78]);
    expect(s.map((p) => p.measured)).toEqual([true, false, false, false, true]);
  });

  it("follows a steady loss without start-up lag or overshoot", () => {
    // A flat start read -0.44 kg/wk on day 14 and -0.87 on day 28 for a steady -0.7.
    for (const n of [14, 21, 28, 35, 42, 90]) {
      const s = G.weightTrend(days("2026-07-01", n, (i) => 90 - 0.1 * i)), last = s[s.length - 1];
      near(last.trend, last.weight, 0.05);
      near(G.weeklyRate(s), -0.7, 0.01);
      near(G.trendChange(s, 7), -0.7, 0.05);
    }
  });

  it("needs six weigh-ins over two weeks for a rate, and uses the last four weeks", () => {
    expect(G.weeklyRate(G.weightTrend(days("2026-09-01", 13, () => 80)))).toBeNull();
    near(G.weeklyRate(G.weightTrend(days("2026-09-01", 14, (i) => 80 - 0.1 * i))), -0.7, 1e-9);
    const on = (offsets: number[]) => offsets.map((i): [string, number] => [G.keyOfNum(G.dayNum("2026-09-01") + i), 80 - 0.1 * i]);
    expect(G.weeklyRate(G.weightTrend(on([0, 5, 10, 15, 20])))).toBeNull();
    // Uneven days fit by date, not by position.
    near(G.weeklyRate(G.weightTrend(on([0, 3, 4, 10, 12, 13]))), -0.7, 1e-9);
    // Steep loss for a month, then flat for four weeks: only the flat four weeks count.
    near(G.weeklyRate(G.weightTrend(days("2026-07-01", 58, (i) => (i < 30 ? 90 - 0.2 * i : 84)))), 0, 1e-9);
    const sparse = G.weightTrend([
      ["2026-09-01", 80],
      ["2026-09-15", 79],
    ]);
    expect(G.trendChange(sparse, 7)).toBeNull();
    expect(G.weeklyRate([])).toBeNull();
    expect(G.weightTrend([])).toEqual([]);
    expect(G.weightTrend([["2026-09-01", 81]]).map((p) => p.trend)).toEqual([81]);
  });

  it("gives a goal date only when heading toward the goal and under three years away", () => {
    const s = G.weightTrend(days("2026-07-01", 90, (i) => 90 - 0.1 * i)), last = s[s.length - 1];
    const d = G.goalDate(s, -0.7, last.trend - 7);
    near(G.daysBetween(last.day, d!), 70, 1);
    expect(G.goalDate(s, -0.7, last.trend + 2)).toBeNull();
    expect(G.goalDate(s, -0.001, last.trend - 20)).toBeNull();
    expect(G.goalDate(s, null, 70)).toBeNull();
  });
});

describe("a measurement's four-week change", () => {
  it("is null with nothing logged, and has no change with only one reading", () => {
    expect(G.measureChange([])).toBeNull();
    expect(G.measureChange([["2026-09-01", 95]])).toEqual({ day: "2026-09-01", value: 95, change: null });
  });

  it("compares the latest reading with the closest one at least four weeks before it", () => {
    // 26 Aug, 9 Sep (14 days back: too soon) and 23 Sept (28 days after 26 Aug): the change is against 26 Aug.
    const r = G.measureChange([
      ["2026-08-26", 96],
      ["2026-09-09", 94.8],
      ["2026-09-23", 93.5],
    ]);
    expect(r).toEqual({ day: "2026-09-23", value: 93.5, change: { since: "2026-08-26", value: -2.5 } });
  });

  it("picks the nearest reading that still clears the window, not the oldest one", () => {
    // 29 days and 40 days back both clear 28; 29 is nearer.
    const r = G.measureChange([
      ["2026-08-15", 100],
      ["2026-08-26", 99],
      ["2026-09-23", 105],
    ]);
    expect(r!.change).toEqual({ since: "2026-08-26", value: 6 });
  });

  it("has no change yet when nothing reaches four weeks back, however the readings are ordered", () => {
    const r = G.measureChange([
      ["2026-09-23", 60],
      ["2026-09-10", 58],
    ]);
    expect(r).toEqual({ day: "2026-09-23", value: 60, change: null });
  });

  it("takes a shorter window when asked, for something logged more often", () => {
    const r = G.measureChange(
      [
        ["2026-09-16", 22],
        ["2026-09-23", 20.5],
      ],
      7,
    );
    expect(r!.change).toEqual({ since: "2026-09-16", value: -1.5 });
  });
});

describe("lifts", () => {
  it("estimates 1RM (Brzycki) only for 1-12 reps", () => {
    near(G.e1rm(100, 1), 100, 1e-9);
    near(G.e1rm(100, 10), 133.333, 1e-3);
    expect(G.e1rm(100, 13)).toBeNull();
    expect(G.e1rm(0, 10)).toBeNull();
    expect(G.e1rm(50, null)).toBeNull();
  });

  it("reads rep ranges", () => {
    expect(G.repRange("8-10")).toEqual([8, 10]);
    expect(G.repRange("12–15")).toEqual([12, 15]);
    expect(G.repRange("10")).toEqual([10, 10]);
    expect(G.repRange("")).toBeNull();
    expect(G.repRange("10-8")).toBeNull();
  });

  it("adds weight when every set reached the top of the range (double progression)", () => {
    const s = (reps: number | null, kg: number): SetLog => ({ reps, kg });
    expect(G.readyToAdd([s(10, 50), s(10, 50), s(10, 50)], "8-10", 3, 2.5)).toEqual({ from: 50, to: 52.5, top: 10 });
    expect(G.readyToAdd([s(10, 50), s(9, 50), s(10, 50)], "8-10", 3, 2.5)).toBeNull(); // one set short
    expect(G.readyToAdd([s(10, 50), s(10, 45), s(10, 50)], "8-10", 3, 2.5)).toBeNull(); // mixed weights
    expect(G.readyToAdd([s(10, 50), s(10, 50)], "8-10", 3, 2.5)).toBeNull(); // fewer sets than planned
    expect(G.readyToAdd([s(10, 0), s(10, 0), s(10, 0)], "8-10", 3, 2.5)?.to).toBe(2.5); // empty sled
    expect(G.readyToAdd([s(null, 50)], "8-10", 1, 2.5)).toBeNull(); // weight only (older entries)
  });
});

// The records algorithm before the per-weight fold, kept as the reference: it compared each set with
// every earlier set of the same exercise.
function referenceRecords(days: LiftDay[]): LiftRecord[] {
  const best = new Map<string, { kg: number; e1rm: number | null; sets: { kg: number; reps: number | null }[] }>(), out: LiftRecord[] = [];
  for (const { day, lifts } of days) {
    for (const { name, sets } of lifts) {
      const b = best.get(name);
      if (!b) continue;
      const top: Partial<Record<RecordKind, { v: number; i: number }>> = {};
      sets.forEach((s, i) => {
        if (!s || s.kg == null) return;
        const e = s.reps != null ? G.e1rm(s.kg, s.reps) : null;
        const heavier = b.sets.filter((p) => p.kg >= s.kg! && p.reps != null);
        const cands: [RecordKind, number][] = [];
        if (s.kg > b.kg) cands.push(["weight", s.kg]);
        if (e != null && b.e1rm != null && e > b.e1rm + 1e-9) cands.push(["e1rm", e]);
        if (s.reps != null && heavier.length && s.reps > Math.max(...heavier.map((p) => p.reps as number))) cands.push(["reps", s.reps * 1000 + s.kg]);
        for (const [kind, v] of cands) if (!top[kind] || v > top[kind]!.v) top[kind] = { v, i };
      });
      const bySet = new Map<number, RecordKind[]>();
      for (const [kind, { i }] of Object.entries(top) as [RecordKind, { i: number }][]) bySet.set(i, [...(bySet.get(i) || []), kind]);
      for (const [i, kinds] of bySet) out.push({ day, name, set: i, kg: sets[i].kg as number, reps: sets[i].reps, e1rm: G.e1rm(sets[i].kg, sets[i].reps), kinds });
    }
    for (const { name, sets } of lifts) {
      const good = sets.filter((s) => s && s.kg != null);
      if (!good.length) continue;
      const b = best.get(name) || { kg: -Infinity, e1rm: null, sets: [] };
      for (const s of good) {
        b.kg = Math.max(b.kg, s.kg!);
        const e = s.reps != null ? G.e1rm(s.kg, s.reps) : null;
        if (e != null) b.e1rm = Math.max(b.e1rm ?? 0, e);
        b.sets.push({ kg: s.kg!, reps: s.reps });
      }
      best.set(name, b);
    }
  }
  return out;
}

describe("records", () => {
  it("match the reference algorithm, and day-by-day checkDay/foldDay match records()", () => {
    for (const seed0 of [3, 11, 29, 47]) {
      let seed = seed0;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const sample: LiftDay[] = Array.from({ length: 150 }, (_, i) => ({
        day: G.keyOfNum(G.dayNum("2026-01-01") + i),
        lifts: ["Leg Press", "Row", "Curl"]
          .filter(() => rnd() < 0.8)
          .map((name) => ({
            name,
            sets: Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => ({
              reps: rnd() < 0.1 ? null : Math.floor(rnd() * 16),
              kg: rnd() < 0.05 ? null : Math.floor(rnd() * 14) * 2.5,
            })),
          })),
      }));
      const ref = referenceRecords(sample), all = G.records(sample);
      expect(ref.length).toBeGreaterThan(10);
      expect(all).toEqual(ref);
      const best: G.RecordFold = new Map(), stepped: LiftRecord[] = [];
      for (const d of sample) {
        stepped.push(...G.checkDay(best, d));
        G.foldDay(best, d);
      }
      expect(stepped).toEqual(all);
      const snap = () => JSON.stringify([...best].map(([k, b]) => [k, b.kg, b.e1rm, [...b.repsAt]]));
      const before = snap();
      G.checkDay(best, sample[40]);
      G.checkDay(best, { day: "2026-12-31", lifts: [{ name: "Row", sets: [{ reps: 12, kg: 500 }] }] });
      expect(snap()).toBe(before); // checkDay leaves the fold alone
    }
  });

  it("count weight, e1RM and reps; an exercise's first day and same-day sets don't", () => {
    const r = G.records([
      { day: "2026-09-16", lifts: [{ name: "Leg Press", sets: [{ reps: 10, kg: 45 }, { reps: 10, kg: 45 }, { reps: 8, kg: 45 }] }] },
      { day: "2026-09-23", lifts: [{ name: "Leg Press", sets: [{ reps: 10, kg: 50 }, { reps: 12, kg: 45 }, { reps: 11, kg: 45 }] }] },
    ]);
    expect(r.map((x) => [x.day, x.set, [...x.kinds].sort().join("+")])).toEqual([
      ["2026-09-23", 0, "e1rm+weight"],
      ["2026-09-23", 1, "reps"],
    ]);
  });

  it("work with older weight-only entries", () => {
    const r = G.records([
      { day: "2026-09-09", lifts: [{ name: "Hack Squat", sets: [{ reps: null, kg: 0 }] }] },
      { day: "2026-09-16", lifts: [{ name: "Hack Squat", sets: [{ reps: 10, kg: 0 }] }] },
      { day: "2026-09-23", lifts: [{ name: "Hack Squat", sets: [{ reps: 10, kg: 10 }] }] },
    ]);
    expect(r.map((x) => [x.day, x.kinds.join("+")])).toEqual([["2026-09-23", "weight"]]);
  });
});
