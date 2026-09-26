/* Health Connect data: what the phone reports, turned into one HealthDay per local date, and the words the
 * screens use for it. No plugin code here (that lives in src/native/), so it can be tested on its own. */
import { keyOf } from "./dates";
import type { DayKey, HealthDay, HealthWorkout } from "./types";

// The parts of @capgo/capacitor-health's results used here.
export interface DayTotal {
  /** The bucket's start: local midnight, or the hour for hourly buckets, since the queries start there. */
  startDate: string;
  value: number;
  values?: Partial<Record<"sum" | "average" | "min" | "max", number>>;
}
export interface Sample {
  startDate: string;
  endDate: string;
  value: number;
  stages?: { stage: string; durationMinutes: number }[];
  /** Blood pressure readings carry both numbers, mmHg. */
  systolic?: number;
  diastolic?: number;
}
export interface Workout {
  workoutType: string;
  /** Seconds. */
  duration: number;
  totalEnergyBurned?: number;
  /** Metres. */
  totalDistance?: number;
  startDate: string;
  endDate: string;
  sourceName?: string;
}
/** What the Android app reads, by kind. Day totals come in daily buckets (hourly for stepsHourly). */
export interface HealthReadings {
  steps?: DayTotal[];
  stepsHourly?: DayTotal[];
  /** Metres. */
  distance?: DayTotal[];
  activeKcal?: DayTotal[];
  eatenKcal?: DayTotal[];
  /** Litres. */
  water?: DayTotal[];
  heartRate?: DayTotal[];
  restingHr?: DayTotal[];
  totalKcal?: Sample[];
  /** kcal a day. */
  bmr?: Sample[];
  floors?: Sample[];
  hrv?: Sample[];
  spo2?: Sample[];
  respRate?: Sample[];
  vo2max?: Sample[];
  bp?: Sample[];
  weight?: Sample[];
  bodyFat?: Sample[];
  /** cm. */
  height?: Sample[];
  sleep?: Sample[];
  workouts?: Workout[];
}

/** When the app most of today's steps come from last shared steps with Health Connect, and that app (a package
 *  name). Kept on this phone only (store.stepsShared), for the Health tab to say it. */
export interface StepsShared {
  at: string;
  from: string;
}

/** A steps record as the app's GymSync plugin gives it (native/sync.ts): its steps, the app that shared it, and when
 *  Health Connect last got it. */
export interface StepsRecordTimes {
  value: number;
  sourceId?: string;
  modified: string;
}

/**
 * When steps were last shared, from today's steps records: the app with the most steps among them, and the latest
 * time Health Connect got one of its records (new, or updated with more steps). Not a record's end: Samsung Health's
 * runs to midnight. That app's, not simply the latest record's: with two apps sharing steps, Health Connect counts
 * the one first in its list, and that's nearly always the one with more.
 */
export function stepsShared(records: StepsRecordTimes[] | undefined): StepsShared | null {
  const by = new Map<string, { steps: number; at: number }>();
  for (const r of records ?? []) {
    if (!(r.value > 0)) continue;
    const k = r.sourceId ?? "", b = by.get(k) ?? { steps: 0, at: 0 };
    by.set(k, { steps: b.steps + r.value, at: Math.max(b.at, Date.parse(r.modified)) });
  }
  const top = [...by].sort((a, b) => b[1].steps - a[1].steps)[0];
  return top ? { at: new Date(top[1].at).toISOString(), from: top[0] } : null;
}

/** The apps that share steps with Health Connect, by package name. */
const APPS: Record<string, string> = {
  "com.sec.android.app.shealth": "Samsung Health",
  "com.google.android.apps.fitness": "Google Fit",
  "com.fitbit.FitbitMobile": "Fitbit",
  "com.garmin.android.apps.connectmobile": "Garmin Connect",
  "com.huawei.health": "Huawei Health",
  "com.ouraring.oura": "Oura",
  "com.withings.wiscale2": "Withings",
};
/** An app's name from its package name, or null for one not known here. */
export const appName = (pkg: string): string | null => APPS[pkg] ?? null;

