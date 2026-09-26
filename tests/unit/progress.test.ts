import { describe, expect, it } from "vitest";
import { kneeModel, liftModel, musclesModel, strengthModel, weightModel } from "@/lib/dashboard";
import { DEFAULT_PLAN } from "@/lib/plan";
import { muscleSetCount, muscleWeeks } from "@/lib/stats";
import type { DayLog, LiftLog, PlanExercise, SetLog } from "@/lib/types";
import { GymStore } from "@/lib/store";
import { atWednesdayNoon, day, LAST, lift, storeWith, WED } from "./helpers";

// Progress (lib/dashboard.ts): the weight card, Strength (lifts ready for more weight, held, or due a deload), the
// sets each muscle got week by week, and a lift's own page.
atWednesdayNoon();

/** Last week's working sets fell short of 10-12 at 50 kg. */
const SHORT: [number, number][] = [[10, 50], [8, 50], [7, 50]];
/** Legs' Hamstring Curl, with these settings. */
const curl = (s: GymStore, x: Partial<PlanExercise> = {}) => Object.assign(s.plan.days[2].exercises[3], x);

describe("Weight", () => {
  // Daily weigh-ins from 26 Aug to today, changing by `perDay` kg.
  const series = (perDay: number, upTo = 28) => {
    const logs: Record<string, DayLog> = {};
    for (let n = 0; n <= upTo; n++) logs[new Date(Date.UTC(2026, 7, 26 + n)).toISOString().slice(0, 10)] = day({ weight: Math.round((84 + perDay * n) * 10) / 10 });
    return logs;
  };
  const pace = (perDay: number, target: number | null) => {
    const s = storeWith(series(perDay));
    s.plan = { ...s.plan, weeklyRatePct: target };
    return weightModel(s, "2026-09-23").flags.map((f) => f.text);
  };

  it("flags the pace against the weekly target", () => {
    expect(pace(-0.1, 0.7)).toEqual([]);
    expect(pace(-0.1, 2)[0]).toMatch(/^Losing 0\.\d\d% a week, well under your 2% target\.$/);
    expect(pace(-0.1, 0.4)[0]).toMatch(/^Losing 0\.\d\d% a week, faster than your 0\.4% target\.$/);
    expect(pace(0.05, 0.7)[0]).toMatch(/^The trend isn’t going down yet \(\+0\.\d\d% a week\) against your 0\.7% target\.$/);
    expect(pace(-0.1, null)).toEqual([]);
  });

  it("flags a gap in weigh-ins, and works out a goal date", () => {
    const s = storeWith(series(-0.1, 22));
    s.plan = { ...s.plan, goalWeight: 78 };
    const m = weightModel(s, "2026-09-23");
    expect(m.flags.map((f) => f.text)).toContain("No weigh-in for 6 days. A few weigh-ins a week keep the trend honest.");
    expect(m.goal).toMatchObject({ kind: "date", goal: 78 });
  });

  it("gives the latest waist reading and its change from four weeks back", () => {
    const s = storeWith(series(-0.05, 28));
    s.logs["2026-08-26"].waist = 96;
    s.logs["2026-09-23"].waist = 93.5;
    expect(weightModel(s, "2026-09-23").waist).toEqual({ day: "2026-09-23", cm: 93.5, change: { since: "2026-08-26", cm: -2.5 } });
    // No waist logged yet: no card.
    expect(weightModel(storeWith(series(-0.05, 1)), "2026-08-27").waist).toBeNull();
  });
});

