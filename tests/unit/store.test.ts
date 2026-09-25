import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kneeModel, liftModel, strengthModel, weightModel } from "@/lib/dashboard";
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

  it("reads chest, arms, thighs and hips as typed only; body fat also takes Health Connect's, like weight", () => {
    const s = storeWith({ "2026-09-16": day({ chest: 100 }), "2026-09-23": day({ chest: 99, bodyFat: 21 }) });
    s.health = { "2026-09-16": { bodyFat: 23 }, "2026-09-20": { bodyFat: 22 } };
    expect(s.measureOf("2026-09-16", "chest")).toBe(100);
    expect(s.measureOf("2026-09-20", "chest")).toBeNull(); // no such thing as an untyped chest measurement
    expect(s.measureOf("2026-09-16", "bodyFat")).toBe(23); // nothing typed that day: Health Connect's
    expect(s.measureOf("2026-09-23", "bodyFat")).toBe(21); // typed wins over Health Connect
    expect(s.measureReadings("chest")).toEqual([["2026-09-16", 100], ["2026-09-23", 99]]);
    expect(s.measureReadings("bodyFat")).toEqual([["2026-09-16", 23], ["2026-09-20", 22], ["2026-09-23", 21]]);
    expect(s.anyMeasured()).toBe(true);
    expect(storeWith({ "2026-09-16": day() }).anyMeasured()).toBe(false);
  });
});

