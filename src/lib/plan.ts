import planJson from "@/data/plan.json";
import { DOW } from "./dates";
import { EQUIPMENT, isEquip, isLoad, isMuscle, MUSCLES, type Equip, type Muscle } from "./library";
import type { CustomExercise, Gym, Plan, Weights } from "./types";

type Loose = Record<string, unknown> | null | undefined;
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const pos = (v: unknown) => (v != null && v !== "" && +(v as number) > 0 ? +(v as number) : null);
/** A number from lo to hi, or null (missing, not a number, out of range). */
const within = (v: unknown, lo: number, hi: number) => (v != null && v !== "" && +(v as number) >= lo && +(v as number) <= hi ? +(v as number) : null);

/** A standard bar and plate set, until Settings says otherwise. */
const DEFAULT_BAR_KG = 20;
const DEFAULT_PLATE_KGS = [25, 20, 15, 10, 5, 2.5, 1.25];
/** The rest timer's default, until Settings says otherwise: long enough for most working sets. */
export const DEFAULT_REST_SEC = 90;
/** My gym's weights, until it says otherwise: the usual EZ bar and trap bar, a Smith machine's bar counted as
 *  nothing (most are counterbalanced), and what dumbbells, kettlebells, machines, cables and bands usually go up by. */
export const DEFAULT_WEIGHTS: Weights = { ezbar: 10, trapbar: 20, smith: 0, dumbbell: 2, kettlebell: 4, machine: 2.5, cable: 2.5, band: 5 };
/** What My gym takes for each, kg: a bar from nothing to 50, a step from 0.25 to 20. */
export const WEIGHT_LIMITS = { bar: [0, 50], step: [0.25, 20] } as const;
const BAR_KEYS = ["ezbar", "trapbar", "smith"] as const;

// Fills gaps and drops unnamed lifts so a hand-edited or partial plan can't break rendering. `d` is the
// default plan to fall back on (none while the default itself is being read).
export function normalizePlan(p: unknown, d: Plan | null): Plan {
  const q = (p ?? {}) as Record<string, unknown>;
  const goal = Math.round(+(q.stepGoal as number)), lim = q.kneeLimit as number | string | null | undefined;
  const days = Array.isArray(q.days) ? (q.days as Loose[]) : null;
  return {
    tempo: typeof q.tempo === "string" ? q.tempo : d ? d.tempo : "",
    stepGoal: goal > 0 ? goal : d ? d.stepGoal : 10000,
    sleepGoalH: within(q.sleepGoalH, 3, 12) ?? d?.sleepGoalH ?? 7,
    exerciseGoalMin: within(q.exerciseGoalMin, 5, 300) ?? d?.exerciseGoalMin ?? 30,
    activeGoalKcal: within(q.activeGoalKcal, 50, 3000) ?? d?.activeGoalKcal ?? 500,
    waterGoalMl: within(q.waterGoalMl, 250, 8000) ?? d?.waterGoalMl ?? 2500,
    goalWeight: pos(q.goalWeight),
    weeklyRatePct: pos(q.weeklyRatePct),
    kneeLimit: lim != null && lim !== "" && Number.isInteger(+lim) && +lim >= 0 && +lim <= 10 ? +lim : d ? d.kneeLimit : 5,
    barKg: pos(q.barKg) ?? (d ? d.barKg : DEFAULT_BAR_KG),
    plateKgs: Array.isArray(q.plateKgs)
      ? [...new Set((q.plateKgs as unknown[]).map(pos).filter((n): n is number => n != null))].sort((a, b) => b - a)
      : d
        ? d.plateKgs.slice()
        : DEFAULT_PLATE_KGS.slice(),
    restSec: within(q.restSec, 5, 600) ?? d?.restSec ?? DEFAULT_REST_SEC,
    effort: q.effort === "rpe" || q.effort === "rir" || q.effort === "off" ? q.effort : (d?.effort ?? "off"),
    warmups: Array.isArray(q.warmups) ? [...new Set((q.warmups as unknown[]).map((w) => str(w).trim()).filter(Boolean))] : d ? d.warmups.slice() : [],
    days: DOW.map((wd, i) => {
      const s = ((days && days[i]) || d?.days[i] || {}) as Record<string, unknown>;
      const cardio = (s.cardio ?? {}) as Record<string, unknown>;
      return {
        weekday: wd,
        name: str(s.name).trim() || wd,
        focus: str(s.focus),
        exercises: (Array.isArray(s.exercises) ? (s.exercises as Loose[]) : [])
          .map((x) => ({
            name: str(x?.name).trim(), sets: str(x?.sets), reps: str(x?.reps), cue: str(x?.cue), flag: str(x?.flag), step: str(x?.step),
            knee: typeof x?.knee === "boolean" ? (x.knee as boolean) : /knee/i.test(str(x?.flag)), // plan.json marks these with a KNEE NOTE
            // Left out (not "") when the plan doesn't set one, so a plan with no overrides round-trips unchanged.
            ...(x?.rest != null ? { rest: str(x.rest) } : {}),
            ...(x?.superset === true ? { superset: true } : {}),
            ...(x?.prog === "linear" || x?.prog === "percent" ? { prog: x.prog as "linear" | "percent" } : {}),
            ...Object.fromEntries((["oneRm", "pct", "deloadAfter", "deloadPct"] as const).filter((k) => x?.[k] != null).map((k) => [k, str(x?.[k])])),
            ...(typeof x?.lib === "string" && x.lib ? { lib: x.lib } : {}),
            ...(isLoad(x?.load) ? { load: x.load } : {}),
          }))
          .filter((x) => x.name)
          // The first lift has none before it to be a superset with.
          .map(({ superset, ...x }, j) => (superset && j > 0 ? { ...x, superset } : x)),
        cardio: { name: str(cardio.name), detail: str(cardio.detail) },
      };
    }),
    ...(Array.isArray(q.custom) ? { custom: normalizeCustom(q.custom) } : d?.custom ? { custom: normalizeCustom(d.custom) } : {}),
    ...(q.gym && typeof q.gym === "object" ? { gym: normalizeGym(q.gym) } : d?.gym ? { gym: normalizeGym(d.gym) } : {}),
    ...(q.weights && typeof q.weights === "object" ? { weights: normalizeWeights(q.weights) } : d?.weights ? { weights: normalizeWeights(d.weights) } : {}),
  };
}

