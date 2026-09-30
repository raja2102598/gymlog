/* Gym Log's Wear OS app, as the phone sees it (docs/watch.md): what it's sent, and what's done with what it sends back.
 * The state is built from the store with the rules the phone's own screens use (lib/lift.ts's models: a lift's rows,
 * the suggestions in its boxes, its weight step and cue; the day's blocks, cardio, skip and free workout), so the watch
 * has nothing to work out for itself. A command goes through the same change as the tap it stands for (Complete set
 * N, a set's check, ··· Skip today, the cardio's tick, the clock, the rest timer's buttons, Finish), so something done
 * on the wrist counts exactly as it would on the phone, whichever screen the phone is on. One more has no tap: the
 * workout's heart rate, measured on the watch, which is kept on the day. native/watch.ts sends the one and takes the
 * others from the app's Watch plugin. */
import { addDays, todayKey } from "./dates";
import { num } from "./format";
import { blockRest, supersetModels, type LiftModel } from "./lift";
import type { GymStore } from "./store";
import type { DayKey, SetType } from "./types";
import { currentRun, finishWorkout, pauseRun, resumeRun, runChangedAt, runMs, runOf, STALE_RUN_MS, startRun } from "./workout";

/** The version of these shapes, `v` in each: either side ignores one it doesn't know. */
export const WATCH_V = 1;

/** One working set as the phone shows it: what's logged, and in grey, what Complete set N would log there. */
export interface WatchRow {
  reps: number | null;
  kg: number | null;
  type: SetType | null;
  sugReps: number | null;
  sugKg: number | null;
}

export interface WatchLift {
  /** The day's name for it, as planned: what commands name. */
  key: string;
  /** What it's done as: a swap's own name. */
  name: string;
  done: boolean;
  skipped: boolean;
  /** The rest its set starts on the phone, seconds: in a superset, the round's (blockRest). */
  restSec: number;
  /** The weight step on its equipment, kg. */
  inc: number;
  /** How to do it, or "" when there's nothing to say. */
  cue: string;
  rows: WatchRow[];
}

export interface WatchDay {
  date: DayKey;
  /** The session's name, or the free workout's. */
  title: string;
  /** The day's workout skipped on purpose. */
  skipped: boolean;
  /** The day's cardio, or null for none (a free workout has none, as in the phone's workout). */
  cardio: string | null;
  cardioDone: boolean;
  /** The workout's steps in order: one lift, or a superset's lifts. */
  blocks: WatchLift[][];
}

export interface WatchState {
  v: number;
  sentAt: number;
  /** False: the watch says to sign in on the phone, and shows nothing else. */
  signedIn: boolean;
  /** The account signed in (its Supabase user id), or null when none is: each command the watch makes carries the
   *  one it was made under, and is only ever applied to that account. */
  account: string | null;
  /** The ids of the watch's commands applied so far, the latest last. */
  applied: string[];
  /** The workout under way (lib/workout.ts's WorkoutRun), or null. `pauses` are those resumed, [from, to]. */
  run: { day: DayKey; startedAt: number; pausedAt: number | null; pausedMs: number; endedAt: number | null; pauses: [number, number][] } | null;
  /** store.rest, or null. `startedAt` tells it from the next rest (null for a timer saved before it was kept). */
  rest: { day: DayKey; lift: string; endAt: number; pausedAt: number | null; sec: number; startedAt: number | null } | null;
  /** When the rest timer was last changed (store.restChangedAt), skipped too, or null: the watch's rest buttons and
   *  sets from before then aren't shown on it. */
  restChangedAt: number | null;
  /** Today and the next six days, and first, when it's another day, the one whose workout is under way. */
  days: WatchDay[];
}

/** One thing done on the watch: its id, when it was done (epoch ms, the watch's clock) and its type's own fields. */
export interface WatchCommand {
  v?: unknown;
  id: string;
  at?: unknown;
  type?: unknown;
  [field: string]: unknown;
}

