import { describe, expect, it, vi } from "vitest";
import { lighter, plateau, STUCK_AFTER, stuckWords } from "@/lib/plateau";
import { deloadStep, fellShort, greyskullStep, linearStep, percentOf, readyToAdd, timeStep } from "@/lib/stats";
import { GymStore, progWords } from "@/lib/store";
import type { DayLog, PlanExercise } from "@/lib/types";
import { atWednesdayNoon, day, LAST, lift, memoryStorage, sets, storeWith, WED } from "./helpers";

// Progression per lift (RAJ-41): the rules, and the next weight each gives, held for a sore knee or a day that holds;
// and a stuck lift's hint. Legs on Wednesdays, with Hamstring Curl at 3 × 10-12 and Leg Press, knee-sensitive, at
// 3 × 10-12. Strength and a lift's page on Progress are in progress.test.ts; the readiness note, in readiness.test.ts.
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

  it("Greyskull adds the step once every set reaches the bottom, twice it when the last set doubles it, and resets 10% on a set short", () => {
    expect(greyskullStep(sets([[5, 60], [5, 60], [7, 60]]), "5", 3, 2.5)).toEqual({ rule: "greyskull", from: 60, to: 62.5, top: 5, amrap: 7, doubled: false });
    expect(greyskullStep(sets([[5, 60], [5, 60], [10, 60]]), "5", 3, 2.5)).toMatchObject({ to: 65, amrap: 10, doubled: true }); // 10 is twice the 5
    expect(greyskullStep(sets([[5, 60], [4, 60], [9, 60]]), "5", 3, 2.5)).toMatchObject({ to: 52.5, reset: true, off: 10 }); // 54, down to a step
    expect(greyskullStep(sets([[5, 60], [5, 60]]), "5", 3, 2.5)).toBeNull(); // a set missing
    expect(greyskullStep(sets([[5, 60], [5, 55], [8, 60]]), "5", 3, 2.5)).toBeNull(); // not one weight
    expect(greyskullStep([...sets([[5, 60], [5, 60], [6, 60]]), { reps: 3, kg: 60, type: "restpause" }], "5", 3, 2.5)?.amrap).toBe(6); // a burst after it isn't the last set
  });

  it("adding time goes up from last time's shortest hold, once it had the planned sets", () => {
    expect(timeStep(sets([[45, 0], [40, 0], [42, 0]]), 3, 5)).toEqual({ rule: "time", from: 40, to: 45, top: 40 });
    expect(timeStep([{ reps: 30, kg: null }, { reps: 35, kg: null }], 2, 10)?.to).toBe(40); // a hold needs no weight
    expect(timeStep(sets([[45, 0], [40, 0]]), 3, 5)).toBeNull(); // a set missing
    expect(timeStep([{ reps: 60, kg: null, type: "warmup" }, { reps: 20, kg: null }], 1, 5)?.from).toBe(20); // a warm-up doesn't count
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

  it("Greyskull says why: a step, a double step, or a reset, which shows as a deload does", () => {
    const at = (a: [number, number][]) => storeWith({ [LAST]: day({ exercises: { "Hamstring Curl": lift(a) } }) });
    let s = at([[10, 30], [10, 30], [14, 30]]);
    let n = s.nextWeight(curl(s, { prog: "greyskull" }), "Hamstring Curl", WED)!;
    expect(progWords(n)).toEqual({ lead: "Go up to ", kg: "32.5", why: ": Greyskull, every set hit 10 reps. Do the last one for as many as you can." });
    s = at([[10, 30], [10, 30], [20, 30]]);
    n = s.nextWeight(curl(s, { prog: "greyskull" }), "Hamstring Curl", WED)!;
    expect(progWords(n)).toEqual({ lead: "Go up to ", kg: "35", why: ": Greyskull, your last set hit 20, twice the 10, so a double step." });
    s = at(SHORT);
    n = s.nextWeight(curl(s, { prog: "greyskull" }), "Hamstring Curl", WED)!;
    expect(n).toMatchObject({ rule: "greyskull", reset: true, from: 50, to: 45, held: false });
    expect(progWords(n)).toEqual({ lead: "Reset to ", kg: "45", why: ": Greyskull, a set fell short of 10 reps, so 10% off 50\u00a0kg." });
    expect(s.placeholders(curl(s), s.lastDone("Hamstring Curl", WED), 0, n)).toEqual(["10", "45"]);
  });

  it("adding time suggests the seconds at last time's weight, and is never held for the knee", () => {
    const s = storeWith({ [LAST]: day({ exercises: { "Leg Press": lift([[40, 20], [35, 20], [40, 20]]) }, kneeAfter: 9 }) });
    const x = Object.assign(s.plan.days[2].exercises[1], { timed: true, prog: "time", stepSec: "10" } as Partial<PlanExercise>);
    const n = s.nextWeight(x, x.name, WED)!;
    expect(n).toMatchObject({ rule: "time", from: 35, to: 45, held: false });
    expect(progWords(n)).toEqual({ lead: "Hold for ", kg: "45", unit: "s", why: ": adding time, +10\u00a0s on your shortest hold last time." });
    expect(s.placeholders(x, s.lastDone(x.name, WED), 0, n)).toEqual(["45", "20"]);
    delete x.stepSec;
    expect(s.nextWeight(x, x.name, WED)?.to).toBe(40); // 5 s when it's empty
    delete x.timed; // no longer a hold: seconds would be no answer for reps
    expect(s.nextWeight(x, x.name, WED)?.rule).not.toBe("time");
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

  it("holds every lift's increase on a day that holds (Hold today), kept on the day, and lets go again on Undo", () => {
    const s = storeWith({ [LAST]: day({ exercises: { "Hamstring Curl": lift([[12, 30], [12, 30], [12, 30]]), "Leg Press": lift(SHORT) } }) });
    const x = curl(s), last = s.lastDone(x.name, WED);
    s.holdDay(WED, true);
    expect(s.logs[WED].hold).toBe(true);
    expect(s.pending[WED].hold).toBe(true); // saved with the day, so it syncs
    // It stays through the day's other changes: a set logged, say.
    s.editLift(WED, "Leg Press", (r) => void (r.sets = sets([[10, 45]])), false);
    expect(s.entry(WED)).toMatchObject({ hold: true, exercises: { "Leg Press": { sets: [{ reps: 10, kg: 45 }] } } });
    const n = s.nextWeight(x, x.name, WED)!;
    expect(n).toMatchObject({ rule: "double", from: 30, to: 32.5, held: true, heldFor: "day" });
    expect(progWords(n)).toEqual({ lead: "Hold 30 kg: you’re holding today’s weights.", kg: "", why: "" });
    // The boxes suggest last time's weight and reps, not the new weight.
    expect(s.placeholders(x, last, 0, n)).toEqual(["12", "30"]);
    // A deload still shows, as with the knee, and so does a percentage that isn't more than last time.
    const lp = Object.assign(s.plan.days[2].exercises[1], { deloadAfter: "1" });
    expect(s.nextWeight(lp, lp.name, WED)).toMatchObject({ rule: "deload", held: false });
    expect(s.nextWeight(curl(s, { prog: "percent", oneRm: "40", pct: "75" }), x.name, WED)).toMatchObject({ rule: "percent", to: 30, held: false });
    delete curl(s).prog;
    // Only that day: the next one goes up as usual.
    expect(s.nextWeight(x, x.name, "2026-09-30")).toMatchObject({ to: 32.5, held: false });
    // A sore knee as well: the knee says why.
    const knee = storeWith({ [LAST]: day({ exercises: { "Leg Press": lift([[12, 50], [12, 50], [12, 50]]) }, kneeAfter: 7 }) });
    knee.holdDay(WED, true);
    expect(knee.nextWeight(knee.plan.days[2].exercises[1], "Leg Press", WED)).toMatchObject({ held: true, heldFor: "knee" });
    // Undo: back to going up, and nothing left on the day.
    s.holdDay(WED, false);
    expect("hold" in s.logs[WED]).toBe(false);
    expect(s.nextWeight(x, x.name, WED)).toMatchObject({ to: 32.5, held: false });
    expect(s.placeholders(x, last, 0, s.nextWeight(x, x.name, WED))).toEqual(["10", "32.5"]);
    // A day saved with anything else there reads as not holding.
    expect(storeWith({ [WED]: { ...day(), hold: "yes" } as unknown as DayLog }).entry(WED).hold).toBeUndefined();
  });
});

// A stuck lift (lib/plateau.ts): no new best estimated 1RM in its last four sessions, its card's hint and what it
// suggests, and Not now. The same on the lift's page on Progress is in progress.test.ts.
describe("a stuck lift", () => {
  /** Five Wednesdays before WED, the last one LAST. */
  const WEEKS = ["2026-08-19", "2026-08-26", "2026-09-02", "2026-09-09", LAST];
  /** 3 × 10 at 30 kg: an estimated 1RM of 40 kg (Brzycki), short of Hamstring Curl's 12s, so it doesn't go up. */
  const FLAT: [number, number][] = [[10, 30], [10, 30], [10, 30]];
  const at = (day: string, e1rm: number | null, top: number | null = 30) => ({ day, e1rm, top });
  /** Hamstring Curl done on WEEKS, one session each, with these sets. */
  const curls = (xs: [number, number][][]) => storeWith(Object.fromEntries(xs.map((a, i) => [WEEKS[i], day({ exercises: { "Hamstring Curl": lift(a) } })])));
  /** Adds a day to a store as the app does, so its list of days takes it in. */
  const add = (s: GymStore, k: string, d: DayLog) => s.save(k, d, true);
  const stuckOn = (s: GymStore, k = WED) => {
    const x = curl(s);
    return s.stuck(x, x.name, k, s.nextWeight(x, x.name, k));
  };

  it("is four sessions in a row without beating the best before them: equal isn't beaten", () => {
    expect(STUCK_AFTER).toBe(4);
    expect(plateau(WEEKS.map((d, i) => at(d, i ? 40 : 41)))).toEqual({ sessions: 4, best: 41, day: WEEKS[0], top: 30 });
    expect(plateau(WEEKS.map((d) => at(d, 40)))).toMatchObject({ sessions: 4, best: 40, day: WEEKS[0] });
    expect(plateau([...WEEKS, WED].map((d, i) => at(d, i ? 39 : 40)))?.sessions).toBe(5); // and on, past four
    // A new best in the last four starts it over.
    expect(plateau(WEEKS.map((d, i) => at(d, i === 4 ? 40.5 : 40)))).toBeNull();
    expect(plateau(WEEKS.map((d, i) => at(d, i === 1 ? 40.5 : 40)))).toBeNull();
  });

  it("needs five sessions: four to judge and one before them to beat", () => {
    expect(plateau([])).toBeNull();
    expect(plateau(WEEKS.slice(1).map((d) => at(d, 40)))).toBeNull();
    // A session with no estimate (reps only, or more than 12) isn't judged, so it doesn't make up the five.
    expect(plateau(WEEKS.map((d, i) => at(d, i === 2 ? null : 40)))).toBeNull();
    expect(plateau([...WEEKS.map((d, i) => at(d, i === 2 ? null : 40)), at(WED, 40)])).toMatchObject({ sessions: 4, day: WEEKS[0] });
  });

  it("counts sessions of the lift, not days: days without it don't count, and one it was swapped in for does", () => {
    const s = curls([FLAT, FLAT, FLAT, FLAT]);
    expect(stuckOn(s)).toBeNull(); // four sessions
    add(s, "2026-09-12", day({ exercises: { "Leg Press": lift([[10, 50]]) } })); // another lift that day
    add(s, "2026-09-14", day({ exercises: { "Hamstring Curl": lift(FLAT, { skipped: true }) } })); // skipped
    expect(stuckOn(s)).toBeNull();
    add(s, "2026-09-19", day({ exercises: { "Leg Curl": lift(FLAT, { swap: "Hamstring Curl" }) } })); // done in its place
    expect(stuckOn(s)).toMatchObject({ sessions: 4, best: 40, day: WEEKS[0] });
    // Today's own sets don't count yet: it's the session to come.
    add(s, WED, day({ exercises: { "Hamstring Curl": { done: false, kg: 30, sets: sets([[11, 30]]) } } }));
    expect(stuckOn(s)?.sessions).toBe(4);
  });

  it("suggests the planned sets at the top of the range, at 90% of last time, and says so", () => {
    const s = curls([FLAT, FLAT, [[10, 30], [9, 30], [9, 30]], FLAT, FLAT]);
    const t = stuckOn(s)!;
    expect(t).toMatchObject({ sessions: 4, best: 40, sets: 3, reps: 12, kg: 27.5 });
    expect(stuckWords(t)).toBe("No progress in 4 sessions. Try 3 × 12 at 90% (27.5 kg), or swap it for a variation.");
    // Asked for other sets and reps that day: those.
    add(s, WED, day({ exercises: { "Hamstring Curl": { done: false, kg: null, target: { sets: "4", reps: "8-10" } } } }));
    expect(stuckOn(s)).toMatchObject({ sets: 4, reps: 10 });
    expect(stuckWords({ ...t, reps: null })).toBe("No progress in 4 sessions. Try 90% (27.5 kg), or swap it for a variation.");
    expect(stuckWords({ ...t, kg: null })).toBe("No progress in 4 sessions. Try swapping it for a variation.");
  });

  it("rounds the lighter weight to what the equipment makes", () => {
    const machine = { base: 0, inc: 2.5 }, dumbbells = { base: 0, inc: 2 }, barbell = { base: 20, inc: 2.5 };
    expect(lighter(30, machine)).toBe(27.5); // 27: nearest 27.5
    expect(lighter(60, barbell)).toBe(55); // 54: nearest 55
    expect(lighter(10, dumbbells)).toBe(8); // 9 is nearest 10, which isn't lighter: the pair below
    expect(lighter(20, barbell)).toBeNull(); // the empty bar: nothing lighter
    expect(lighter(null, machine)).toBeNull();
    // Through the store: what the lift's equipment goes up by (My gym's weights), or its own step.
    const s = curls([FLAT, FLAT, FLAT, FLAT, FLAT]);
    expect(s.loadOf("Hamstring Curl")).toBe("machine");
    s.plan.weights = { ...s.weights(), machine: 5 };
    expect(stuckOn(s)?.kg).toBe(25); // 27, in 5 kg steps
    curl(s, { step: "1" });
    expect(stuckOn(s)?.kg).toBe(27);
  });

  it("gives way to the lift's own rule: go up or a deload", () => {
    // Stuck under a heavier best, but every set hit 12 last time: going up wins.
    const up = curls([[[10, 35], [10, 35], [10, 35]], FLAT, FLAT, FLAT, [[12, 30], [12, 30], [12, 30]]]);
    expect(up.sessionBests("Hamstring Curl", WED).map((b) => Math.round(b.e1rm!))).toEqual([47, 40, 40, 40, 43]);
    expect(plateau(up.sessionBests("Hamstring Curl", WED))).not.toBeNull();
    expect(up.nextWeight(curl(up), "Hamstring Curl", WED)?.rule).toBe("double");
    expect(stuckOn(up)).toBeNull();
    // Short last time, with a deload after one: the deload wins.
    const down = curls([FLAT, FLAT, FLAT, FLAT, [[10, 30], [8, 30], [7, 30]]]);
    expect(stuckOn(down)).not.toBeNull();
    curl(down, { deloadAfter: "1" });
    expect(stuckOn(down)).toBeNull();
  });

  it("shows nothing on a day the lift is skipped, done or swapped for another", () => {
    const s = curls([FLAT, FLAT, FLAT, FLAT, FLAT]);
    expect(stuckOn(s)).not.toBeNull();
    for (const r of [{ done: false, kg: null, skipped: true }, lift(FLAT), { done: false, kg: null, swap: "Nordic Curl" }]) {
      add(s, WED, day({ exercises: { "Hamstring Curl": r } }));
      expect(stuckOn(s)).toBeNull();
    }
  });

  it("stays away after Not now, kept on this phone and not in the plan, until the lift beats its best and sticks again", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("navigator", { onLine: true });
    try {
      const s = curls([FLAT, FLAT, FLAT, FLAT, FLAT]);
      s.putOffStuck("Hamstring Curl", stuckOn(s)!.best);
      expect(stuckOn(s)).toBeNull();
      expect(JSON.parse(localStorage.getItem("gymlog.notnow.v1")!)).toEqual({ user: "u", lifts: { "Hamstring Curl": 40 } });
      expect(s.planDirty || localStorage.getItem("gymlog.plan.v1") != null).toBe(false);
      // Another session no better: still put off.
      add(s, "2026-09-19", day({ exercises: { "Hamstring Curl": lift(FLAT) } }));
      expect(stuckOn(s)).toBeNull();
      // A new best, then four more without one: stuck again, on a best it hadn't when put off.
      const later = ["2026-09-24", "2026-09-26", "2026-09-28", "2026-09-30", "2026-10-02"];
      add(s, later[0], day({ exercises: { "Hamstring Curl": lift([[11, 30], [10, 30], [10, 30]]) } }));
      for (const d of later.slice(1)) add(s, d, day({ exercises: { "Hamstring Curl": lift(FLAT) } }));
      expect(stuckOn(s, "2026-10-05")).toMatchObject({ sessions: 4, day: later[0] });
      // Signed in again on this phone (a reload), it's still put off; another account on it has its own.
      const signIn = async (id: string) => {
        const again = new GymStore(), user = { id, created_at: "2026-08-26T05:00:00Z" };
        await (again as unknown as { onSignedIn(u: unknown, s: unknown): Promise<void> }).onSignedIn(user, { user, access_token: "" });
        return again;
      };
      const again = await signIn("u");
      expect(again.notNow).toEqual({ "Hamstring Curl": 40 });
      expect(stuckOn(again)).toBeNull();
      expect((await signIn("v")).notNow).toEqual({});
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stays put off when the lift is renamed with its history", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("navigator", { onLine: true });
    try {
      const s = curls([FLAT, FLAT, FLAT, FLAT, FLAT]);
      s.putOffStuck("Hamstring Curl", stuckOn(s)!.best);
      expect((await s.renameLift("Hamstring Curl", "Lying Leg Curl")).days).toBe(5);
      expect(curl(s).name).toBe("Lying Leg Curl");
      expect(stuckOn(s)).toBeNull();
      expect(JSON.parse(localStorage.getItem("gymlog.notnow.v1")!).lifts).toEqual({ "Lying Leg Curl": 40 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
