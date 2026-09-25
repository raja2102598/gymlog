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
  /** Who started it: another account signed in on this phone never picks it up. */
  user?: string | null;
}

/** The run while trying the sample data, which saves nothing on the phone: kept here instead, and gone on reload. */
let inMemory: WorkoutRun | null = null;
let memoryOnly = false;
/** Keeps runs in memory only (the demo), or on the phone again. */
export function keepRunsInMemory(on: boolean) {
  memoryOnly = on;
  if (!on) inMemory = null;
}
/** The account signed in: runs belong to it. */
let owner: string | null = null;
export function runsFor(user: string | null) {
  owner = user;
}
const read = () => {
  const r = memoryOnly ? inMemory : lsGet<WorkoutRun | null>(WORKOUT_KEY, null);
  return r && (r.user ?? null) === owner ? r : null;
};
function write(r: WorkoutRun): WorkoutRun;
function write(r: null): null;
function write(r: WorkoutRun | null): WorkoutRun | null {
  const w = r && { ...r, user: owner };
  if (memoryOnly) inMemory = w;
  else if (w) lsSet(WORKOUT_KEY, w);
  else lsDel(WORKOUT_KEY);
  return w;
}

export function runOf(day: DayKey): WorkoutRun | null {
  const r = read();
  return r && r.day === day && typeof r.startedAt === "number" ? r : null;
}

/** Starts the day's workout clock, unless it's already running for that day. */
export function startRun(day: DayKey, now = Date.now()): WorkoutRun {
  const r = runOf(day);
  if (r && !r.endedAt) return r;
  return write({ day, startedAt: now });
}

export function endRun(day: DayKey, now = Date.now()): WorkoutRun | null {
  const r = runOf(day);
  if (!r) return null;
  return write({ ...r, endedAt: r.endedAt ?? now });
}

export function clearRun() {
  write(null);
}

/** Seconds a run has lasted, to its end or to now. */
export const runSeconds = (r: WorkoutRun, now = Date.now()) => Math.max(0, Math.round(((r.endedAt ?? now) - r.startedAt) / 1000));

/** "18:42", or "1:05:10" past an hour. */
export function clock(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
