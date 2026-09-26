import { describe, expect, it } from "vitest";
import { plateLine } from "@/components/today/PlateCalc";
import { CATALOGUE, equipText, equipWords, gymCan, gymLacks, libraryNamed, loadOf } from "@/lib/library";
import { DEFAULT_PLAN } from "@/lib/plan";
import { onGrid, warmupLadder } from "@/lib/stats";
import { GymStore } from "@/lib/store";
import type { Gym, PlanExercise } from "@/lib/types";
import { atWednesdayNoon, day, LAST, storeWith, WED } from "./helpers";

// My gym (RAJ-63, RAJ-64): the equipment it has, which lifts it offers, and what each bar weighs and the rest go up
// by, so a lift's plates, warm-up sets and next weight fit what it's loaded with. How the plan saves it, and keeps it
// on Reset, is in plan.test.ts.
atWednesdayNoon();

const lift = (name: string) => libraryNamed(name)!;
const gym = (g: Partial<Gym>): Gym => ({ off: [], always: [], never: [], ...g });
/** A lift as the plan holds it, 3 × 10-12. */
const planned = (name: string, x: Partial<PlanExercise> = {}): PlanExercise => ({ name, sets: "3", reps: "10-12", cue: "", flag: "", step: "", knee: false, ...x });
/** Last Wednesday, every set of a lift at the top of 10-12 at `kg`: time to go up. */
const topped = (name: string, kg: number) => ({ [LAST]: day({ exercises: { [name]: { done: true, kg, sets: [12, 12, 12].map((reps) => ({ reps, kg })) } } }) });
/** Last Wednesday, a lift short of 10-12 at `kg`: a deload's due, for a lift that deloads after one. */
const short = (name: string, kg: number) => ({ [LAST]: day({ exercises: { [name]: { done: true, kg, sets: [10, 8, 7].map((reps) => ({ reps, kg })) } } }) });
const next = (s: GymStore, x: PlanExercise, did = x.name) => s.nextWeight(x, did, WED)?.to;
const words = (s: string) => s.replace(/ /g, " ");

describe("equipment", () => {
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

  it("offers swaps for the same main muscle, from the plan and the library, only what the gym can do; the plan keeps its own lifts", () => {
    const s = storeWith();
    const swaps = s.swapSuggestions("Leg Press");
    expect(swaps).toContain("Hack Squat"); // from the plan
    expect(swaps).toContain("Barbell Squat"); // quads, from the library
    expect(swaps).not.toContain("Barbell Curl"); // biceps
    expect(swaps).not.toContain("Leg Press");
    expect(s.liftSuggestions()).toContain("Barbell Curl"); // a free-form workout is offered any muscle
    s.setEquip(false, "barbell");
    const without = s.swapSuggestions("Leg Press");
    expect(without).not.toContain("Barbell Squat");
    expect(without).toContain("Goblet Squat"); // a kettlebell
    expect(without).toContain("Hack Squat"); // the plan's
    expect(s.liftSuggestions()).not.toContain("Barbell Curl");
    expect(s.liftSuggestions()).toContain("Dumbbell Bicep Curl");
    // The plan keeps its lifts, and says what one needs that isn't here.
    s.setEquip(false, "machine");
    expect(s.plan.days[2].exercises.map((x) => x.name)).toContain("Leg Press");
    expect(s.lacks(s.exerciseOf("Leg Press")!)).toEqual(["machine"]);
  });

  it("keeps EZ bar's capitals mid-sentence", () => {
    expect(equipWords(["barbell", "ezbar", "rack"])).toBe("barbell, EZ bar or squat rack");
    expect(equipWords(["machine"])).toBe("machines");
    expect(equipText(lift("EZ-Bar Curl"))).toBe("EZ bar");
    expect(equipText(lift("Barbell Bench Press - Medium Grip"))).toBe("Barbell, bench, squat rack");
  });
});

