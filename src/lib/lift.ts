/* One lift on one day, as the workout shows it and the changes it makes to it: a lift's own card (LiftItem.tsx), a
 * superset's (SupersetItem.tsx), the workout's Complete set N (WorkoutView.tsx), and the watch (lib/watch.ts), which
 * logs its sets through the same changes so a set done on the wrist counts exactly as one done on the phone. */
import { num } from "./format";
import { isWorkingSet } from "./stats";
import { minSets, performed, restSecFor, setsComplete, setsOf, targetOf, topKg, type GymStore, type LastDone, type LiftItem as Item, type NextWeight } from "./store";
import type { DayKey, DayLog, LiftLog, PlanExercise, SetLog } from "./types";

/** One lift on one day, as a card shows it, and the changes a card makes to it: shared by a lift's own card, a
 *  superset's (SupersetItem.tsx) and the watch (lib/watch.ts), and plain values and functions rather than hooks, so a
 *  superset has one for each of its lifts. */
export interface LiftModel {
  item: Item;
  i: number;
  day: DayKey;
  name: string;
  x: PlanExercise;
  r: Partial<LiftLog>;
  /** What was done: the planned name, or what it was swapped for. */
  did: string;
  last: LastDone | null;
  next: NextWeight | null;
  target: { sets: string; reps: string };
  warmSets: SetLog[];
  /** Working sets, numbered as on the card. */
  sets: SetLog[];
  /** The planned number of sets, and how many rows the card shows. */
  min: number;
  rows: number;
  /** The warm-up calculator's working weight to start from: the progression hint, or last time's top set. */
  defaultWorkingKg: number | null;
  /** The bar what was done goes on, for its plates and warm-up sets (null: it takes no plates), and what its
   *  warm-up sets round to: My gym's weights for what it's loaded with. */
  bar: number | null;
  inc: number;
  /** How to do the lift, when there's anything to say and it's done as planned. */
  cue: string;
  /** The working set whose box has the cursor, or null: it's being typed in (see logged). */
  typing: number | null;
  /** The cursor going into set j's boxes, and out of them. */
  typeIn: (j: number) => void;
  typeOut: (j: number) => void;
  /** What set `j` of `sets` suggests, [reps, kg] as its boxes show them greyed ("-" for nothing): the numbers of the
   *  last set before it that's logged, a drop set aside (it's lighter on purpose), so the sets after one repeat it;
   *  before any, last time's set or the next weight (store.placeholders). What Complete set N logs for what isn't
   *  typed. */
  sugFor: (sets: Partial<SetLog>[], j: number) => [string, string];
  /** The weight set `j` of `sets` takes when it gets its reps without one, typed or from Complete set N alike, and
   *  the one its box suggests: the last logged set's before it (sugFor), or else the weight typed in the set just
   *  before it, or else last time's or the next weight. */
  kgFor: (sets: Partial<SetLog>[], j: number) => number | null;
  edit: (fn: (r: LiftLog) => void, immediate: boolean) => void;
  setField: (j: number, f: "reps" | "kg", value: string) => void;
  setInfo: (j: number, patch: Partial<SetLog>) => void;
  /** Adds a set: one more than it has, or up to `upTo` sets. */
  addSet: (upTo?: number) => void;
  /** Removes the last working set, without asking. */
  dropSet: () => void;
  /** Whether the lift's working sets are still the ones this was made from: a question asked from it (− Set) may
   *  have waited while voice logged another. */
  sameSets: () => boolean;
  /** Whether the lift is still all as `r` has it, warm-ups and swap too: removing it acts only if so. */
  sameLift: () => boolean;
  logWarmups: (steps: { reps: number; kg: number }[]) => void;
  removeWarmups: () => void;
  skipToday: () => void;
}

/** A tick that came from logging the planned working sets (autoDone, saved with the day) follows them: on once
 *  they're all logged, and off again when one is cleared, taken off or made a drop set. Warm-ups never count, and a
 *  tick given by hand, with the box or "done", stays. */
function tickFollows(r: LiftLog, work: SetLog[], min: number) {
  if (r.done && r.autoDone && !setsComplete(work, min)) {
    r.done = false;
    delete r.autoDone;
  } else if (!r.done && !r.skipped && setsComplete(work, min)) {
    r.done = true;
    r.autoDone = true;
  }
}