// In the vocabulary's own order, each once: what a hand-edited or older plan says, sanitized.
const inOrder = <T extends string>(all: Record<T, string>, ok: (v: unknown) => v is T, v: unknown): T[] =>
  Array.isArray(v) ? (Object.keys(all) as T[]).filter((k) => v.some((e) => ok(e) && e === k)) : [];

/** Lifts of your own: named, each name once (whatever its case), with known equipment and muscles only, and a main
 *  muscle never listed again as a secondary one. */
export function normalizeCustom(v: unknown): CustomExercise[] {
  const seen = new Set<string>();
  return (Array.isArray(v) ? (v as Loose[]) : []).flatMap((c) => {
    const name = str(c?.name).trim();
    if (!name || seen.has(name.toLowerCase())) return [];
    seen.add(name.toLowerCase());
    const primary = inOrder<Muscle>(MUSCLES, isMuscle, c?.primary);
    return [{ name, equip: inOrder<Equip>(EQUIPMENT, isEquip, c?.equip), primary, secondary: inOrder<Muscle>(MUSCLES, isMuscle, c?.secondary).filter((m) => !primary.includes(m)) }];
  });
}

/** My gym: known equipment only, in order; each lift once, and on one list only (never wins). */
export function normalizeGym(v: unknown): Gym {
  const g = (v ?? {}) as Record<string, unknown>;
  const ids = (l: unknown) => [...new Set((Array.isArray(l) ? l : []).map((s) => str(s).trim()).filter(Boolean))];
  const never = ids(g.never);
  return { off: inOrder<Equip>(EQUIPMENT, isEquip, g.off), always: ids(g.always).filter((id) => !never.includes(id)), never };
}

/** My gym's weights: each in range (WEIGHT_LIMITS), or its default. */
export function normalizeWeights(v: unknown): Weights {
  const w = (v ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    (Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]).map((k) => {
      const [lo, hi] = WEIGHT_LIMITS[(BAR_KEYS as readonly string[]).includes(k) ? "bar" : "step"];
      return [k, within(w[k], lo, hi) ?? DEFAULT_WEIGHTS[k]];
    }),
  ) as unknown as Weights;
}

/** A day's lifts in blocks: lifts joined to the one before them (PlanExercise.superset) make one block, a
 *  superset, and any other lift is a block of its own. */
export function planBlocks<T extends { superset?: boolean }>(xs: T[]): T[][] {
  const out: T[][] = [];
  xs.forEach((x, j) => (j > 0 && x.superset ? out[out.length - 1].push(x) : out.push([x])));
  return out;
}

/** Blocks in a day's saved order (DayLog.order): each where its first lift named there stands, and blocks it
 *  names none of after those, in the order they came. */
export function orderBlocks<T extends { name: string }>(blocks: T[][], order: string[]): T[][] {
  const at = (b: T[]) => Math.min(...b.map((it) => (order.includes(it.name) ? order.indexOf(it.name) : Infinity)));
  return blocks
    .map((b, n) => ({ b, n, at: at(b) }))
    .sort((a, c) => (a.at === c.at ? a.n - c.n : a.at - c.at))
    .map((o) => o.b);
}

/** The plan every account starts from, until it's edited in the app. */
export const DEFAULT_PLAN: Plan = normalizePlan(planJson, null);
