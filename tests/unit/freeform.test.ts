import { describe, expect, it } from "vitest";
import { planModel } from "@/lib/dashboard";
import { FREE_NAME, GymStore } from "@/lib/store";
import type { DayLog } from "@/lib/types";
import { atWednesdayNoon, day, lift, storeWith, WED } from "./helpers";

// A free-form workout on any day (RAJ-36). Legs on Wednesdays, a rest day on Thursdays. A rename moving a lift in it
// is in rename.test.ts.
atWednesdayNoon();

const MON = "2026-09-21", TUE = "2026-09-22", THU = "2026-09-24";

describe("a free-form workout", () => {
  it("is the day's workout, its lifts in the order added, with the plan's settings for a lift the plan has", () => {
    const s = storeWith({});
    s.startFree(WED);
    expect(s.isFree(WED)).toBe(true);
    expect(s.planFor(WED).name).toBe(FREE_NAME);
    expect(s.liftsFor(WED)).toEqual([]);
    expect(s.addFreeLift(WED, " Goblet Squat ")).toBe(true);
    expect(s.addFreeLift(WED, "Leg Press")).toBe(true);
    expect(s.addFreeLift(WED, "Leg Press")).toBe(false); // there already
    expect(s.addFreeLift(WED, "  ")).toBe(false);
    s.setFreeName(WED, "Hotel gym");
    const p = s.planFor(WED);
    expect(p.name).toBe("Hotel gym");
    expect(p.exercises.map((x) => [x.name, x.sets, x.reps, x.knee])).toEqual([
      ["Goblet Squat", "", "", false],
      ["Leg Press", "3", "10-12", true],
    ]);
    expect(p.cardio).toEqual(s.plan.days[2].cardio); // the usual day's finisher
    expect(s.liftsFor(WED).map((it) => [it.name, it.extra])).toEqual([
      ["Goblet Squat", false],
      ["Leg Press", false],
    ]);
    expect(s.kneeDay(WED)).toBe(true); // Leg Press is knee-sensitive wherever it's done
  });

  it("never carries a superset into it", () => {
    const s = storeWith({});
    s.plan.days[2].exercises[1].superset = true; // Leg Press with Hack Squat, on Legs
    s.startFree(THU);
    s.addFreeLift(THU, "Leg Press");
    expect("superset" in s.planFor(THU).exercises[0]).toBe(false);
  });

  it("counts as an extra session once something's logged, and never as a planned one", () => {
    const push = new GymStore().plan.days[0].exercises.map((x) => x.name);
    const s = storeWith({ [MON]: day({ free: { name: "Hotel gym", lifts: push } }) });
    expect(s.weekSessions(MON)).toMatchObject({ done: 0, extra: 0 });
    // Every Push lift done, but in a free-form workout on Monday: an extra session, and Push still to do.
    for (const name of push) s.logs[MON].exercises[name] = lift([[10, 50]]);
    expect(s.weekSessions(MON)).toMatchObject({ done: 0, planned: 5, extra: 1 });
    expect(planModel(s, WED).week).toEqual({ done: 0, planned: 5, extra: 1 });
    expect(s.missedThisWeek(THU)).toEqual([0, 1]); // Push and Pull: the free Monday did neither
    delete s.logs[MON].free;
    expect(s.weekSessions(MON)).toMatchObject({ done: 1, extra: 0 }); // the same lifts as Monday's Push count
  });

  it("leaves what was logged on the day as lifts outside the plan when it ends", () => {
    const s = storeWith({});
    s.startFree(WED);
    s.addFreeLift(WED, "Goblet Squat");
    s.editLift(WED, "Goblet Squat", (r) => (r.sets = [{ reps: 12, kg: 20 }]), true);
    s.addFreeLift(WED, "Lunge");
    s.endFree(WED);
    expect(s.isFree(WED)).toBe(false);
    expect(s.planFor(WED).name).toBe("Legs");
    const items = s.liftsFor(WED);
    expect(items.slice(0, 5).map((it) => it.name)).toEqual(["Hack Squat", "Leg Press", "Leg Extension", "Hamstring Curl", "Calf Raise"]);
    expect(items.slice(5).map((it) => [it.name, it.extra])).toEqual([["Goblet Squat", true]]); // Lunge had nothing logged
  });

  it("takes a lift out with what was logged for it", () => {
    const s = storeWith({});
    s.startFree(TUE);
    s.addFreeLift(TUE, "Goblet Squat");
    s.addFreeLift(TUE, "Lunge");
    s.editLift(TUE, "Lunge", (r) => (r.sets = [{ reps: 10, kg: 12 }]), true);
    s.removeFreeLift(TUE, "Lunge");
    expect(s.entry(TUE).free).toEqual({ name: "", lifts: ["Goblet Squat"] });
    expect(s.entry(TUE).exercises.Lunge).toBeUndefined();
  });

  it("is kept with the day, and dropped when it doesn't read right", () => {
    expect(storeWith({ [WED]: day({ free: { name: "Pool", lifts: ["Swim"] } }) }).entry(WED).free).toEqual({ name: "Pool", lifts: ["Swim"] });
    for (const bad of [{ name: 3, lifts: [] }, { name: "x" }, { name: "x", lifts: [1] }, "x"]) {
      const s = storeWith({ [WED]: day({ free: bad as unknown as DayLog["free"] }) });
      expect(s.isFree(WED)).toBe(false);
      expect("free" in s.entry(WED)).toBe(false);
      expect(s.planFor(WED).name).toBe("Legs");
    }
  });


  it("suggests the plan's lifts, anything swapped in and every lift logged, less those already added", () => {
    const s = storeWith({
      "2026-09-16": day({ exercises: { "Hack Squat": { ...lift([[10, 40]]), swap: "Pendulum Squat" }, Lunge: lift([[10, 12]]) } }),
    });
    const all = s.liftSuggestions();
    expect(all).toContain("Pendulum Squat");
    expect(all).toContain("Lunge");
    expect(all).toContain("Lat Pulldown"); // from the plan
    expect(s.liftSuggestions(["Lunge"])).not.toContain("Lunge");
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b)));
  });
});
