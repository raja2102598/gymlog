import { describe, expect, it } from "vitest";
import { healthDays, hoursMin, workoutName } from "@/lib/health";
import { syncedWhen } from "@/lib/format";

// Times in the phone's local time zone, whatever the test machine's is.
const at = (d: number, h = 0, m = 0) => new Date(2026, 8, d, h, m).toISOString();

describe("healthDays", () => {
  it("puts day totals on the local date their bucket starts", () => {
    const days = healthDays({
      steps: [{ startDate: at(22), value: 8421.4 }, { startDate: at(23), value: 0 }],
      activeKcal: [{ startDate: at(22), value: 412.6 }],
      heartRate: [{ startDate: at(22), value: 78, values: { average: 77.6, max: 151 } }],
      restingHr: [{ startDate: at(22), value: 61.7 }],
    });
    expect(days).toEqual({ "2026-09-22": { steps: 8421, activeKcal: 413, hrAvg: 78, hrMax: 151, restingHr: 62 } });
  });

  it("keeps the day's first weigh-in", () => {
    const days = healthDays({
      weight: [
        { startDate: at(23, 21), endDate: at(23, 21), value: 81.9 },
        { startDate: at(23, 7, 12), endDate: at(23, 7, 12), value: 81.24 },
      ],
    });
    expect(days["2026-09-23"].weight).toBe(81.2);
  });

  it("counts sleep on the day it ended, without the awake minutes", () => {
    const days = healthDays({
      sleep: [
        {
          startDate: at(22, 23, 0),
          endDate: at(23, 6, 30),
          value: 450,
          stages: [
            { stage: "light", durationMinutes: 240 },
            { stage: "deep", durationMinutes: 80 },
            { stage: "rem", durationMinutes: 95 },
            { stage: "awake", durationMinutes: 35 },
          ],
        },
      ],
    });
    expect(days["2026-09-22"]).toBeUndefined();
    expect(days["2026-09-23"]).toEqual({ sleepMin: 415, sleepStages: { light: 240, deep: 80, rem: 95, awake: 35 } });
  });

  it("uses the whole session when a tracker gives no stages, and files 'asleep' under no stage", () => {
    const days = healthDays({
      sleep: [
        { startDate: at(23, 0, 30), endDate: at(23, 7), value: 390 },
        { startDate: at(23, 14), endDate: at(23, 14, 40), value: 40, stages: [{ stage: "asleep", durationMinutes: 40 }] },
      ],
    });
    expect(days["2026-09-23"]).toEqual({ sleepMin: 430 });
  });

  it("lists workouts on the day they started, earliest first, in minutes, kcal and km", () => {
    const days = healthDays({
      workouts: [
        { workoutType: "walking", duration: 1810, totalDistance: 2412.5, startDate: at(23, 18), endDate: at(23, 18, 30), sourceName: "Samsung Health" },
        { workoutType: "strengthTraining", duration: 3120, totalEnergyBurned: 310.4, startDate: at(23, 7, 10), endDate: at(23, 8, 2) },
        { workoutType: "yoga", duration: 0, startDate: at(23, 9), endDate: at(23, 9) },
      ],
    });
    expect(days["2026-09-23"].workouts).toEqual([
      { type: "strengthTraining", start: at(23, 7, 10), end: at(23, 8, 2), min: 52, kcal: 310 },
      { type: "walking", start: at(23, 18), end: at(23, 18, 30), min: 30, km: 2.41, source: "Samsung Health" },
    ]);
  });

  it("leaves out days with nothing in them", () => {
    expect(healthDays({ steps: [{ startDate: at(20), value: 0 }], weight: [], sleep: [], workouts: [] })).toEqual({});
  });
});

describe("words and times", () => {
  it("says durations the short way, with the number kept next to its unit", () => {
    expect(hoursMin(432).replace(/\u00a0/g, " ")).toBe("7 h 12 min");
    expect(hoursMin(45).replace(/\u00a0/g, " ")).toBe("45 min");
    expect(hoursMin(420).replace(/\u00a0/g, " ")).toBe("7 h");
  });
  it("names workout types, and splits the ones it doesn't know", () => {
    expect(workoutName("strengthTraining")).toBe("Strength training");
    expect(workoutName("stairClimbingMachine")).toBe("Stair machine");
    expect(workoutName("paddleSports")).toBe("Paddle sports");
  });
  it("says when data last synced", () => {
    const now = new Date(2026, 8, 23, 12, 0);
    expect(syncedWhen(new Date(2026, 8, 23, 10, 42).toISOString(), now)).toMatch(/^at 10:42\s?am$/i);
    expect(syncedWhen(new Date(2026, 8, 22, 21, 0).toISOString(), now)).toBe("yesterday");
    expect(syncedWhen(new Date(2026, 8, 20, 9, 0).toISOString(), now)).toBe("on 20 Sept");
  });
});
