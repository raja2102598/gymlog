/* What the dashboard shows, worked out from the store: one model per card, plus the flags each card
 * raises for the list at the top. No rendering here, so the numbers can be tested on their own. */
import { addDays, DOW, dm, mondayOf } from "./dates";
import { avg, signed, sum } from "./format";
import * as S from "./stats";
import { setsOf, topKg, type GymStore } from "./store";
import type { DayKey, PlanExercise } from "./types";

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
        text: loss > 0 ? `Losing ${loss.toFixed(2)}% a week, well under your ${target}% target.` : `The trend isn't going down yet (${signed(pct, 2)}% a week) against your ${target}% target.`,
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
  const wd = store.days().filter((k) => store.logs[k].waist != null), wl = wd[wd.length - 1];
  const w4 = wl ? wd.filter((k) => S.daysBetween(k, wl) >= 28).pop() : undefined;
  const cm = (k: DayKey) => store.logs[k].waist as number;
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
    waist: wl ? { day: wl, cm: cm(wl), change: w4 ? { since: w4, cm: cm(wl) - cm(w4) } : null } : null,
  };
}

/* ---------- plan kept: am I keeping the plan? ---------- */

export type HeatClass = "done" | "part" | "miss" | "todo" | "rest" | "fut" | "pre";
export const HEAT_WORDS: Record<HeatClass, string> = { done: "all lifts done", part: "some lifts done", miss: "missed", todo: "to do", rest: "rest day", fut: "ahead", pre: "before you started" };

export interface PlanModel {
  week: { done: number; planned: number };
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
    week: { done: tw.done, planned: tw.planned },
    streak,
    recent: { weeks: recent.length, done: sum(recent.map((w) => w.done)), planned: sum(recent.map((w) => w.planned)) },
    cardioDays: wk.filter((k) => store.entry(k).cardio).length,
    cardioMin: sum(wk.map((k) => store.entry(k).cardioMin || 0)),
    weighIns: wk.filter((k) => store.entry(k).weight != null).length,
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
  const steps = (k: DayKey) => store.entry(k).steps;
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

/* ---------- strength: is it holding during the cut? ---------- */

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
  records: S.LiftRecord[];
}

export function strengthModel(store: GymStore, t: DayKey): StrengthModel {
  const flags: Flag[] = [], days = store.days().filter((k) => k <= t);
  // Each gym day's first lift stands in for that day.
  const rows = store.plan.days
    .filter((d) => d.exercises.length)
    .map((d): StrengthRow => {
      const x = d.exercises[0];
      const points = days
        .map((k): [DayKey, number] => [k, Math.max(0, ...store.liftSets(k).filter((l) => l.name === x.name).flatMap((l) => l.sets.map((s) => S.e1rm(s.kg, s.reps) || 0)))])
        .filter(([, v]) => v > 0);
      let change = "";
      if (points.length >= 2) {
        const [lk, lv] = points[points.length - 1], base = points.filter(([k]) => S.daysBetween(k, lk) >= 28).pop() || points[0], pc = ((lv - base[1]) / base[1]) * 100;
        change = Math.abs(pc) < 2.5 ? `holding since ${dm(base[0])}` : `${signed(pc, 0)}% since ${dm(base[0])}`;
      }
      const logged = points.length > 0 || days.some((k) => store.liftSets(k).some((l) => l.name === x.name));
      return {
        name: x.name,
        day: d.name,
        points,
        change: points.length ? change || "first session" : logged ? "no estimate yet: needs a set with weight and 1-12 reps" : "not logged yet",
      };
    });
  // Lifts ready for more weight next time, and knee lifts held back after a sore day.
  const tomorrow = addDays(t, 1), seen = new Set<string>(), ready: NextUp[] = [], held: NextUp[] = [];
  store.plan.days.forEach((d) =>
    d.exercises.forEach((x: PlanExercise) => {
      if (seen.has(x.name)) return;
      seen.add(x.name);
      const nw = store.nextWeight(x, x.name, tomorrow);
      if (nw) (nw.held ? held : ready).push({ name: x.name, day: d.name, from: nw.from, to: nw.to });
    }),
  );
  if (ready.length) flags.push({ pri: 4, text: `${ready.length} lift${ready.length === 1 ? " is" : "s are"} ready for more weight. See Strength.` });
  return {
    flags,
    anyLogged: days.some((k) => store.liftSets(k).length > 0),
    rows,
    ready,
    held,
    records: store.recentRecords(t, 30).reverse().slice(0, 8),
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
