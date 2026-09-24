/* What the Health tab shows, worked out from the store: one day's numbers for the tiles, and a metric's values
 * across days for its charts. Steps and weight you typed win over Health Connect's, as everywhere else. */
import { addDays } from "./dates";
import type { Metric } from "./route";
import type { DayKey, HealthDay, HealthWorkout, Plan } from "./types";

export const METRIC_TITLE: Record<Metric, string> = {
  steps: "Steps",
  sleep: "Sleep",
  heart: "Heart",
  energy: "Calories",
  exercise: "Exercise",
  body: "Body",
  water: "Water",
};

/** The store's side of this, so it can be tested with plain objects. */
export interface HealthSource {
  plan: Plan;
  healthOf(k: DayKey): HealthDay | null;
  stepsOf(k: DayKey): number | null;
  weightOf(k: DayKey): number | null;
  /** Health Connect days, for the latest height. */
  health: Record<DayKey, HealthDay>;
}

export interface DayNumbers {
  steps: number | null;
  stepsByHour: number[] | null;
  km: number | null;
  floors: number | null;
  exerciseMin: number;
  workouts: HealthWorkout[];
  activeKcal: number | null;
  totalKcal: number | null;
  eatenKcal: number | null;
  bmr: number | null;
  sleepMin: number | null;
  sleepStages: HealthDay["sleepStages"] | null;
  bed: string | null;
  wake: string | null;
  restingHr: number | null;
  hrAvg: number | null;
  hrMin: number | null;
  hrMax: number | null;
  hrv: number | null;
  spo2: number | null;
  respRate: number | null;
  vo2max: number | null;
  bp: HealthDay["bp"] | null;
  weight: number | null;
  bodyFat: number | null;
  bmi: number | null;
  waterMl: number | null;
}

/** The latest height measured on or before `k`, cm. */
export function heightBy(src: HealthSource, k: DayKey): number | null {
  let best: DayKey | null = null;
  for (const [d, h] of Object.entries(src.health)) if (h.height && d <= k && (!best || d > best)) best = d;
  return best ? src.health[best].height! : null;
}

export function dayNumbers(src: HealthSource, k: DayKey): DayNumbers {
  const h = src.healthOf(k) ?? {};
  const workouts = h.workouts ?? [];
  const weight = src.weightOf(k), height = heightBy(src, k);
  return {
    steps: src.stepsOf(k),
    stepsByHour: h.stepsByHour ?? null,
    km: h.km ?? null,
    floors: h.floors ?? null,
    exerciseMin: workouts.reduce((m, w) => m + w.min, 0),
    workouts,
    activeKcal: h.activeKcal ?? null,
    totalKcal: h.totalKcal ?? null,
    eatenKcal: h.eatenKcal ?? null,
    bmr: h.bmr ?? null,
    sleepMin: h.sleepMin ?? null,
    sleepStages: h.sleepStages ?? null,
    bed: h.bed ?? null,
    wake: h.wake ?? null,
    restingHr: h.restingHr ?? null,
    hrAvg: h.hrAvg ?? null,
    hrMin: h.hrMin ?? null,
    hrMax: h.hrMax ?? null,
    hrv: h.hrv ?? null,
    spo2: h.spo2 ?? null,
    respRate: h.respRate ?? null,
    vo2max: h.vo2max ?? null,
    bp: h.bp ?? null,
    weight,
    bodyFat: h.bodyFat ?? null,
    bmi: weight && height ? Math.round((weight / (height / 100) ** 2) * 10) / 10 : null,
    waterMl: h.waterMl ?? null,
  };
}

/** Whether Health Connect has anything at all, so the tab can say where the data comes from instead. */
export const anyHealth = (src: HealthSource) => Object.keys(src.health).length > 0;

/** The days ending at `end`, oldest first. */
export const daysTo = (end: DayKey, n: number): DayKey[] => Array.from({ length: n }, (_, i) => addDays(end, i - n + 1));

/** A number per day, or null for a day with none. */
export type Series = [DayKey, number | null][];

/** The value a metric's bar chart shows for a day. */
export function metricValue(m: Metric, n: DayNumbers): number | null {
  switch (m) {
    case "steps":
      return n.steps;
    case "sleep":
      return n.sleepMin != null ? n.sleepMin / 60 : null;
    case "heart":
      return n.restingHr;
    case "energy":
      return n.totalKcal ?? n.activeKcal;
    case "exercise":
      return n.exerciseMin || null;
    case "body":
      return n.weight;
    case "water":
      return n.waterMl;
  }
}

/** The daily goal a metric is held to, in its chart's units, or null for none. */
export function goalOf(m: Metric, p: Plan): number | null {
  switch (m) {
    case "steps":
      return p.stepGoal;
    case "sleep":
      return p.sleepGoalH;
    case "exercise":
      return p.exerciseGoalMin;
    case "water":
      return p.waterGoalMl;
    default:
      return null;
  }
}

export function seriesOf(src: HealthSource, m: Metric, days: DayKey[], value: (n: DayNumbers) => number | null = (n) => metricValue(m, n)): Series {
  return days.map((k) => [k, value(dayNumbers(src, k))]);
}

export interface Summary {
  /** Days with a value. */
  n: number;
  avg: number | null;
  total: number;
  best: [DayKey, number] | null;
  /** Days at or over the goal, when there is one. */
  goalDays: number;
}

export function summarize(s: Series, goal: number | null = null): Summary {
  const vals = s.filter((p): p is [DayKey, number] => p[1] != null);
  const total = vals.reduce((m, [, v]) => m + v, 0);
  return {
    n: vals.length,
    avg: vals.length ? total / vals.length : null,
    total,
    best: vals.reduce<[DayKey, number] | null>((b, p) => (!b || p[1] > b[1] ? p : b), null),
    goalDays: goal == null ? 0 : vals.filter(([, v]) => v >= goal).length,
  };
}

/** Minutes after local midnight for an ISO time. */
const clockMin = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};

/**
 * Average bedtime and waking time over some nights, as minutes after midnight (bedtime can be past 24 h, e.g.
 * 1,450 for 12:10 am). Bedtimes in the evening and after midnight average together: a bedtime before noon counts
 * as the next day's.
 */
export function sleepTimes(nights: DayNumbers[]): { bed: number; wake: number } | null {
  const both = nights.filter((n) => n.bed && n.wake);
  if (!both.length) return null;
  const bed = both.reduce((m, n) => m + (clockMin(n.bed!) < 12 * 60 ? clockMin(n.bed!) + 24 * 60 : clockMin(n.bed!)), 0) / both.length;
  const wake = both.reduce((m, n) => m + clockMin(n.wake!), 0) / both.length;
  return { bed: Math.round(bed), wake: Math.round(wake) };
}

/** "10:45 pm" for minutes after midnight (wrapping past 24 h). */
export function clockText(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const d = new Date(2026, 0, 1, Math.floor(m / 60), m % 60);
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}