const dayOf = (iso: string): DayKey => keyOf(new Date(iso));
const round = (v: number, dp = 0) => Math.round(v * 10 ** dp) / 10 ** dp;
const byStart = <T extends { startDate: string }>(xs: T[] | undefined): T[] => [...(xs ?? [])].sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));

/**
 * One HealthDay per local date. A day only appears when the phone had something for it. The Android app's
 * background sync builds the same days in Kotlin (HealthDays.kt): tests/fixtures/health-days.json keeps the two alike.
 */
export function healthDays(r: HealthReadings): Record<DayKey, HealthDay> {
  const out: Record<DayKey, HealthDay> = {};
  const day = (k: DayKey) => (out[k] ??= {});
  // Day totals count on the local date their bucket starts.
  const totals = (xs: DayTotal[] | undefined, set: (d: HealthDay, v: number) => void) => {
    for (const t of xs ?? []) if (t.value > 0) set(day(dayOf(t.startDate)), t.value);
  };
  totals(r.steps, (d, v) => (d.steps = round(v)));
  totals(r.distance, (d, v) => (d.km = round(v / 1000, 2)));
  totals(r.activeKcal, (d, v) => (d.activeKcal = round(v)));
  totals(r.eatenKcal, (d, v) => (d.eatenKcal = round(v)));
  totals(r.water, (d, v) => (d.waterMl = round(v * 1000)));
  totals(r.restingHr, (d, v) => (d.restingHr = round(v)));
  for (const t of r.heartRate ?? []) {
    const d = day(dayOf(t.startDate)), avg = t.values?.average ?? t.value, min = t.values?.min, max = t.values?.max;
    if (avg > 0) d.hrAvg = round(avg);
    if (min && min > 0) d.hrMin = round(min);
    if (max && max > 0) d.hrMax = round(max);
  }
  // Steps hour by hour, in local hours.
  for (const t of r.stepsHourly ?? []) {
    if (!(t.value > 0)) continue;
    const d = day(dayOf(t.startDate));
    (d.stepsByHour ??= Array<number>(24).fill(0))[new Date(t.startDate).getHours()] += round(t.value);
  }
  // Samples that add up over the day they start: all calories burned, floors.
  const sums = (xs: Sample[] | undefined, set: (d: HealthDay, v: number) => void) => {
    const by: Record<DayKey, number> = {};
    for (const s of byStart(xs)) if (s.value > 0) by[dayOf(s.startDate)] = (by[dayOf(s.startDate)] ?? 0) + s.value;
    for (const [k, v] of Object.entries(by)) set(day(k), v);
  };
  sums(r.totalKcal, (d, v) => (d.totalKcal = round(v)));
  sums(r.floors, (d, v) => (d.floors = round(v)));
  // Readings averaged over the day: HRV, blood oxygen, breathing rate.
  const means = (xs: Sample[] | undefined, set: (d: HealthDay, v: number) => void) => {
    const by: Record<DayKey, [number, number]> = {};
    for (const s of byStart(xs)) {
      if (!(s.value > 0)) continue;
      const a = (by[dayOf(s.startDate)] ??= [0, 0]);
      a[0] += s.value;
      a[1]++;
    }
    for (const [k, [sum, n]] of Object.entries(by)) set(day(k), sum / n);
  };
  means(r.hrv, (d, v) => (d.hrv = round(v)));
  means(r.spo2, (d, v) => (d.spo2 = round(v, 1)));
  means(r.respRate, (d, v) => (d.respRate = round(v, 1)));
  // One reading a day: the first for weight and body fat (least changed by food and drink), the latest otherwise.
  const pick = (xs: Sample[] | undefined, first: boolean, set: (d: HealthDay, s: Sample) => void) => {
    const seen = new Set<DayKey>();
    for (const s of byStart(xs)) {
      const k = dayOf(s.startDate);
      if (!(s.value > 0) || (first && seen.has(k))) continue;
      seen.add(k);
      set(day(k), s);
    }
  };
  pick(r.weight, true, (d, s) => (d.weight = round(s.value, 1)));
  pick(r.bodyFat, true, (d, s) => (d.bodyFat = round(s.value, 1)));
  pick(r.height, false, (d, s) => (d.height = round(s.value)));
  pick(r.bmr, false, (d, s) => (d.bmr = round(s.value)));
  pick(r.vo2max, false, (d, s) => (d.vo2max = round(s.value, 1)));
  pick(r.bp, false, (d, s) => {
    const sys = s.systolic ?? s.value, dia = s.diastolic ?? 0;
    if (sys > 0 && dia > 0) d.bp = { sys: round(sys), dia: round(dia) };
  });
  // Sleep counts on the day it ended, so last night shows on today. Asleep means every stage but awake;
  // without stages, the whole session. The longest session that day gives bedtime and waking time.
  const longest: Record<DayKey, number> = {};
  for (const s of byStart(r.sleep)) {
    const k = dayOf(s.endDate), stages = s.stages ?? [];
    const asleep = stages.length ? stages.filter((x) => x.stage !== "awake").reduce((m, x) => m + x.durationMinutes, 0) : s.value;
    if (!(asleep > 0)) continue;
    const d = day(k);
    d.sleepMin = (d.sleepMin ?? 0) + round(asleep);
    // "asleep" is sleep with no stage detail: it counts above, but isn't filed under a stage.
    for (const x of stages) {
      const st = x.stage as "deep" | "rem" | "light" | "awake";
      if (!["deep", "rem", "light", "awake"].includes(st)) continue;
      d.sleepStages = { ...d.sleepStages, [st]: (d.sleepStages?.[st] ?? 0) + round(x.durationMinutes) };
    }
    const span = Date.parse(s.endDate) - Date.parse(s.startDate);
    if (!(span <= (longest[k] ?? -1))) {
      longest[k] = span;
      d.bed = s.startDate;
      d.wake = s.endDate;
    }
  }
  // Workouts count on the day they started, earliest first.
  for (const w of byStart(r.workouts)) {
    if (!(w.duration > 0)) continue;
    const x: HealthWorkout = { type: w.workoutType || "other", start: w.startDate, end: w.endDate, min: round(w.duration / 60) };
    if (w.totalEnergyBurned && w.totalEnergyBurned > 0) x.kcal = round(w.totalEnergyBurned);
    if (w.totalDistance && w.totalDistance > 0) x.km = round(w.totalDistance / 1000, 2);
    if (w.sourceName) x.source = w.sourceName;
    (day(dayOf(w.startDate)).workouts ??= []).push(x);
  }
  return out;
}

