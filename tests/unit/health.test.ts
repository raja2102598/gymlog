import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { appName, canon, healthDays, hoursMin, stepsShared, workoutName, type HealthReadings } from "@/lib/health";
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
    expect(days["2026-09-23"]).toEqual({ sleepMin: 415, sleepStages: { light: 240, deep: 80, rem: 95, awake: 35 }, bed: at(22, 23, 0), wake: at(23, 6, 30) });
  });

  it("uses the whole session when a tracker gives no stages, and files 'asleep' under no stage", () => {
    const days = healthDays({
      sleep: [
        { startDate: at(23, 0, 30), endDate: at(23, 7), value: 390 },
        { startDate: at(23, 14), endDate: at(23, 14, 40), value: 40, stages: [{ stage: "asleep", durationMinutes: 40 }] },
      ],
    });
    // Bedtime and waking time come from the night, not the nap.
    expect(days["2026-09-23"]).toEqual({ sleepMin: 430, bed: at(23, 0, 30), wake: at(23, 7) });
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

  it("fills steps hour by hour, and totals distance, floors, water and calories burned and eaten", () => {
    const days = healthDays({
      stepsHourly: [{ startDate: at(23, 9), value: 2100 }, { startDate: at(23, 19), value: 1500.6 }, { startDate: at(23, 20), value: 0 }],
      distance: [{ startDate: at(23), value: 7254.4 }],
      floors: [{ startDate: at(23, 9), endDate: at(23, 9, 5), value: 3 }, { startDate: at(23, 19), endDate: at(23, 19, 10), value: 4 }],
      water: [{ startDate: at(23), value: 1.75 }],
      eatenKcal: [{ startDate: at(23), value: 1850.6 }],
      totalKcal: [{ startDate: at(23, 0), endDate: at(23, 9), value: 600.3 }, { startDate: at(23, 9), endDate: at(23, 13), value: 613.9 }],
      bmr: [{ startDate: at(23, 18), endDate: at(23, 18), value: 1662.7 }, { startDate: at(23, 6), endDate: at(23, 6), value: 1650 }],
    });
    const d = days["2026-09-23"];
    expect(d.stepsByHour?.[9]).toBe(2100);
    expect(d.stepsByHour?.[19]).toBe(1501);
    expect(d.stepsByHour?.reduce((a, b) => a + b, 0)).toBe(3601);
    expect(d.stepsByHour).toHaveLength(24);
    expect([d.km, d.floors, d.waterMl, d.eatenKcal, d.totalKcal, d.bmr]).toEqual([7.25, 7, 1750, 1851, 1214, 1663]);
  });

  it("averages HRV, blood oxygen and breathing rate; keeps the lowest heart rate, the latest VO2 max and blood pressure, the first body fat", () => {
    const one = (h: number, value: number, more = {}) => ({ startDate: at(23, h), endDate: at(23, h), value, ...more });
    const d = healthDays({
      heartRate: [{ startDate: at(23), value: 77.6, values: { average: 77.6, min: 52.2, max: 151 } }],
      hrv: [one(2, 41), one(3, 46.4)],
      spo2: [one(2, 96), one(3, 97.5), one(4, 95)],
      respRate: [one(3, 14.6)],
      vo2max: [one(8, 38.2), one(19, 38.44)],
      bp: [one(7, 122.4, { systolic: 122.4, diastolic: 79.6 }), one(17, 118, { systolic: 118, diastolic: 76 })],
      bodyFat: [one(20, 25.1), one(7, 24.36)],
      height: [one(7, 175.3)],
    })["2026-09-23"];
    expect(d).toEqual({ hrAvg: 78, hrMin: 52, hrMax: 151, hrv: 44, spo2: 96.2, respRate: 14.6, vo2max: 38.4, bp: { sys: 118, dia: 76 }, bodyFat: 24.4, height: 175 });
  });

  it("leaves out days with nothing in them", () => {
    expect(healthDays({ steps: [{ startDate: at(20), value: 0 }], weight: [], sleep: [], workouts: [] })).toEqual({});
  });
});

describe("how far the steps go", () => {
  it("takes the app with the most steps, and when Health Connect last got one of its records", () => {
    const rec = (h: number, m: number, value: number, sourceId?: string) => ({ value, sourceId, modified: at(23, h, m) });
    const samsung = "com.sec.android.app.shealth", fit = "com.google.android.apps.fitness";
    // Google Fit shared last, but Samsung Health has most of the steps: when Samsung Health last shared, out of order.
    expect(stepsShared([rec(20, 40, 900, samsung), rec(9, 10, 4000, samsung), rec(21, 10, 300, fit), rec(22, 10, 0, samsung)])).toEqual({ at: at(23, 20, 40), from: samsung });
    expect(stepsShared([rec(9, 10, 50)])).toEqual({ at: at(23, 9, 10), from: "" });
    // No steps: nothing to say.
    expect(stepsShared([rec(9, 10, 0, samsung)])).toBeNull();
    expect(stepsShared(undefined)).toBeNull();
    expect([appName(samsung), appName(fit), appName("com.example.pedometer")]).toEqual(["Samsung Health", "Google Fit", null]);
  });
});

describe("the shared fixture, also checked against the Android app's Kotlin", () => {
  const fx = JSON.parse(readFileSync(new URL("../fixtures/health-days.json", import.meta.url), "utf8")) as { zone: string; readings: HealthReadings; expected: unknown };
  const tz = process.env.TZ;
  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });
  it("turns the readings into the expected days in its time zone", () => {
    process.env.TZ = fx.zone;
    expect(JSON.parse(canon(healthDays(fx.readings)))).toEqual(JSON.parse(canon(fx.expected)));
  });
  it("compares days whatever order their keys are in", () => {
    expect(canon({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: 2 } })).toBe(canon({ a: { c: 2, d: [1, { e: 3, f: 2 }] }, b: 1 }));
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
