/* Health Connect data: what the phone reports, turned into one HealthDay per local date, and the words the
 * screens use for it. No plugin code here (that lives in src/native/), so it can be tested on its own. */
import { keyOf } from "./dates";
import type { DayKey, HealthDay, HealthWorkout } from "./types";

// The parts of @capgo/capacitor-health's results used here.
export interface DayTotal {
  /** The bucket's start: local midnight, since the queries start at local midnight. */
  startDate: string;
  value: number;
  values?: Partial<Record<"sum" | "average" | "min" | "max", number>>;
}
export interface Sample {
  startDate: string;
  endDate: string;
  value: number;
  stages?: { stage: string; durationMinutes: number }[];
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
export interface HealthReadings {
  steps?: DayTotal[];
  activeKcal?: DayTotal[];
  heartRate?: DayTotal[];
  restingHr?: DayTotal[];
  weight?: Sample[];
  sleep?: Sample[];
  workouts?: Workout[];
}

const dayOf = (iso: string): DayKey => keyOf(new Date(iso));
const round = (v: number, dp = 0) => Math.round(v * 10 ** dp) / 10 ** dp;

/** One HealthDay per local date. A day only appears when the phone had something for it. */
export function healthDays(r: HealthReadings): Record<DayKey, HealthDay> {
  const out: Record<DayKey, HealthDay> = {};
  const day = (iso: string) => (out[dayOf(iso)] ??= {});
  for (const t of r.steps ?? []) if (t.value > 0) day(t.startDate).steps = round(t.value);
  for (const t of r.activeKcal ?? []) if (t.value > 0) day(t.startDate).activeKcal = round(t.value);
  for (const t of r.restingHr ?? []) if (t.value > 0) day(t.startDate).restingHr = round(t.value);
  for (const t of r.heartRate ?? []) {
    const avg = t.values?.average ?? t.value, max = t.values?.max;
    if (avg > 0) day(t.startDate).hrAvg = round(avg);
    if (max && max > 0) day(t.startDate).hrMax = round(max);
  }
  // Weight: the day's first weigh-in, the one least changed by food and drink.
  for (const s of [...(r.weight ?? [])].sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate))) {
    const d = day(s.startDate);
    if (d.weight == null && s.value > 0) d.weight = round(s.value, 1);
  }
  // Sleep counts on the day it ended, so last night shows on today. Asleep means every stage but awake;
  // without stages, the whole session.
  for (const s of r.sleep ?? []) {
    const d = day(s.endDate), stages = s.stages ?? [];
    const asleep = stages.length ? stages.filter((x) => x.stage !== "awake").reduce((m, x) => m + x.durationMinutes, 0) : s.value;
    if (!(asleep > 0)) continue;
    d.sleepMin = (d.sleepMin ?? 0) + round(asleep);
    // "asleep" is sleep with no stage detail: it counts above, but isn't filed under a stage.
    for (const x of stages) {
      const k = x.stage as "deep" | "rem" | "light" | "awake";
      if (!["deep", "rem", "light", "awake"].includes(k)) continue;
      d.sleepStages = { ...d.sleepStages, [k]: (d.sleepStages?.[k] ?? 0) + round(x.durationMinutes) };
    }
  }
  // Workouts count on the day they started, earliest first.
  for (const w of [...(r.workouts ?? [])].sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate))) {
    if (!(w.duration > 0)) continue;
    const x: HealthWorkout = { type: w.workoutType || "other", start: w.startDate, end: w.endDate, min: round(w.duration / 60) };
    if (w.totalEnergyBurned && w.totalEnergyBurned > 0) x.kcal = round(w.totalEnergyBurned);
    if (w.totalDistance && w.totalDistance > 0) x.km = round(w.totalDistance / 1000, 2);
    if (w.sourceName) x.source = w.sourceName;
    (day(w.startDate).workouts ??= []).push(x);
  }
  return out;
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
