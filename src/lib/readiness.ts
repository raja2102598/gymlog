/* Whether today's signals say take it easier: last night's sleep, resting heart rate against its usual, and the knee
 * before the session. Home's workout card (and the workout's first step) says so in one line, with Hold today, which
 * keeps the day's lifts at last time's weights (DayLog.hold, GymStore.nextWeight). Reads a day's numbers and changes
 * nothing, so each case can be tested on its own. */
import { addDays } from "./dates";
import { hoursMin } from "./health";
import type { DayKey, DayLog, HealthDay, Plan } from "./types";

/** A night under this, minutes, is short: 6 h, below the 7 or more most sleep advice gives adults, and far enough
 *  below it that one night's shortfall shows in a session. */
export const SHORT_NIGHT = 6 * 60;
/** Resting heart rate this many bpm or more over its usual is raised: more than a day-to-day wobble (a few bpm), and
 *  the kind of rise that follows too little recovery, a hard week or an illness coming on. */
export const RHR_OVER = 7;
/** Its usual: the average of the days before today, over two weeks. */
export const RHR_DAYS = 14;
/** Readings the usual needs, of those two weeks: half, so a few days alone don't set it. */
export const RHR_READINGS = 7;

/** What the note is made from: each signal present only when it says take it easier. */
export interface Readiness {
  /** Last night's sleep, minutes, under SHORT_NIGHT. */
  sleepMin?: number;
  /** Today's resting heart rate and how far over its usual, bpm, when RHR_OVER or more. */
  rhr?: { bpm: number; over: number };
  /** The knee before the session, 0-10, when over the plan's limit: the score that holds knee lifts after a session
   *  (GymStore.kneeBad). */
  knee?: number;
}

/** The store's side of this, so it can be tested with plain objects too. */
export interface ReadinessSource {
  plan: Pick<Plan, "kneeLimit">;
  healthOf(k: DayKey): HealthDay | null;
  entry(k: DayKey): Pick<DayLog, "kneeBefore">;
}

/** Day k's signals, or null on a good day and on a day with nothing to go on: no sleep or heart rate from Health
 *  Connect (the website before the Android app has synced, say) and no knee score. Sleep counts on the day it ended,
 *  so day k's is last night's. */
export function readiness(src: ReadinessSource, k: DayKey): Readiness | null {
  const out: Readiness = {}, h = src.healthOf(k);
  if (h?.sleepMin != null && h.sleepMin > 0 && h.sleepMin < SHORT_NIGHT) out.sleepMin = h.sleepMin;
  const rhr = h?.restingHr;
  if (rhr != null && rhr > 0) {
    const before = Array.from({ length: RHR_DAYS }, (_, i) => src.healthOf(addDays(k, -1 - i))?.restingHr).filter((v): v is number => v != null && v > 0);
    const usual = before.length >= RHR_READINGS ? before.reduce((a, v) => a + v, 0) / before.length : null;
    if (usual != null && rhr - usual >= RHR_OVER - 1e-9) out.rhr = { bpm: rhr, over: Math.round(rhr - usual) };
  }
  const knee = src.entry(k).kneeBefore;
  if (knee != null && knee > src.plan.kneeLimit) out.knee = knee;
  return Object.keys(out).length ? out : null;
}

/** The note in one line: the reasons, then what to do, or that today's weights hold already (`held`); with no
 *  reasons, only that. "Slept 5 h 10 min. Keep today's weights where they were last time." */
export function readinessLine(r: Readiness | null, held: boolean): string {
  const why = [
    r?.sleepMin != null ? `slept ${hoursMin(r.sleepMin)}` : "",
    r?.rhr ? `resting heart rate ${r.rhr.over} bpm above usual` : "",
    r?.knee != null ? `knee ${r.knee}/10` : "",
  ].filter(Boolean);
  const said = why.length < 2 ? why.join("") : `${why.slice(0, -1).join(", ")} and ${why[why.length - 1]}`;
  const todo = held ? "Today’s weights stay where they were last time." : "Keep today’s weights where they were last time.";
  return said ? `${said[0].toUpperCase()}${said.slice(1)}. ${todo}` : todo;
}
