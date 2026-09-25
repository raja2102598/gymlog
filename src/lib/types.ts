/* The data model. One row per (user, day) in table `logs`, with a JSON `data` column shaped like DayLog.
 * Exercises are keyed by their planned name, so editing the plan never scrambles old logs. The plan is
 * one row per user in table `plans`; src/data/plan.json is the default until it's edited. Health Connect
 * data is one row per (user, day) in table `health_days`, shaped like HealthDay, kept apart from what you
 * type so neither overwrites the other. */

/** "YYYY-MM-DD" in the phone's local time. */
export type DayKey = string;

export type SetType = "warmup" | "drop" | "failure";
export type Effort = "off" | "rpe" | "rir";
export interface SetLog {
  reps: number | null;
  kg: number | null;
  /** What kind of set: unset (older sets too) is a working set. A warm-up counts toward nothing: not the planned
   *  sets, records or volume. A drop set is volume only: it doesn't count toward the planned sets, the go-up rule
   *  or a record. A set to failure counts as a working set does. */
  type?: SetType;
  /** How hard it was, when the plan logs effort (Plan.effort): RPE 1-10, or reps in reserve 0-10. */
  rpe?: number;
  rir?: number;
}

export interface LiftLog {
  done: boolean;
  /** Heaviest set, which is also all that older entries hold. */
  kg: number | null;
  sets?: SetLog[];
  /** Skipped that day, e.g. machine busy. */
  skipped?: boolean;
  reason?: string;
  /** Did this exercise instead that day. */
  swap?: string;
  /** The tick came from logging the planned number of sets, not from a hand: voice's "undo" can take it back. */
  autoDone?: boolean;
  /** The plan's sets and reps for this lift when it was first logged that day (see GymStore.editLift), so its
   *  row count, "sets done" reading and go-up check still match what was actually asked after the plan's
   *  targets change. Unset on older entries, and on a lift no longer in the plan when first logged: both fall
   *  back to today's plan, as every entry did before this. */
  target?: { sets: string; reps: string };
}

export interface DayLog {
  exercises: Record<string, LiftLog>;
  warmup: string[];
  cardio: boolean;
  steps: number | null;
  weight: number | null;
  note: string;
  /** Did another weekday's workout that day (0 = Monday), e.g. a missed one. */
  session?: number;
  waist?: number;
  /** cm, like waist: once a week is enough. */
  chest?: number;
  arms?: number;
  thighs?: number;
  hips?: number;
  /** %: what you type wins over Health Connect's reading, as with weight. */
  bodyFat?: number;
  cardioMin?: number;
  cardioKmh?: number;
  cardioIncline?: number;
  /** The order the day's lifts were done in, by name, once one was moved on Today: lifts it doesn't name follow
   *  in the plan's order. Unset while the day keeps the plan's order. */
  order?: string[];
  /** Knee pain 0-10 around knee-sensitive sessions, and on waking the next morning. */
  kneeBefore?: number;
  kneeAfter?: number;
  kneeWake?: number;
}