describe("Strength", () => {
  it("lists lifts ready for more weight and knee lifts on hold", () => {
    const s = storeWith({
      "2026-09-16": day({ exercises: { "Leg Press": lift([[12, 50], [12, 50], [12, 50]]), "Hamstring Curl": lift([[12, 30], [12, 30], [12, 30]]) }, kneeBefore: 2, kneeAfter: 6 }),
    });
    const m = strengthModel(s, "2026-09-23");
    expect(m.ready.map((x) => [x.name, x.from, x.to])).toEqual([["Hamstring Curl", 30, 32.5]]);
    expect(m.held.map((x) => x.name)).toEqual(["Leg Press"]);
    expect(m.flags.map((f) => f.text)).toEqual(["1 lift is ready for more weight. See Strength."]);
    const k = kneeModel(s, "2026-09-23");
    expect(k.kind).toBe("table");
    expect(k.flags[0].text).toBe("Knee was above your limit after Legs on 16 Sept. Knee lifts hold their weight until a better session.");
  });

  it("lists every lift in the plan, not only each day's first, and a lift on two days once, naming both", () => {
    const m = strengthModel(storeWith({}), "2026-09-23");
    const names = new Set(DEFAULT_PLAN.days.flatMap((d) => d.exercises.map((x) => x.name)));
    expect(m.rows).toHaveLength(names.size);
    expect(m.rows.map((r) => r.name)).toEqual([...names]); // in the plan's order
    expect(m.rows.find((r) => r.name === "Chest Press Machine")?.day).toBe("Push"); // not that day's first lift
    expect(m.rows.filter((r) => r.name === "Seated Row").map((r) => r.day)).toEqual(["Pull, Upper"]);
  });

  it("lists lifts due a deload, and a percentage as ready only when it's more than last time", () => {
    const s = storeWith({ [LAST]: day({ exercises: { "Hamstring Curl": lift(SHORT), "Calf Raise": lift([[12, 40], [12, 40], [12, 40]]) } }) });
    curl(s, { deloadAfter: "1" });
    const calf = Object.assign(s.plan.days[2].exercises[4], { prog: "percent", oneRm: "80", pct: "50" }); // 40 kg, as last time
    const m = strengthModel(s, WED);
    expect(m.deload.map((x) => [x.name, x.day, x.from, x.to])).toEqual([["Hamstring Curl", "Legs", 50, 45]]);
    expect(m.ready).toEqual([]);
    expect(m.flags.map((f) => f.text)).toEqual(["1 lift is due a deload. See Strength."]);
    calf.pct = "60"; // 48, to 47.5 kg
    expect(strengthModel(s, WED).ready.map((x) => [x.name, x.from, x.to])).toEqual([["Calf Raise", 40, 47.5]]);
  });

  it("follows each day a lift is on, once for the same answer", () => {
    // Seated Row on Pull and Upper: last week's fell short, which only Upper's settings deload.
    const s = storeWith({ [LAST]: day({ exercises: { "Seated Row": lift(SHORT) } }) });
    const [pull, upper] = [s.plan.days[1].exercises[2], s.plan.days[4].exercises[3]];
    expect([pull.name, upper.name]).toEqual(["Seated Row", "Seated Row"]);
    upper.deloadAfter = "1";
    let m = strengthModel(s, WED);
    expect(m.deload.map((x) => [x.name, x.day, x.from, x.to])).toEqual([["Seated Row", "Upper", 50, 45]]);
    expect(m.flags.map((f) => f.text)).toEqual(["1 lift is due a deload. See Strength."]);
    // With the same settings on both, it's one row, under the first day.
    pull.deloadAfter = "1";
    m = strengthModel(s, WED);
    expect(m.deload.map((x) => [x.name, x.day])).toEqual([["Seated Row", "Pull"]]);
  });

  it("leaves out a percentage with no history to go up from", () => {
    const s = storeWith({});
    curl(s, { prog: "percent", oneRm: "60", pct: "75" });
    const m = strengthModel(s, WED);
    expect([m.ready, m.held, m.deload]).toEqual([[], [], []]);
  });
});

