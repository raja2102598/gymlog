/* What Train's Add exercise suggests for a day, above the library's list (components/library/Suggested.tsx): the lifts
 * left on the days just before it, to add for that day only, and lifts for the muscles low this week, to pick like
 * any other. Reads the store; changes nothing. */
import { musclesJudged, musclesModel, WEEKLY_SETS } from "./dashboard";
import { addDays, mondayOf, todayKey } from "./dates";
import { byCommon, MUSCLES, type Exercise, type Muscle } from "./library";
import { weekdayName, targetWords } from "./session";
import { isStraightSet, isWorkingSet, muscleSetCount } from "./stats";
import { minSets, performed, setsOf, targetOf, topKg, type GymStore } from "./store";
import type { DayKey, LiftLog, PlanExercise } from "./types";

/** How far back a lift left is offered: the week before the day. */
export const MISSED_DAYS = 7;
/** At most this many lifts left are offered, the latest first. */
export const MISSED_MAX = 6;
/** At most this many muscles low this week, each with at most LOW_LIFTS lifts for it. */
export const LOW_MAX = 3;
export const LOW_LIFTS = 2;

/** A lift left on an earlier day: planned there, and not done. */
export interface MissedLift {
  name: string;
  /** The day it was left on. */
  day: DayKey;
  /** The sets and reps it was planned with there: added for the day, it asks for the same. */
  target: { sets: string; reps: string };
  /** Last time's heaviest working set, and the most reps done at that weight; null for a lift never done. */
  top: { kg: number; reps: number | null } | null;
}

/** Whether a day's entry for a lift says it was done: ticked, or a working set logged with reps, whether as planned or
 *  swapped for another. Skipped isn't done, whatever it has. */
const didLift = (r?: LiftLog | null) => !!r && !r.skipped && (r.done || setsOf(r).some((s) => isWorkingSet(s) && s.reps != null));

/** The lifts left on the days before `sel` that are worth adding to it, the latest day first and each day's in its
 *  plan's order, at most MISSED_MAX: each planned on a day in the week before `sel` whose planned session was trained
 *  (some lift done: store.worked), and not done there, left or skipped on purpose. A day skipped as a whole, never
 *  started or done as a free-form workout has none (Train offers a missed session itself: missedThisWeek), nor does
 *  today until it's over. A lift done on any later day isn't left any more, and one the selected day has already,
 *  planned, added or swapped in, isn't offered again; a lift left on two days is offered once, from the later. */
export function missedLifts(store: GymStore, sel: DayKey, t: DayKey = todayKey()): MissedLift[] {
  const from = addDays(sel, -MISSED_DAYS), before = sel < t ? sel : t, days = store.days();
  const e = store.entry(sel), here = new Set(store.liftsFor(sel).flatMap((it) => [it.name, performed(it.name, e.exercises[it.name])]));
  const doneAfter = (name: string, k: DayKey) => days.some((d) => d > k && Object.entries(store.logs[d].exercises || {}).some(([key, r]) => performed(key, r) === name && didLift(r)));
  const out: MissedLift[] = [], seen = new Set<string>();
  for (let i = days.length - 1; i >= 0 && out.length < MISSED_MAX; i--) {
    const k = days[i];
    if (k >= before || k < from || store.isFree(k) || store.logs[k].skip != null || !store.worked(k)) continue;
    const ex = store.entry(k).exercises;
    for (const x of store.planFor(k).exercises) {
      if (out.length >= MISSED_MAX || seen.has(x.name) || here.has(x.name) || didLift(ex[x.name]) || doneAfter(x.name, k)) continue;
      seen.add(x.name);
      out.push({ name: x.name, day: k, target: targetOf(ex[x.name], x), top: topSet(store, x.name, sel) });
    }
  }
  return out;
}

/** The last time `name` was done before `k`: its heaviest working set (not a drop set), with the most reps done at it. */
function topSet(store: GymStore, name: string, k: DayKey): MissedLift["top"] {
  const last = store.lastDone(name, k), sets = last ? setsOf(last.r).filter(isStraightSet) : [], kg = topKg(sets);
  return kg == null ? null : { kg, reps: Math.max(0, ...sets.filter((s) => s.kg === kg).map((s) => s.reps ?? 0)) || null };
}

/** The heading over the lifts left: "Missed on Tuesday", the day's name, or "Missed this week" from several days. */
export const missedTitle = (xs: MissedLift[]) => (xs.length && xs.every((m) => m.day === xs[0].day) ? `Missed on ${weekdayName(xs[0].day)}` : "Missed this week");

/** A lift left, in words: "3–4 × 8–10 · last 45 kg × 8", each part kept whole on a line (a line breaks between them). */
export const missedLine = (m: MissedLift) =>
  [targetWords(m.target), m.top ? `last ${m.top.kg} kg${m.top.reps ? ` × ${m.top.reps}` : ""}` : ""]
    .filter(Boolean)
    .map((part) => part.replace(/ /g, "\u00a0"))
    .join(" · ");

/** A muscle's sets this week: those done so far (Progress's Muscles), and those the rest of the week's sessions still
 *  plan for it. A set counts one for a lift's main muscles and half for its others, as on Progress. */
export interface MuscleWeek {
  muscle: Muscle;
  done: number;
  planned: number;
}

