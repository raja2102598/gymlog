/* What the dashboard shows, worked out from the store: one model per card, plus the flags each card
 * raises for the list at the top. No rendering here, so the numbers can be tested on their own. */
import { addDays, DOW, dm, mondayOf } from "./dates";
import { avg, signed, sum } from "./format";
import { hoursMin } from "./health";
import { MUSCLES, type Muscle } from "./library";
import * as S from "./stats";
import { setsOf, topKg, type GymStore } from "./store";
import type { DayKey, PlanExercise, SetLog } from "./types";

export interface Flag {
  /** Lower comes first. */
  pri: number;
  warn?: boolean;
  text: string;
}

/* ---------- weight: is the trend moving at the intended pace? ---------- */

export type GoalKpi =
  | { kind: "none" }
  | { kind: "reached"; goal: number }
  | { kind: "date"; goal: number; day: DayKey }
  | { kind: "unknown"; goal: number; why: string };

export interface WeightModel {
  flags: Flag[];
  series: S.TrendPoint[];
  trend?: number;
  /** Days since the last weigh-in. */
  since?: number;
  /** kg a week, and as % of body weight. */
  rate?: number | null;
  pct?: number | null;
  goal?: GoalKpi;
  /** Trend change over 1, 2 and 4 weeks, where there's enough data: [weeks, kg]. */
  changes?: [number, number][];
  /** The goal line, drawn only when it's near enough not to squash the chart. */
  chartGoal?: number | null;
  waist?: { day: DayKey; cm: number; change: { since: DayKey; cm: number } | null } | null;
}

export function weightModel(store: GymStore, t: DayKey): WeightModel {
  const s = store.weightSeries(), flags: Flag[] = [];
  if (!s.length) return { flags, series: s };
  const first = s[0], last = s[s.length - 1], since = S.daysBetween(s.filter((p) => p.measured).pop()!.day, t);
  const rate = S.weeklyRate(s), pct = rate != null ? (rate / last.trend) * 100 : null;
  const goal = store.plan.goalWeight, target = store.plan.weeklyRatePct;
  if (since >= 5) flags.push({ pri: 2, warn: true, text: `No weigh-in for ${since} days. A few weigh-ins a week keep the trend honest.` });
  if (target && pct != null && s.length >= 21) {
    const loss = -pct;
    if (loss < target / 2)
      flags.push({
        pri: 3,
        text: loss > 0 ? `Losing ${loss.toFixed(2)}% a week, well under your ${target}% target.` : `The trend isn’t going down yet (${signed(pct, 2)}% a week) against your ${target}% target.`,
      });
    else if (loss > target * 1.5) flags.push({ pri: 3, warn: true, text: `Losing ${loss.toFixed(2)}% a week, faster than your ${target}% target.` });
  }
  let goalKpi: GoalKpi;
  if (goal == null) goalKpi = { kind: "none" };
  else if ((last.trend - goal) * (first.trend - goal) <= 0) goalKpi = { kind: "reached", goal };
  else {
    const day = S.goalDate(s, rate, goal);
    goalKpi = day ? { kind: "date", goal, day } : { kind: "unknown", goal, why: rate == null ? "needs 2 weeks of weigh-ins" : "not heading there yet" };
  }
  const changes = [7, 14, 28].map((d) => [d / 7, S.trendChange(s, d)]).filter((c): c is [number, number] => c[1] != null);
  const waist = S.measureChange(store.days().filter((k) => store.logs[k].waist != null).map((k): [DayKey, number] => [k, store.logs[k].waist as number]));
  return {
    flags,
    series: s,
    trend: last.trend,
    since,
    rate,
    pct,
    goal: goalKpi,
    changes,
    chartGoal: goal != null && Math.abs(goal - last.trend) <= 8 ? goal : null,
    waist: waist ? { day: waist.day, cm: waist.value, change: waist.change ? { since: waist.change.since, cm: waist.change.value } : null } : null,
  };
}

/* ---------- plan kept: am I keeping the plan? ---------- */

export type HeatClass = "done" | "part" | "miss" | "todo" | "rest" | "fut" | "pre";
export const HEAT_WORDS: Record<HeatClass, string> = { done: "all lifts done", part: "some lifts done", miss: "missed", todo: "to do", rest: "rest day", fut: "ahead", pre: "before you started" };