describe("Muscles", () => {
  // The four weeks start on Mondays 31 August, 7, 14 and 21 September.
  const WEEKS = ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"];
  /** A day of these lifts. */
  const trained = (exercises: Record<string, LiftLog>): DayLog => day({ exercises });
  /** `n` working sets of 10 at 40 kg, then any others. */
  const worked = (n: number, more: SetLog[] = [], x: Partial<LiftLog> = {}): LiftLog => ({ done: true, kg: 40, sets: [...Array.from({ length: n }, () => ({ reps: 10, kg: 40 })), ...more], ...x });
  const WARM: SetLog = { reps: 8, kg: 20, type: "warmup" }, DROP: SetLog = { reps: 12, kg: 30, type: "drop" };

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

  // Last week: Leg Extension (quads) with a warm-up and a drop set, Leg Press (quads; calves, glutes and hamstrings
  // too), Hamstring Curl (hamstrings), a heavy week of Dumbbell Bench Press (chest; shoulders and triceps too), and
  // a lift the library doesn't know. The week before, Leg Extension swapped for Hack Squat; before the four
  // weeks, one that isn't counted.
  const logs = {
    "2026-08-24": trained({ "Leg Extension": worked(5) }),
    "2026-09-09": trained({ "Leg Extension": worked(2, [], { swap: "Hack Squat" }) }),
    "2026-09-16": trained({ "Leg Extension": worked(3, [WARM, DROP]), "Leg Press": worked(3), "Hamstring Curl": worked(4), "Dumbbell Bench Press": worked(21), "Mystery Press": worked(2) }),
    [WED]: trained({ "Leg Extension": worked(2) }),
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
    expect(musclesModel(storeWith({ [WED]: trained({ "Leg Extension": worked(2) }) }, "2026-09-20T05:00:00Z"), WED).rows[0].note).toBeNull();
  });

  it("lists untagged lifts apart rather than guess: one the library doesn't know, and one of your own with no muscles", () => {
    const s = storeWith({ ...logs, [WED]: trained({ "Odd Lift": worked(3), "Cable Thing": worked(2) }) });
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

describe("a lift's own page", () => {
  it("tracks heaviest set, estimated 1RM and volume per session, and how often, from sets that count", () => {
    const s = storeWith({
      "2026-09-09": day({ exercises: { "Leg Press": lift([[10, 45], [10, 45], [8, 45]]) } }),
      "2026-09-16": day({ exercises: { "Leg Press": lift([[10, 50], [10, 50], [10, 50]]) } }),
      // A set with only a weight, and one with only reps: neither should add a load or a 1RM, but the
      // weight-only set still counts as the day's heaviest.
      "2026-09-23": day({ exercises: { "Leg Press": { done: true, kg: 55, sets: [{ reps: null, kg: 55 }, { reps: 12, kg: null }, { reps: 8, kg: 55 }] } } }),
    });
    const m = liftModel(s, "2026-09-23", "Leg Press");
    expect(m.points.map((p) => [p.day, p.top, p.topReps, p.volume])).toEqual([
      ["2026-09-09", 45, 10, 1260],
      ["2026-09-16", 50, 10, 1500],
      ["2026-09-23", 55, 8, 440], // only the 8 x 55 set has both a weight and reps
    ]);
    expect(m.points[0].e1rm).toBeCloseTo(60, 9); // Brzycki, 45 kg x 10
    expect(m.points[2].e1rm).toBeCloseTo(68.27586, 4); // the 12-rep, weightless set can't estimate one
    expect(m.bestTop).toEqual(["2026-09-23", 55]);
    expect(m.bestE1rm?.[0]).toBe("2026-09-23");
    expect(m.volume).toBe(1260 + 1500 + 440);
    expect(m.perWeek).toBeCloseTo(1.5, 9); // 3 sessions over the 14 days from the first to today
    expect(m.planned).toEqual([{ day: "Legs", reps: [10, 12] }]);
  });

  it("matches a lift by its logged name on any day, not only the plan's usual day for it", () => {
    // Monday is Push, which has no Leg Press: a day moved, or logged under an older plan, still has to count.
    const s = storeWith({ "2026-09-21": day({ exercises: { "Leg Press": lift([[10, 40]]) } }) });
    expect(s.planFor("2026-09-21").name).toBe("Push");
    expect(liftModel(s, "2026-09-23", "Leg Press").points.map((p) => p.day)).toEqual(["2026-09-21"]);
  });

  it("keeps a renamed lift's earlier days under its old name; only the new name carries the plan's rep range", () => {
    const s = storeWith({ "2026-09-09": day({ exercises: { "Leg Press": lift([[10, 45]]) } }) });
    s.plan = { ...s.plan, days: s.plan.days.map((d, i) => (i === 2 ? { ...d, exercises: d.exercises.map((x) => (x.name === "Leg Press" ? { ...x, name: "Leg Press Machine" } : x)) } : d)) };
    const old = liftModel(s, "2026-09-23", "Leg Press"), renamed = liftModel(s, "2026-09-23", "Leg Press Machine");
    expect(old.points).toHaveLength(1);
    expect(old.planned).toEqual([]);
    expect(renamed.points).toHaveLength(0);
    expect(renamed.planned).toEqual([{ day: "Legs", reps: [10, 12] }]);
  });

  it("keeps two days with the same session name apart only when the lift's rep ranges differ there", () => {
    const s = storeWith({});
    const withPush = (reps: string) => ({
      ...s.plan,
      days: s.plan.days.map((d, i) => (i === 3 ? { ...d, name: "Push", exercises: [{ ...s.plan.days[0].exercises[0], reps }] } : d)),
    });
    s.plan = withPush("8-10"); // Thursday is a second Push, the same as Monday's
    expect(liftModel(s, "2026-09-23", "Incline Machine Press").planned).toEqual([{ day: "Push", reps: [8, 10] }]);
    expect(strengthModel(s, "2026-09-23").rows.find((r) => r.name === "Incline Machine Press")?.day).toBe("Push");
    s.plan = withPush("12-15"); // a lighter Push on Thursday
    expect(liftModel(s, "2026-09-23", "Incline Machine Press").planned).toEqual([
      { day: "Push", reps: [8, 10] },
      { day: "Push", reps: [12, 15] },
    ]);
    expect(strengthModel(s, "2026-09-23").rows.find((r) => r.name === "Incline Machine Press")?.day).toBe("Push");
  });

  it("names every day the plan has a lift on, each with its rep range there", () => {
    const s = storeWith({});
    expect(liftModel(s, "2026-09-23", "Seated Row").planned).toEqual([
      { day: "Pull", reps: [10, 12] },
      { day: "Upper", reps: [10, 12] },
    ]);
  });

  it("has nothing to show for a lift that's never been logged and isn't in the plan", () => {
    const m = liftModel(storeWith({}), "2026-09-23", "Nonexistent Lift");
    expect(m).toMatchObject({ points: [], bestTop: null, bestE1rm: null, volume: 0, perWeek: null, planned: [] });
  });
});
