import planJson from "@/data/plan.json";
import { DOW } from "./dates";
import type { Plan } from "./types";

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
          }))
          .filter((x) => x.name)
          // The first lift has none before it to be a superset with.
          .map(({ superset, ...x }, j) => (superset && j > 0 ? { ...x, superset } : x)),
        cardio: { name: str(cardio.name), detail: str(cardio.detail) },
      };
    }),
  };
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