describe("the phone's copy", () => {
  /** The phone's storage, which throws on every save while `full` is set, as a browser does when it's full or blocked. */
  function phoneStorage() {
    const kept = new Map<string, string>(), phone = { kept, full: false };
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (phone.full) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        kept.set(k, v);
      },
      removeItem: (k: string) => void kept.delete(k),
    });
    return phone;
  }
  afterEach(() => vi.unstubAllGlobals());

  it("says when the phone won't keep an edit, until each copy saves again", async () => {
    const phone = phoneStorage(), s = storeWith({});
    s.editDay("2026-09-23", (n) => void (n.steps = 9100), false);
    expect(s.localSaveFailed).toBe(false);
    phone.full = true;
    s.editDay("2026-09-23", (n) => void (n.steps = 9200), false);
    expect(s.localSaveFailed).toBe(true);
    expect(JSON.parse(phone.kept.get("gymlog.pending.v1")!).pending["2026-09-23"].steps).toBe(9100);
    phone.full = false;
    // The plan saves, but the day's copy on the phone is still the old one.
    s.editPlan((p) => void (p.stepGoal = 12000));
    expect(s.localSaveFailed).toBe(true);
    s.editDay("2026-09-23", (n) => void (n.steps = 9300), false);
    expect(s.localSaveFailed).toBe(false);
    // Health Connect's copy counts too.
    s.sb = { from: () => ({ upsert: async () => ({ error: null }) }) } as unknown as GymStore["sb"];
    phone.full = true;
    await s.saveHealth({ "2026-09-23": { steps: 8421 } });
    expect(s.localSaveFailed).toBe(true);
    phone.full = false;
    await s.saveHealth({ "2026-09-23": { steps: 8500 } });
    expect(s.localSaveFailed).toBe(false);
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

  it("gives the latest waist reading and its change from four weeks back", () => {
    const s = storeWith(series(-0.05, 28));
    s.logs["2026-08-26"].waist = 96;
    s.logs["2026-09-23"].waist = 93.5;
    expect(weightModel(s, "2026-09-23").waist).toEqual({ day: "2026-09-23", cm: 93.5, change: { since: "2026-08-26", cm: -2.5 } });
    // No waist logged yet: no card.
    expect(weightModel(storeWith(series(-0.05, 1)), "2026-08-27").waist).toBeNull();
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

  it("lists every lift in the plan, not only each day's first, and a lift on two days once, naming both", () => {
    const m = strengthModel(storeWith({}), "2026-09-23");
    const names = new Set(DEFAULT_PLAN.days.flatMap((d) => d.exercises.map((x) => x.name)));
    expect(m.rows).toHaveLength(names.size);
    expect(m.rows.map((r) => r.name)).toEqual([...names]); // in the plan's order
    expect(m.rows.find((r) => r.name === "Chest Press Machine")?.day).toBe("Push"); // not that day's first lift
    expect(m.rows.filter((r) => r.name === "Seated Row").map((r) => r.day)).toEqual(["Pull, Upper"]);
  });
});

describe("a lift's own page", () => {
  it("tracks heaviest set, estimated 1RM and volume per session, and how often, from sets that count", () => {
    const s = storeWith({
      "2026-09-09": day({ exercises: { "Leg Press": lift([[10, 45], [10, 45], [8, 45]]) } }),
      "2026-09-16": day({ exercises: { "Leg Press": lift([[10, 50], [10, 50], [10, 50]]) } }),
      // A set with only a weight, and one with only reps: neither should add a load or a 1RM, but the
      // weight-only set still counts as the day's heaviest.
      "2026-09-23": day({ exercises: { "Leg Press": { done: true, kg: 55, sets: [{ reps: null, kg: 55 }, { reps: 12, kg: null }, { reps: 8, kg: 55 }] } } }),
    });
    const m = liftModel(s, "2026-09-23", "Leg Press");
    expect(m.points.map((p) => [p.day, p.top, p.topReps, p.volume])).toEqual([
      ["2026-09-09", 45, 10, 1260],
      ["2026-09-16", 50, 10, 1500],
      ["2026-09-23", 55, 8, 440], // only the 8 x 55 set has both a weight and reps
    ]);
    expect(m.points[0].e1rm).toBeCloseTo(60, 9); // Brzycki, 45 kg x 10
    expect(m.points[2].e1rm).toBeCloseTo(68.27586, 4); // the 12-rep, weightless set can't estimate one
    expect(m.bestTop).toEqual(["2026-09-23", 55]);
    expect(m.bestE1rm?.[0]).toBe("2026-09-23");
    expect(m.volume).toBe(1260 + 1500 + 440);
    expect(m.perWeek).toBeCloseTo(1.5, 9); // 3 sessions over the 14 days from the first to today
    expect(m.planned).toEqual([{ day: "Legs", reps: [10, 12] }]);
  });

  it("matches a lift by its logged name on any day, not only the plan's usual day for it", () => {
    // Monday is Push, which has no Leg Press: a day moved, or logged under an older plan, still has to count.
    const s = storeWith({ "2026-09-21": day({ exercises: { "Leg Press": lift([[10, 40]]) } }) });
    expect(s.planFor("2026-09-21").name).toBe("Push");
    expect(liftModel(s, "2026-09-23", "Leg Press").points.map((p) => p.day)).toEqual(["2026-09-21"]);
  });

  it("keeps a renamed lift's earlier days under its old name; only the new name carries the plan's rep range", () => {
    const s = storeWith({ "2026-09-09": day({ exercises: { "Leg Press": lift([[10, 45]]) } }) });
    s.plan = { ...s.plan, days: s.plan.days.map((d, i) => (i === 2 ? { ...d, exercises: d.exercises.map((x) => (x.name === "Leg Press" ? { ...x, name: "Leg Press Machine" } : x)) } : d)) };
    const old = liftModel(s, "2026-09-23", "Leg Press"), renamed = liftModel(s, "2026-09-23", "Leg Press Machine");
    expect(old.points).toHaveLength(1);
    expect(old.planned).toEqual([]);
    expect(renamed.points).toHaveLength(0);
    expect(renamed.planned).toEqual([{ day: "Legs", reps: [10, 12] }]);
  });

  it("keeps two days with the same session name apart only when the lift's rep ranges differ there", () => {
    const s = storeWith({});
    const withPush = (reps: string) => ({
      ...s.plan,
      days: s.plan.days.map((d, i) => (i === 3 ? { ...d, name: "Push", exercises: [{ ...s.plan.days[0].exercises[0], reps }] } : d)),
    });
    s.plan = withPush("8-10"); // Thursday is a second Push, the same as Monday's
    expect(liftModel(s, "2026-09-23", "Incline Machine Press").planned).toEqual([{ day: "Push", reps: [8, 10] }]);
    expect(strengthModel(s, "2026-09-23").rows.find((r) => r.name === "Incline Machine Press")?.day).toBe("Push");
    s.plan = withPush("12-15"); // a lighter Push on Thursday
    expect(liftModel(s, "2026-09-23", "Incline Machine Press").planned).toEqual([
      { day: "Push", reps: [8, 10] },
      { day: "Push", reps: [12, 15] },
    ]);
    expect(strengthModel(s, "2026-09-23").rows.find((r) => r.name === "Incline Machine Press")?.day).toBe("Push");
  });

  it("names every day the plan has a lift on, each with its rep range there", () => {
    const s = storeWith({});
    expect(liftModel(s, "2026-09-23", "Seated Row").planned).toEqual([
      { day: "Pull", reps: [10, 12] },
      { day: "Upper", reps: [10, 12] },
    ]);
  });

  it("has nothing to show for a lift that's never been logged and isn't in the plan", () => {
    const m = liftModel(storeWith({}), "2026-09-23", "Nonexistent Lift");
    expect(m).toMatchObject({ points: [], bestTop: null, bestE1rm: null, volume: 0, perWeek: null, planned: [] });
  });
});
