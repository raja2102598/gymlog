/* Pure calculations for the dashboard, the Health tab's measurements, add-weight hints and records. No DOM and no
 * storage, so they can be unit-tested on their own. Days are "YYYY-MM-DD" keys; sets are { reps, kg }. */
import type { DayKey, SetLog } from "./types";

/** Counts toward the planned sets, records and volume: a warm-up doesn't. */
export const isWorkingSet = (s: SetLog) => s.type !== "warmup";

const DAY = 86400000;
export const dayNum = (k: DayKey) => {
  const [y, m, d] = k.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
};
export const keyOfNum = (n: number): DayKey => new Date(n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: DayKey, b: DayKey) => dayNum(b) - dayNum(a);

/* ---------- body-weight trend ---------- */

export interface TrendPoint {
  day: DayKey;
  weight: number;
  /** A real weigh-in, not a day filled in between two. */
  measured: boolean;
  trend: number;
}

// After TrendWeight (github.com/ervwalter/trendweight, MIT): one value per day from the first to the
// last weigh-in, gaps filled with straight lines, then Holt's double exponential smoothing (level and
// slope, alpha = beta = 0.1), which follows steady loss with less lag than a plain moving average.
// Unlike TrendWeight, level and slope start from a straight-line fit of the first two weeks: started
// flat from the first weigh-in, the trend lags a steady loss for weeks and then overshoots it.
export function weightTrend(points: [DayKey, number][], alpha = 0.1, beta = 0.1): TrendPoint[] {
  const pts = points.filter(([, w]) => w > 0).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const out: Omit<TrendPoint, "trend">[] = [];
  pts.forEach(([k, w], i) => {
    if (i) {
      const [pk, pw] = pts[i - 1], pn = dayNum(pk), n = dayNum(k);
      for (let g = pn + 1; g < n; g++) out.push({ day: keyOfNum(g), weight: pw + ((w - pw) * (g - pn)) / (n - pn), measured: false });
    }
    out.push({ day: k, weight: w, measured: true });
  });
  const head = out.slice(0, 14).map((p) => p.weight);
  let b = slope(head) ?? 0;
  let level = head.reduce((a, w) => a + w, 0) / (head.length || 1) - (b * (head.length - 1)) / 2;
  return out.map((p, i) => {
    if (i) {
      const prev = level;
      level = alpha * p.weight + (1 - alpha) * (level + b);
      b = beta * (level - prev) + (1 - beta) * b;
    }
    return { ...p, trend: level };
  });
}

/** Least-squares slope of ys against xs (0, 1, 2, … when xs is left out). */
export function slope(ys: number[], xs: number[] = ys.map((_, i) => i)): number | null {
  const n = ys.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, x) => a + x, 0) / n, my = ys.reduce((a, y) => a + y, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, i) => {
    num += (xs[i] - mx) * (y - my);
    den += (xs[i] - mx) ** 2;
  });
  return den ? num / den : null;
}

// kg per week: least-squares slope of the weigh-ins in the four weeks up to the latest one. It needs
// six or more weigh-ins spread over at least two weeks; over less, water weight swamps the change.
export function weeklyRate(series: TrendPoint[]): number | null {
  const m = series.filter((p) => p.measured);
  if (!m.length) return null;
  const end = dayNum(m[m.length - 1].day), win = m.filter((p) => end - dayNum(p.day) < 28);
  if (win.length < 6 || end - dayNum(win[0].day) < 13) return null;
  const b = slope(win.map((p) => p.weight), win.map((p) => dayNum(p.day)));
  return b == null ? null : b * 7;
}

// Trend change over the last `days`, if the trend reaches back that far and at least `minReadings`
// real weigh-ins fall inside the window.
export function trendChange(series: TrendPoint[], days: number, minReadings = 3): number | null {
  const i = series.length - 1 - days;
  if (i < 0) return null;
  const readings = series.slice(i + 1).filter((p) => p.measured).length;
  return readings >= minReadings ? series[series.length - 1].trend - series[i].trend : null;
}

// Day the trend reaches `goal` at the current rate: only while heading toward it and under three years away.
export function goalDate(series: TrendPoint[], rateKgWeek: number | null, goal: number | null): DayKey | null {
  if (!series.length || rateKgWeek == null || goal == null) return null;
  const last = series[series.length - 1], perDay = rateKgWeek / 7, gap = goal - last.trend;
  if (!perDay || Math.sign(gap) !== Math.sign(perDay)) return null;
  const days = Math.ceil(gap / perDay);
  return days > 0 && days < 3 * 365 ? keyOfNum(dayNum(last.day) + days) : null;
}

/* ---------- a measurement logged now and then: waist, chest, arms, thighs, hips, body fat ---------- */

export interface MeasureChange {
  day: DayKey;
  value: number;
  change: { since: DayKey; value: number } | null;
}

