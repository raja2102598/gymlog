import { describe, expect, it } from "vitest";
import { anyHealth, clockText, dayNumbers, daysTo, goalOf, metricValue, seriesOf, sleepTimes, stepsSharedText, summarize } from "@/lib/healthView";
import { DEFAULT_PLAN } from "@/lib/plan";
import { niceMax, trendScale } from "@/lib/scale";
import type { DayLog, HealthDay } from "@/lib/types";
import { atWednesdayNoon, day, storeWith, WED } from "./helpers";

// The Health tab's numbers (lib/healthView.ts), from the store as the app passes it: what you typed in the day log,
// and Health Connect's days.
atWednesdayNoon();

/** A store with Health Connect's days, and what you typed on the days in `typed`. */
function store(health: Record<string, HealthDay>, typed: Record<string, Partial<DayLog>> = {}) {
  const s = storeWith(Object.fromEntries(Object.entries(typed).map(([k, d]) => [k, day(d)])));
  s.health = health;
  return s;
}

describe("a day's numbers", () => {
  it("takes the steps and weight you typed over Health Connect's, adds up workouts, and works out BMI from the latest height", () => {
    const workouts = [
      { type: "walking", start: "a", end: "b", min: 20 },
      { type: "strengthTraining", start: "c", end: "d", min: 52 },
    ];
    const s = store(
      { "2026-09-01": { height: 175 }, "2026-09-20": { steps: 8800, weight: 81.8 }, "2026-09-21": { steps: 7000, weight: 81.6 }, [WED]: { steps: 8421, weight: 81.2, workouts } },
      { "2026-09-20": { steps: 9000, weight: 82 }, [WED]: { steps: 9000 } },
    );
    expect([s.stepsOf("2026-09-20"), s.stepsOf("2026-09-21"), s.stepsOf("2026-09-22")]).toEqual([9000, 7000, null]);
    expect([s.weightOf("2026-09-20"), s.weightOf("2026-09-21")]).toEqual([82, 81.6]);
    // Weight's trend reads both: each day's typed weight, or else Health Connect's.
    expect(s.weightSeries().filter((p) => p.measured).map((p) => [p.day, p.weight])).toEqual([
      ["2026-09-20", 82],
      ["2026-09-21", 81.6],
      [WED, 81.2],
    ]);
    const n = dayNumbers(s, WED);
    expect([n.steps, n.weight, n.exerciseMin, n.bmi]).toEqual([9000, 81.2, 72, 26.5]);
    // No height measured yet by then: no BMI.
    expect(dayNumbers(store({ [WED]: { weight: 81.2 } }), WED).bmi).toBeNull();
  });

  it("gives each metric's chart value: sleep in hours, calories burned in all when known", () => {
    const n = dayNumbers(store({ [WED]: { sleepMin: 450, activeKcal: 400, totalKcal: 2400, restingHr: 60 } }), WED);
    expect(metricValue("sleep", n)).toBe(7.5);
    expect(metricValue("energy", n)).toBe(2400);
    expect(metricValue("heart", n)).toBe(60);
    expect(metricValue("exercise", n)).toBeNull();
    expect(metricValue("energy", dayNumbers(store({ [WED]: { activeKcal: 400 } }), WED))).toBe(400);
  });

  it("counts calories burned as resting and active together, today's resting only up to now", () => {
    // Samsung Health's case: total-calorie records for a workout (223), less than the day's active calories (511).
    const s = store({ "2026-09-01": { bmr: 1680 }, "2026-09-22": { activeKcal: 600 }, [WED]: { activeKcal: 511, totalKcal: 223 } });
    expect(dayNumbers(s, WED)).toMatchObject({ totalKcal: 840 + 511, restingEstimated: false }); // noon: half the day's resting
    expect(dayNumbers(s, "2026-09-22").totalKcal).toBe(1680 + 600); // a whole day gone by
    // A source whose totals are the whole day's wins.
    expect(dayNumbers(store({ "2026-09-01": { bmr: 1680 }, [WED]: { activeKcal: 511, totalKcal: 2400 } }), WED).totalKcal).toBe(2400);
    // No resting rate measured: estimated from the latest weight, and said so.
    expect(dayNumbers(store({ "2026-09-20": { weight: 80 }, [WED]: { activeKcal: 511, totalKcal: 223 } }), WED)).toMatchObject({ totalKcal: 880 + 511, restingEstimated: true });
    // Neither: no total below the active calories; the tile shows those, burned moving.
    expect(dayNumbers(store({ [WED]: { activeKcal: 511, totalKcal: 223 } }), WED).totalKcal).toBeNull();
    // A day with no activity from Health Connect gets no total made up from resting alone.
    expect(dayNumbers(store({ "2026-09-01": { bmr: 1680 } }), "2026-09-10").totalKcal).toBeNull();
  });

  it("says how far today's steps go, and which app shared them", () => {
    const at = (d: number, h: number, m: number) => new Date(2026, 8, d, h, m).toISOString();
    expect(stepsSharedText({ at: at(23, 20, 40), from: "com.sec.android.app.shealth" }, WED)).toMatch(/^Samsung Health shared steps up to 8:40\s?pm$/);
    expect(stepsSharedText({ at: at(23, 9, 5), from: "com.example.pedometer" }, WED)).toMatch(/^Health Connect has steps up to 9:05\s?am$/);
    // Not for another day, nor from yesterday's read, nor before a read on this phone.
    expect(stepsSharedText({ at: at(23, 20, 40), from: "com.sec.android.app.shealth" }, "2026-09-22")).toBeNull();
    expect(stepsSharedText({ at: at(22, 23, 50), from: "com.sec.android.app.shealth" }, WED)).toBeNull();
    expect(stepsSharedText(null, WED)).toBeNull();
  });

  it("reads chest, arms, thighs and hips as typed only, and body fat typed over Health Connect's, like weight", () => {
    const s = store(
      { "2026-09-16": { bodyFat: 23 }, "2026-09-20": { bodyFat: 22 }, [WED]: { bodyFat: 22.4 } },
      { "2026-09-16": { chest: 100 }, [WED]: { chest: 99, arms: 34, thighs: 58, hips: 96, bodyFat: 21 } },
    );
    const n = dayNumbers(s, WED);
    expect([n.chest, n.arms, n.thighs, n.hips, n.bodyFat]).toEqual([99, 34, 58, 96, 21]);
    // Nothing typed: body fat falls back to Health Connect's; there's no such thing as an untyped chest measurement.
    const m = dayNumbers(s, "2026-09-20");
    expect([m.chest, m.bodyFat]).toEqual([null, 22]);
    expect(s.measureReadings("chest")).toEqual([
      ["2026-09-16", 100],
      [WED, 99],
    ]);
    expect(s.measureReadings("bodyFat")).toEqual([
      ["2026-09-16", 23],
      ["2026-09-20", 22],
      [WED, 21],
    ]);
  });

  it("opens the Health tab for a typed measurement alone, with Health Connect never connected", () => {
    expect(anyHealth(store({}, { "2026-09-16": {} }))).toBe(false);
    expect(anyHealth(store({}, { [WED]: { chest: 100 } }))).toBe(true);
    expect(anyHealth(store({ [WED]: { steps: 8421 } }))).toBe(true);
  });
});