export interface PlanModel {
  /** Planned sessions done this week, of how many; and free-form workouts, which count on their own. */
  week: { done: number; planned: number; extra: number };
  /** Full weeks in a row; the current week only counts once it's full. */
  streak: number;
  recent: { weeks: number; done: number; planned: number };
  cardioDays: number;
  cardioMin: number;
  weighIns: number;
  /** Up to 16 weeks of workout days, oldest first. */
  heat: { day: DayKey; cls: HeatClass }[][];
}

export function planModel(store: GymStore, t: DayKey): PlanModel {
  const start = store.firstDay(), mon = mondayOf(t), weeks = [];
  for (let m = mondayOf(start); m <= mon; m = addDays(m, 7)) weeks.push({ mon: m, ...store.weekSessions(m) });
  let streak = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i].planned && weeks[i].done >= weeks[i].planned) streak++;
    else if (weeks[i].mon !== mon) break;
  }
  const recent = weeks.slice(-12), tw = weeks[weeks.length - 1], wk = tw.days.filter((k) => k <= t && k >= start);
  // Workout days only: steps and weigh-ins have their own cards.
  const cls = (k: DayKey): HeatClass => {
    if (k > t) return "fut";
    if (k < start) return "pre";
    const p = store.planFor(k), n = p.exercises.filter((x) => store.entry(k).exercises[x.name]?.done).length;
    if (!p.exercises.length) return "rest";
    return n === p.exercises.length ? "done" : n || store.worked(k) ? "part" : k < t ? "miss" : "todo";
  };
  return {
    week: { done: tw.done, planned: tw.planned, extra: tw.extra },
    streak,
    recent: { weeks: recent.length, done: sum(recent.map((w) => w.done)), planned: sum(recent.map((w) => w.planned)) },
    cardioDays: wk.filter((k) => store.entry(k).cardio).length,
    cardioMin: sum(wk.map((k) => store.entry(k).cardioMin || 0)),
    weighIns: wk.filter((k) => store.weightOf(k) != null).length,
    heat: weeks.slice(-16).map((w) => DOW.map((_, i) => addDays(w.mon, i)).map((day) => ({ day, cls: cls(day) }))),
  };
}

/* ---------- steps: am I walking enough? ---------- */

export interface StepsModel {
  goal: number;
  /** Average of the last 7 days with steps logged. */
  avg7: number | null;
  atGoal: number;
  daysSoFar: number;
  /** Average daily steps for up to 12 weeks: [monday, average]. */
  bars: [DayKey, number | null][];
}

export function stepsModel(store: GymStore, t: DayKey): StepsModel {
  const start = store.firstDay(), goal = store.plan.stepGoal, mon = mondayOf(t);
  const steps = (k: DayKey) => store.stepsOf(k);
  const avg7 = avg(DOW.map((_, i) => addDays(t, -i)).filter((k) => k >= start).map(steps).filter((v): v is number => v != null));
  const wk = DOW.map((_, i) => addDays(mon, i)).filter((k) => k <= t && k >= start), weeks = [];
  for (let m = mondayOf(start); m <= mon; m = addDays(m, 7)) weeks.push(m);
  return {
    goal,
    avg7,
    atGoal: wk.filter((k) => (steps(k) || 0) >= goal).length,
    daysSoFar: wk.length,
    bars: weeks.slice(-12).map((m) => [m, avg(DOW.map((_, i) => steps(addDays(m, i))).filter((v): v is number => v != null))]),
  };
}

/* ---------- sleep and resting heart rate, from Health Connect ---------- */

/** Flags for Progress when recovery slips: the last 7 days' sleep, and resting heart rate against the 7 before.
 *  (The charts are in the Health tab.) */
export function healthModel(store: GymStore, t: DayKey): { flags: Flag[] } {
  const days = (n: number, skip = 0) => Array.from({ length: n }, (_, i) => addDays(t, -i - skip));
  const mean = (ks: DayKey[], f: (k: DayKey) => number | undefined) => avg(ks.map(f).filter((v): v is number => v != null && v > 0));
  const sleep = (k: DayKey) => store.healthOf(k)?.sleepMin, rhr = (k: DayKey) => store.healthOf(k)?.restingHr;
  const sleep7 = mean(days(7), sleep), rhr7 = mean(days(7), rhr), rhrPrev = mean(days(7, 7), rhr);
  const flags: Flag[] = [];
  if (sleep7 != null && sleep7 < 6 * 60) flags.push({ pri: 3, text: `Sleeping ${hoursMin(sleep7)} a night on average this week. Short sleep makes a cut harder on muscle and appetite.` });
  if (rhr7 != null && rhrPrev != null && rhr7 >= rhrPrev + 5)
    flags.push({ pri: 3, text: `Resting heart rate is ${Math.round(rhr7 - rhrPrev)} bpm higher than last week, which can mean too little sleep, stress or a cold coming on.` });
  return { flags };
}

