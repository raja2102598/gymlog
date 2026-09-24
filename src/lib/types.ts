/* The data model. One row per (user, day) in table `logs`, with a JSON `data` column shaped like DayLog.
 * Exercises are keyed by their planned name, so editing the plan never scrambles old logs. The plan is
 * one row per user in table `plans`; src/data/plan.json is the default until it's edited. Health Connect
 * data is one row per (user, day) in table `health_days`, shaped like HealthDay, kept apart from what you
 * type so neither overwrites the other. */

/** "YYYY-MM-DD" in the phone's local time. */
export type DayKey = string;

export interface SetLog {
  reps: number | null;
  kg: number | null;
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
  cardioMin?: number;
  cardioKmh?: number;
  cardioIncline?: number;
  /** Knee pain 0-10 around knee-sensitive sessions, and on waking the next morning. */
  kneeBefore?: number;
  kneeAfter?: number;
  kneeWake?: number;
}

/** One day of Health Connect data, as the Android app saves it to table `health_days`. Only what the phone had. */
export interface HealthDay {
  /** Health Connect's total for the day: phone and watch counted once. */
  steps?: number;
  /** Active calories burned, kcal. */
  activeKcal?: number;
  /** kg: the day's first weigh-in. */
  weight?: number;
  /** bpm: resting heart rate, and the day's average and highest heart rate. */
  restingHr?: number;
  hrAvg?: number;
  hrMax?: number;
  /** Minutes asleep in the sleep that ended this day, and by stage when the tracker reports stages. */
  sleepMin?: number;
  sleepStages?: Partial<Record<"deep" | "rem" | "light" | "awake", number>>;
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

export const EXTRA_FIELDS = ["waist", "cardioMin", "cardioKmh", "cardioIncline", "kneeBefore", "kneeAfter", "kneeWake"] as const;
export type ExtraField = (typeof EXTRA_FIELDS)[number];
export type KneeField = "kneeBefore" | "kneeAfter" | "kneeWake";
export type NumField = "waist" | "cardioMin" | "cardioKmh" | "cardioIncline";

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
  stepGoal: number;
  goalWeight: number | null;
  weeklyRatePct: number | null;
  kneeLimit: number;
  warmups: string[];
  days: PlanDay[];
}
