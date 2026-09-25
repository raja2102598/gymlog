import type { DayKey, DayLog, HealthDay } from "./types";

/** The slice of a PlanDay that sampleDays reads. A Plan's own `days` (lib/plan.ts) satisfies this already, and so
 *  does plan.json's raw, un-normalized shape (scripts/screenshots.mjs): knee-flagged exercises are found from
 *  `knee` when it's already a boolean, or from a KNEE NOTE in `flag` otherwise, the same rule normalizePlan uses. */
export interface SamplePlanDay {
  exercises: { name: string; reps: string; knee?: boolean; flag?: string }[];
}

/**
 * Four weeks of plan-driven workout history ending on `today` (inclusive), plus three weeks of Health Connect
 * data over the same stretch. See sampleData.js for what it builds and why the file itself is plain JavaScript.
 */
export function sampleDays(today: DayKey, planDays: readonly SamplePlanDay[]): { logs: Record<DayKey, DayLog>; health: Record<DayKey, HealthDay> };
