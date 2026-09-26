import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN, DEFAULT_WEIGHTS, normalizeCustom, normalizeGym, normalizePlan, normalizeWeights } from "@/lib/plan";
import { atWednesdayNoon, storeWith } from "./helpers";

// The plan as it's saved and read back (lib/plan.ts's normalizePlan), and Reset to the default plan. What each part
// does is tested with it: supersets in supersets.test.ts, a lift's rest in rest.test.ts, effort in settypes.test.ts.
atWednesdayNoon();

describe("the plan as saved", () => {
  it("fills gaps, drops unnamed lifts and reads knee notes", () => {
    const p = normalizePlan({ stepGoal: "8000", kneeLimit: 11, days: [{ name: " Push ", exercises: [{ name: "Press", flag: "KNEE NOTE: go easy" }, { name: "" }] }] }, DEFAULT_PLAN);
    expect(p.stepGoal).toBe(8000);
    expect(p.kneeLimit).toBe(DEFAULT_PLAN.kneeLimit);
    expect(p.days[0].name).toBe("Push");
    expect(p.days[0].exercises.map((x) => [x.name, x.knee])).toEqual([["Press", true]]);
    expect(p.days[1]).toEqual(DEFAULT_PLAN.days[1]);
    expect(p.days.map((d) => d.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  it("gives a 20 kg bar and a standard plate set by default, sanitizing what's typed or restored", () => {
    const p = normalizePlan({}, DEFAULT_PLAN);
    expect(p.barKg).toBe(20);
    expect(p.plateKgs).toEqual([25, 20, 15, 10, 5, 2.5, 1.25]);
    const q = normalizePlan({ barKg: 15, plateKgs: [10, "20", 0, -5, 10, "not a number"] }, DEFAULT_PLAN);
    expect(q.barKg).toBe(15);
    expect(q.plateKgs).toEqual([20, 10]);
    const r = normalizePlan({ barKg: 0, plateKgs: [] }, q);
    expect([r.barKg, r.plateKgs]).toEqual([15, []]);
  });

  it("tidies My gym, its weights and your own lifts: known equipment in order, each lift once, weights in range", () => {
    expect(normalizeGym({ off: ["rack", "laser", "barbell", "rack"], always: ["A", " A ", "B", ""], never: ["B", 3] })).toEqual({ off: ["barbell", "rack"], always: ["A"], never: ["B", "3"] });
    expect(normalizeGym(null)).toEqual({ off: [], always: [], never: [] });
    expect(normalizeWeights({ ezbar: 12, trapbar: "25", smith: -1, dumbbell: 0, kettlebell: "8", band: 500 })).toEqual({ ...DEFAULT_WEIGHTS, ezbar: 12, trapbar: 25, kettlebell: 8 });
    expect(normalizeWeights(null)).toEqual(DEFAULT_WEIGHTS);
    expect(
      normalizeCustom([
        { name: " Sled Push ", equip: ["other", "laser"], primary: ["quadriceps", "quadriceps"], secondary: ["glutes", "quadriceps", 7] },
        { name: "sled push", equip: [], primary: [], secondary: [] },
        { name: "", equip: [] },
        "x",
      ]),
    ).toEqual([{ name: "Sled Push", equip: ["other"], primary: ["quadriceps"], secondary: ["glutes"] }]);
    // Each lift's own pick of what it's loaded with, when it's one the app knows.
    const q = normalizePlan({ days: [{ exercises: [{ name: "A", load: "dumbbell" }, { name: "B", load: "anvil" }] }] }, DEFAULT_PLAN);
    expect(q.days[0].exercises.map((x) => x.load)).toEqual(["dumbbell", undefined]);
  });

  it("leaves My gym, its weights and your own lifts out until they're set, so older plans read back unchanged, and keeps them once they are", () => {
    const plain = normalizePlan(DEFAULT_PLAN, DEFAULT_PLAN);
    expect(["gym", "weights", "custom"].filter((k) => k in plain)).toEqual([]);
    const p = normalizePlan(
      { ...DEFAULT_PLAN, gym: { off: ["cable"], always: [], never: ["X"] }, weights: { ...DEFAULT_WEIGHTS, ezbar: 8 }, custom: [{ name: "Sled Push", equip: ["other"], primary: ["quadriceps"], secondary: [] }] },
      DEFAULT_PLAN,
    );
    expect([p.gym, p.weights?.ezbar, p.custom?.map((c) => c.name)]).toEqual([{ off: ["cable"], always: [], never: ["X"] }, 8, ["Sled Push"]]);
    expect(normalizePlan(JSON.parse(JSON.stringify(p)), DEFAULT_PLAN)).toEqual(p);
  });

  it("keeps each lift's rule and numbers, and drops a rule it doesn't know", () => {
    const p = normalizePlan(
      {
        days: [
          {
            name: "A",
            exercises: [
              { name: "Squat", prog: "linear", deloadAfter: 3, deloadPct: "15" },
              { name: "Bench", prog: "percent", oneRm: "100", pct: 75 },
              { name: "Row", prog: "wave" },
              { name: "Curl" },
            ],
          },
        ],
      },
      DEFAULT_PLAN,
    );
    const [squat, bench, row, curl] = p.days[0].exercises;
    expect(squat).toMatchObject({ prog: "linear", deloadAfter: "3", deloadPct: "15" });
    expect(bench).toMatchObject({ prog: "percent", oneRm: "100", pct: "75" });
    expect("prog" in row).toBe(false);
    // A lift with none of them round-trips unchanged.
    for (const k of ["prog", "oneRm", "pct", "deloadAfter", "deloadPct"]) expect(k in curl).toBe(false);
    expect(normalizePlan(JSON.parse(JSON.stringify(p)), DEFAULT_PLAN)).toEqual(p);
  });
});

describe("Reset to the default plan", () => {
  it("keeps what isn't the plan itself: My gym, its bar, plates and weights, and your own lifts", () => {
    const s = storeWith();
    s.setEquip(false, "smith");
    s.setWeight("dumbbell", 2.5);
    s.saveCustom({ name: "Sled Push", equip: ["other"], primary: ["quadriceps"], secondary: [] });
    s.editPlan((p) => {
      p.barKg = 15;
      p.plateKgs = [20, 10];
      p.stepGoal = 12000;
      p.days[0].name = "Chest day";
    });
    s.resetPlan();
    expect([s.gym().off, s.weights().dumbbell, s.plan.barKg, s.plan.plateKgs, s.plan.custom?.map((c) => c.name)]).toEqual([["smith"], 2.5, 15, [20, 10], ["Sled Push"]]);
    // And the plan itself is the default's again.
    expect([s.plan.stepGoal, s.plan.days[0].name]).toEqual([DEFAULT_PLAN.stepGoal, DEFAULT_PLAN.days[0].name]);
  });
});