/** The last set before set `j` that's logged, a drop set aside: the one the sets after it repeat (LiftModel.sugFor). */
const loggedBefore = (sets: Partial<SetLog>[], j: number) => sets.slice(0, j).findLast((s) => (s.reps ?? 0) > 0 && s.type !== "drop");

/** A lift's model on a day. `onReps` hears of a set just given its first reps with no later set of the lift logged:
 *  when a rest can start. A lift's own card starts it then; a superset waits for the round. */
export function liftModel(store: GymStore, sel: DayKey, item: Item, i: number, entry: DayLog, onReps: (m: LiftModel, j: number) => void): LiftModel {
  const { x, name, extra } = item, r: Partial<LiftLog> = entry.exercises[name] || {};
  const did = performed(name, r as LiftLog), last = store.lastDone(did, sel), next = r.skipped ? null : store.nextWeight(x, did, sel);
  const load = store.loadDone(x, did);
  // What this lift was actually asked for on this day: its own stored target once logged, so its row count and
  // "sets done" reading don't drift under it if the plan's sets or reps change later; today's plan otherwise.
  const target = targetOf(r, x);
  // Warm-up sets (WU-marked) are kept apart from the numbered grid: they never count toward the planned sets, a
  // record or the heaviest set, whatever position they hold in the stored array.
  const allSets = setsOf(r as LiftLog), warmSets = allSets.filter((s) => !isWorkingSet(s));
  const sets = allSets.filter(isWorkingSet), min = extra ? 1 : minSets(target);
  const edit = (fn: (r: LiftLog) => void, immediate: boolean) => void store.editLift(sel, name, fn, immediate);
  const t = store.typing;
  const m: LiftModel = {
    item,
    i,
    day: sel,
    name,
    x,
    r,
    did,
    last,
    next,
    target,
    warmSets,
    sets,
    min,
    rows: Math.max(min, sets.length),
    defaultWorkingKg: next && !next.held ? next.to : last ? topKg(setsOf(last.r)) : null,
    bar: store.barFor(load),
    inc: store.gridFor(load)?.inc ?? 2.5,
    // How to do the lift: folded, since it's the same every week. Warnings (e.g. a KNEE NOTE) always show.
    cue: r.skipped || r.swap ? "" : x.cue,
    typing: t && t.day === sel && t.lift === name ? t.set : null,
    typeIn: (j) => store.typeIn({ day: sel, lift: name, set: j }),
    typeOut: (j) => store.typeOut({ day: sel, lift: name, set: j }),
    sugFor: (sets, j) => {
      const reps = loggedBefore(sets, j)?.reps, kg = m.kgFor(sets, j);
      return [reps != null ? String(reps) : store.placeholders(x, last, j, next)[0], kg != null ? String(kg) : "-"];
    },
    kgFor: (sets, j) => loggedBefore(sets, j)?.kg ?? (j > 0 ? sets[j - 1]?.kg : null) ?? num(store.placeholders(x, last, j, next)[1]),
    edit,
    setField(j, f, value) {
      // Whether these reps can start a rest: set once inside edit(), against the state just before this change.
      let first = false;
      edit((r) => {
        const warm = setsOf(r).filter((s) => !isWorkingSet(s));
        const work = setsOf(r).filter(isWorkingSet).map((s): SetLog => ({ ...s, reps: s.reps ?? null, kg: s.kg ?? null }));
        while (work.length <= j) work.push({ reps: null, kg: null });
        const v = num(value), hadReps = work[j].reps != null;
        work[j][f] = v == null ? null : f === "kg" ? Math.round(v * 2) / 2 : Math.max(0, Math.round(v));
        // A new set usually uses the same weight as the one before it, and the first the suggested one: reps typed
        // without a weight give it the one Complete set N would, rather than log none under a suggestion that looks
        // like one.
        if (f === "reps" && v != null && work[j].kg == null) work[j].kg = m.kgFor(work, j);
        // When a set gets its reps, whether its kg came first or not: not again as more digits go in ("1", then
        // "12"), and not for a correction to a set with a later one already logged.
        if (f === "reps" && v != null && !hadReps && !work.slice(j + 1).some((s) => s.reps != null)) first = true;
        r.sets = [...warm, ...work];
        r.kg = topKg(r.sets);
        tickFollows(r, work, min);
      }, false);
      if (first) onReps(m, j);
    },
    // A set's kind or effort, from its menu. Making a set a drop set, or a working set again, changes how many
    // count toward the planned sets.
    setInfo(j, patch) {
      edit((r) => {
        const warm = setsOf(r).filter((s) => !isWorkingSet(s));
        const work = setsOf(r).filter(isWorkingSet).map((s) => ({ ...s }));
        while (work.length <= j) work.push({ reps: null, kg: null });
        const next: SetLog = { ...work[j], ...patch };
        for (const k of ["type", "rpe", "rir"] as const) if (next[k] == null) delete next[k];
        work[j] = next;
        r.sets = [...warm, ...work];
        tickFollows(r, work, min);
      }, true);
    },
    addSet(upTo) {
      edit((r) => {
        const warm = setsOf(r).filter((s) => !isWorkingSet(s));
        const work = setsOf(r).filter(isWorkingSet).map((s) => ({ ...s }));
        const want = upTo ?? Math.max(min, work.length) + 1;
        while (work.length < want) work.push({ reps: null, kg: null });
        r.sets = [...warm, ...work];
      }, true);
    },
    dropSet() {
      edit((r) => {
        const warm = setsOf(r).filter((s) => !isWorkingSet(s)), work = setsOf(r).filter(isWorkingSet).slice(0, -1);
        r.sets = [...warm, ...work];
        r.kg = topKg(r.sets);
        tickFollows(r, work, min);
      }, true);
    },
    sameSets: () => JSON.stringify(setsOf((store.entry(sel).exercises[name] || {}) as LiftLog).filter(isWorkingSet)) === JSON.stringify(sets),
    sameLift: () => JSON.stringify(store.entry(sel).exercises[name] || {}) === JSON.stringify(r),
    logWarmups(steps) {
      edit((r) => {
        const work = setsOf(r).filter(isWorkingSet);
        r.sets = [...steps.map((s) => ({ reps: s.reps, kg: s.kg, type: "warmup" as const })), ...work];
        r.kg = topKg(r.sets);
      }, true);
    },
    removeWarmups() {
      edit((r) => {
        r.sets = setsOf(r).filter(isWorkingSet);
        r.kg = topKg(r.sets);
      }, true);
    },
    skipToday() {
      edit((r) => {
        r.skipped = true;
        r.done = false;
        delete r.autoDone;
      }, true);
    },
  };
  return m;
}

