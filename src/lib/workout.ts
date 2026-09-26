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
  /** While the clock is paused (tapped, then Pause): since when, ms since the epoch. */
  pausedAt?: number;
  /** How long it was paused before, ms: none of it counts. */
  pausedMs?: number;
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
  // A new sign-in (or a fresh go at the sample data, which always has the same user) starts with no run in memory.
  if (user !== owner) inMemory = null;
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

/** Whether the day's clock was left behind: still running, STALE_RUN_MS of it counted. Only asked as the workout
 *  opens, so a long workout on screen keeps its clock. A paused clock was stopped on purpose, so it waits. */
const staleRun = (r: WorkoutRun | null, now: number): r is WorkoutRun => !!r && !r.endedAt && r.pausedAt == null && runMs(r, now) >= STALE_RUN_MS;

/** A clock left running this long was left behind (closed without Finish, then opened another day or hours
 *  later): opening the workout starts it again, rather than carrying on from hours ago. */
export const STALE_RUN_MS = 3 * 60 * 60 * 1000;

/** Starts the day's workout clock, unless it's already running for that day (and not left running for hours). */
export function startRun(day: DayKey, now = Date.now()): WorkoutRun {
  const r = runOf(day);
  if (r && !r.endedAt && !staleRun(r, now)) return r;
  return write({ day, startedAt: now });
}

/** Starts the day's clock again from 0:00: the top bar's clock, tapped. */
export const restartRun = (day: DayKey, now = Date.now()): WorkoutRun => write({ day, startedAt: now });

/** Stops the day's clock where it is (the top bar's clock, tapped), until resumeRun. Nothing for a
 *  finished or already paused one. */
export function pauseRun(day: DayKey, now = Date.now()): WorkoutRun | null {
  const r = runOf(day);
  if (!r || r.endedAt || r.pausedAt != null) return r;
  return write({ ...r, pausedAt: now });
}

/** Starts a paused clock again from where it stopped: the time it was paused doesn't count. */
export function resumeRun(day: DayKey, now = Date.now()): WorkoutRun | null {
  const r = runOf(day);
  if (!r || r.endedAt || r.pausedAt == null) return r;
  const { pausedAt, ...rest } = r;
  return write({ ...rest, pausedMs: (r.pausedMs ?? 0) + Math.max(0, now - pausedAt) });
}

/** Drops the day's clock if it was left behind: a finished workout opened to review it shows no abandoned clock, and
 *  Finish there records no duration of hours. */
export function dropStaleRun(day: DayKey, now = Date.now()) {
  if (staleRun(runOf(day), now)) write(null);
}

export function endRun(day: DayKey, now = Date.now()): WorkoutRun | null {
  const r = runOf(day);
  if (!r) return null;
  return write({ ...r, endedAt: r.endedAt ?? now });
}

/** Forgets the run, or with `day`, only a run for that day: a finished workout reviewed later leaves another
 *  day's running clock alone. */
export function clearRun(day?: DayKey) {
  if (day === undefined || read()?.day === day) write(null);
}

/** How long a run has lasted, ms, to its end or to now, less the time it was paused (still paused: up to then). */
function runMs(r: WorkoutRun, now: number): number {
  const end = r.endedAt ?? now, paused = (r.pausedMs ?? 0) + (r.pausedAt != null ? Math.max(0, end - r.pausedAt) : 0);
  return Math.max(0, end - r.startedAt - paused);
}

/** Seconds a run has lasted, as runMs. */
export const runSeconds = (r: WorkoutRun, now = Date.now()) => Math.round(runMs(r, now) / 1000);

/** "18:42", or "1:05:10" past an hour. */
export function clock(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
