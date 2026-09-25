/* What a day's session adds up to, for the screens that summarise it: Home's workout card, Train's session card, the
 * active workout and Workout complete. Reads the store; changes nothing. */
import { addDays, DOW, mondayOf, wdIndex } from "./dates";
import { e1rm, isStraightSet, isWorkingSet, repRange, type RecordKind } from "./stats";
import { minSets, performed, restSecFor, setsOf, targetOf, topKg, type GymStore, type LiftItem } from "./store";
import type { DayKey, PlanExercise } from "./types";

/** "8-10" → "8–10": the range with an en dash, as the screens print it. */
export const dash = (s: string) => s.replace(/\s*-\s*/g, "–");

/** A lift's target in words: "3 × 8–10". */
export const targetWords = (t: { sets: string; reps: string }) => [t.sets, dash(t.reps)].filter(Boolean).join(" × ");

export interface SessionSummary {
  lifts: number;
  sets: number;
  /** About how long it takes, minutes, to the nearest 5: each set's work and rest, and a few minutes to set up. */
  min: number;
}

/** Every lift of day k's workout done or skipped: Train's button then says Review. */
export function sessionDone(store: GymStore, k: DayKey): boolean {
  const e = store.entry(k), items = store.liftBlocks(k).flat();
  return items.length > 0 && items.every((it) => e.exercises[it.name]?.done || e.exercises[it.name]?.skipped);
}

export function sessionSummary(store: GymStore, k: DayKey): SessionSummary {
  const e = store.entry(k), items = store.liftsFor(k).filter((it) => !it.extra);
  let sets = 0, sec = 0;
  for (const it of items) {
    const n = minSets(targetOf(e.exercises[it.name], it.x));
    sets += n;
    sec += n * (restSecFor(store.plan, it.x) + 40);
  }
  return { lifts: items.length, sets, min: items.length ? Math.max(5, Math.round((sec / 60 + 5) / 5) * 5) : 0 };
}

/** Where today sits in the plan: its week since the first logged day, and which of the week's training days it is. */
export function weekPosition(store: GymStore, k: DayKey): { week: number; day: number; of: number } | null {
  const trainDays = store.plan.days.map((d) => d.exercises.length > 0);
  const of = trainDays.filter(Boolean).length;
  if (!of || !trainDays[wdIndex(k)]) return null;
  const day = trainDays.slice(0, wdIndex(k) + 1).filter(Boolean).length;
  const first = mondayOf(store.firstDay()), mon = mondayOf(k);
  const week = Math.max(1, Math.round((Date.parse(mon) - Date.parse(first)) / (7 * 864e5)) + 1);
  return { week, day, of };
}

/** The weight to show for a lift in a list: the suggested next weight, or last time's heaviest set. */
export function liftWeight(store: GymStore, k: DayKey, it: LiftItem): number | null {
  const r = store.entry(k).exercises[it.name];
  const logged = r ? topKg(setsOf(r)) : null;
  if (logged != null) return logged;
  const did = performed(it.name, r), next = r?.skipped ? null : store.nextWeight(it.x, did, k);
  if (next && !next.held && next.to != null) return next.to;
  const last = store.lastDone(did, k);
  return last ? topKg(setsOf(last.r)) : null;
}

/** "3 × 8–10 · 37.5 kg", or "Skipped", or "Done · 3 sets". */
export function liftLine(store: GymStore, k: DayKey, it: LiftItem): string {
  const r = store.entry(k).exercises[it.name];
  if (r?.skipped) return r.reason ? `Skipped · ${r.reason}` : "Skipped";
  const kg = liftWeight(store, k, it), t = targetWords(targetOf(r, it.x));
  return [r?.swap ? `Instead of ${it.name}` : "", t, kg != null ? `${kg} kg` : ""].filter(Boolean).join(" · ") || "Not in the plan";
}

/** The kind of lift, for its icon tile's tint: by the library's main muscle. */
export type Tint = "t-brand" | "t-body" | "t-success" | "t-water" | "t-steps" | "t-info";
export function tintOf(store: GymStore, name: string, x?: Pick<PlanExercise, "lib"> | null): Tint {
  const m = store.exerciseOf(name, x)?.primary[0] as string | undefined;
  if (!m) return "t-brand";
  if (/ham/.test(m)) return "t-body";
  if (/glute|abduct/.test(m)) return "t-water";
  if (/calf|calves|abdom|abs|core|oblique/.test(m)) return "t-success";
  if (/back|lat|trap|bicep|forearm|rear/.test(m)) return "t-info";
  return "t-brand";
}

/** A day's lifting in numbers: working sets logged and planned, and kg lifted (weight × reps of straight sets). */
export function dayTotals(store: GymStore, k: DayKey): { sets: number; planned: number; kg: number } {
  const e = store.entry(k);
  let sets = 0, planned = 0, kg = 0;
  for (const it of store.liftsFor(k)) {
    const r = e.exercises[it.name];
    if (!it.extra && !r?.skipped) planned += minSets(targetOf(r, it.x));
    for (const s of setsOf(r)) {
      if (!isWorkingSet(s) || !(s.reps ?? 0)) continue;
      sets++;
      if (isStraightSet(s) && s.kg) kg += s.kg * (s.reps ?? 0);
    }
  }
  return { sets, planned, kg: Math.round(kg) };
}

export interface Best {
  lift: string;
  kg: number | null;
  reps: number | null;
  kinds: RecordKind[];
}

/** The day's personal bests: each lift's best record-setting set. */
export function dayBests(store: GymStore, k: DayKey): Best[] {
  const marks = store.recordsOn(k), e = store.entry(k), out = new Map<string, Best>();
  for (const [key, kinds] of marks) {
    const cut = key.lastIndexOf("|"), lift = key.slice(0, cut), j = +key.slice(cut + 1);
    const it = store.liftsFor(k).find((x) => performed(x.name, e.exercises[x.name]) === lift);
    const s = it ? setsOf(e.exercises[it.name]).filter(isWorkingSet)[j] : null;
    const b: Best = { lift, kg: s?.kg ?? null, reps: s?.reps ?? null, kinds };
    const had = out.get(lift);
    if (!had || (e1rm(b.kg, b.reps) ?? 0) > (e1rm(had.kg, had.reps) ?? 0)) out.set(lift, b);
  }
  return [...out.values()];
}

/** The day's weekday name: "Wednesday". */
export const weekdayName = (k: DayKey) => new Date(`${k}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long" });

/** "Legs · Wednesday 23 September". */
export const longDay = (k: DayKey) => new Date(`${k}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }).replace(",", "");

/** Planned sessions missed earlier this week, by weekday name. */
export const missedWords = (store: GymStore, k: DayKey) => store.missedThisWeek(k).map((i) => ({ i, name: store.plan.days[i].name, day: DOW[i] }));

/** Whether a lift's reps reached the top of its range in every set: for the "Steady" / "+2.5 kg" chips. */
export const topOfRange = (reps: string) => repRange(reps)?.[1] ?? null;

export const yesterday = (k: DayKey) => addDays(k, -1);
