import { describe, expect, it } from "vitest";
import { deloadStep, fellShort, linearStep, percentOf, readyToAdd } from "@/lib/stats";
import { GymStore, progWords } from "@/lib/store";
import type { PlanExercise } from "@/lib/types";
import { atWednesdayNoon, day, LAST, lift, sets, storeWith, WED } from "./helpers";

// Progression per lift (RAJ-41): the rules, and the next weight each gives. Legs on Wednesdays, with Hamstring Curl at
// 3 × 10-12 and Leg Press, knee-sensitive, at 3 × 10-12. Strength on Progress is in progress.test.ts.
atWednesdayNoon();

const BEFORE = "2026-09-09";
/** Working sets short of 10-12 at 50 kg. */
const SHORT: [number, number][] = [[10, 50], [8, 50], [7, 50]];
/** Legs' Hamstring Curl, with these settings. */
const curl = (s: GymStore, x: Partial<PlanExercise> = {}) => Object.assign(s.plan.days[2].exercises[3], x);

describe("the rules", () => {
  it("linear adds the step once every set reaches the bottom of the range, at one weight", () => {
    expect(linearStep(sets([[5, 100], [5, 100], [5, 100]]), "5", 3, 2.5)).toEqual({ rule: "linear", from: 100, to: 102.5, top: 5 });
    expect(linearStep(sets([[10, 40], [8, 40], [8, 40]]), "8-10", 3, 2.5)?.to).toBe(42.5); // the bottom is enough
    expect(linearStep(sets([[5, 100], [4, 100], [5, 100]]), "5", 3, 2.5)).toBeNull(); // a set short
    expect(linearStep(sets([[5, 100], [5, 100]]), "5", 3, 2.5)).toBeNull(); // a set missing
    expect(linearStep(sets([[5, 100], [5, 95], [5, 100]]), "5", 3, 2.5)).toBeNull(); // not one weight
    expect(linearStep([{ reps: 5, kg: 60, type: "warmup" }, ...sets([[5, 100], [5, 100], [5, 100]])], "5", 3, 2.5)?.from).toBe(100);
  });

  it("double progression waits for every set at the top of the range, at one weight, as many as were asked", () => {
    expect(readyToAdd(sets([[10, 40], [10, 40], [10, 40]]), "8-10", 3, 2.5)).toEqual({ rule: "double", from: 40, to: 42.5, top: 10 });
    expect(readyToAdd(sets([[10, 40], [8, 40], [8, 40]]), "8-10", 3, 2.5)).toBeNull(); // the bottom isn't enough
    expect(readyToAdd(sets([[10, 50], [9, 50], [10, 50]]), "8-10", 3, 2.5)).toBeNull(); // one set short
    expect(readyToAdd(sets([[10, 50], [10, 45], [10, 50]]), "8-10", 3, 2.5)).toBeNull(); // mixed weights
    expect(readyToAdd(sets([[10, 50], [10, 50]]), "8-10", 3, 2.5)).toBeNull(); // fewer sets than asked
    expect(readyToAdd(sets([[10, 0], [10, 0], [10, 0]]), "8-10", 3, 2.5)?.to).toBe(2.5); // an empty sled
    expect(readyToAdd([{ reps: null, kg: 50 }], "8-10", 1, 2.5)).toBeNull(); // weight only (older entries)
  });

  it("a percentage of a 1RM goes to the nearest step, 2.5 kg without one", () => {
    expect(percentOf(120, 75, 2.5)).toBe(90);
    expect(percentOf(117, 75, 2.5)).toBe(87.5); // 87.75
    expect(percentOf(117, 75, 1)).toBe(88);
    expect(percentOf(100, 72, 0)).toBe(72.5);
  });

  it("a session falls short with a working set under the bottom of the range, or fewer sets than asked", () => {
    expect(fellShort(sets([[10, 40], [9, 40], [10, 40]]), "10-12", 3)).toBe(true);
    expect(fellShort(sets([[10, 40], [10, 40]]), "10-12", 3)).toBe(true);
    expect(fellShort(sets([[10, 40], [10, 40], [10, 40]]), "10-12", 3)).toBe(false);
    // A warm-up or a drop set isn't judged against the range.
    expect(fellShort([{ reps: 6, kg: 20, type: "warmup" }, ...sets([[10, 40], [10, 40], [10, 40]]), { reps: 5, kg: 30, type: "drop" }], "10-12", 3)).toBe(false);
    expect(fellShort([], "10-12", 3)).toBeNull();
    expect(fellShort(sets([[10, 40]]), "", 3)).toBeNull();
  });

  it("a deload follows enough sessions in a row that fell short, off the latest, down to a whole step", () => {
    const short = { sets: sets(SHORT), reps: "10-12", minSets: 3 }, fine = { sets: sets([[10, 50], [10, 50], [10, 50]]), reps: "10-12", minSets: 3 };
    expect(deloadStep([short, short, fine], 2, 10, 2.5)).toEqual({ rule: "deload", from: 50, to: 45, top: 10, fails: 2, off: 10 });
    expect(deloadStep([short, fine, short], 2, 10, 2.5)).toBeNull(); // not in a row
    expect(deloadStep([short], 2, 10, 2.5)).toBeNull(); // not enough sessions yet
    expect(deloadStep([short, short], 2, 15, 2.5)?.to).toBe(42.5);
    expect(deloadStep([{ ...short, sets: sets([[8, 52.5], [7, 52.5]]) }], 1, 10, 2.5)?.to).toBe(45); // 47.25, down to 45
    expect(deloadStep([short, short], 0, 10, 2.5)).toBeNull(); // off
    expect(deloadStep([short, short], 2, 0, 2.5)).toBeNull();
  });
});