/** The rest a set of this block starts, seconds, once it's the one that starts it: its lift's own, or in a superset,
 *  once a round is complete, the longest any of its lifts not skipped has. */
export function blockRest(store: GymStore, sel: DayKey, items: Item[]): number {
  const e = store.entry(sel);
  return Math.max(0, ...items.map((it) => (e.exercises[it.name]?.skipped ? 0 : restSecFor(store.plan, it.x))));
}

/** A superset's lifts as models, with the rest timer starting once a round is complete rather than after each set,
 *  for the longest rest any of its lifts has (blockRest). Shared by the card, the workout's Complete button and the
 *  watch, whose sets were logged at `from` (store.startRest). */
export function supersetModels(store: GymStore, sel: DayKey, lifts: { item: Item; i: number }[], entry: DayLog, from?: number): LiftModel[] {
  // Each lift as saved now, not as of this render: voice changes a set after it.
  const now = () =>
    lifts.map(({ item }) => {
      const r = store.entry(sel).exercises[item.name];
      const sets = setsOf(r).filter(isWorkingSet), min = item.extra ? 1 : minSets(targetOf(r, item.x));
      return { sets, rows: r?.skipped ? 0 : Math.max(min, sets.length) };
    });
  const onReps = (m: LiftModel, j: number) => {
    const all = now();
    const complete = all.every((l) => j >= l.rows || l.sets[j]?.reps != null);
    const later = all.some((l) => l.sets.slice(j + 1).some((s) => s.reps != null));
    if (complete && !later) store.startRest(sel, m.did, blockRest(store, sel, lifts.map((l) => l.item)), from);
  };
  return lifts.map(({ item, i }) => liftModel(store, sel, item, i, entry, onReps));
}
