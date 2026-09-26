/* What the Health tab shows, worked out from the store: one day's numbers for the tiles, and a metric's values
 * across days for its charts. Steps, weight and body fat you typed win over Health Connect's, as everywhere else. */
import { addDays, keyOf, parseKey, todayKey } from "./dates";
import { appName, type StepsShared } from "./health";
import type { Metric } from "./route";
import type { DayKey, HealthDay, HealthWorkout, MeasureField, Plan } from "./types";

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
  /** Water, ml: what was logged here, or else Health Connect's. Optional for plain test sources. */
  waterOf?(k: DayKey): number | null;
  /** Chest, arms, thighs and hips, and body fat (which also takes Health Connect's reading, like weight). */
  measureOf(k: DayKey, field: MeasureField): number | null;
  /** Whether the measurements card has ever been filled in, typed rather than from Health Connect. */
  anyMeasured(): boolean;
  /** Health Connect days, for the latest height. */
  health: Record<DayKey, HealthDay>;
  /** The days logged in Gym Log, oldest first. */
  days(): DayKey[];
}

export interface DayNumbers {
  steps: number | null;
  stepsByHour: number[] | null;
  km: number | null;
  floors: number | null;
  exerciseMin: number;
  workouts: HealthWorkout[];
  activeKcal: number | null;
  /** Calories burned in all: resting and active together (dayNumbers says how). */
  totalKcal: number | null;
  /** Whether the resting part of totalKcal is estimated from body weight, with no resting rate measured. */
  restingEstimated: boolean;
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
  chest: number | null;
  arms: number | null;
  thighs: number | null;
  hips: number | null;
}

/** The latest height measured on or before `k`, cm. */
export function heightBy(src: HealthSource, k: DayKey): number | null {
  let best: DayKey | null = null;
  for (const [d, h] of Object.entries(src.health)) if (h.height && d <= k && (!best || d > best)) best = d;
  return best ? src.health[best].height! : null;
}

/** Resting calories a day on `k`: the latest resting rate Health Connect has on or before it (from a watch's body
 *  composition, say), or else an estimate from the latest weight, 22 kcal a kilo, close to what the usual formulas
 *  give an adult. Null with neither. */
export function restingPerDay(src: HealthSource, k: DayKey): { kcal: number; estimated: boolean } | null {
  let rate: DayKey | null = null;
  for (const [d, h] of Object.entries(src.health)) if (d <= k && h.bmr && (!rate || d > rate)) rate = d;
  if (rate) return { kcal: src.health[rate].bmr!, estimated: false };
  const w = weightBy(src, k);
  return w ? { kcal: Math.round(w * 22), estimated: true } : null;
}

/** The latest weight on or before `k`: typed in Gym Log or weighed in Health Connect, whichever day is later (the
 *  typed one on the same day, as everywhere). */
export function weightBy(src: HealthSource, k: DayKey): number | null {
  let last: DayKey | null = null;
  for (const d of src.days()) if (d <= k && (!last || d > last) && src.weightOf(d) != null) last = d;
  for (const [d, h] of Object.entries(src.health)) if (d <= k && h.weight && (!last || d > last)) last = d;
  return last ? src.weightOf(last) : null;
}

/** How much of day `k` has gone by at `now`: all of a day before, none of one after. */
function dayGone(k: DayKey, now: number): number {
  const start = parseKey(k).getTime(), end = parseKey(addDays(k, 1)).getTime();
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

export function dayNumbers(src: HealthSource, k: DayKey, now = Date.now()): DayNumbers {
  const h = src.healthOf(k) ?? {};
  const workouts = h.workouts ?? [];
  const weight = src.weightOf(k), height = heightBy(src, k);
  // Calories burned: resting and active together, as Samsung Health counts them, today's resting only up to now. A
  // source's own total records count only when they're the whole day, at least that much: Samsung Health writes some
  // (for workouts) that add up to less than the day's active calories alone.
  const active = h.activeKcal ?? null, rest = active != null ? restingPerDay(src, k) : null;
  const both = rest ? Math.round(rest.kcal * dayGone(k, now)) + active! : null;
  const total = h.totalKcal != null && h.totalKcal >= (both ?? active ?? 0) ? h.totalKcal : both;
  return {
    steps: src.stepsOf(k),
    stepsByHour: h.stepsByHour ?? null,
    km: h.km ?? null,
    floors: h.floors ?? null,
    exerciseMin: workouts.reduce((m, w) => m + w.min, 0),
    workouts,
    activeKcal: active,
    totalKcal: total,
    restingEstimated: !!rest?.estimated && total === both,
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
    bodyFat: src.measureOf(k, "bodyFat"),
    bmi: weight && height ? Math.round((weight / (height / 100) ** 2) * 10) / 10 : null,
    waterMl: src.waterOf ? src.waterOf(k) : (h.waterMl ?? null),
    chest: src.measureOf(k, "chest"),
    arms: src.measureOf(k, "arms"),
    thighs: src.measureOf(k, "thighs"),
    hips: src.measureOf(k, "hips"),
  };
}

/** Whether Health Connect has given anything yet, rather than only the measurements typed on Today. */
export const fromHealthConnect = (src: HealthSource) => Object.keys(src.health).length > 0;

/** Whether there's anything to show at all: Health Connect data, or a typed measurement. Otherwise the tab says
 *  where the data comes from instead. */
export const anyHealth = (src: HealthSource) => fromHealthConnect(src) || src.anyMeasured();

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

/**
 * When today's steps were last shared, under the Health tab's rings: "Samsung Health last shared steps at 8:40 pm".
 * The watch or phone app passes them to Health Connect every so often, so the count here is its count as of then.
 * For today only, from this phone's last read (null on another day, before a read today, or on the website).
 */
export function stepsSharedText(s: StepsShared | null, k: DayKey, today = todayKey()): string | null {
  if (!s || k !== today || keyOf(new Date(s.at)) !== today) return null;
  const at = new Date(s.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toLowerCase();
  const app = appName(s.from);
  return app ? `${app} last shared steps at ${at}` : `Steps last shared with Health Connect at ${at}`;
}

/** "10:45 pm" for minutes after midnight (wrapping past 24 h). */
export function clockText(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const d = new Date(2026, 0, 1, Math.floor(m / 60), m % 60);
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}