/** JSON with object keys in sorted order, so a day compares equal however its keys were ordered (jsonb reorders them). */
export function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
  );
}

/** "7 h 12 min", "7 h", "45 min", never split across lines. */
export function hoursMin(min: number): string {
  const m = Math.round(min), h = Math.floor(m / 60);
  if (!h) return `${m}\u00a0min`;
  return m % 60 ? `${h}\u00a0h\u00a0${m % 60}\u00a0min` : `${h}\u00a0h`;
}

// Health Connect's exercise types in words, for the ones a gym-goer is likely to log; others get split
// camelCase ("stairClimbingMachine" -> "Stair climbing machine").
const WORKOUT_WORDS: Record<string, string> = {
  strengthTraining: "Strength training",
  traditionalStrengthTraining: "Strength training",
  functionalStrengthTraining: "Functional training",
  weightlifting: "Weightlifting",
  walking: "Walk",
  running: "Run",
  runningTreadmill: "Treadmill run",
  cycling: "Cycling",
  bikingStationary: "Exercise bike",
  elliptical: "Elliptical",
  stairClimbingMachine: "Stair machine",
  rowingMachine: "Rowing machine",
  highIntensityIntervalTraining: "HIIT",
  yoga: "Yoga",
  stretching: "Stretching",
  swimming: "Swim",
  swimmingPool: "Pool swim",
  hiking: "Hike",
  other: "Workout",
};
export function workoutName(type: string): string {
  if (WORKOUT_WORDS[type]) return WORKOUT_WORDS[type];
  const words = type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