/** The day's workout, block by block, as models whose sets start the rest the phone's workout would (supersetModels:
 *  a lift's own after each set, a superset's once a round is complete), for sets logged at `from`. */
function modelsOf(store: GymStore, day: DayKey, from?: number): LiftModel[][] {
  const e = store.entry(day);
  let i = 0;
  return store.liftBlocks(day).map((b) => supersetModels(store, day, b.map((item) => ({ item, i: i++ })), e, from));
}

/** A lift for the watch: its rows are the ones its card shows (none once skipped), each with what's logged in it and
 *  what Complete set N would log there (logSet: the suggestion's reps, and the weight of the set before it today or
 *  else the suggestion's). */
function liftOf(store: GymStore, m: LiftModel, restSec: number): WatchLift {
  const rows = m.r.skipped ? 0 : m.rows;
  return {
    key: m.name,
    name: m.did,
    done: !!m.r.done,
    skipped: !!m.r.skipped,
    restSec,
    inc: m.inc,
    cue: m.cue,
    rows: Array.from({ length: rows }, (_, j): WatchRow => {
      const s = m.sets[j], reps = num(m.sugFor(m.sets, j)[0]);
      return { reps: s?.reps ?? null, kg: s?.kg ?? null, type: s?.type ?? null, sugReps: reps != null && reps > 0 ? reps : null, sugKg: m.kgFor(m.sets, j) };
    }),
  };
}

function dayOf(store: GymStore, date: DayKey): WatchDay {
  const p = store.planFor(date), e = store.entry(date);
  return {
    date,
    title: p.name,
    skipped: e.skip != null,
    cardio: p.cardio.name && !store.isFree(date) ? p.cardio.name : null,
    cardioDone: e.cardio,
    blocks: modelsOf(store, date).map((ms) => {
      const rest = blockRest(store, date, ms.map((m) => m.item));
      return ms.map((m) => liftOf(store, m, rest));
    }),
  };
}

/** What the watch is sent: nothing but `signedIn: false` unless a real account is signed in (never the demo's sample
 *  data), and otherwise the workout's clock, the rest timer, and the days it may be asked about. */
export function watchState(store: GymStore, applied: string[], now = Date.now()): WatchState {
  const signedIn = store.auth === "signedIn" && !store.demo, account = (signedIn && store.user?.id) || null;
  if (!signedIn || !account) return { v: WATCH_V, sentAt: now, signedIn: false, account: null, applied, run: null, rest: null, restChangedAt: null, days: [] };
  const r = currentRun(), rest = store.rest, today = todayKey();
  const dates = Array.from({ length: 7 }, (_, n) => addDays(today, n));
  // A workout for another day, started before midnight or opened for a day gone by, stays the one the watch is on
  // until it's finished or left behind (docs/watch.md): paused too, since a pause at 00:10 is still that workout, and
  // the watch would otherwise jump to the next day's session in the middle of it. A paused clock is never left behind.
  const left = r != null && r.pausedAt == null && runMs(r, now) >= STALE_RUN_MS;
  if (r && !r.endedAt && !left && !dates.includes(r.day)) dates.unshift(r.day);
  return {
    v: WATCH_V,
    sentAt: now,
    signedIn,
    account,
    applied,
    run: r && { day: r.day, startedAt: r.startedAt, pausedAt: r.pausedAt ?? null, pausedMs: r.pausedMs ?? 0, endedAt: r.endedAt ?? null, pauses: r.pauses ?? [] },
    // (A timer saved before its length was kept counts as the plan's.)
    rest: rest && { day: rest.day, lift: rest.lift, endAt: rest.endAt, pausedAt: rest.pausedAt, sec: rest.sec ?? store.plan.restSec, startedAt: rest.startedAt ?? null },
    restChangedAt: store.restChangedAt,
    days: dates.map((d) => dayOf(store, d)),
  };
}

const isDay = (v: unknown): v is DayKey => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The lift a command names by its key, as the day's workout has it, its rest counted from `from`: null when the day
 *  has no such lift. */
