import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAN, normalizePlan, orderBlocks, planBlocks } from "@/lib/plan";
import { GymStore } from "@/lib/store";
import type { DayLog, LiftLog } from "@/lib/types";

// Supersets and a day's own order (RAJ-54). Wednesday 23 September 2026, as in the end-to-end tests: Legs, whose
// lifts are Hack Squat, Leg Press, Leg Extension, Hamstring Curl and Calf Raise.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-23T12:00:00"));
});
afterEach(() => vi.useRealTimers());

const WED = "2026-09-23";
const LEGS = ["Hack Squat", "Leg Press", "Leg Extension", "Hamstring Curl", "Calf Raise"];
const day = (d: Partial<DayLog> = {}): DayLog => ({ exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "", ...d });
const lift = (sets: [number, number][]): LiftLog => ({ done: true, kg: Math.max(...sets.map((s) => s[1])), sets: sets.map(([reps, kg]) => ({ reps, kg })) });
function storeWith(logs: Record<string, DayLog>) {
  const s = new GymStore();
  s.logs = logs;
  s.user = { id: "u", created_at: "2026-08-26T05:00:00Z" } as GymStore["user"];
  return s;
}
const names = (bs: { name: string }[][]) => bs.map((b) => b.map((x) => x.name).join("+"));

describe("supersets in the plan", () => {
  it("make one block of lifts joined to the one before, and a block of each other lift", () => {
    const xs = [{ name: "A" }, { name: "B", superset: true }, { name: "C", superset: true }, { name: "D" }, { name: "E" }, { name: "F", superset: true }];
    expect(names(planBlocks(xs))).toEqual(["A+B+C", "D", "E+F"]);
    expect(names(planBlocks([{ name: "A", superset: true }, { name: "B" }]))).toEqual(["A", "B"]); // nothing before the first
  });

  it("are kept by the plan's reading, left out when off, and never on a day's first lift", () => {
    const p = normalizePlan(
      { days: [{ name: "Push", exercises: [{ name: "", superset: true }, { name: "Bench", superset: true }, { name: "Row", superset: true }, { name: "Fly", superset: false }, { name: "Dip", superset: "yes" }] }] },
      DEFAULT_PLAN,
    );
    expect(p.days[0].exercises.map((x) => [x.name, x.superset])).toEqual([
      ["Bench", undefined],
      ["Row", true],
      ["Fly", undefined],
      ["Dip", undefined],
    ]);
    expect(p.days[0].exercises.filter((x) => "superset" in x).map((x) => x.name)).toEqual(["Row"]);
    expect(normalizePlan(p, DEFAULT_PLAN)).toEqual(p);
    // A plan without any, like the default, reads back exactly as it was.
    expect(DEFAULT_PLAN.days.some((d) => d.exercises.some((x) => "superset" in x))).toBe(false);
  });
});

describe("a day's order", () => {
  it("puts each block where the order first names one of its lifts, and the rest after, as they came", () => {
    const bs = [[{ name: "A" }], [{ name: "B" }, { name: "C" }], [{ name: "D" }]];
    expect(names(orderBlocks(bs, ["D", "C", "A"]))).toEqual(["D", "B+C", "A"]);
    expect(names(orderBlocks(bs, ["D"]))).toEqual(["D", "A", "B+C"]);
    expect(names(orderBlocks(bs, []))).toEqual(["A", "B+C", "D"]);
  });

  it("shows a superset of the plan whole, and moves it as one, saved with that day only", () => {
    const s = storeWith({});
    s.plan.days[2].exercises[3].superset = true; // Hamstring Curl with Leg Extension
    expect(names(s.liftBlocks(WED))).toEqual(["Hack Squat", "Leg Press", "Leg Extension+Hamstring Curl", "Calf Raise"]);
    s.moveBlock(WED, 2, -1);
    expect(names(s.liftBlocks(WED))).toEqual(["Hack Squat", "Leg Extension+Hamstring Curl", "Leg Press", "Calf Raise"]);
    expect(s.entry(WED).order).toEqual(["Hack Squat", "Leg Extension", "Hamstring Curl", "Leg Press", "Calf Raise"]);
    expect(s.liftsFor(WED).map((it) => it.name)).toEqual(["Hack Squat", "Leg Extension", "Hamstring Curl", "Leg Press", "Calf Raise"]);
    expect(s.liftsFor("2026-09-16").map((it) => it.name)).toEqual(LEGS); // last Wednesday keeps the plan's order
    // Moved back, the day is in the plan's order again and keeps none of its own.
    s.moveBlock(WED, 1, 1);
    expect(s.liftsFor(WED).map((it) => it.name)).toEqual(LEGS);
    expect("order" in s.entry(WED)).toBe(false);
  });

  it("goes no further than either end", () => {
    const s = storeWith({});
    s.moveBlock(WED, 0, -1);
    s.moveBlock(WED, 4, 1);
    expect(s.logs[WED]).toBeUndefined();
    expect(s.liftsFor(WED).map((it) => it.name)).toEqual(LEGS);
  });

  it("puts a lift the plan has since dropped where it was done, and a lift added since after the rest", () => {
    const s = storeWith({ [WED]: day({ exercises: { "Goblet Squat": lift([[12, 20]]) }, order: ["Goblet Squat", "Calf Raise", "Hack Squat"] }) });
    expect(s.liftsFor(WED).map((it) => [it.name, it.extra])).toEqual([
      ["Goblet Squat", true],
      ["Calf Raise", false],
      ["Hack Squat", false],
      ["Leg Press", false],
      ["Leg Extension", false],
      ["Hamstring Curl", false],
    ]);
  });

  it("is kept with the day, through a rename of one of its lifts", async () => {
    const s = storeWith({ "2026-09-16": day({ order: ["Leg Press", "Hack Squat"], exercises: { "Hack Squat": lift([[10, 40]]) } }) });
    expect(s.entry("2026-09-16").order).toEqual(["Leg Press", "Hack Squat"]);
    const r = await s.renameLift("Leg Press", "Leg Press Machine");
    // That day never logged a Leg Press, so no history moved; its place in the day's order did.
    expect(r).toMatchObject({ ok: true, days: 0 });
    expect(s.logs["2026-09-16"].order).toEqual(["Leg Press Machine", "Hack Squat"]);
    expect(s.liftsFor("2026-09-16")[0].name).toBe("Leg Press Machine");
  });

  it("drops an order that isn't a list of names", () => {
    const s = storeWith({ [WED]: day({ order: [1, "Leg Press"] as unknown as string[] }) });
    expect("order" in s.entry(WED)).toBe(false);
    expect(s.liftsFor(WED).map((it) => it.name)).toEqual(LEGS);
  });

  it("orders the CSV's lifts as they were done", () => {
    const s = storeWith({ [WED]: day({ exercises: { "Hack Squat": lift([[10, 40]]), "Calf Raise": lift([[15, 30]]) }, order: ["Calf Raise", "Hack Squat"] }) });
    expect(s.workoutRows().map((r) => r[2])).toEqual(["Calf Raise", "Hack Squat"]);
  });
});