// The latest reading and how it has changed from the closest earlier one at least `days` before it (about four
// weeks by default). Unlike weight, these are typed now and then rather than every day, so there's no daily
// trend line: just the last reading and what it moved from roughly a month back. Null with no readings at all.
export function measureChange(readings: [DayKey, number][], days = 28): MeasureChange | null {
  if (!readings.length) return null;
  const sorted = [...readings].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const [day, value] = sorted[sorted.length - 1];
  const base = sorted.filter(([k]) => daysBetween(k, day) >= days).pop();
  return { day, value, change: base ? { since: base[0], value: value - base[1] } : null };
}

/* ---------- lifts ---------- */

// Brzycki estimate, only for sets of 1-12 reps (higher-rep estimates are unreliable).
export function e1rm(kg: number | null | undefined, reps: number | null | undefined): number | null {
  return kg != null && kg > 0 && reps != null && reps >= 1 && reps <= 12 ? (kg * 36) / (37 - reps) : null;
}

/** "8-10" -> [8, 10], "12" -> [12, 12], anything else -> null. */
export function repRange(s: string | null | undefined): [number, number] | null {
  const n = String(s ?? "").match(/\d+/g);
  if (!n) return null;
  const lo = +n[0], hi = +(n[1] ?? n[0]);
  return lo > 0 && hi >= lo ? [lo, hi] : null;
}

export interface NextStep {
  from: number;
  to: number;
  top: number;
}

// Double progression: when every working set last time reached the top of the rep range at one
// weight, it's time to add `step` kg.
export function readyToAdd(sets: SetLog[] | undefined, reps: string, minSets: number, step: number): NextStep | null {
  const range = repRange(reps);
  if (!range || !(step > 0)) return null;
  const work = (sets || []).filter((s) => s && isWorkingSet(s) && s.reps != null && s.kg != null && s.kg >= 0) as { reps: number; kg: number }[];
  if (!work.length || work.length < minSets) return null;
  const kg = work[0].kg;
  if (!work.every((s) => s.kg === kg && s.reps >= range[1])) return null;
  return { from: kg, to: Math.round((kg + step) * 100) / 100, top: range[1] };
}

/* ---------- plates ---------- */

export interface PlateBreakdown {
  /** One entry per plate size actually used, heaviest first: how many go on each side. */
  perSide: { kg: number; count: number }[];
  /** What the plates and bar actually come to: at most `kg`, since a plate is never split or guessed at. */
  loaded: number;
  /** `kg` minus `loaded`: 0 when the plates make it exactly. */
  shortBy: number;
  /** `kg` is under the bar's own weight, so no plates can reach it. */
  underBar: boolean;
}

// The plates for one side that come closest to the target without going over, with the fewest plates that
// does, heaviest first among equals; as many of each as it takes (a gym rarely runs out). Heaviest-first alone
// can miss: with 25 and 15 kg plates, 30 kg a side is two 15s, not a 25 and 5 kg short. Counted in 0.05 kg
// steps, which every usual plate is a whole number of, with any other plate rounded up to one so the count
// never loads more than asked. A target under the bar loads the bar alone, since it can't go any lighter.
export function platesFor(kg: number, barKg: number, plateKgs: number[]): PlateBreakdown {
  const bar = barKg > 0 ? barKg : 0;
  if (kg < bar) return { perSide: [], loaded: bar, shortBy: Math.round((kg - bar) * 100) / 100, underBar: true };
  const sizes = [...new Set(plateKgs.filter((p) => p > 0))].sort((a, b) => b - a);
  const STEP = 0.05, units = sizes.map((p) => Math.ceil(p / STEP - 1e-9));
  // A side past 1000 kg is a typo: the search stops there rather than take long, and the rest shows as short.
  const target = Math.min(Math.floor((kg - bar) / 2 / STEP + 1e-9), 20000);
  const fewest = new Array<number>(target + 1).fill(Infinity), last = new Array<number>(target + 1).fill(-1);
  fewest[0] = 0;
  for (let t = 1; t <= target; t++)
    units.forEach((u, i) => {
      if (u <= t && fewest[t - u] + 1 < fewest[t]) [fewest[t], last[t]] = [fewest[t - u] + 1, i];
    });
  let t = target;
  while (t > 0 && fewest[t] === Infinity) t--;
  const count = new Map<number, number>();
  for (; t > 0; t -= units[last[t]]) count.set(last[t], (count.get(last[t]) ?? 0) + 1);
  const perSide = sizes.flatMap((p, i) => (count.has(i) ? [{ kg: p, count: count.get(i) as number }] : []));
  const loaded = Math.round((bar + 2 * perSide.reduce((a, p) => a + p.kg * p.count, 0)) * 100) / 100;
  return { perSide, loaded, shortBy: Math.round((kg - loaded) * 100) / 100, underBar: false };
}

/* ---------- warm-up ladder ---------- */

export interface WarmupStep {
  pct: number;
  kg: number;
  reps: number;
}