function liftNamed(store: GymStore, day: DayKey, key: unknown, from?: number): LiftModel | null {
  if (typeof key !== "string") return null;
  for (const ms of modelsOf(store, day, from)) for (const m of ms) if (m.name === key) return m;
  return null;
}

/** A set done on the watch: logged as Complete set N logs it, weight then reps, so the rest starts on the finished set
 *  as the phone's rule has it, counted from when it was done, `at`, which is also its startedAt, as the watch started
 *  it (store.startRest). With no weight, the reps take the one Complete set N would (kgFor). No reps is the check's
 *  undo: the set's reps go, and a tick they gave the lift with them. Not for a skipped lift, which shows no sets, a
 *  set past the rows it shows, or a row changed on the phone since the watch saw it. */
function logWatchSet(store: GymStore, day: DayKey, c: WatchCommand, at: number): boolean {
  const m = liftNamed(store, day, c.lift, at), j = c.set, reps = c.reps, kg = c.kg;
  const baseReps = c.baseReps ?? null, baseKg = c.baseKg ?? null;
  if (!m || m.r.skipped || typeof j !== "number" || !Number.isInteger(j) || j < 0 || j >= m.rows) return false;
  if (!(kg === null || (isNumber(kg) && kg >= 0)) || (reps !== null && (!isNumber(reps) || reps <= 0))) return false;
  if (!(baseReps === null || isNumber(baseReps)) || !(baseKg === null || isNumber(baseKg))) return false;
  // The row as the watch had it when this was done, `baseReps` and `baseKg`: changed on the phone since (a correction
  // typed or said there, or cleared), the phone's is the newer, and this is dropped. A row that already has what this
  // logs needs nothing. The watch's own commands on a row follow one another: each one's base is the one before's.
  const cur = m.sets[j], curReps = cur?.reps ?? null, curKg = cur?.kg ?? null;
  if (reps === null ? curReps === null : curReps === reps && (kg === null || curKg === halfKg(kg))) return true;
  if (curReps !== baseReps || curKg !== halfKg(baseKg)) return false;
  if (reps === null) {
    if ((curReps ?? 0) > 0) m.setField(j, "reps", "");
    return true;
  }
  if (kg != null) m.setField(j, "kg", String(kg));
  m.setField(j, "reps", String(reps));
  return true;
}

/** A weight as the phone keeps it, to the half kg (LiftModel.setField): the watch's are compared with it so. */
const halfKg = (kg: number | null) => (kg == null ? null : Math.round(kg * 2) / 2);

/** Whether a rest button pressed on the watch, at `at`, was pressed for the rest there is now, as it was. The command
 *  names the rest the watch showed, by its day, lift and startedAt (`restStartedAt`); a newer rest started since, by a
 *  set logged on the phone or said to it, has another startedAt. A timer saved before rests had one, or a command about
 *  one, is known by its day and lift alone. And the rest hasn't changed since `at` (paused, resumed or made longer on
 *  the phone after it), which a late one would undo. */
function sameRest(store: GymStore, day: DayKey | null, c: WatchCommand, at: number): boolean {
  const r = store.rest, from = c.restStartedAt;
  if (!r || !day || r.day !== day || r.lift !== c.lift || !(from == null || isNumber(from))) return false;
  return (r.startedAt == null || from == null || r.startedAt === from) && (store.restChangedAt ?? -Infinity) <= at;
}

/** Whether the clock's pause, resume or Finish pressed on the watch, at `at`, is for the day's run as it is now: the
 *  command names the run the watch showed by its startedAt (`runStartedAt`, or none for a day with no clock yet), and
 *  one restarted (↺) or started again on the phone since has another; and that run hasn't changed since `at` (paused,
 *  resumed or finished on the phone after it), which a late one would undo. */
function sameRun(day: DayKey, c: WatchCommand, at: number): boolean {
  const from = c.runStartedAt, r = runOf(day);
  return (from == null || isNumber(from)) && (r?.startedAt ?? null) === (from ?? null) && (!r || runChangedAt(r) <= at);
}

