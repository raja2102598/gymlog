/* The workout under way on this phone: which day it's for and when it started, so the active-workout screen can show
 * the time elapsed and Workout complete its duration. Kept on this device only, like the theme: it's the screen's
 * state, not part of the day's log. */
import { lsDel, lsGet, lsSet } from "./storage";
import type { DayKey } from "./types";

export const WORKOUT_KEY = "gymlog.workout.v1";

export interface WorkoutRun {
  day: DayKey;
  /** ms since the epoch. */
  startedAt: number;
  /** When Finish was tapped: the duration stops there. */
  endedAt?: number;
}

export function runOf(day: DayKey): WorkoutRun | null {
  const r = lsGet<WorkoutRun | null>(WORKOUT_KEY, null);
  return r && r.day === day && typeof r.startedAt === "number" ? r : null;
}

/** Starts the day's workout clock, unless it's already running for that day. */
export function startRun(day: DayKey, now = Date.now()): WorkoutRun {
  const r = runOf(day);
  if (r && !r.endedAt) return r;
  const n = { day, startedAt: now };
  lsSet(WORKOUT_KEY, n);
  return n;
}

export function endRun(day: DayKey, now = Date.now()): WorkoutRun | null {
  const r = runOf(day);
  if (!r) return null;
  const n = { ...r, endedAt: r.endedAt ?? now };
  lsSet(WORKOUT_KEY, n);
  return n;
}

export function clearRun() {
  lsDel(WORKOUT_KEY);
}

/** Seconds a run has lasted, to its end or to now. */
export const runSeconds = (r: WorkoutRun, now = Date.now()) => Math.max(0, Math.round(((r.endedAt ?? now) - r.startedAt) / 1000));

/** "18:42", or "1:05:10" past an hour. */
export function clock(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
