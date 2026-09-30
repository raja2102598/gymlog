/* A stuck lift: one whose best estimated 1RM hasn't moved for a few sessions, and what to try instead. The rules
 * alone, with no store, so every case can be tested on its own; GymStore.stuck reads a lift's sessions into them for
 * its card in the workout, and the lift's page on Progress (dashboard.ts) shows the same. */
import { e1rm, isStraightSet, onGrid, type Grid } from "./stats";
import type { DayKey, SetLog } from "./types";

/** Sessions of a lift, not days, without a new best before it counts as stuck: four. It also takes one session
 *  before them to set the best they didn't beat, so a lift done fewer than five times is never stuck. */
export const STUCK_AFTER = 4;
/** The lighter weight a stuck lift tries, as a share of last session's heaviest set. */
export const LIGHTER = 0.9;

/** One session of a lift: its day, its best estimated 1RM (null when no set gives one), and its heaviest straight
 *  set, kg. */
export interface SessionBest {
  day: DayKey;
  e1rm: number | null;
  top: number | null;
}

/** A session's best estimated 1RM: Brzycki's, from its straight sets of 1-12 reps with a weight (a warm-up or a drop
 *  set never counts, as with records), or null when none gives one. */
export const sessionE1rm = (sets: SetLog[]): number | null => Math.max(0, ...sets.filter(isStraightSet).map((s) => e1rm(s.kg, s.reps) ?? 0)) || null;

export interface Plateau {
  /** Sessions since the best, all of them without a new one: STUCK_AFTER or more. */
  sessions: number;
  /** The best estimated 1RM, kg, and the day it was set. */
  best: number;
  day: DayKey;
  /** The latest session's heaviest straight set, kg: what the lighter weight is worked out from. */
  top: number | null;
}

/** Whether a lift is stuck, from its sessions oldest first: its best estimated 1RM was set STUCK_AFTER or more sessions
 *  ago, so the last four haven't beaten the best before them. Equal isn't beaten, and a session with no estimate (reps
 *  only, or more than 12) is left out: it can neither beat the best nor fall short of it. */
export function plateau(sessions: SessionBest[]): Plateau | null {
  const judged = sessions.filter((s): s is SessionBest & { e1rm: number } => s.e1rm != null);
  let b = -1;
  judged.forEach((s, i) => {
    if (b < 0 || s.e1rm > judged[b].e1rm + 1e-9) b = i;
  });
  const since = judged.length - 1 - b;
  return b >= 0 && since >= STUCK_AFTER ? { sessions: since, best: judged[b].e1rm, day: judged[b].day, top: judged[judged.length - 1].top } : null;
}

/** 90% of last session's heaviest set, as a weight the lift's equipment makes (`grid`): the nearest, or the one below
 *  it when the nearest isn't lighter (10 kg dumbbells in 2 kg steps: 9 kg is nearest 10, so 8). Null when nothing
 *  lighter can be made, as with an empty bar, or with no weight to go from. */
export function lighter(top: number | null, grid: Grid): number | null {
  if (top == null || !(top > 0)) return null;
  const near = onGrid(top * LIGHTER, grid);
  if (near < top) return near;
  const down = onGrid(top * LIGHTER, grid, "down");
  return down < top ? down : null;
}

/** What a stuck lift's card suggests: its planned sets at the top of its rep range, at the lighter weight, to build back
 *  up from (reaching the top of the range is what makes the lift go up again, by its own rule). */
export interface Stuck extends Plateau {
  sets: number;
  /** The top of the lift's rep range, or null when it has none. */
  reps: number | null;
  /** The lighter weight, kg, or null when the equipment can't go lighter (lighter). */
  kg: number | null;
}

/** The hint on a stuck lift's card, in the app's voice: what happened, and what to try. */
export function stuckWords(s: Stuck): string {
  const n = `No progress in ${s.sessions} sessions.`;
  if (s.kg == null) return `${n} Try swapping it for a variation.`;
  const sr = s.reps != null ? `${s.sets} × ${s.reps} at ` : "";
  return `${n} Try ${sr}${Math.round(LIGHTER * 100)}% (${s.kg} kg), or swap it for a variation.`;
}

/** The same, as a line on the lift's page on Progress. */
export const stuckLine = (p: Plateau, since: string): string => `No progress in ${p.sessions} sessions: no new best estimated 1RM since ${since}.`;