describe("weights", () => {
  it("goes by the library's equipment: a bar, then what goes up in steps, then bodyweight", () => {
    const s = storeWith();
    const names = ["Barbell Squat", "EZ-Bar Curl", "Trap Bar Deadlift", "Smith Machine Squat", "Dumbbell Bench Press", "Goblet Squat", "Leg Press", "Seated Cable Rows", "Band Good Morning", "Pushups"];
    expect(names.map((n) => s.loadOf(n))).toEqual(["barbell", "ezbar", "trapbar", "smith", "dumbbell", "kettlebell", "machine", "cable", "band", "body"]);
    expect(loadOf(libraryNamed("Dumbbell Bench Press"))).toBe("dumbbell"); // the bench it also needs isn't a load
  });

  it("isn't known for a lift the library doesn't have, or one of your own with no muscles yet", () => {
    const s = storeWith();
    expect(s.loadOf("Mystery Press")).toBeNull();
    s.keepOwn("Mystery Press");
    expect(s.loadOf("Mystery Press")).toBeNull();
    s.saveCustom({ name: "Mystery Press", equip: [], primary: ["chest"], secondary: [] }, true);
    expect(s.loadOf("Mystery Press")).toBe("body"); // tagged, with no equipment: bodyweight
  });

  it("takes the plan lift's own pick over the library's, and a swap is loaded as the lift done", () => {
    const s = storeWith();
    expect(s.loadOf("Goblet Squat", planned("Goblet Squat", { load: "dumbbell" }))).toBe("dumbbell");
    s.plan.days[2].exercises[1].load = "barbell"; // Leg Press, picked in the plan editor
    expect(s.loadOf("Leg Press")).toBe("barbell");
    expect(s.loadDone(planned("Goblet Squat"), "Goblet Squat")).toBe("kettlebell");
    expect(s.loadDone(planned("Goblet Squat"), "Dumbbell Squat")).toBe("dumbbell");
  });

  it("is each bar's own weight, nothing for a machine's plates, and none for what takes no plates", () => {
    const s = storeWith();
    const bar = (n: string) => s.barFor(s.loadOf(n));
    expect(["Barbell Squat", "EZ-Bar Curl", "Trap Bar Deadlift", "Smith Machine Squat", "Leg Press"].map(bar)).toEqual([20, 10, 20, 0, 0]);
    expect(["Dumbbell Bench Press", "Goblet Squat", "Seated Cable Rows", "Band Good Morning", "Pushups"].map(bar)).toEqual([null, null, null, null, null]);
    expect(bar("Mystery Press")).toBe(20); // not known: the barbell, as before My gym had weights
  });

  it("follows My gym: the barbell's weight, and each other bar's", () => {
    const s = storeWith();
    s.editPlan((p) => {
      p.barKg = 15;
    });
    s.setWeight("ezbar", 7.5);
    s.setWeight("smith", 6);
    expect([s.barFor("barbell"), s.barFor("ezbar"), s.barFor("trapbar"), s.barFor("smith"), s.barFor(null)]).toEqual([15, 7.5, 20, 6, 15]);
  });

  it("puts a weight on what the equipment makes: the nearest, or the next one up or down", () => {
    expect(onGrid(23.75, { base: 0, inc: 2 })).toBe(24);
    expect(onGrid(22.5, { base: 0, inc: 2 }, "up")).toBe(24);
    expect(onGrid(23, { base: 0, inc: 2 }, "down")).toBe(22);
    expect(onGrid(31, { base: 10, inc: 2.5 })).toBe(30);
    expect(onGrid(29.5, { base: 7, inc: 2.5 })).toBe(29.5); // the bar and nine pairs of 1.25s
    expect(onGrid(15, { base: 20, inc: 2.5 }, "down")).toBe(20); // never under the bar
    expect(onGrid(0.5, { base: 0, inc: 2 }, "down")).toBe(2); // nor under the lightest dumbbell
  });

  it("gives each kind its grid: a bar and pairs of the smallest plate, or a step from nothing", () => {
    const s = storeWith();
    expect(s.gridFor("barbell")).toEqual({ base: 20, inc: 2.5 });
    expect(s.gridFor("ezbar")).toEqual({ base: 10, inc: 2.5 });
    expect(s.gridFor("smith")).toEqual({ base: 0, inc: 2.5 });
    expect((["dumbbell", "kettlebell", "machine", "cable", "band"] as const).map((l) => s.gridFor(l)?.inc)).toEqual([2, 4, 2.5, 2.5, 5]);
    expect(s.gridFor("body")).toBeNull();
    expect(s.gridFor(null)).toBeNull();
    s.editPlan((p) => {
      p.plateKgs = [20, 10, 5];
    });
    expect(s.gridFor("barbell")).toEqual({ base: 20, inc: 10 });
    s.editPlan((p) => {
      p.plateKgs = [];
    });
    expect(s.gridFor("trapbar")).toEqual({ base: 20, inc: 2.5 });
  });

  it("goes up by the equipment's step, to a weight it makes: a dumbbell lift never suggests 23.75 kg", () => {
    expect(next(storeWith(topped("Dumbbell Bench Press", 22)), planned("Dumbbell Bench Press"))).toBe(24);
    expect(next(storeWith(topped("Dumbbell Bench Press", 21.75)), planned("Dumbbell Bench Press"))).toBe(24);
    expect(next(storeWith(topped("Goblet Squat", 16)), planned("Goblet Squat"))).toBe(20);
    expect(next(storeWith(topped("Band Good Morning", 10)), planned("Band Good Morning"))).toBe(15);
    expect(next(storeWith(topped("EZ-Bar Curl", 30)), planned("EZ-Bar Curl"))).toBe(32.5);
    expect(next(storeWith(topped("Leg Press", 50)), planned("Leg Press"))).toBe(52.5);
    const s = storeWith(topped("EZ-Bar Curl", 30));
    s.editPlan((p) => {
      p.plateKgs = [20, 10, 5];
    });
    expect(next(s, planned("EZ-Bar Curl"))).toBe(40); // a pair of 5s is the least it can add
  });

  it("still goes up by a lift's own step, as it's set, and 2.5 kg for a lift that isn't known", () => {
    expect(next(storeWith(topped("Dumbbell Bench Press", 22)), planned("Dumbbell Bench Press", { step: "2.5" }))).toBe(24.5);
    expect(next(storeWith(topped("Mystery Press", 21)), planned("Mystery Press"))).toBe(23.5);
    const s = storeWith();
    expect([s.stepFor(planned("Dumbbell Bench Press")), s.stepFor(planned("Goblet Squat", { load: "dumbbell" })), s.stepFor(planned("Leg Press", { step: "5" })), s.stepFor(planned("Pushups"))]).toEqual([2, 2, 5, 2.5]);
  });

  it("rounds a percentage of a 1RM to the nearest weight it makes, and a deload down to one", () => {
    const s = storeWith(short("EZ-Bar Curl", 30));
    s.setWeight("ezbar", 7);
    expect(next(s, planned("EZ-Bar Curl", { prog: "percent", oneRm: "50", pct: "60" }))).toBe(29.5); // 30 isn't a 7 kg bar and pairs of 1.25s
    expect(next(s, planned("EZ-Bar Curl", { deloadAfter: "1" }))).toBe(27); // 10% off 30
    expect(next(storeWith(short("Dumbbell Bench Press", 24)), planned("Dumbbell Bench Press", { deloadAfter: "1" }))).toBe(20); // 21.6, down
  });

  it("goes by what was done: a swap goes up as the lift it was swapped for", () => {
    expect(next(storeWith(topped("Dumbbell Squat", 20)), planned("Goblet Squat"), "Dumbbell Squat")).toBe(22);
  });

  it("round warm-up sets on the lift's bar and its step", () => {
    expect(warmupLadder(30, 10, 2.5).map((s) => s.kg)).toEqual([12.5, 17.5, 25]); // an EZ bar
    expect(warmupLadder(24, 0, 2).map((s) => s.kg)).toEqual([10, 14, 20]); // dumbbells
    expect(warmupLadder(100, 0, 2.5).map((s) => s.kg)).toEqual([40, 60, 80]); // a machine
    expect(warmupLadder(47, 20, 2.5)).toEqual(warmupLadder(47, 20)); // the barbell, as before
  });

  it("names no bar for a machine's plates", () => {
    expect(words(plateLine(30, 10, DEFAULT_PLAN.plateKgs))).toBe("10 kg per side, 10 kg bar: 30 kg.");
    expect(words(plateLine(100, 0, [20, 10, 5]))).toBe("20 kg × 2, 10 kg per side: 100 kg.");
    expect(words(plateLine(3, 0, [20, 10, 5]))).toBe("No plates: 0 kg. 3 kg left over.");
  });
});
