import { describe, expect, it } from "vitest";
import { checkSet, completeSet, liftModel, logged, nextSet } from "@/components/today/LiftItem";
import { nextInRounds, supersetModels } from "@/components/today/SupersetItem";
import { takesSaved } from "@/components/ui/SyncedField";
import { wdIndex } from "@/lib/dates";
import { DEFAULT_PLAN } from "@/lib/plan";
import { liftLine, sessionSummary, targetWords } from "@/lib/session";
import { setsOf, targetOf, type GymStore } from "@/lib/store";
import { lowMuscles, missedLifts, missedLine, missedTitle, weekMuscles } from "@/lib/suggest";
import { searchLibrary } from "@/lib/library";
import type { LiftLog } from "@/lib/types";
import { atWednesdayNoon, day, LAST, LEGS, lift, storeWith, WED } from "./helpers";

// Train: a day's log as the day view and the week read it (done, part, missed, skipped, the week's missed sessions,
// records while a set is typed), a set typed into the workout and completed, what each lift was asked for that day,
// and what Add exercise suggests: lifts left on the days before, added for the day only, and muscles low this week.
atWednesdayNoon();

describe("a day's log", () => {
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

  it("takes a day skipped on purpose as neither missed nor offered again, and keeps why", () => {
    const s = storeWith({ "2026-09-21": day({ skip: "travelling" }) }, "2026-09-20T06:00:00Z");
    expect(s.missedThisWeek("2026-09-24")).toEqual([1]); // Pull (Tue) only: Monday's Push was skipped
    expect(s.dayState("2026-09-21")).toBe("");
    expect(s.dayState("2026-09-22")).toBe("miss");
    expect(s.entry("2026-09-21").skip).toBe("travelling");
  });

  it("colours days like the calendar: done, part, missed, nothing before the account", () => {
    const s = storeWith({
      "2026-09-21": day({ exercises: { "Chest Press Machine": lift([[12, 40]]) } }),
      "2026-09-23": day({ exercises: Object.fromEntries(DEFAULT_PLAN.days[2].exercises.map((x) => [x.name, lift([[10, 20]])])) }),
    });
    expect(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-08-25"].map((k) => s.dayState(k))).toEqual(["part", "miss", "done", "", ""]);
  });

  it("doesn't count a day with only warm-up sets as trained: its session is still missed, and it isn't last time", () => {
    const warm: LiftLog = { done: false, kg: null, sets: [{ reps: 8, kg: 20, type: "warmup" }, { reps: 5, kg: 30, type: "warmup" }] };
    const s = storeWith({ "2026-09-14": day({ exercises: { "Chest Press Machine": lift([[12, 35]]) } }), "2026-09-21": day({ exercises: { "Chest Press Machine": warm } }) });
    expect(s.worked("2026-09-21")).toBe(false);
    expect(s.dayState("2026-09-21")).toBe("miss");
    expect(s.missedThisWeek("2026-09-24")).toEqual([0, 1]);
    expect(s.lastDone("Chest Press Machine", WED)?.day).toBe("2026-09-14");
    s.logs["2026-09-21"].exercises["Chest Press Machine"].sets!.push({ reps: 12, kg: 40 });
    expect([s.worked("2026-09-21"), s.dayState("2026-09-21")]).toEqual([true, "part"]);
    expect(s.missedThisWeek("2026-09-24")).toEqual([1]);
    expect(s.lastDone("Chest Press Machine", WED)?.day).toBe("2026-09-21");
  });

  it("marks a set as a record while it's typed, against earlier days only, numbering working sets as the card does", () => {
    const earlier = { [LAST]: day({ exercises: { "Leg Press": lift([[10, 45]]) } }) };
    const s = storeWith({ ...earlier, [WED]: day({ exercises: { "Leg Press": lift([[10, 50], [10, 45]]) } }) });
    expect([...s.recordsOn(WED)]).toEqual([["Leg Press|0", ["weight", "e1rm"]]]);
    // A heavier warm-up first is neither a record nor counted: the record is still working set 1.
    const warm = storeWith({ ...earlier, [WED]: day({ exercises: { "Leg Press": { done: false, kg: null, sets: [{ reps: 5, kg: 70, type: "warmup" }, { reps: 10, kg: 50 }] } } }) });
    expect([...warm.recordsOn(WED)]).toEqual([["Leg Press|0", ["weight", "e1rm"]]]);
  });
});

// The workout's set table as a phone types into it. Leg Press is 3 × 10–12 and done for the first time, so its boxes
// suggest 10 reps and no weight, as Dumbbell Curls' did in the report of 12 reps coming back as 10.
describe("a set typed in the workout", () => {
  /** A lift as the workout draws it now: each keystroke draws it again. `rests` hears each set that starts a rest. */
  const at = (s: GymStore, name = "Leg Press", rests: number[] = []) => {
    const items = s.liftsFor(WED), i = items.findIndex((it) => it.name === name);
    return liftModel(s, WED, items[i], i, s.entry(WED), (_, j) => rests.push(j));
  };
  /** A lift's sets as saved, [kg, reps] each. */
  const saved = (s: GymStore, name = "Leg Press") => setsOf(s.entry(WED).exercises[name]).map((x) => [x.kg, x.reps]);
  /** A phone on the workout: a tap puts the cursor in a box (out of the one it was in), and each key goes into the
   *  box's text, which is saved as it changes ("<" is backspace). The check and Complete set N take a tap without
   *  moving the cursor, as on the screen (keepCursor). */
  const phone = (s: GymStore, name = "Leg Press", rests: number[] = []) => {
    let box: { j: number; f: "kg" | "reps"; text: string } | null = null;
    const leave = () => {
      if (box) at(s, name).typeOut(box.j);
      box = null;
    };
    const afterTap = () => {
      if (!s.typing) box = null; // it completed a set, which closes the keyboard
    };
    return {
      tap(j: number, f: "kg" | "reps") {
        leave();
        const v = setsOf(s.entry(WED).exercises[name])[j]?.[f];
        box = { j, f, text: v == null ? "" : String(v) };
        at(s, name).typeIn(j);
      },
      keys(ks: string) {
        for (const k of ks) {
          box!.text = k === "<" ? box!.text.slice(0, -1) : box!.text + k;
          at(s, name, rests).setField(box!.j, box!.f, box!.text);
        }
      },
      leave,
      check(j: number) {
        checkSet(s, at(s, name, rests), j);
        afterTap();
      },
      /** Complete set N, at the bottom: the set the workout is on. */
      complete() {
        const m = at(s, name, rests);
        completeSet(s, m, nextSet(m));
        afterTap();
      },
    };
  };

  it("stays on the set being typed, and logs it as typed when it's completed: the 1 of 12 doesn't log it", () => {
    const s = storeWith(), rests: number[] = [], p = phone(s, "Leg Press", rests);
    expect(s.placeholders(at(s).x, null, 0, null)).toEqual(["10", "-"]);
    p.tap(0, "kg");
    p.keys("5");
    p.tap(0, "reps");
    p.keys("1");
    // Saved as it goes in, but not logged: its check would complete it, not undo it, and Complete set 1 is still set 1.
    expect([saved(s), logged(at(s), 0), nextSet(at(s))]).toEqual([[[5, 1]], false, 0]);
    p.keys("2");
    expect([logged(at(s), 0), nextSet(at(s))]).toEqual([false, 0]);
    p.complete();
    expect([saved(s), logged(at(s), 0), nextSet(at(s)), s.typing]).toEqual([[[5, 12]], true, 1, null]);
    expect(rests).toEqual([0]); // one rest, on the set's first reps: not again for the 2, or when it's completed
  });

  it("logs what's typed, in the plan's range or out of it, however it's typed and completed", () => {
    const cases: [string, (p: ReturnType<typeof phone>) => void, (number | null)[]][] = [
      ["kg, reps, then Complete set 1", (p) => (p.tap(0, "kg"), p.keys("5"), p.tap(0, "reps"), p.keys("12"), p.complete()), [5, 12]],
      ["reps, kg, then the set's check", (p) => (p.tap(0, "reps"), p.keys("12"), p.tap(0, "kg"), p.keys("5"), p.check(0)), [5, 12]],
      ["reps, then the check, no weight to suggest", (p) => (p.tap(0, "reps"), p.keys("12"), p.check(0)), [null, 12]],
      ["12 taken back to 1, then 15", (p) => (p.tap(0, "kg"), p.keys("5"), p.tap(0, "reps"), p.keys("12<5"), p.complete()), [5, 15]],
      ["under the range", (p) => (p.tap(0, "kg"), p.keys("5"), p.tap(0, "reps"), p.keys("8"), p.complete()), [5, 8]],
      ["over it", (p) => (p.tap(0, "kg"), p.keys("5"), p.tap(0, "reps"), p.keys("20"), p.check(0)), [5, 20]],
      ["a three-figure weight with a half", (p) => (p.tap(0, "kg"), p.keys("102.5"), p.tap(0, "reps"), p.keys("12"), p.complete()), [102.5, 12]],
      ["typed, and the cursor taken away", (p) => (p.tap(0, "kg"), p.keys("5"), p.tap(0, "reps"), p.keys("12"), p.leave()), [5, 12]],
    ];
    for (const [how, run, want] of cases) {
      const s = storeWith();
      run(phone(s));
      expect([saved(s), logged(at(s), 0), nextSet(at(s))], how).toEqual([[want], true, 1]);
    }
  });

  it("gives reps typed without a weight the weight Complete set N would: the set before's, or else the suggestion", () => {
    // Last Wednesday's 10 × 25 kg: the boxes suggest 10 at 25 kg (10 isn't the top of 10–12, so no more weight yet).
    const lastWeek = () => ({ [LAST]: day({ exercises: { "Leg Press": lift([[10, 25], [10, 25], [10, 25]]) } }) });
    const cases: [string, (p: ReturnType<typeof phone>) => void][] = [
      ["typed, then left", (p) => (p.tap(0, "reps"), p.keys("12"), p.leave())],
      ["typed, then Complete set 1", (p) => (p.tap(0, "reps"), p.keys("12"), p.complete())],
      ["typed, then the set's check", (p) => (p.tap(0, "reps"), p.keys("12"), p.check(0))],
      ["not typed: Complete set 1 as shown", (p) => (p.complete(), p.tap(0, "reps"), p.keys("<<12"), p.leave())],
    ];
    for (const [how, run] of cases) {
      const s = storeWith(lastWeek());
      expect(s.placeholders(at(s).x, at(s).last, 0, at(s).next), how).toEqual(["10", "25"]);
      run(phone(s));
      expect(saved(s), how).toEqual([[25, 12]]);
    }
    // A later set takes the weight just used; after a set logged with its weight cleared, the suggestion.
    const s = storeWith(lastWeek()), p = phone(s);
    p.tap(0, "kg");
    p.keys("30");
    p.tap(0, "reps");
    p.keys("10");
    p.tap(1, "reps");
    p.keys("10");
    expect(saved(s)).toEqual([[30, 10], [30, 10]]);
    p.tap(1, "kg");
    p.keys("<<");
    p.tap(2, "reps");
    p.keys("8");
    p.leave();
    expect(saved(s)).toEqual([[30, 10], [null, 10], [25, 8]]);
  });

  it("counts a typed set once the cursor leaves it: with only a weight, it's still the next, and Complete adds the suggested reps", () => {
    const s = storeWith(), p = phone(s);
    p.tap(0, "kg");
    p.keys("5");
    p.leave();
    expect([logged(at(s), 0), nextSet(at(s))]).toEqual([false, 0]);
    p.complete();
    expect(saved(s)).toEqual([[5, 10]]);
    // The next set, left alone: Complete logs the suggestion, at the weight just used.
    p.complete();
    expect([saved(s), nextSet(at(s))]).toEqual([[[5, 10], [5, 10]], 2]);
  });

  it("never lets a set's check clear what's typed in it: a logged set's check clears it, one being changed completes it", () => {
    const s = storeWith(), p = phone(s);
    p.tap(0, "kg");
    p.keys("5");
    p.complete();
    p.complete();
    expect([saved(s), nextSet(at(s))]).toEqual([[[5, 10], [5, 10]], 2]);
    p.check(0); // no cursor in it: Undo
    expect([saved(s), nextSet(at(s))]).toEqual([[[5, null], [5, 10]], 0]);
    p.complete();
    // Changing set 1 to 12: it's the set the workout is on while it's typed in, empty on the way or not.
    p.tap(0, "reps");
    p.keys("<<");
    expect([logged(at(s), 0), nextSet(at(s))]).toEqual([false, 0]);
    p.keys("12");
    expect([logged(at(s), 0), nextSet(at(s))]).toEqual([false, 0]);
    p.check(0);
    expect([saved(s), logged(at(s), 0), nextSet(at(s))]).toEqual([[[5, 12], [5, 10]], true, 2]);
  });

  it("stays on the last set while it's typed, though its reps tick the lift off", () => {
    const s = storeWith(), p = phone(s);
    p.tap(0, "kg");
    p.keys("5");
    p.complete();
    p.complete();
    p.tap(2, "reps");
    p.keys("1");
    // Done by its sets, but Complete set 3 stays: the big button isn't Next exercise under the thumb.
    expect([s.entry(WED).exercises["Leg Press"].done, nextSet(at(s))]).toEqual([true, 2]);
    p.keys("1");
    p.complete();
    expect([saved(s), nextSet(at(s))]).toEqual([[[5, 10], [5, 10], [5, 11]], -1]);
  });

  it("in a superset, stays on the lift and round typed in until it's completed", () => {
    const s = storeWith();
    s.plan.days[wdIndex(WED)].exercises[3].superset = true; // Hamstring Curl joins Leg Extension: A1 and A2
    const next = () => {
      const items = s.liftsFor(WED), lifts = ["Leg Extension", "Hamstring Curl"].map((n) => ({ item: items.find((it) => it.name === n)!, i: items.findIndex((it) => it.name === n) }));
      return nextInRounds(supersetModels(s, WED, lifts, s.entry(WED)));
    };
    const p = phone(s, "Leg Extension");
    p.tap(0, "reps");
    p.keys("1");
    expect(next()).toEqual([0, 0]); // A1 · set 1, not A2's yet
    p.keys("2");
    p.leave();
    expect(next()).toEqual([1, 0]);
    phone(s, "Hamstring Curl").tap(1, "kg"); // straight to A2's second set
    expect(next()).toEqual([1, 1]);
  });

  it("shows in the box being typed in a change that isn't its own typing, as a set said by voice, never its own redone", () => {
    // [how, [saved now, saved at the last render, the box's text, has the cursor, typed since that render], takes it]
    const cases: [string, Parameters<typeof takesSaved>, boolean][] = [
      ["no cursor: a set filled in shows", ["45", "", "", false, false], true],
      ["no cursor: its own 5. shows as saved once the cursor leaves", ["5", "5", "5.", false, false], true],
      ["no cursor, showing it already", ["45", "", "45", false, false], false],
      ["5. typed: saved as 5, unchanged since, it stays 5.", ["5", "5", "5.", true, false], false],
      ["5. taken back to 5: its own change", ["5", "", "5", true, true], false],
      ["52.3 typed, saved to the half kilo: its own, it stays", ["52.5", "52", "52.3", true, true], false],
      ["42.5 said by voice while 5. is typed: it shows", ["42.5", "5", "5.", true, false], true],
      ["undone by voice while 1 is typed: it clears", ["", "1", "1", true, false], true],
      ["said by voice as what's typed: nothing to write", ["5", "", "5", true, false], false],
    ];
    for (const [how, args, want] of cases) expect(takesSaved(...args), how).toBe(want);
  });

  it("is on the set typed in, past one still to do; keeps it to its own lift; a row that goes takes only its own set out", () => {
    const s = storeWith();
    at(s).typeIn(1);
    expect([nextSet(at(s)), at(s).typing, at(s, "Hack Squat").typing]).toEqual([1, 1, null]);
    at(s).typeOut(0); // another row going, with the cursor still in set 2
    expect(at(s).typing).toBe(1);
    at(s).typeOut(1);
    expect([at(s).typing, s.typing]).toEqual([null, null]);
  });
});

describe("what a lift was asked for", () => {
  it("stamps a lift's first entry with the plan's sets and reps, and keeps them once the plan changes", () => {
    const s = storeWith({});
    s.editLift("2026-09-23", "Hamstring Curl", (r) => void (r.sets = [{ reps: 10, kg: 30 }]), false);
    expect(s.logs["2026-09-23"].exercises["Hamstring Curl"].target).toEqual({ sets: "3", reps: "10-12" });
    s.plan = { ...s.plan, days: s.plan.days.map((d, i) => (i === 2 ? { ...d, exercises: d.exercises.map((x) => (x.name === "Hamstring Curl" ? { ...x, sets: "4", reps: "12-15" } : x)) } : d)) };
    // Already stamped: logging more sets that day doesn't restamp it against the plan's new numbers.
    s.editLift("2026-09-23", "Hamstring Curl", (r) => void r.sets!.push({ reps: 10, kg: 30 }), false);
    expect(s.logs["2026-09-23"].exercises["Hamstring Curl"].target).toEqual({ sets: "3", reps: "10-12" });
  });

  it("gives no stored target to a lift logged that isn't on that day's plan (an extra)", () => {
    const s = storeWith({});
    s.editLift("2026-09-23", "Face Pulls", (r) => void (r.sets = [{ reps: 15, kg: 10 }]), false);
    expect(s.logs["2026-09-23"].exercises["Face Pulls"].target).toBeUndefined();
  });

  it("prints a range of sets with an en dash, as a range of reps has: 3–4 × 8–10, not 3-4 × 8–10", () => {
    expect([targetWords({ sets: "3-4", reps: "8-10" }), targetWords({ sets: "2 - 3", reps: "10-12" }), targetWords({ sets: "3", reps: "12" })]).toEqual(["3–4 × 8–10", "2–3 × 10–12", "3 × 12"]);
    // Train's row, and the lift's sheet, which shows the same line.
    const s = storeWith();
    expect(liftLine(s, WED, s.liftsFor(WED)[0])).toBe("3–4 × 8–10");
  });

  it("targetOf falls back to today's plan when a lift has no stored target, and otherwise reads its own", () => {
    const x = { name: "Hamstring Curl", sets: "3", reps: "10-12", cue: "", flag: "", step: "", knee: false };
    expect(targetOf(undefined, x)).toEqual({ sets: "3", reps: "10-12" });
    expect(targetOf({ done: true, kg: 30 }, x)).toEqual({ sets: "3", reps: "10-12" });
    expect(targetOf({ done: true, kg: 30, target: { sets: "4", reps: "8-10" } }, x)).toEqual({ sets: "4", reps: "8-10" });
  });

  it("checks the go-up rule against what a session was actually asked for, not a later plan change", () => {
    const s = storeWith({
      "2026-09-16": day({ exercises: { "Hamstring Curl": { ...lift([[12, 30], [12, 30], [12, 30]]), target: { sets: "3", reps: "10-12" } } } }),
    });
    const x = () => s.plan.days[2].exercises.find((e) => e.name === "Hamstring Curl")!;
    expect(s.nextWeight(x(), "Hamstring Curl", "2026-09-23")).toMatchObject({ from: 30, to: 32.5 });
    // The plan now asks for more reps than that session gave. Without its own stored target this would no
    // longer look complete; with it, the session still reads as having met what it was actually asked.
    s.plan = { ...s.plan, days: s.plan.days.map((d, i) => (i === 2 ? { ...d, exercises: d.exercises.map((e) => (e.name === "Hamstring Curl" ? { ...e, reps: "14-16" } : e)) } : d)) };
    expect(s.nextWeight(x(), "Hamstring Curl", "2026-09-23")).toMatchObject({ from: 30, to: 32.5 });
  });
});

// Add exercise on a day (Suggested.tsx, lib/suggest.ts): the lifts left on the days just before it. The default plan:
// Push on Mondays, Pull on Tuesdays, Legs today (Wednesday 23), Upper on Fridays.
const MON = "2026-09-21", TUE = "2026-09-22", THU = "2026-09-24", FRI = "2026-09-25";
const PULL = ["Lat Pulldown", "Chest-Supported Row", "Seated Row", "Rear Delt Fly", "Dumbbell Curls", "Cable Curls"];
/** A day with these of its lifts done, 3 sets of 10 at 20 kg each, and any others as given. */
const worked = (done: string[], more: Record<string, LiftLog> = {}) => day({ exercises: { ...Object.fromEntries(done.map((n) => [n, lift([[10, 20], [10, 20], [10, 20]])])), ...more } });
const names = (xs: { name: string }[]) => xs.map((x) => x.name);

describe("lifts left on the days before, for Add exercise", () => {
  it("offers what was left on the last day trained, in its plan's order, with what it was planned with and last time's top set", () => {
    const s = storeWith({
      // Last Tuesday, over a week ago: last time's sets only.
      "2026-09-15": day({ exercises: { "Lat Pulldown": lift([[8, 45], [8, 50], [6, 50]]), "Rear Delt Fly": lift([[12, 20], [15, 17.5]]) } }),
      [TUE]: worked(["Chest-Supported Row", "Dumbbell Curls"]),
    });
    const m = missedLifts(s, WED);
    expect(m.map((x) => [x.name, x.day, x.target, x.top])).toEqual([
      ["Lat Pulldown", TUE, { sets: "3-4", reps: "8-10" }, { kg: 50, reps: 8 }],
      ["Seated Row", TUE, { sets: "3", reps: "10-12" }, null],
      ["Rear Delt Fly", TUE, { sets: "3", reps: "12-15" }, { kg: 20, reps: 12 }],
      ["Cable Curls", TUE, { sets: "2-3", reps: "10-12" }, null],
    ]);
    expect(missedTitle(m)).toBe("Missed on Tuesday");
    // Ranges with an en dash, and each part kept whole on a line.
    expect(m.map(missedLine).map((l) => l.replace(/\u00a0/g, " "))).toEqual(["3–4 × 8–10 · last 50 kg × 8", "3 × 10–12", "3 × 12–15 · last 20 kg × 12", "2–3 × 10–12"]);
    expect(missedLine(m[0])).toBe("3–4\u00a0×\u00a08–10 · last\u00a050\u00a0kg\u00a0×\u00a08");
  });

  it("counts a lift skipped on purpose, or with only warm-ups, as left, and one with a set in, ticked, or swapped and done as done", () => {
    const s = storeWith({
      [TUE]: worked(["Dumbbell Curls"], {
        "Lat Pulldown": { done: false, kg: 40, sets: [{ reps: 10, kg: 40 }], skipped: true, reason: "machine broke" }, // a set in, then skipped
        "Chest-Supported Row": { done: false, kg: 20, sets: [{ reps: 10, kg: 20, type: "warmup" }] },
        "Seated Row": lift([[10, 40]], { done: false }),
        "Rear Delt Fly": { done: true, kg: null },
        "Cable Curls": lift([[10, 15]], { swap: "Hammer Curls" }),
      }),
    });
    expect(names(missedLifts(s, WED))).toEqual(["Lat Pulldown", "Chest-Supported Row"]);
  });

  it("leaves out a lift done on a later day, as planned or swapped in for another", () => {
    const s = storeWith({
      [MON]: worked(["Incline Machine Press"]),
      // Monday's Chest Press Machine done on Tuesday, and its Machine Shoulder Press in place of Seated Row.
      [TUE]: worked(["Chest-Supported Row", "Dumbbell Curls"], { "Chest Press Machine": lift([[10, 40]]), "Seated Row": lift([[10, 30]], { swap: "Machine Shoulder Press" }) }),
    });
    expect(missedLifts(s, WED).map((x) => [x.name, x.day])).toEqual([
      ["Lat Pulldown", TUE],
      ["Rear Delt Fly", TUE],
      ["Cable Curls", TUE],
      ["DB Lateral Raises", MON],
      ["Cable Triceps Pushdown", MON],
      ["Overhead Rope Extension", MON],
    ]);
  });

  it("leaves out a lift the selected day has already: planned, added for it, or swapped in there", () => {
    const s = storeWith({ [TUE]: worked(["Chest-Supported Row", "Dumbbell Curls"]) });
    expect(names(missedLifts(s, FRI))).toEqual(["Lat Pulldown", "Rear Delt Fly", "Cable Curls"]); // Seated Row is Friday's too
    s.addExtraLift(FRI, "Rear Delt Fly", { sets: "3", reps: "12-15" });
    s.logs[FRI].exercises["Cable Bicep Curls"] = { done: false, kg: null, swap: "Cable Curls" };
    expect(names(missedLifts(s, FRI))).toEqual(["Lat Pulldown"]);
  });

  it("counts only a day whose planned session was trained: not one skipped as a whole, never started, free-form, or today's before it's over", () => {
    const warmOnly = { "Lat Pulldown": { done: false, kg: 20, sets: [{ reps: 10, kg: 20, type: "warmup" as const }] } };
    const s = storeWith({
      [MON]: { ...worked(["Incline Machine Press"]), skip: "" }, // skipped as a whole, a set in from the watch or not
      [TUE]: day({ exercises: warmOnly }), // warm-ups alone: never started
      [WED]: worked(["Hack Squat"]),
    });
    expect(missedLifts(s, THU)).toEqual([]);
    s.logs[MON] = { ...worked(["Goblet Squat"]), free: { name: "Hotel gym", lifts: ["Goblet Squat", "Lunge"] } };
    expect(missedLifts(s, THU)).toEqual([]);
    // Tomorrow, today's is over: what's left of Legs is offered on Friday.
    expect(names(missedLifts(s, FRI, THU))).toEqual(LEGS.slice(1));
  });

  it("looks back a week from the selected day, no further", () => {
    const s = storeWith({ "2026-09-15": worked(["Dumbbell Curls"]) });
    const left = PULL.filter((n) => n !== "Dumbbell Curls");
    expect(names(missedLifts(s, MON))).toEqual(left); // six days on
    s.logs[TUE] = day({ session: 4 }); // Tuesday switched to Upper: a week on, to the day
    expect(names(missedLifts(s, TUE))).toEqual(left.filter((n) => n !== "Seated Row"));
    expect(missedLifts(s, WED)).toEqual([]); // eight days on
  });

  it("puts the latest day first, offers a lift left on two days once, from the later, and at most six", () => {
    // Friday 18's Upper and Tuesday's Pull both left Seated Row.
    const s = storeWith({ "2026-09-18": worked(["Flat DB Press"]), [TUE]: worked(PULL.filter((n) => n !== "Seated Row")) });
    const m = missedLifts(s, WED);
    expect(m.map((x) => [x.name, x.day])).toEqual([
      ["Seated Row", TUE],
      ["Cable Chest Fly", "2026-09-18"],
      ["Lat Pulldown (Neutral Grip)", "2026-09-18"],
      ["Cable Bicep Curls", "2026-09-18"],
      ["Cable Rope Pushdown", "2026-09-18"],
    ]);
    expect(missedTitle(m)).toBe("Missed this week");
    const many = storeWith({ [MON]: worked(["Incline Machine Press"]), [TUE]: worked(["Chest-Supported Row", "Dumbbell Curls"]) });
    expect(missedLifts(many, WED).map((x) => [x.name, x.day])).toEqual([
      ["Lat Pulldown", TUE],
      ["Seated Row", TUE],
      ["Rear Delt Fly", TUE],
      ["Cable Curls", TUE],
      ["Chest Press Machine", MON],
      ["Machine Shoulder Press", MON],
    ]);
  });
});

describe("a lift added for the day only", () => {
  it("shows after the day's planned lifts before anything's logged, as the plan's lift of its name asking what it was added with, and the plan stays as it was", () => {
    const s = storeWith(), plan = JSON.stringify(s.plan);
    expect(s.addExtraLift(WED, "Rear Delt Fly", { sets: "2", reps: "10-12" })).toBe(true);
    expect(s.logs[WED].exercises["Rear Delt Fly"]).toEqual({ done: false, kg: null, target: { sets: "2", reps: "10-12" }, added: true });
    const it = s.liftsFor(WED)[5];
    expect(names(s.liftsFor(WED))).toEqual([...LEGS, "Rear Delt Fly"]);
    expect([it.extra, it.added, it.x.sets, it.x.reps, it.x.lib]).toEqual([false, true, "2", "10-12", "Reverse_Machine_Flyes"]);
    expect(liftLine(s, WED, it)).toBe("2 × 10–12");
    // One of the day's lifts: counted in its session, and its Review waits for it.
    expect(sessionSummary(s, WED).lifts).toBe(6);
    expect(JSON.stringify(s.plan)).toBe(plan);
    expect(s.liftsFor(TUE).some((x) => x.name === "Rear Delt Fly" && x.added)).toBe(false);
  });

  it("logs like a planned lift: last time's numbers and the next weight, and its sets tick it off", () => {
    const s = storeWith({ "2026-09-15": day({ exercises: { "Rear Delt Fly": lift([[15, 20], [15, 20], [15, 20]]) } }) });
    s.addExtraLift(WED, "Rear Delt Fly", { sets: "3", reps: "12-15" });
    const model = () => {
      const items = s.liftsFor(WED);
      return liftModel(s, WED, items[5], 5, s.entry(WED), () => {});
    };
    expect([model().min, model().rows, model().last?.day, model().next?.to]).toEqual([3, 3, "2026-09-15", 22.5]);
    expect(s.placeholders(model().x, model().last, 0, model().next)).toEqual(["12", "22.5"]);
    completeSet(s, model(), 0);
    completeSet(s, model(), 1);
    expect(s.entry(WED).exercises["Rear Delt Fly"].done).toBe(false);
    completeSet(s, model(), 2);
    expect(s.entry(WED).exercises["Rear Delt Fly"]).toMatchObject({ done: true, added: true, target: { sets: "3", reps: "12-15" } });
    expect(setsOf(s.entry(WED).exercises["Rear Delt Fly"])).toEqual([{ reps: 12, kg: 22.5 }, { reps: 12, kg: 22.5 }, { reps: 12, kg: 22.5 }]);
  });

  it("isn't added twice, nor over one of the day's, and comes out again with its sets and its place in the day's order", () => {
    const s = storeWith(), t = { sets: "3", reps: "12-15" };
    expect([s.addExtraLift(WED, "Rear Delt Fly", t), s.addExtraLift(WED, "Rear Delt Fly", t), s.addExtraLift(WED, "Leg Press", t)]).toEqual([true, false, false]);
    s.editLift(WED, "Rear Delt Fly", (r) => void (r.sets = [{ reps: 12, kg: 20 }]), true);
    s.moveBlock(WED, 5, -1);
    expect(s.logs[WED].order).toEqual(["Hack Squat", "Leg Press", "Leg Extension", "Hamstring Curl", "Rear Delt Fly", "Calf Raise"]);
    s.removeExtraLift(WED, "Rear Delt Fly");
    expect([names(s.liftsFor(WED)), "Rear Delt Fly" in s.logs[WED].exercises, s.logs[WED].order?.includes("Rear Delt Fly")]).toEqual([LEGS, false, false]);
  });
});

// Add exercise's "Low this week": the default plan from today, Wednesday, plans Legs, Upper on Friday and Shoulders +
// Legs on Saturday, so lats and middle back have 4.5 sets to come, and biceps, chest, glutes and triceps 6.
describe("muscles low this week, for Add exercise", () => {
  const sets = (s: GymStore) => Object.fromEntries(weekMuscles(s, WED).map((m) => [m.muscle, [m.done, m.planned]]));

  it("counts the week so far and what the rest of it still plans, so a muscle trained later in the week isn't short yet", () => {
    const s = storeWith();
    expect(weekMuscles(s, WED)).toEqual([
      { muscle: "lats", done: 0, planned: 4.5 },
      { muscle: "middle back", done: 0, planned: 4.5 },
      { muscle: "biceps", done: 0, planned: 6 },
      { muscle: "chest", done: 0, planned: 6 },
      { muscle: "glutes", done: 0, planned: 6 },
      { muscle: "triceps", done: 0, planned: 6 },
      { muscle: "calves", done: 0, planned: 7.5 },
      { muscle: "hamstrings", done: 0, planned: 10.5 },
      { muscle: "quadriceps", done: 0, planned: 12 },
      { muscle: "shoulders", done: 0, planned: 12 },
    ]);
    expect(lowMuscles(s, WED).map((m) => [m.muscle, m.done, m.planned])).toEqual([
      ["lats", 0, 4.5],
      ["middle back", 0, 4.5],
      ["biceps", 0, 6],
    ]);
    // Monday's chest and Tuesday's lats count so far; today's Hack Squat, 2 of its 3 sets in, counts once, as sets done
    // and one to come.
    const week = storeWith({
      [MON]: worked(["Incline Machine Press", "Chest Press Machine"]),
      [TUE]: day({ exercises: { "Lat Pulldown": lift([[10, 40], [10, 40], [10, 40], [10, 40]]) } }),
      [WED]: day({ exercises: { "Hack Squat": lift([[10, 40], [10, 40]], { done: false }) } }),
    });
    expect(sets(week)).toMatchObject({ chest: [6, 6], lats: [4, 4.5], quadriceps: [2, 10], glutes: [1, 5] });
    // Chest and lats are no longer short: glutes (6 in all), middle back (6.5) and calves (7.5) are.
    expect(lowMuscles(week, WED).map((m) => m.muscle)).toEqual(["glutes", "middle back", "calves"]);
  });

  it("leaves out a muscle with about 10 sets, done and planned", () => {
    const s = storeWith();
    for (const d of s.plan.days) for (const x of d.exercises) x.sets = "5"; // lats and middle back 7.5, biceps 10
    expect(lowMuscles(s, WED).map((m) => [m.muscle, m.done + m.planned])).toEqual([
      ["lats", 7.5],
      ["middle back", 7.5],
    ]);
  });

  it("stops counting a lift's sets to come once it's done by hand or skipped, and a day skipped as a whole plans none", () => {
    const s = storeWith({
      [WED]: day({ exercises: { "Calf Raise": { done: false, kg: null, skipped: true }, "Leg Press": { done: true, kg: null } } }),
      [FRI]: day({ skip: "travelling" }),
    });
    expect(sets(s)).toMatchObject({ calves: [0, 3], chest: [0, 0], lats: [0, 0], quadriceps: [0, 9] });
  });

  it("counts a lift added for a day, and a swap as what it was swapped for", () => {
    const s = storeWith({ [FRI]: day({ exercises: { "Cable Chest Fly": { done: false, kg: null, swap: "Barbell Curl" } } }) });
    s.addExtraLift(WED, "Cable Curls", { sets: "3", reps: "10-12" });
    expect(sets(s)).toMatchObject({ biceps: [0, 12], chest: [0, 3] });
  });

  it("only names muscles the plan trains: a main muscle of one of its lifts", () => {
    const s = storeWith({ [MON]: day({ exercises: { Crunches: lift([[20, 0], [20, 0]]) } }) });
    expect(weekMuscles(s, WED).map((m) => m.muscle).sort()).toEqual(["biceps", "calves", "chest", "glutes", "hamstrings", "lats", "middle back", "quadriceps", "shoulders", "triceps"]);
    s.plan.days[0].exercises.push({ name: "Crunches", sets: "3", reps: "20", cue: "", flag: "", step: "", knee: false }); // on Mondays
    expect(weekMuscles(s, WED).find((m) => m.muscle === "abdominals")).toEqual({ muscle: "abdominals", done: 2, planned: 0 });
    expect(lowMuscles(s, WED)[0].muscle).toBe("abdominals");
  });

  it("shows nothing until the account has a full week behind it, as Progress judges its muscles", () => {
    expect(lowMuscles(storeWith({}, "2026-09-15T05:00:00Z"), WED)).toEqual([]);
    expect(lowMuscles(storeWith({}, "2026-09-14T05:00:00Z"), WED).length).toBe(3);
  });

  it("offers two lifts for each that My gym can do, those done before first, by the name they were done under", () => {
    const s = storeWith({ "2026-09-15": worked(["Chest-Supported Row", "Dumbbell Curls"]) });
    const lifts = (sel = WED, except: string[] = []) => Object.fromEntries(lowMuscles(s, sel, WED, except).map((m) => [m.muscle, m.lifts.map((x) => `${x.name} (${x.id})`)]));
    expect(lifts()).toEqual({
      lats: ["Pullups (Pullups)", "Chin-Up (Chin-Up)"],
      "middle back": ["Chest-Supported Row (Lying_T-Bar_Row)", "Bent Over Barbell Row (Bent_Over_Barbell_Row)"],
      biceps: ["Dumbbell Curls (Dumbbell_Bicep_Curl)", "Barbell Curl (Barbell_Curl)"],
    });
    // The common lifts, as the library puts them first, when nothing's been done.
    const common = searchLibrary(s.library(), { muscle: "lats" }).slice(0, 2).map((x) => x.id);
    expect(common).toEqual(["Pullups", "Chin-Up"]);
    // No pull-up bar: pulldowns, the plan's by the plan's name.
    s.plan.gym = { off: ["pullupbar"], always: [], never: [] };
    expect(lifts().lats).toEqual(["Lat Pulldown (Wide-Grip_Lat_Pulldown)", "Straight-Arm Pulldown (Straight-Arm_Pulldown)"]);
    // Not a lift the day has (Tuesday's Chest-Supported Row), nor one of the lifts left, offered already.
    expect(lifts(TUE)["middle back"]).toEqual(["Bent Over Barbell Row (Bent_Over_Barbell_Row)", "One-Arm Dumbbell Row (One-Arm_Dumbbell_Row)"]);
    expect(lifts(WED, ["Lat Pulldown", "Chest-Supported Row"])).toMatchObject({ lats: ["Straight-Arm Pulldown (Straight-Arm_Pulldown)", expect.any(String)], "middle back": ["Bent Over Barbell Row (Bent_Over_Barbell_Row)", "Seated Row (Seated_Cable_Rows)"] });
  });

  it("offers a lift once, for the first muscle it works, and passes over a muscle with nothing My gym can do for it", () => {
    // A lift of your own for lats and biceps, done before: first for lats, and not offered again for biceps.
    const s = storeWith({ "2026-09-15": worked(["Backyard Rope Pull"]) });
    expect(s.saveCustom({ name: "Backyard Rope Pull", equip: [], primary: ["lats", "biceps"], secondary: [] })).toBe("");
    const low = lowMuscles(s, WED);
    expect(low.map((m) => [m.muscle, m.lifts.map((x) => x.name)])).toEqual([
      ["lats", ["Backyard Rope Pull", "Pullups"]],
      ["middle back", ["Bent Over Barbell Row", "Seated Row"]],
      ["biceps", ["Barbell Curl", "Dumbbell Curls"]],
    ]);
    s.plan.gym = { off: [], always: [], never: s.library().filter((x) => x.primary.includes("lats")).map((x) => x.id) };
    expect(lowMuscles(s, WED).map((m) => m.muscle)).toEqual(["middle back", "biceps", "chest"]);
  });
});