describe("a week or a month", () => {
  it("lists the days oldest first, and sums them up against the goal", () => {
    const days = daysTo(WED, 7);
    expect(days[0]).toBe("2026-09-17");
    expect(days[6]).toBe(WED);
    const s = seriesOf(store({ "2026-09-21": { steps: 12000 }, "2026-09-22": { steps: 6000 }, [WED]: { steps: 10000 } }), "steps", days);
    expect(s.filter(([, v]) => v == null)).toHaveLength(4);
    expect(summarize(s, goalOf("steps", DEFAULT_PLAN))).toEqual({ n: 3, avg: 28000 / 3, total: 28000, best: ["2026-09-21", 12000], goalDays: 2 });
    expect(goalOf("heart", DEFAULT_PLAN)).toBeNull();
  });

  it("averages bedtimes either side of midnight as one clock", () => {
    const night = (bed: string, wake: string) => dayNumbers(store({ [WED]: { bed, wake, sleepMin: 400 } }), WED);
    const t = sleepTimes([night("2026-09-21T23:30:00", "2026-09-22T06:30:00"), night("2026-09-23T00:30:00", "2026-09-23T07:30:00")]);
    expect(t).toEqual({ bed: 24 * 60, wake: 7 * 60 });
    expect(clockText(t!.bed)).toMatch(/^12:00\s?am$/i);
    expect(clockText(22 * 60 + 45)).toMatch(/^10:45\s?pm$/i);
    expect(sleepTimes([])).toBeNull();
  });
});

describe("chart axes", () => {
  it("tops bar charts with a round number whose half is round too", () => {
    expect([niceMax(11550), niceMax(2770), niceMax(8.6), niceMax(0)]).toEqual([12000, 3000, 10, 1]);
  });

  it("puts trend gridlines on round values around the readings", () => {
    expect(trendScale([58, 65], 4)).toEqual({ lo: 55, hi: 65, ticks: [55, 60, 65] });
    expect(trendScale([81.2, 81.8], 1)).toEqual({ lo: 81, hi: 82, ticks: [81, 81.5, 82] });
    // A steady reading still gets a range, centred on it.
    const flat = trendScale([60, 60, 60], 4);
    expect(flat.lo).toBeLessThanOrEqual(58);
    expect(flat.hi).toBeGreaterThanOrEqual(62);
    expect(trendScale([], 4).ticks).toEqual([]);
  });
});
