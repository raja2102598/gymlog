import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN } from "@/lib/plan";
import { setsOf, targetOf } from "@/lib/store";
import type { LiftLog } from "@/lib/types";
import { atWednesdayNoon, day, LAST, lift, storeWith, WED } from "./helpers";

// Train: a day's log as the day view and the week read it (done, part, missed, skipped, the week's missed sessions,
// records while a set is typed), and what each lift was asked for that day.
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
