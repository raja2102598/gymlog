import planJson from "@/data/plan.json";
import { DOW } from "./dates";
import type { Plan } from "./types";

type Loose = Record<string, unknown> | null | undefined;
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const pos = (v: unknown) => (v != null && v !== "" && +(v as number) > 0 ? +(v as number) : null);

// Fills gaps and drops unnamed lifts so a hand-edited or partial plan can't break rendering. `d` is the
// default plan to fall back on (none while the default itself is being read).
export function normalizePlan(p: unknown, d: Plan | null): Plan {
  const q = (p ?? {}) as Record<string, unknown>;
  const goal = Math.round(+(q.stepGoal as number)), lim = q.kneeLimit as number | string | null | undefined;
  const days = Array.isArray(q.days) ? (q.days as Loose[]) : null;
  return {
    tempo: typeof q.tempo === "string" ? q.tempo : d ? d.tempo : "",
    stepGoal: goal > 0 ? goal : d ? d.stepGoal : 10000,
    goalWeight: pos(q.goalWeight),
    weeklyRatePct: pos(q.weeklyRatePct),
    kneeLimit: lim != null && lim !== "" && Number.isInteger(+lim) && +lim >= 0 && +lim <= 10 ? +lim : d ? d.kneeLimit : 5,
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
          }))
          .filter((x) => x.name),
        cardio: { name: str(cardio.name), detail: str(cardio.detail) },
      };
    }),
  };
}

/** The plan every account starts from, until it's edited in the app. */
export const DEFAULT_PLAN: Plan = normalizePlan(planJson, null);
