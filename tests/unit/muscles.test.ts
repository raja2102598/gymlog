import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { musclesModel } from "@/lib/dashboard";
import { muscleSetCount, muscleWeeks } from "@/lib/stats";
import { GymStore } from "@/lib/store";
import type { DayLog, LiftLog, SetLog } from "@/lib/types";

// Weekly sets per muscle (RAJ-56). Wednesday 23 September 2026, as in the end-to-end tests: the four weeks start on
// Mondays 31 August, 7, 14 and 21 September.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-23T12:00:00"));
});
afterEach(() => vi.useRealTimers());

const WED = "2026-09-23", WEEKS = ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"];
const day = (exercises: Record<string, LiftLog>): DayLog => ({ exercises, warmup: [], cardio: false, steps: null, weight: null, note: "" });
/** `n` working sets of 10 at 40 kg, then any others. */
const lift = (n: number, more: SetLog[] = [], x: Partial<LiftLog> = {}): LiftLog => ({ done: true, kg: 40, sets: [...Array.from({ length: n }, () => ({ reps: 10, kg: 40 })), ...more], ...x });
const WARM: SetLog = { reps: 8, kg: 20, type: "warmup" }, DROP: SetLog = { reps: 12, kg: 30, type: "drop" };
function storeWith(logs: Record<string, DayLog>, created = "2026-08-26T05:00:00Z") {
  const s = new GymStore();
  s.logs = logs;
  s.user = { id: "u", created_at: created } as GymStore["user"];
  return s;
}

describe("counting", () => {
  it("counts sets done, leaving out warm-ups, drop sets and sets with no reps", () => {
    expect(muscleSetCount([WARM, { reps: 10, kg: 40 }, { reps: 8, kg: 40, type: "failure" }, DROP, { reps: null, kg: 40 }, { reps: 0, kg: 40 }])).toBe(2);
  });

  it("gives a lift's main muscles a set each and its others a half, week by week", () => {
    const tags: Record<string, { primary: string[]; secondary: string[] }> = { Press: { primary: ["chest"], secondary: ["shoulders", "triceps"] }, Curl: { primary: ["biceps"], secondary: [] } };
    const w = muscleWeeks(
      [
        { day: "2026-08-30", lifts: [{ name: "Press", sets: [{ reps: 10, kg: 40 }] }] }, // the Sunday before: not counted
        { day: "2026-09-01", lifts: [{ name: "Press", sets: [{ reps: 10, kg: 40 }, { reps: 10, kg: 40 }, WARM] }] },
        { day: "2026-09-20", lifts: [{ name: "Curl", sets: [{ reps: 10, kg: 12 }] }, { name: "Wobble", sets: [{ reps: 10, kg: 5 }] }] },
        { day: "2026-09-21", lifts: [{ name: "Press", sets: [{ reps: 10, kg: 40 }] }, { name: "Curl", sets: [WARM] }] },
      ],
      WEEKS,
      (name) => tags[name] ?? null,
    );
    expect(Object.fromEntries(w.muscles)).toEqual({ chest: [2, 0, 0, 1], shoulders: [1, 0, 0, 0.5], triceps: [1, 0, 0, 0.5], biceps: [0, 0, 1, 0] });
    expect([...w.main]).toEqual(["chest", "biceps"]);
    expect(Object.fromEntries(w.untagged)).toEqual({ Wobble: [0, 0, 1, 0] });
  });
});

describe("on Progress", () => {
  // Last week: Leg Extension (quads) with a warm-up and a drop set, Leg Press (quads; calves, glutes and hamstrings
  // too), Hamstring Curl (hamstrings), a heavy week of Dumbbell Bench Press (chest; shoulders and triceps too), and
  // a lift the library doesn't know. The week before, Leg Extension swapped for Hack Squat; before the four
  // weeks, one that isn't counted.
  const logs = {
    "2026-08-24": day({ "Leg Extension": lift(5) }),
    "2026-09-09": day({ "Leg Extension": lift(2, [], { swap: "Hack Squat" }) }),
    "2026-09-16": day({ "Leg Extension": lift(3, [WARM, DROP]), "Leg Press": lift(3), "Hamstring Curl": lift(4), "Dumbbell Bench Press": lift(21), "Mystery Press": lift(2) }),
    [WED]: day({ "Leg Extension": lift(2) }),
  };

  it("counts each muscle in each of the last four weeks, most first, a swap as the lift done", () => {
    const m = musclesModel(storeWith(logs), WED);
    expect(m.weeks).toEqual(WEEKS);
    expect(m.rows.map((r) => [r.muscle, r.sets])).toEqual([
      ["chest", [0, 0, 21, 0]],
      ["shoulders", [0, 0, 10.5, 0]],
      ["triceps", [0, 0, 10.5, 0]],
      ["quadriceps", [0, 2, 6, 2]],
      ["hamstrings", [0, 1, 5.5, 0]],
      ["calves", [0, 1, 1.5, 0]],
      ["glutes", [0, 1, 1.5, 0]],
    ]);
  });

  it("notes last week under 10 sets for a muscle trained on purpose, and over 20 for any", () => {
    const notes = Object.fromEntries(musclesModel(storeWith(logs), WED).rows.map((r) => [r.muscle, r.note]));
    expect(notes).toEqual({ chest: "over", shoulders: null, triceps: null, quadriceps: "under", hamstrings: "under", calves: null, glutes: null });
    // An account younger than last week isn't judged on it.
    expect(musclesModel(storeWith({ [WED]: day({ "Leg Extension": lift(2) }) }, "2026-09-20T05:00:00Z"), WED).rows[0].note).toBeNull();
  });

  it("lists untagged lifts apart rather than guess: one the library doesn't know, and one of your own with no muscles", () => {
    const s = storeWith({ ...logs, [WED]: day({ "Odd Lift": lift(3), "Cable Thing": lift(2) }) });
    s.keepOwn("Odd Lift");
    s.saveCustom({ name: "Cable Thing", equip: ["cable"], primary: ["lats"], secondary: [] });
    const m = musclesModel(s, WED);
    expect(m.untagged).toEqual([
      { name: "Odd Lift", sets: 3 },
      { name: "Mystery Press", sets: 2 },
    ]);
    expect(m.rows.find((r) => r.muscle === "lats")?.sets).toEqual([0, 0, 0, 2]); // your own, with its muscles
  });

  it("has nothing to show before a session is logged", () => {
    expect(musclesModel(storeWith({}), WED)).toEqual({ weeks: WEEKS, rows: [], untagged: [] });
  });
});