/* ---------- strength: is it holding during the cut? ---------- */

export interface LiftPoint {
  day: DayKey;
  /** Heaviest set that day, kg, leaving out drop sets (some old entries hold only a weight, with no reps). */
  top: number | null;
  /** The most reps done at that weight that day, or null when none were logged with it. */
  topReps: number | null;
  /** Best estimated 1RM that day (Brzycki, from sets of 1-12 reps: see e1rm in stats.ts), or null when no
   *  set qualifies. */
  e1rm: number | null;
  /** That day's sets with both a weight and reps, kg × reps summed: a set missing either adds nothing, so
   *  it can't inflate the load. */
  volume: number;
}

// Every day this lift has anything logged for it, oldest first: not only the days the plan currently puts it
// on, so a lift moved to another day, or a day logged under an older plan, still counts (liftSets reads the
// day's own entries, not today's plan). Renaming a plan exercise starts a fresh name for this to match on;
// its earlier days stay under the old one (see the note on DayLog in types.ts) and so drop out of a page
// opened at the new name, the same as they would from a search for the old one.
const loaded = (sets: SetLog[]) => sets.filter((s): s is { reps: number; kg: number } => s.reps != null && s.kg != null);
function liftPoints(store: GymStore, days: DayKey[], name: string): LiftPoint[] {
  const out: LiftPoint[] = [];
  for (const k of days) {
    const sets = store.liftSets(k).filter((l) => l.name === name).flatMap((l) => l.sets);
    if (!sets.some((s) => s.reps != null || s.kg != null)) continue;
    // A drop set adds to the volume but, as with records, never to the heaviest set or the 1RM.
    const straight = sets.filter(S.isStraightSet), top = topKg(straight);
    out.push({
      day: k,
      top,
      topReps: Math.max(0, ...loaded(straight).filter((s) => s.kg === top).map((s) => s.reps)) || null,
      e1rm: Math.max(0, ...straight.map((s) => S.e1rm(s.kg, s.reps) || 0)) || null,
      volume: sum(loaded(sets).map((s) => s.reps * s.kg)),
    });
  }
  return out;
}

/** "+17% since 31 Aug", "holding since …", or "first session", from a lift's 1RM points (oldest first, at
 *  least one). */
function e1rmChange(points: [DayKey, number][]): string {
  if (points.length < 2) return "first session";
  const [lk, lv] = points[points.length - 1], base = points.filter(([k]) => S.daysBetween(k, lk) >= 28).pop() || points[0], pc = ((lv - base[1]) / base[1]) * 100;
  return Math.abs(pc) < 2.5 ? `holding since ${dm(base[0])}` : `${signed(pc, 0)}% since ${dm(base[0])}`;
}

/** Where a lift is in the plan: the days it's on, with its rep range on each. */
export type Planned = { day: string; reps: [number, number] | null }[];

/** Each lift in the plan, in the plan's order, with the days it's on. Days that read the same (the same session
 *  name and rep range: Push on Monday and Thursday, or a day listing the lift twice) count once; two Push days
 *  with different rep ranges stay two, so neither range is hidden. */
function plannedDays(store: GymStore): Map<string, Planned> {
  const out = new Map<string, Planned>();
  for (const d of store.plan.days)
    for (const x of d.exercises) {
      const on = out.get(x.name) ?? [], reps = S.repRange(x.reps);
      if (!on.some((p) => p.day === d.name && String(p.reps) === String(reps))) on.push({ day: d.name, reps });
      out.set(x.name, on);
    }
  return out;
}

export interface StrengthRow {
  name: string;
  day: string;
  /** Best estimated 1RM per session, oldest first. */
  points: [DayKey, number][];
  /** "+17% since 31 Aug", "holding since …", "first session", or why there's no estimate. */
  change: string;
}
export interface NextUp {
  name: string;
  day: string;
  from: number;
  to: number;
}
export interface StrengthModel {
  flags: Flag[];
  anyLogged: boolean;
  rows: StrengthRow[];
  ready: NextUp[];
  held: NextUp[];
  /** Lifts due a deload: enough sessions in a row fell short of the rep range. */
  deload: NextUp[];
  records: S.LiftRecord[];
}

