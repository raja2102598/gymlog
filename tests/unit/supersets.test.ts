import { describe, expect, it } from "vitest";
import { nextInRounds, supersetModels } from "@/components/today/SupersetItem";
import { DEFAULT_PLAN, normalizePlan, orderBlocks, planBlocks } from "@/lib/plan";
import { atWednesdayNoon, day, LEGS, lift, storeWith, WED } from "./helpers";

// Supersets and a day's own order (RAJ-54). Wednesday is Legs, whose lifts are Hack Squat, Leg Press, Leg Extension,
// Hamstring Curl and Calf Raise. A rename moving a lift's place in the order is in rename.test.ts.
atWednesdayNoon();

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

describe("a superset in the workout", () => {
  /** Wednesday with Hamstring Curl joined to Leg Extension (A1 and A2), and the superset's lifts as its card has them,
   *  as saved now. */
  const superset = () => {
    const s = storeWith({});
    s.plan.days[2].exercises[3].superset = true;
    const lifts = s.liftBlocks(WED)[2].map((item, n) => ({ item, i: 2 + n }));
    return { s, lifts: () => supersetModels(s, WED, lifts, s.entry(WED)) };
  };

  it("goes round by round, A1 then A2, whichever of a round's sets was logged first", () => {
    const { lifts } = superset();
    expect(nextInRounds(lifts())).toEqual([0, 0]);
    lifts()[1].setField(0, "reps", "10"); // A2's first set before A1's
    expect(nextInRounds(lifts())).toEqual([0, 0]);
    lifts()[0].setField(0, "reps", "12");
    expect(nextInRounds(lifts())).toEqual([0, 1]); // round 2
    lifts()[0].setField(1, "reps", "12");
    expect(nextInRounds(lifts())).toEqual([1, 1]);
  });

  it("leaves a skipped lift out of the rounds, lets a lift with more sets fill the last ones alone, and ends once all are logged", () => {
    const { lifts } = superset();
    lifts()[0].skipToday();
    expect(nextInRounds(lifts())).toEqual([1, 0]); // A2 alone
    lifts()[0].edit((r) => void delete r.skipped, true);
    for (let j = 0; j < 3; j++) for (const m of lifts()) m.setField(j, "reps", "10");
    expect(nextInRounds(lifts())).toBeNull();
    lifts()[1].addSet(); // a 4th set for A2 only
    expect(nextInRounds(lifts())).toEqual([1, 3]);
  });

  it("starts the rest once a round is complete, for the longest rest of its lifts that are left, and not once a later round is under way", () => {
    const { s, lifts } = superset();
    s.plan.days[2].exercises[3].rest = "120"; // Hamstring Curl, A2
    lifts()[0].setField(0, "reps", "12");
    expect(s.rest).toBeNull(); // A2 still to come
    lifts()[1].setField(0, "reps", "10");
    expect(s.rest).toMatchObject({ lift: "Hamstring Curl", sec: 120 });
    s.skipRest();
    lifts()[1].setField(1, "reps", "10");
    lifts()[0].setField(1, "reps", "12"); // A1 completes round 2
    expect(s.rest).toMatchObject({ lift: "Leg Extension", sec: 120 });
    s.skipRest();
    lifts()[1].skipToday(); // A2 skipped: A1's set is the round, and its own 90 s the rest
    lifts()[0].setField(2, "reps", "12");
    expect(s.rest).toMatchObject({ lift: "Leg Extension", sec: 90 });
    s.skipRest();
    lifts()[1].edit((r) => void delete r.skipped, true); // back in
    for (const m of lifts()) m.addSet(4); // + Round
    lifts()[0].setField(3, "reps", "12"); // A1 on into round 4
    lifts()[1].setField(2, "reps", "10"); // A2 completes round 3, with round 4 under way
    expect(s.rest).toBeNull();
  });
});
