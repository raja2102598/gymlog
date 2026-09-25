import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOGUE, equipText, equipWords, gymCan, gymLacks, libraryNamed } from "@/lib/library";
import { DEFAULT_PLAN, normalizeGym, normalizePlan } from "@/lib/plan";
import { GymStore } from "@/lib/store";
import type { Gym } from "@/lib/types";

// My gym (RAJ-63). Wednesday 23 September 2026, as in the end-to-end tests.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-23T12:00:00"));
});
afterEach(() => vi.useRealTimers());

function storeWith() {
  const s = new GymStore();
  s.user = { id: "u", created_at: "2026-08-26T05:00:00Z" } as GymStore["user"];
  return s;
}
const lift = (name: string) => libraryNamed(name)!;
const gym = (g: Partial<Gym>): Gym => ({ off: [], always: [], never: [], ...g });

describe("filtering by equipment", () => {
  it("offers everything with no gym set", () => {
    expect(CATALOGUE.every((x) => gymCan(x))).toBe(true);
    expect(gymLacks(lift("Barbell Squat"))).toEqual([]);
  });

  it("leaves out a lift needing any equipment the gym hasn't got, never one needing none", () => {
    const g = gym({ off: ["barbell"] });
    expect(gymCan(lift("Barbell Squat"), g)).toBe(false);
    expect(gymCan(lift("Barbell Bench Press - Medium Grip"), g)).toBe(false); // barbell, bench and rack
    expect(gymCan(lift("Dumbbell Bench Press"), g)).toBe(true);
    expect(gymCan(lift("Pushups"), g)).toBe(true); // bodyweight
    expect(gymLacks(lift("Barbell Bench Press - Medium Grip"), gym({ off: ["barbell", "rack"] }))).toEqual(["barbell", "rack"]);
    const none = gym({ off: ["barbell", "ezbar", "trapbar", "dumbbell", "kettlebell", "band", "bench", "rack", "pullupbar", "dipbars", "cable", "machine", "smith", "medball", "ball", "foamroll", "other"] });
    expect(CATALOGUE.filter((x) => gymCan(x, none)).every((x) => x.equip.length === 0)).toBe(true);
  });

  it("always offers a lift on the always list, and never one on the never list", () => {
    const squat = lift("Barbell Squat"), pushups = lift("Pushups");
    const g = gym({ off: ["barbell", "rack"], always: [squat.id], never: [pushups.id] });
    expect(gymCan(squat, g)).toBe(true);
    expect(gymLacks(squat, g)).toEqual([]); // not flagged: you said it's here
    expect(gymCan(pushups, g)).toBe(false);
  });

  it("keeps a gym as it should be: known equipment in order, each lift once and on one list", () => {
    expect(normalizeGym({ off: ["rack", "laser", "barbell", "rack"], always: ["A", " A ", "B", ""], never: ["B", 3] })).toEqual({ off: ["barbell", "rack"], always: ["A"], never: ["B", "3"] });
    expect(normalizeGym(null)).toEqual({ off: [], always: [], never: [] });
  });

  it("stays out of a plan until it's set, and round-trips once it is", () => {
    expect("gym" in normalizePlan(DEFAULT_PLAN, DEFAULT_PLAN)).toBe(false);
    const p = normalizePlan({ ...DEFAULT_PLAN, gym: { off: ["cable"], always: [], never: ["X"] } }, DEFAULT_PLAN);
    expect(p.gym).toEqual({ off: ["cable"], always: [], never: ["X"] });
    expect(normalizePlan(p, DEFAULT_PLAN)).toEqual(p);
  });
});

describe("My gym in the app", () => {
  it("turns equipment on and off, one piece or all of it", () => {
    const s = storeWith();
    s.setEquip(false, "barbell");
    s.setEquip(false, "cable");
    expect(s.gym().off).toEqual(["barbell", "cable"]);
    s.setEquip(true, "barbell");
    expect(s.gym().off).toEqual(["cable"]);
    s.setEquip(false);
    expect(s.gym().off).toHaveLength(17);
    s.setEquip(true);
    expect(s.gym().off).toEqual([]);
  });

  it("moves a lift between the always and never lists, and off them", () => {
    const s = storeWith(), a = lift("Barbell Squat").id, b = lift("Pushups").id;
    s.showLifts([a, b], "always");
    expect(s.gym()).toMatchObject({ always: [a, b], never: [] });
    s.showLifts([b], "never");
    expect(s.gym()).toMatchObject({ always: [a], never: [b] });
    s.showLifts([a], null);
    expect(s.gym()).toMatchObject({ always: [], never: [b] });
  });

  it("offers swaps and free-form lifts the gym can do, and keeps the plan's own lifts whatever it has", () => {
    const s = storeWith();
    expect(s.swapSuggestions("Leg Press")).toContain("Barbell Squat");
    s.setEquip(false, "barbell");
    const swaps = s.swapSuggestions("Leg Press");
    expect(swaps).not.toContain("Barbell Squat");
    expect(swaps).toContain("Goblet Squat"); // a kettlebell
    expect(swaps).toContain("Hack Squat"); // the plan's
    expect(s.liftSuggestions()).not.toContain("Barbell Curl");
    expect(s.liftSuggestions()).toContain("Dumbbell Bicep Curl");
    // The plan keeps its lifts, and says what one needs that isn't here.
    s.setEquip(false, "machine");
    expect(s.plan.days[2].exercises.map((x) => x.name)).toContain("Leg Press");
    expect(s.lacks(s.exerciseOf("Leg Press")!)).toEqual(["machine"]);
  });

  it("stays when the plan's reset", () => {
    const s = storeWith();
    s.setEquip(false, "smith");
    s.resetPlan();
    expect(s.gym().off).toEqual(["smith"]);
  });
});

describe("equipment in words", () => {
  it("keeps EZ bar's capitals mid-sentence", () => {
    expect(equipWords(["barbell", "ezbar", "rack"])).toBe("barbell, EZ bar or squat rack");
    expect(equipWords(["machine"])).toBe("machines");
    expect(equipText(lift("EZ-Bar Curl"))).toBe("EZ bar");
    expect(equipText(lift("Barbell Bench Press - Medium Grip"))).toBe("Barbell, bench, squat rack");
  });
});
