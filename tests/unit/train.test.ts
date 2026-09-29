import { describe, expect, it } from "vitest";
import { checkSet, completeSet, liftModel, logged, nextSet } from "@/components/today/LiftItem";
import { nextInRounds, supersetModels } from "@/components/today/SupersetItem";
import { wdIndex } from "@/lib/dates";
import { DEFAULT_PLAN } from "@/lib/plan";
import { setsOf, targetOf, type GymStore } from "@/lib/store";
import type { LiftLog } from "@/lib/types";
import { atWednesdayNoon, day, LAST, lift, storeWith, WED } from "./helpers";

// Train: a day's log as the day view and the week read it (done, part, missed, skipped, the week's missed sessions,
// records while a set is typed), a set typed into the workout and completed, and what each lift was asked for that
// day.
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