/** One day of Health Connect data, as the Android app saves it to table `health_days`. Only what the phone had. */
export interface HealthDay {
  /** Health Connect's total for the day: phone and watch counted once. */
  steps?: number;
  /** Steps in each hour of the day, 0 to 23, local time. */
  stepsByHour?: number[];
  /** Distance walked, run or ridden, km. */
  km?: number;
  /** Floors climbed. */
  floors?: number;
  /** kcal: burned by activity, burned in all (activity and resting), and eaten, as logged in a food app. */
  activeKcal?: number;
  totalKcal?: number;
  eatenKcal?: number;
  /** kcal a day burned at rest (basal metabolic rate), the day's latest estimate. */
  bmr?: number;
  /** Water drunk, ml. */
  waterMl?: number;
  /** kg: the day's first weigh-in. */
  weight?: number;
  /** %: the day's first body-fat reading. */
  bodyFat?: number;
  /** cm: the day's latest height reading. */
  height?: number;
  /** bpm: resting heart rate, and the day's average, lowest and highest heart rate. */
  restingHr?: number;
  hrAvg?: number;
  hrMin?: number;
  hrMax?: number;
  /** Heart rate variability (RMSSD), ms, the day's average. */
  hrv?: number;
  /** Blood oxygen, %, the day's average. */
  spo2?: number;
  /** Breaths a minute, the day's average. */
  respRate?: number;
  /** VO2 max, mL/kg/min, the day's latest. */
  vo2max?: number;
  /** Blood pressure, mmHg: the day's last reading. */
  bp?: { sys: number; dia: number };
  /** Minutes asleep in the sleep that ended this day, and by stage when the tracker reports stages. */
  sleepMin?: number;
  sleepStages?: Partial<Record<"deep" | "rem" | "light" | "awake", number>>;
  /** When the night's main sleep started and ended (ISO). */
  bed?: string;
  wake?: string;
  workouts?: HealthWorkout[];
}

export interface HealthWorkout {
  /** Health Connect's exercise type, e.g. "strengthTraining", "walking". */
  type: string;
  /** ISO times. */
  start: string;
  end: string;
  min: number;
  kcal?: number;
  km?: number;
  /** The app that recorded it. */
  source?: string;
}

export const EXTRA_FIELDS = ["waist", "chest", "arms", "thighs", "hips", "bodyFat", "cardioMin", "cardioKmh", "cardioIncline", "kneeBefore", "kneeAfter", "kneeWake"] as const;
export type ExtraField = (typeof EXTRA_FIELDS)[number];
export type KneeField = "kneeBefore" | "kneeAfter" | "kneeWake";
export type NumField = "waist" | "cardioMin" | "cardioKmh" | "cardioIncline";
/** The measurements card on Today, beyond weight and waist: cm for the first four, body fat in %. Each has a
 *  trend and its change over four weeks in Health → Body. */
export const MEASURE_FIELDS = ["chest", "arms", "thighs", "hips", "bodyFat"] as const;
export type MeasureField = (typeof MEASURE_FIELDS)[number];

export interface PlanExercise {
  name: string;
  sets: string;
  reps: string;
  cue: string;
  /** Warning shown under the lift, e.g. a KNEE NOTE. */
  flag: string;
  /** kg to add when every set reaches the top of the rep range (2.5 when empty). */
  step: string;
  knee: boolean;
  /** Seconds to rest after a set, overriding the plan's default (restSecFor in lib/store.ts). Empty or unset: use
   *  the plan's. Optional so older plans and the plan templates need no change to keep normalizePlan's round trip. */
  rest?: string;
  /** Done as a superset with the lift before it: lifts joined this way make one superset (planBlocks in
   *  lib/plan.ts), shown on Today as one card with their sets taken in rounds. Never on a day's first lift, and
   *  left out rather than false, as `rest` is. */
  superset?: boolean;
}

export interface PlanDay {
  weekday: string;
  name: string;
  focus: string;
  exercises: PlanExercise[];
  cardio: { name: string; detail: string };
}

export interface Plan {
  tempo: string;
  /** Daily goals: steps, and for the Health tab hours asleep, minutes of exercise, active kcal and ml of water. */
  stepGoal: number;
  sleepGoalH: number;
  exerciseGoalMin: number;
  activeGoalKcal: number;
  waterGoalMl: number;
  goalWeight: number | null;
  weeklyRatePct: number | null;
  kneeLimit: number;
  /** For the plates button on a set, and a lift's warm-up sets. */
  barKg: number;
  plateKgs: number[];
  /** The rest timer's default length, seconds, started when a set's reps are logged. A lift can override it. */
  restSec: number;
  /** An effort field on each set: RPE, reps in reserve, or neither. */
  effort: Effort;
  warmups: string[];
  days: PlanDay[];
}
