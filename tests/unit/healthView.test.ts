import { describe, expect, it } from "vitest";
import { anyHealth, clockText, dayNumbers, daysTo, goalOf, metricValue, seriesOf, sleepTimes, summarize, type HealthSource } from "@/lib/healthView";
import { DEFAULT_PLAN } from "@/lib/plan";
import { depthOf, hashOf, parentOf, routeOf, tabOf } from "@/lib/route";
import { niceMax, trendScale } from "@/lib/scale";
import { signInMethods } from "@/lib/store";
import { MEASURE_FIELDS, type DayKey, type HealthDay, type MeasureField } from "@/lib/types";

type Typed = { steps?: number; weight?: number } & Partial<Record<MeasureField, number>>;
/** The store's side of the Health tab, from plain objects: days typed in the log, and Health Connect's. */
function source(health: Record<DayKey, HealthDay>, typed: Record<DayKey, Typed> = {}): HealthSource {
  return {
    plan: DEFAULT_PLAN,
    health,
    healthOf: (k) => health[k] ?? null,
    stepsOf: (k) => typed[k]?.steps ?? health[k]?.steps ?? null,
    weightOf: (k) => typed[k]?.weight ?? health[k]?.weight ?? null,
    measureOf: (k, f) => typed[k]?.[f] ?? (f === "bodyFat" ? health[k]?.bodyFat : undefined) ?? null,
    anyMeasured: () => Object.values(typed).some((t) => MEASURE_FIELDS.some((f) => t[f] != null)),
  };
}

describe("a day's numbers", () => {
  it("takes what you typed over Health Connect, adds up workouts, and works out BMI from the latest height", () => {
    const src = source(
      {
        "2026-09-01": { height: 175 },
        "2026-09-23": { steps: 8421, weight: 81.2, workouts: [{ type: "walking", start: "a", end: "b", min: 20 }, { type: "strengthTraining", start: "c", end: "d", min: 52 }] },
      },
      { "2026-09-23": { steps: 9000 } },
    );
    const n = dayNumbers(src, "2026-09-23");
    expect(n.steps).toBe(9000);
    expect(n.weight).toBe(81.2);
    expect(n.exerciseMin).toBe(72);
    expect(n.bmi).toBe(26.5);
    // No height measured yet by then: no BMI.
    expect(dayNumbers(source({ "2026-09-23": { weight: 81.2 } }), "2026-09-23").bmi).toBeNull();
  });

  it("gives each metric's chart value: sleep in hours, calories burned in all when known", () => {
    const n = dayNumbers(source({ k: { sleepMin: 450, activeKcal: 400, totalKcal: 2400, restingHr: 60 } }), "k");
    expect(metricValue("sleep", n)).toBe(7.5);
    expect(metricValue("energy", n)).toBe(2400);
    expect(metricValue("heart", n)).toBe(60);
    expect(metricValue("exercise", n)).toBeNull();
    expect(metricValue("energy", dayNumbers(source({ k: { activeKcal: 400 } }), "k"))).toBe(400);
  });

  it("reads chest, arms, thighs and hips as typed, and body fat typed over Health Connect's", () => {
    const n = dayNumbers(source({ k: { bodyFat: 22 } }, { k: { chest: 100, arms: 34, thighs: 58, hips: 96, bodyFat: 20.5 } }), "k");
    expect([n.chest, n.arms, n.thighs, n.hips, n.bodyFat]).toEqual([100, 34, 58, 96, 20.5]);
    // Nothing typed: body fat falls back to Health Connect's, like weight; the tape-measure fields stay null.
    const m = dayNumbers(source({ k: { bodyFat: 22 } }), "k");
    expect([m.chest, m.bodyFat]).toEqual([null, 22]);
  });

  it("opens the Health tab for a typed measurement alone, with Health Connect never connected", () => {
    expect(anyHealth(source({}))).toBe(false);
    expect(anyHealth(source({}, { "2026-09-23": { chest: 100 } }))).toBe(true);
    expect(anyHealth(source({ "2026-09-23": { steps: 8421 } }))).toBe(true);
  });
});

describe("a week or a month", () => {
  it("lists the days oldest first, and sums them up against the goal", () => {
    const days = daysTo("2026-09-23", 7);
    expect(days[0]).toBe("2026-09-17");
    expect(days[6]).toBe("2026-09-23");
    const src = source({ "2026-09-21": { steps: 12000 }, "2026-09-22": { steps: 6000 }, "2026-09-23": { steps: 10000 } });
    const s = seriesOf(src, "steps", days);
    expect(s.filter(([, v]) => v == null)).toHaveLength(4);
    expect(summarize(s, goalOf("steps", DEFAULT_PLAN))).toEqual({ n: 3, avg: 28000 / 3, total: 28000, best: ["2026-09-21", 12000], goalDays: 2 });
    expect(goalOf("heart", DEFAULT_PLAN)).toBeNull();
  });

  it("averages bedtimes either side of midnight as one clock", () => {
    const night = (bed: string, wake: string) => dayNumbers(source({ k: { bed, wake, sleepMin: 400 } }), "k");
    const t = sleepTimes([night("2026-09-21T23:30:00", "2026-09-22T06:30:00"), night("2026-09-23T00:30:00", "2026-09-23T07:30:00")]);
    expect(t).toEqual({ bed: 24 * 60, wake: 7 * 60 });
    expect(clockText(t!.bed)).toMatch(/^12:00\s?am$/i);
    expect(clockText(22 * 60 + 45)).toMatch(/^10:45\s?pm$/i);
    expect(sleepTimes([])).toBeNull();
  });
});

describe("chart axes", () => {
  it("tops bar charts with a round number whose half is round too", () => {
    expect(niceMax(11550)).toBe(12000);
    expect(niceMax(2770)).toBe(3000);
    expect(niceMax(8.6)).toBe(10);
    expect(niceMax(0)).toBe(1);
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

describe("where the app is", () => {
  it("reads each screen's address, including the old #dashboard", () => {
    expect(routeOf("")).toEqual({ view: "today" });
    expect(routeOf("#dashboard")).toEqual({ view: "progress" });
    expect(routeOf("#health/sleep")).toEqual({ view: "health", metric: "sleep" });
    expect(routeOf("#health/nonsense")).toEqual({ view: "today" });
    expect(hashOf({ view: "health", metric: "heart" })).toBe("#health/heart");
    expect(hashOf({ view: "today" })).toBe("");
  });

  it("knows how deep a screen is, its tab, and where its back arrow goes", () => {
    expect([depthOf({ view: "today" }), depthOf({ view: "settings" }), depthOf({ view: "health", metric: "water" }), depthOf({ view: "plan" })]).toEqual([0, 1, 2, 2]);
    expect(tabOf({ view: "plan" })).toBe("settings");
    expect(parentOf({ view: "health", metric: "water" })).toEqual({ view: "health" });
    expect(parentOf({ view: "plan" })).toEqual({ view: "settings" });
  });
});

describe("how a session signed in", () => {
  const token = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
  it("reads the methods from the access token", () => {
    expect(signInMethods(token({ amr: [{ method: "password", timestamp: 1 }] }))).toEqual(["password"]);
    expect(signInMethods(token({ amr: [{ method: "otp", timestamp: 1 }] }))).toEqual(["otp"]);
    expect(signInMethods(token({}))).toEqual([]);
    expect(signInMethods("not-a-token")).toEqual([]);
  });
});