/** A muscle short of WEEKLY_SETS this week, even with what's still planned, and lifts to add for it. */
export interface LowMuscle extends MuscleWeek {
  /** Library lifts with it as a main muscle that My gym can do, those done before first, then the common ones. */
  lifts: Exercise[];
}

/** Each muscle the plan trains (a main muscle of one of its lifts) with its sets this week, t's, fewest first: done
 *  from Monday to t, and planned from t to Sunday, each lift of those days' sessions (and any added for the day) not
 *  done or skipped yet, less the sets it has already, a swap as what it was swapped for. A day skipped as a whole
 *  plans none. */
export function weekMuscles(store: GymStore, t: DayKey = todayKey()): MuscleWeek[] {
  const sofar = new Map(musclesModel(store, t).rows.map((r) => [r.muscle, r.sets[r.sets.length - 1]]));
  const planned = new Map<Muscle, number>(), add = (m: Muscle, n: number) => planned.set(m, (planned.get(m) ?? 0) + n);
  for (let d = t, end = addDays(mondayOf(t), 6); d <= end; d = addDays(d, 1)) {
    const e = store.entry(d);
    if (e.skip != null) continue;
    for (const it of store.liftsFor(d)) {
      const r = e.exercises[it.name];
      if (it.extra || r?.done || r?.skipped) continue;
      // What's logged of it already counts in the week so far.
      const left = minSets(targetOf(r, it.x)) - muscleSetCount(setsOf(r));
      const x = r?.swap ? store.exerciseOf(r.swap) : store.exerciseOf(it.name, it.x);
      if (left <= 0 || !x?.primary.length) continue;
      for (const m of x.primary) add(m, left);
      for (const m of x.secondary) add(m, left / 2);
    }
  }
  const trained = new Set(store.plan.days.flatMap((d) => d.exercises.flatMap((x) => store.exerciseOf(x.name, x)?.primary ?? [])));
  return [...trained]
    .map((muscle) => ({ muscle, done: sofar.get(muscle) ?? 0, planned: planned.get(muscle) ?? 0 }))
    .sort((a, b) => a.done + a.planned - (b.done + b.planned) || MUSCLES[a.muscle].localeCompare(MUSCLES[b.muscle]));
}

/** The muscles furthest short of WEEKLY_SETS this week (weekMuscles: counting what's still planned, so a muscle
 *  trained later in the week isn't short yet), at most LOW_MAX, the fewest sets first; none until the account has a
 *  full week behind it, as Progress judges it (musclesJudged). Each comes with up to LOW_LIFTS lifts for it
 *  (LowMuscle.lifts) the selected day hasn't got and `except` (the lifts left, offered already) doesn't name, each
 *  offered once; a muscle with none to offer is passed over. */
export function lowMuscles(store: GymStore, sel: DayKey, t: DayKey = todayKey(), except: string[] = []): LowMuscle[] {
  if (!musclesJudged(store, t)) return [];
  const short = weekMuscles(store, t).filter((m) => m.done + m.planned < WEEKLY_SETS);
  // Lifts not to offer, by the library's lift: the day's own, swaps included, and those named in `except`.
  const e = store.entry(sel), idOf = (name: string, x?: Pick<PlanExercise, "lib">) => store.exerciseOf(name, x)?.id ?? `name:${name}`;
  const taken = new Set([...store.liftsFor(sel).flatMap((it) => [idOf(it.name, it.x), idOf(performed(it.name, e.exercises[it.name]))]), ...except.map((n) => idOf(n))]);
  // Library lifts done before, by the name they were last done under, and the plan's by the plan's name: offered by
  // that name, so one added goes on under it and keeps one history (the plan's Lat Pulldown, not the library's
  // Wide-Grip Lat Pulldown).
  const done = new Set<string>(), known = new Map<string, string>();
  for (const k of [...store.days()].reverse())
    for (const [key, r] of Object.entries(store.logs[k].exercises || {})) {
      const did = performed(key, r), id = idOf(did);
      if (!didLift(r)) continue;
      done.add(id);
      if (!known.has(id)) known.set(id, did);
    }
  for (const d of store.plan.days) for (const x of d.exercises) if (!known.has(idOf(x.name, x))) known.set(idOf(x.name, x), x.name);
  const pool = store.library().filter((x) => store.canDo(x));
  const out: LowMuscle[] = [];
  for (const m of short) {
    if (out.length >= LOW_MAX) break;
    const lifts = pool
      .filter((x) => x.primary.includes(m.muscle) && !taken.has(x.id))
      .sort((a, b) => Number(done.has(b.id)) - Number(done.has(a.id)) || byCommon(a, b))
      .slice(0, LOW_LIFTS)
      .map((x) => (known.has(x.id) && !x.custom ? { ...x, name: known.get(x.id) as string } : x));
    if (!lifts.length) continue;
    for (const x of lifts) taken.add(x.id);
    out.push({ ...m, lifts });
  }
  return out;
}

/** A low muscle's sets in words: "3 done, 4.5 planned, of about 10 a week". */
export const lowLine = (m: LowMuscle) => `${half(m.done)} done, ${half(m.planned)} planned, of about ${WEEKLY_SETS} a week`;
const half = (n: number) => String(Math.round(n * 2) / 2);