export function strengthModel(store: GymStore, t: DayKey): StrengthModel {
  const flags: Flag[] = [], days = store.days().filter((k) => k <= t);
  // Every lift in the plan, not only each day's first. A lift on two days (Seated Row on Pull and Upper) is one
  // row naming both: its history is matched by name, so it's the same history whichever day it was done on.
  const rows = [...plannedDays(store)].map(([name, on]): StrengthRow => {
    const points = liftPoints(store, days, name)
      .filter((p) => p.e1rm != null)
      .map((p): [DayKey, number] => [p.day, p.e1rm as number]);
    const logged = points.length > 0 || days.some((k) => store.liftSets(k).some((l) => l.name === name));
    return {
      name,
      day: [...new Set(on.map((p) => p.day))].join(", "),
      points,
      change: points.length ? e1rmChange(points) : logged ? "no estimate yet: needs a set with weight and 1-12 reps" : "not logged yet",
    };
  });
  // Lifts ready for more weight next time, knee lifts held back after a sore day, and lifts due a deload. A lift
  // worked at a percentage of its 1RM is only ready when that's more than it last lifted. Each day a lift is on
  // counts, since two can progress it differently (a deload on one only, say): the same answer twice, as a lift
  // with the same settings on both gives, shows once, under the first.
  const tomorrow = addDays(t, 1), seen = new Set<string>(), ready: NextUp[] = [], held: NextUp[] = [], deload: NextUp[] = [];
  store.plan.days.forEach((d) =>
    d.exercises.forEach((x: PlanExercise) => {
      const nw = store.nextWeight(x, x.name, tomorrow);
      if (!nw || nw.from == null) return;
      const list = nw.rule === "deload" ? deload : nw.held ? held : nw.to > nw.from ? ready : null, key = `${x.name}|${nw.rule === "deload"}|${nw.held}|${nw.to}`;
      if (!list || seen.has(key)) return;
      seen.add(key);
      list.push({ name: x.name, day: d.name, from: nw.from, to: nw.to });
    }),
  );
  const lifts = (l: NextUp[]) => new Set(l.map((x) => x.name)).size, nReady = lifts(ready), nDeload = lifts(deload);
  if (nReady) flags.push({ pri: 4, text: `${nReady} lift${nReady === 1 ? " is" : "s are"} ready for more weight. See Strength.` });
  if (nDeload) flags.push({ pri: 4, text: `${nDeload} lift${nDeload === 1 ? " is" : "s are"} due a deload. See Strength.` });
  return {
    flags,
    anyLogged: days.some((k) => store.liftSets(k).length > 0),
    rows,
    ready,
    held,
    deload,
    records: store.recentRecords(t, 30).reverse().slice(0, 8),
  };
}

/* ---------- sets per muscle: is each muscle getting enough? ---------- */

export interface MuscleRow {
  muscle: Muscle;
  /** Its sets in each of the four weeks, oldest first. */
  sets: number[];
  /** Last week under 10 sets or over 20, outside the range most advice gives: under only for a muscle trained on
   *  purpose (a main muscle of a lift done), and neither before the account's first full week. */
  note: "under" | "over" | null;
}

export interface MusclesModel {
  /** The four weeks' Mondays, oldest first: the last is this week, so far. */
  weeks: DayKey[];
  /** Muscles with any sets in them, most first. */
  rows: MuscleRow[];
  /** Lifts done in them with no muscles to count (not in the library, or yours with none given), with their sets. */
  untagged: { name: string; sets: number }[];
}

export function musclesModel(store: GymStore, t: DayKey): MusclesModel {
  const mon = mondayOf(t), weeks = [-21, -14, -7, 0].map((n) => addDays(mon, n));
  const days = store.days().filter((k) => k >= weeks[0] && k <= t).map((k) => ({ day: k, lifts: store.liftSets(k) }));
  const w = S.muscleWeeks(days, weeks, (name) => {
    const x = store.exerciseOf(name);
    return x?.primary.length ? x : null;
  });
  const judged = store.firstDay() <= weeks[2];
  const note = (m: string, n: number): MuscleRow["note"] => (!judged ? null : n > 20 ? "over" : n < 10 && w.main.has(m) ? "under" : null);
  return {
    weeks,
    rows: [...w.muscles]
      .map(([m, sets]) => ({ muscle: m as Muscle, sets, note: note(m, sets[2]) }))
      .sort((a, b) => sum(b.sets) - sum(a.sets) || MUSCLES[a.muscle].localeCompare(MUSCLES[b.muscle])),
    untagged: [...w.untagged].map(([name, sets]) => ({ name, sets: sum(sets) })).sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name)),
  };
}

/* ---------- one lift: its own page, opened from Strength or a lift's card ---------- */