/** Does what a command from the watch stands for, through the same change as the phone's own tap, and says whether it
 *  could: false for one it can't apply (made under another account than the one signed in, or under none; a day or
 *  lift it doesn't have, a set past the rows, a rest or a run since replaced, a type or version it doesn't know),
 *  which is dropped. The clock and the rest timer's buttons act as of when they were done on the watch (never later
 *  than now, should the watch's clock be ahead), and only on the run or rest they were pressed for. */
export function applyWatchCommand(store: GymStore, c: WatchCommand, now = Date.now()): boolean {
  // Made while the watch showed another account's workout: signed out and into this one since, with the watch out of
  // reach. Its day and lift are that account's, never this one's.
  if (c.v !== WATCH_V || typeof c.account !== "string" || c.account !== store.user?.id) return false;
  const at = Math.min(isNumber(c.at) ? c.at : now, now), day = isDay(c.day) ? c.day : null;
  switch (c.type) {
    case "set":
      // The rest it starts takes the watch's own `at` as its startedAt (startRest counts down from no later than now).
      return !!day && logWatchSet(store, day, c, isNumber(c.at) ? c.at : now);
    case "startRun": {
      // Never over a run changed after it was pressed, whatever its day: the phone keeps one run, and one started,
      // paused, resumed or finished there while this waited out of reach is the newer.
      const r = currentRun();
      if (!day || (r && runChangedAt(r) > at)) return false;
      startRun(day, at);
      return true;
    }
    // Only for the run they were pressed for, as it was: a pause queued away from the phone never stops a clock
    // restarted since, nor one paused and resumed there after it.
    case "pauseRun":
      if (!day || !sameRun(day, c, at)) return false;
      pauseRun(day, at);
      return true;
    case "resumeRun":
      if (!day || !sameRun(day, c, at)) return false;
      resumeRun(day, at);
      return true;
    case "finish":
      if (!day || !sameRun(day, c, at)) return false;
      finishWorkout(store, day, at);
      return true;
    // As of `at`, when they were pressed, as the watch shows them: +15s arriving once even the longer rest is over
    // changes nothing, and a pause keeps what was left then.
    case "restSkip":
      if (!sameRest(store, day, c, at)) return false;
      store.skipRest(at);
      return true;
    case "restAdd":
      if (!isNumber(c.sec) || c.sec <= 0 || !sameRest(store, day, c, at)) return false;
      return store.addRestTime(c.sec, at);
    case "restPause":
      if (!sameRest(store, day, c, at)) return false;
      store.pauseRest(at);
      return true;
    case "restResume":
      if (!sameRest(store, day, c, at)) return false;
      store.resumeRest(at);
      return true;
    case "skipLift": {
      // ··· Skip today, with no reason.
      const m = day && liftNamed(store, day, c.lift);
      if (!m) return false;
      if (!m.r.skipped) m.skipToday();
      return true;
    }
    case "cardioDone": {
      // The cardio's tick, on a day whose workout has it.
      const done = c.done;
      if (!day || typeof done !== "boolean" || !store.planFor(day).cardio.name || store.isFree(day)) return false;
      store.editDay(
        day,
        (n) => {
          n.cardio = done;
        },
        true,
      );
      return true;
    }
    case "hr": {
      // The day's heart rate so far, measured on the watch through its workout: each replaces the one before, since
      // it's the whole of it. Kept on the day for Workout complete. Each goes as its own item, and they can arrive
      // in any order, a batch apart: one over fewer readings than the day has already is an older snapshot, dropped.
      const { avg, max, samples } = c;
      if (!day || !isNumber(avg) || !isNumber(max) || !isNumber(samples) || samples < 1 || avg < 20 || avg > max || max > 250) return false;
      if (samples < (store.entry(day).hr?.samples ?? 0)) return false;
      store.editDay(
        day,
        (n) => {
          n.hr = { avg: Math.round(avg), max: Math.round(max), samples };
        },
        true,
      );
      return true;
    }
    default:
      return false;
  }
}