// 40, 60 and 80 percent of the working weight, fewer reps as it climbs: a common ramp before the working sets.
const WARMUP_STEPS: readonly { pct: number; reps: number }[] = [
  { pct: 40, reps: 8 },
  { pct: 60, reps: 5 },
  { pct: 80, reps: 3 },
];

// Rounded to the nearest 2.5 kg (a plate pair's smallest common step) and never over the working weight. A barbell
// lift's warm-ups never go under the bar, which can't be loaded any lighter; a working weight under the bar is a
// dumbbell or machine lift, so the bar doesn't apply there, and a step that rounds to nothing is left out.
export function warmupLadder(workingKg: number, barKg: number): WarmupStep[] {
  const bar = barKg > 0 && workingKg >= barKg ? barKg : 0;
  return WARMUP_STEPS.map(({ pct, reps }) => ({ pct, reps, kg: Math.min(workingKg, Math.max(bar, Math.round((workingKg * pct) / 100 / 2.5) * 2.5)) })).filter(
    (s) => s.kg > 0,
  );
}

export type RecordKind = "weight" | "e1rm" | "reps";
export interface LiftDay {
  day: DayKey;
  lifts: { name: string; sets: SetLog[] }[];
}
export interface LiftRecord {
  day: DayKey;
  name: string;
  set: number;
  kg: number;
  reps: number | null;
  e1rm: number | null;
  kinds: RecordKind[];
}
/** Per exercise: heaviest weight, best estimated 1RM, and the most reps done at each weight. */
export type RecordFold = Map<string, { kg: number; e1rm: number | null; repsAt: Map<number, number> }>;

// Personal records. `days` is oldest first. Each set is compared with every earlier day of the same
// exercise (not with other sets that day): heaviest weight, best estimated 1RM, or most reps at that
// weight or heavier. An exercise's first day sets no records. Per exercise and day, each kind of record
// goes to the best set only.
export function records(days: LiftDay[]): LiftRecord[] {
  const best: RecordFold = new Map(), out: LiftRecord[] = [];
  for (const d of days) {
    out.push(...checkDay(best, d));
    foldDay(best, d);
  }
  return out;
}

// The records one day sets against `best`, the fold of every earlier day. Leaves `best` alone, so a
// caller can keep the fold of the days before today and re-check today on every keystroke.
export function checkDay(best: RecordFold, { day, lifts }: LiftDay): LiftRecord[] {
  const out: LiftRecord[] = [];
  for (const { name, sets } of lifts) {
    const b = best.get(name);
    if (!b) continue;
    const top: Partial<Record<RecordKind, { v: number; i: number }>> = {};
    sets.forEach((s, i) => {
      if (!s || s.kg == null || !isWorkingSet(s)) return;
      const e = s.reps != null ? e1rm(s.kg, s.reps) : null;
      const cands: [RecordKind, number][] = [];
      if (s.kg > b.kg) cands.push(["weight", s.kg]);
      if (e != null && b.e1rm != null && e > b.e1rm + 1e-9) cands.push(["e1rm", e]);
      if (s.reps != null) {
        let most = -Infinity; // most reps in any earlier set at this weight or heavier
        for (const [kg, reps] of b.repsAt) if (kg >= s.kg && reps > most) most = reps;
        if (s.reps > most && most > -Infinity) cands.push(["reps", s.reps * 1000 + s.kg]);
      }
      for (const [kind, v] of cands) if (!top[kind] || v > top[kind]!.v) top[kind] = { v, i };
    });
    const bySet = new Map<number, RecordKind[]>();
    for (const [kind, t] of Object.entries(top) as [RecordKind, { v: number; i: number }][]) bySet.set(t.i, [...(bySet.get(t.i) || []), kind]);
    for (const [i, kinds] of bySet) out.push({ day, name, set: i, kg: sets[i].kg as number, reps: sets[i].reps, e1rm: e1rm(sets[i].kg, sets[i].reps), kinds });
  }
  return out;
}

// Adds a day's sets to `best`. Done only after the day is checked, so sets on one day don't compete.
// Per exercise it keeps the heaviest weight, the best estimated 1RM and the most reps done at each
// weight (a few distinct weights, so checking a set doesn't mean scanning every earlier set).
export function foldDay(best: RecordFold, { lifts }: LiftDay): void {
  for (const { name, sets } of lifts) {
    const good = sets.filter((s) => s && s.kg != null && isWorkingSet(s)) as { reps: number | null; kg: number }[];
    if (!good.length) continue;
    const b = best.get(name) || { kg: -Infinity, e1rm: null, repsAt: new Map<number, number>() };
    for (const s of good) {
      b.kg = Math.max(b.kg, s.kg);
      const e = s.reps != null ? e1rm(s.kg, s.reps) : null;
      if (e != null) b.e1rm = Math.max(b.e1rm ?? 0, e);
      const had = b.repsAt.get(s.kg);
      if (s.reps != null && !(had != null && had >= s.reps)) b.repsAt.set(s.kg, s.reps);
    }
    best.set(name, b);
  }
}