export interface LiftModel {
  name: string;
  /** The plan's days for it, with its rep range on each, while this is still a lift in the current plan
   *  (matched by name, so a lift renamed or dropped from the plan has none). */
  planned: Planned;
  /** One entry per session logged for this lift, oldest first; empty when it's never been logged. */
  points: LiftPoint[];
  /** The heaviest set, and the best estimated 1RM, ever logged for it, each with the day it happened. */
  bestTop: [DayKey, number] | null;
  bestE1rm: [DayKey, number] | null;
  /** Every session's volume, added up. */
  volume: number;
  /** Sessions a week, from the first one logged to `t`; null until at least a week separates two sessions. */
  perWeek: number | null;
}

export function liftModel(store: GymStore, t: DayKey, name: string): LiftModel {
  const days = store.days().filter((k) => k <= t);
  const points = liftPoints(store, days, name);
  const best = (f: (p: LiftPoint) => number | null): [DayKey, number] | null =>
    points.reduce<[DayKey, number] | null>((b, p) => {
      const v = f(p);
      return v != null && (!b || v > b[1]) ? [p.day, v] : b;
    }, null);
  const span = points.length > 1 ? S.daysBetween(points[0].day, t) : 0;
  return {
    name,
    planned: plannedDays(store).get(name) ?? [],
    points,
    bestTop: best((p) => p.top),
    bestE1rm: best((p) => p.e1rm),
    volume: sum(points.map((p) => p.volume)),
    perWeek: span >= 7 ? (points.length / span) * 7 : null,
  };
}

/* ---------- knee: how is it responding? ---------- */

export interface KneeRow {
  day: DayKey;
  name: string;
  /** Weights on the knee lifts that session, e.g. "Leg Press 50 kg". */
  loads: string[];
  before: number | null;
  after: number | null;
  wake: number | null;
  /** Morning pain above the pre-session level: not settled. */
  unsettled: boolean;
}
export type KneeModel =
  | { kind: "none"; flags: Flag[] }
  | { kind: "prompt"; flags: Flag[]; dayNames: string[]; limit: number }
  | { kind: "table"; flags: Flag[]; limit: number; now: number | null; prev: number | null; rows: KneeRow[] };

export function kneeModel(store: GymStore, t: DayKey): KneeModel {
  const flags: Flag[] = [], lim = store.plan.kneeLimit, kneeDays = store.plan.days.filter((d) => store.kneeLifts(d).length);
  if (!kneeDays.length) return { kind: "none", flags };
  const e = (k: DayKey) => store.entry(k);
  const scored = (k: DayKey) => e(k).kneeBefore != null || e(k).kneeAfter != null || e(addDays(k, 1)).kneeWake != null;
  const sess = store
    .days()
    .filter((k) => k <= t && store.kneeDay(k) && (store.worked(k) || scored(k)))
    .slice(-10);
  if (!sess.some(scored)) return { kind: "prompt", flags, dayNames: [...new Set(kneeDays.map((d) => d.name))], limit: lim };
  const last = sess[sess.length - 1];
  if (store.kneeBad(last)) flags.push({ pri: 1, warn: true, text: `Knee was above your limit after ${store.planFor(last).name} on ${dm(last)}. Knee lifts hold their weight until a better session.` });
  const mon = mondayOf(t);
  const vals = (m: DayKey) =>
    DOW.map((_, i) => addDays(m, i))
      .flatMap((k) => [e(k).kneeAfter, e(k).kneeWake])
      .filter((v): v is number => v != null);
  const now = avg(vals(mon)), prev = avg(vals(addDays(mon, -7)));
  if (now != null && prev != null && now > prev + 0.5) flags.push({ pri: 1, warn: true, text: `Knee pain is up this week: ${now.toFixed(1)} on average, against ${prev.toFixed(1)} last week.` });
  const rows = sess
    .slice()
    .reverse()
    .map((k): KneeRow => {
      const d = e(k), wake = e(addDays(k, 1)).kneeWake ?? null;
      const loads = store
        .kneeLifts(store.planFor(k))
        .map((x) => {
          const r = d.exercises[x.name], top = r && !r.skipped ? topKg(setsOf(r)) : null;
          return top != null ? `${r.swap || x.name} ${top} kg` : "";
        })
        .filter(Boolean);
      return { day: k, name: store.planFor(k).name, loads, before: d.kneeBefore ?? null, after: d.kneeAfter ?? null, wake, unsettled: wake != null && d.kneeBefore != null && wake > d.kneeBefore };
    });
  return { kind: "table", flags, limit: lim, now, prev, rows };
}
