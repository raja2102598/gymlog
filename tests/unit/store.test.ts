import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kneeModel, strengthModel, weightModel } from "@/lib/dashboard";
import { DEFAULT_PLAN, normalizePlan } from "@/lib/plan";
import { GymStore, setsOf } from "@/lib/store";
import type { DayLog, LiftLog } from "@/lib/types";

// Wednesday 23 September 2026, as in the end-to-end tests.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-23T12:00:00"));
});
afterEach(() => vi.useRealTimers());

const day = (d: Partial<DayLog> = {}): DayLog => ({ exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "", ...d });
const lift = (sets: [number, number][]): LiftLog => ({ done: true, kg: Math.max(...sets.map((s) => s[1])), sets: sets.map(([reps, kg]) => ({ reps, kg })) });
/** A store holding these days, for an account created on `created`. */
function storeWith(logs: Record<string, DayLog>, created = "2026-08-26T05:00:00Z") {
  const s = new GymStore();
  s.logs = logs;
  s.user = { id: "u", created_at: created } as GymStore["user"];
  return s;
}

describe("plan", () => {
  it("fills gaps, drops unnamed lifts and reads knee notes", () => {
    const p = normalizePlan({ stepGoal: "8000", kneeLimit: 11, days: [{ name: " Push ", exercises: [{ name: "Press", flag: "KNEE NOTE: go easy" }, { name: "" }] }] }, DEFAULT_PLAN);
    expect(p.stepGoal).toBe(8000);
    expect(p.kneeLimit).toBe(DEFAULT_PLAN.kneeLimit);
    expect(p.days[0].name).toBe("Push");
    expect(p.days[0].exercises.map((x) => [x.name, x.knee])).toEqual([["Press", true]]);
    expect(p.days[1]).toEqual(DEFAULT_PLAN.days[1]);
    expect(p.days.map((d) => d.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  it("marks the default plan's knee lifts", () => {
    expect(DEFAULT_PLAN.days[2].exercises.filter((x) => x.knee).map((x) => x.name)).toEqual(["Hack Squat", "Leg Press", "Leg Extension"]);
  });
});

describe("store", () => {
  it("shows an older single weight as set 1", () => {
    expect(setsOf({ done: true, kg: 50 })).toEqual([{ reps: null, kg: 50 }]);
    expect(setsOf(undefined)).toEqual([]);
  });

  it("offers the week's missed sessions on a rest day, once each", () => {
    const s = storeWith({ "2026-09-23": day({ exercises: { "Leg Press": lift([[10, 50]]) } }) }, "2026-09-23T06:00:00Z");
    expect(s.missedThisWeek("2026-09-24")).toEqual([0, 1]); // Push (Mon) and Pull (Tue)
    s.logs["2026-09-24"] = day({ session: 0 }); // Push taken over for Thursday
    expect(s.missedThisWeek("2026-09-27")).toEqual([1]);
  });

  it("colours days like the calendar: done, part, missed, nothing before the account", () => {
    const s = storeWith({
      "2026-09-21": day({ exercises: { "Chest Press Machine": lift([[12, 40]]) } }),
      "2026-09-23": day({ exercises: Object.fromEntries(DEFAULT_PLAN.days[2].exercises.map((x) => [x.name, lift([[10, 20]])])) }),
    });
    expect(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-08-25"].map((k) => s.dayState(k))).toEqual(["part", "miss", "done", "", ""]);
  });

  it("suggests more weight when every set hit the top, but holds knee lifts after a sore day", () => {
    const s = storeWith({
      "2026-09-16": day({ exercises: { "Leg Press": lift([[12, 50], [12, 50], [12, 50]]), "Hamstring Curl": lift([[12, 30], [12, 30], [12, 30]]) }, kneeAfter: 6 }),
    });
    const legs = DEFAULT_PLAN.days[2].exercises, x = (n: string) => legs.find((l) => l.name === n)!;
    expect(s.nextWeight(x("Hamstring Curl"), "Hamstring Curl", "2026-09-23")).toMatchObject({ from: 30, to: 32.5, held: false });
    expect(s.nextWeight(x("Leg Press"), "Leg Press", "2026-09-23")).toMatchObject({ from: 50, held: true });
    expect(s.placeholders(x("Hamstring Curl"), s.lastDone("Hamstring Curl", "2026-09-23"), 0, s.nextWeight(x("Hamstring Curl"), "Hamstring Curl", "2026-09-23"))).toEqual(["10", "32.5"]);
  });

  it("marks a set as a record while it's typed, against earlier days only", () => {
    const s = storeWith({ "2026-09-16": day({ exercises: { "Leg Press": lift([[10, 45]]) } }) });
    s.logs["2026-09-23"] = day({ exercises: { "Leg Press": lift([[10, 50], [10, 45]]) } });
    expect([...s.recordsOn("2026-09-23")]).toEqual([["Leg Press|0", ["weight", "e1rm"]]]);
  });
});

describe("dashboard", () => {
  // Daily weigh-ins from 26 Aug to today, changing by `perDay` kg.
  const series = (perDay: number, upTo = 28) => {
    const logs: Record<string, DayLog> = {};
    for (let n = 0; n <= upTo; n++) logs[new Date(Date.UTC(2026, 7, 26 + n)).toISOString().slice(0, 10)] = day({ weight: Math.round((84 + perDay * n) * 10) / 10 });
    return logs;
  };
  const pace = (perDay: number, target: number | null) => {
    const s = storeWith(series(perDay));
    s.plan = { ...s.plan, weeklyRatePct: target };
    return weightModel(s, "2026-09-23").flags.map((f) => f.text);
  };

  it("flags the pace against the weekly target", () => {
    expect(pace(-0.1, 0.7)).toEqual([]);
    expect(pace(-0.1, 2)[0]).toMatch(/^Losing 0\.\d\d% a week, well under your 2% target\.$/);
    expect(pace(-0.1, 0.4)[0]).toMatch(/^Losing 0\.\d\d% a week, faster than your 0\.4% target\.$/);
    expect(pace(0.05, 0.7)[0]).toMatch(/^The trend isn’t going down yet \(\+0\.\d\d% a week\) against your 0\.7% target\.$/);
    expect(pace(-0.1, null)).toEqual([]);
  });

  it("flags a gap in weigh-ins, and works out a goal date", () => {
    const s = storeWith(series(-0.1, 22));
    s.plan = { ...s.plan, goalWeight: 78 };
    const m = weightModel(s, "2026-09-23");
    expect(m.flags.map((f) => f.text)).toContain("No weigh-in for 6 days. A few weigh-ins a week keep the trend honest.");
    expect(m.goal).toMatchObject({ kind: "date", goal: 78 });
  });

  it("lists lifts ready for more weight and knee lifts on hold", () => {
    const s = storeWith({
      "2026-09-16": day({ exercises: { "Leg Press": lift([[12, 50], [12, 50], [12, 50]]), "Hamstring Curl": lift([[12, 30], [12, 30], [12, 30]]) }, kneeBefore: 2, kneeAfter: 6 }),
    });
    const m = strengthModel(s, "2026-09-23");
    expect(m.ready.map((x) => [x.name, x.from, x.to])).toEqual([["Hamstring Curl", 30, 32.5]]);
    expect(m.held.map((x) => x.name)).toEqual(["Leg Press"]);
    expect(m.flags.map((f) => f.text)).toEqual(["1 lift is ready for more weight. See Strength."]);
    const k = kneeModel(s, "2026-09-23");
    expect(k.kind).toBe("table");
    expect(k.flags[0].text).toBe("Knee was above your limit after Legs on 16 Sept. Knee lifts hold their weight until a better session.");
  });
});