describe("the next weight, by the lift's rule", () => {
  it("is double progression unless the plan says otherwise, as before", () => {
    const s = storeWith({ [LAST]: day({ exercises: { "Hamstring Curl": lift([[12, 30], [12, 30], [12, 30]]) } }) });
    const n = s.nextWeight(curl(s), "Hamstring Curl", WED)!;
    expect(n).toMatchObject({ rule: "double", from: 30, to: 32.5, top: 12, held: false, day: LAST });
    expect(progWords(n)).toEqual({ lead: "Go up to ", kg: "32.5", why: ": every set hit 12 reps last time." });
    // The next set's boxes suggest the bottom of the range at the new weight.
    expect(s.placeholders(curl(s), s.lastDone("Hamstring Curl", WED), 0, n)).toEqual(["10", "32.5"]);
  });

  it("linear goes up once every set reaches the bottom of the range, by the lift's step", () => {
    const s = storeWith({ [LAST]: day({ exercises: { "Hamstring Curl": lift([[10, 30], [10, 30], [10, 30]]) } }) });
    const x = curl(s, { prog: "linear", step: "5" }), n = s.nextWeight(x, x.name, WED)!;
    expect(n).toMatchObject({ rule: "linear", from: 30, to: 35, top: 10 });
    expect(progWords(n)).toEqual({ lead: "Go up to ", kg: "35", why: ": linear, +5 kg a session while every set hits 10 reps." });
    expect(s.placeholders(x, s.lastDone(x.name, WED), 0, n)).toEqual(["10", "35"]);
    delete x.prog;
    expect(s.nextWeight(x, x.name, WED)).toBeNull(); // double progression waits for 12s
  });

  it("a percentage of a 1RM needs no history, and names both numbers", () => {
    const s = storeWith({});
    const x = curl(s, { prog: "percent", oneRm: "60", pct: "75" }), n = s.nextWeight(x, x.name, WED)!;
    expect(n).toMatchObject({ rule: "percent", from: null, to: 45, pct: 75, oneRm: 60, day: WED, held: false });
    expect(progWords(n)).toEqual({ lead: "Work at ", kg: "45", why: ": 75% of your 60 kg 1RM." });
    expect(s.placeholders(x, null, 0, n)).toEqual(["10", "45"]);
    // Until both numbers make sense there's nothing to say.
    expect(s.nextWeight(curl(s, { pct: "" }), x.name, WED)).toBeNull();
    expect(s.nextWeight(curl(s, { pct: "120" }), x.name, WED)).toBeNull();
  });

  it("puts a deload first once enough sessions in a row fell short, whatever the rule", () => {
    const s = storeWith({ [BEFORE]: day({ exercises: { "Hamstring Curl": lift(SHORT) } }), [LAST]: day({ exercises: { "Hamstring Curl": lift(SHORT) } }) });
    const x = curl(s, { deloadAfter: "2" }), n = s.nextWeight(x, x.name, WED)!;
    expect(n).toMatchObject({ rule: "deload", from: 50, to: 45, fails: 2, off: 10, day: LAST, held: false });
    expect(progWords(n)).toEqual({ lead: "Deload to ", kg: "45", why: ": 2 sessions in a row fell short, so 10% off 50 kg." });
    expect(s.placeholders(x, s.lastDone(x.name, WED), 0, n)).toEqual(["10", "45"]);
    expect(s.nextWeight(curl(s, { deloadPct: "20" }), x.name, WED)?.to).toBe(40);
    expect(s.nextWeight(curl(s, { prog: "percent", oneRm: "100", pct: "70" }), x.name, WED)?.rule).toBe("deload");
    expect(progWords(s.nextWeight(curl(s, { deloadAfter: "1" }), x.name, WED)!).why).toBe(": last session fell short, so 20% off 50 kg.");
    // Not yet: three sessions asked for, two logged.
    expect(s.nextWeight(curl(s, { deloadAfter: "3" }), x.name, WED)?.rule).toBe("percent");
  });

  it("judges each session against what it was asked for", () => {
    // Two weeks ago asked for 6-8, and 10, 8 and 7 met that; only last week fell short.
    const s = storeWith({
      [BEFORE]: day({ exercises: { "Hamstring Curl": lift(SHORT, { target: { sets: "3", reps: "6-8" } }) } }),
      [LAST]: day({ exercises: { "Hamstring Curl": lift(SHORT) } }),
    });
    const x = curl(s, { deloadAfter: "2" });
    expect(s.nextWeight(x, x.name, WED)).toBeNull();
  });

  it("holds an increase on a knee lift after a sore session, never a deload", () => {
    const sore = { kneeBefore: 2, kneeAfter: 7 };
    const s = storeWith({ [LAST]: day({ exercises: { "Leg Press": lift([[12, 50], [12, 50], [12, 50]]) }, ...sore }) });
    const x = s.plan.days[2].exercises[1];
    expect(x).toMatchObject({ name: "Leg Press", knee: true });
    const n = s.nextWeight(x, x.name, WED)!;
    expect(n).toMatchObject({ rule: "double", from: 50, to: 52.5, held: true });
    expect(progWords(n)).toEqual({ lead: "Hold 50 kg: your knee was sore after 16/09.", kg: "", why: "" });
    expect(s.placeholders(x, s.lastDone(x.name, WED), 0, n)).toEqual(["12", "50"]);
    // A percentage is held when it's more than last time, and shows when it isn't.
    Object.assign(x, { prog: "percent", oneRm: "100", pct: "60" });
    expect(s.nextWeight(x, x.name, WED)).toMatchObject({ rule: "percent", to: 60, held: true });
    Object.assign(x, { pct: "45" });
    expect(s.nextWeight(x, x.name, WED)).toMatchObject({ rule: "percent", to: 45, held: false });
    // A deload only takes weight off, so a sore knee doesn't hold it.
    const t = storeWith({ [LAST]: day({ exercises: { "Leg Press": lift(SHORT) }, ...sore }) });
    const y = Object.assign(t.plan.days[2].exercises[1], { deloadAfter: "1" });
    expect(t.nextWeight(y, y.name, WED)).toMatchObject({ rule: "deload", to: 45, held: false });
  });
});
