/* The exercise library: a catalogue of common lifts (src/data/exercises.json, built from free-exercise-db by
 * scripts/build-exercises.mjs; see docs/exercise-library.md) with the muscles each works and the equipment it
 * needs, plus your own lifts, searched by name, muscle and equipment. Lifts are still identified by name
 * (docs/exercise-model.md): a plan lift points at a library lift with PlanExercise.lib, and a lift of your own is
 * found by its name. */
import data from "@/data/exercises.json";
import type { CustomExercise, PlanExercise } from "./types";

/** Muscles in the library's words, and as the app shows them. */
export const MUSCLES = {
  abdominals: "Abs",
  abductors: "Abductors",
  adductors: "Adductors",
  biceps: "Biceps",
  calves: "Calves",
  chest: "Chest",
  forearms: "Forearms",
  glutes: "Glutes",
  hamstrings: "Hamstrings",
  lats: "Lats",
  "lower back": "Lower back",
  "middle back": "Middle back",
  neck: "Neck",
  quadriceps: "Quads",
  shoulders: "Shoulders",
  traps: "Traps",
  triceps: "Triceps",
} as const;
export type Muscle = keyof typeof MUSCLES;

/** Equipment in the app's words, as My gym lists it; a lift with none is done with bodyweight only. */
export const EQUIPMENT = {
  barbell: "Barbell",
  ezbar: "EZ bar",
  trapbar: "Trap bar",
  dumbbell: "Dumbbells",
  kettlebell: "Kettlebells",
  band: "Resistance bands",
  bench: "Bench",
  rack: "Squat rack",
  pullupbar: "Pull-up bar",
  dipbars: "Dip bars",
  cable: "Cable machine",
  machine: "Machines",
  smith: "Smith machine",
  medball: "Medicine ball",
  ball: "Exercise ball",
  foamroll: "Foam roller",
  other: "Other",
} as const;
export type Equip = keyof typeof EQUIPMENT;

export const isMuscle = (m: unknown): m is Muscle => typeof m === "string" && Object.hasOwn(MUSCLES, m);
export const isEquip = (e: unknown): e is Equip => typeof e === "string" && Object.hasOwn(EQUIPMENT, e);

export interface Exercise {
  /** The library's id, or "custom:" and the name for one of your own. */
  id: string;
  name: string;
  /** Everything it needs, in EQUIPMENT's order; none for bodyweight only. */
  equip: Equip[];
  primary: Muscle[];
  secondary: Muscle[];
  /** Its place among the lifts most people know, 1 first, or 0: those come first in the list. */
  rank: number;
  custom?: boolean;
}

type Row = { id: string; n: string; e: string[]; p: string[]; s: string[]; c?: number };
export const CATALOGUE: readonly Exercise[] = (data.exercises as Row[]).map((x) => ({
  id: x.id,
  name: x.n,
  equip: x.e.filter(isEquip),
  primary: x.p.filter(isMuscle),
  secondary: x.s.filter(isMuscle),
  rank: x.c ?? 0,
}));
const BY_ID = new Map(CATALOGUE.map((x) => [x.id, x]));
const BY_NAME = new Map(CATALOGUE.map((x) => [x.name.toLowerCase(), x]));
/** Where the catalogue comes from, for the credit line. */
export const SOURCE = { url: data.source, commit: data.commit };

export const libraryLift = (id: string | undefined): Exercise | null => (id ? (BY_ID.get(id) ?? null) : null);
/** The library lift with exactly this name, whatever its case. */
export const libraryNamed = (name: string): Exercise | null => BY_NAME.get(name.trim().toLowerCase()) ?? null;
export const customLift = (c: CustomExercise): Exercise => ({ id: `custom:${c.name}`, name: c.name, equip: c.equip, primary: c.primary, secondary: c.secondary, rank: 0, custom: true });

/** A lift's exercise, when the library or your own lifts know it: the library lift it points at, else your own lift
 *  of that name, else the library lift of that name. Null for a name neither knows: an untagged lift. */
export function exerciseFor(name: string, custom: readonly CustomExercise[], x?: Pick<PlanExercise, "lib"> | null): Exercise | null {
  const linked = libraryLift(x?.lib);
  if (linked) return linked;
  const key = name.trim().toLowerCase(), own = custom.find((c) => c.name.toLowerCase() === key);
  return own ? customLift(own) : libraryNamed(name);
}

/* ---------- words ---------- */

const ABBR: Record<string, string> = { db: "dumbbell", dbs: "dumbbell", bb: "barbell", kb: "kettlebell", kbs: "kettlebell" };
const SAME: Record<string, string> = { flye: "fly", flie: "fly", calve: "calf", bicep: "bicep", tricep: "tricep" };
const STOP = new Set(["a", "an", "the", "with", "on", "to", "of", "or", "and", "for", "in", "your"]);
const stem = (w: string) => {
  let s = w;
  if (w.length > 3) {
    if (/(ss|sh|ch|x)es$/.test(w)) s = w.slice(0, -2);
    else if (w.endsWith("ies")) s = `${w.slice(0, -3)}y`;
    else if (w.endsWith("s") && !w.endsWith("ss")) s = w.slice(0, -1);
  }
  return SAME[s] ?? s;
};

/** A name's words, for search and matching: lower case, pull-up and the like as one word, abbreviations spelled
 *  out, plurals made singular, and little words left out, so "DB Lateral Raises" and "Dumbbell Lateral Raise"
 *  read the same. */
export function words(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(pull|chin|push|sit|step)[\s-]+ups?\b/g, "$1up")
    .replace(/\b(pull|push)[\s-]+downs?\b/g, "$1down")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .flatMap((w) => (ABBR[w] ?? w).split(" "))
    .map(stem)
    .filter((w) => !STOP.has(w));
}

const MUSCLE_WORDS: Record<Muscle, string[]> = {
  abdominals: ["abdominal", "ab", "abs", "core"],
  abductors: ["abductor"],
  adductors: ["adductor"],
  biceps: ["bicep"],
  calves: ["calf"],
  chest: ["chest", "pec"],
  forearms: ["forearm"],
  glutes: ["glute"],
  hamstrings: ["hamstring"],
  lats: ["lat"],
  "lower back": ["lower", "back"],
  "middle back": ["middle", "back"],
  neck: ["neck"],
  quadriceps: ["quadricep", "quad"],
  shoulders: ["shoulder", "delt"],
  traps: ["trap"],
  triceps: ["tricep"],
};
const EQUIP_WORDS: Record<Equip, string[]> = {
  barbell: ["barbell"],
  ezbar: ["ez", "bar"],
  trapbar: ["trap", "bar"],
  dumbbell: ["dumbbell"],
  kettlebell: ["kettlebell"],
  band: ["band"],
  bench: ["bench"],
  rack: ["rack"],
  pullupbar: ["pullup", "bar"],
  dipbars: ["dip", "bar"],
  cable: ["cable"],
  machine: ["machine", "leverage"],
  smith: ["smith", "machine"],
  medball: ["medicine", "ball"],
  ball: ["exercise", "ball"],
  foamroll: ["foam", "roller"],
  other: [],
};
/** Words that name a kind of equipment: a name saying one isn't a lift done with another. */
const GEAR = new Set(["barbell", "dumbbell", "kettlebell", "cable", "machine", "smith", "band", "ez"]);

const cache = new WeakMap<Exercise, { name: Set<string>; gear: Set<string>; muscles: Set<string>; all: string[] }>();
function wordsOf(x: Exercise) {
  let w = cache.get(x);
  if (!w) {
    const name = new Set(words(x.name)), gear = new Set(x.equip.flatMap((e) => EQUIP_WORDS[e])), muscles = new Set(x.primary.flatMap((m) => MUSCLE_WORDS[m]));
    const all = [...new Set([...name, ...gear, ...muscles, ...x.secondary.flatMap((m) => MUSCLE_WORDS[m]), ...(x.equip.length ? [] : ["bodyweight"])])];
    w = { name, gear, muscles, all };
    cache.set(x, w);
  }
  return w;
}

/* ---------- search ---------- */

export interface LibQuery {
  /** Words to find: each must start a word of the lift's name, its muscles or its equipment. */
  text?: string;
  /** Only lifts with this as a main muscle. */
  muscle?: Muscle | "";
  /** Only lifts that use this. */
  equip?: Equip | "";
  /** Common lifts first (the default), or A to Z. */
  sort?: "common" | "az";
}
const byName = (a: Exercise, b: Exercise) => a.name.localeCompare(b.name);
/** Common lifts first, in their order, then the rest A to Z. */
export const byCommon = (a: Exercise, b: Exercise) => (a.rank || Infinity) - (b.rank || Infinity) || byName(a, b);

export function searchLibrary(all: readonly Exercise[], q: LibQuery = {}): Exercise[] {
  const want = words(q.text ?? "");
  return all
    .filter(
      (x) =>
        (!q.muscle || x.primary.includes(q.muscle)) &&
        (!q.equip || x.equip.includes(q.equip)) &&
        want.every((w) => wordsOf(x).all.some((o) => o.startsWith(w))),
    )
    .sort(q.sort === "az" ? byName : byCommon);
}

/* ---------- matching a name to the library ---------- */

// How alike a name is to a library lift, 0 to 1: the words they share over the words there are (a Dice
// coefficient), where a name's word for the lift's equipment or main muscle counts as shared ("Chest Press Machine"
// and Leverage Chest Press), less a quarter for naming a kind of equipment the lift doesn't use.
function likeness(name: Set<string>, x: Exercise): number {
  const w = wordsOf(x), theirs = new Set(w.name);
  for (const n of name) if (w.gear.has(n) || w.muscles.has(n)) theirs.add(n);
  let both = 0;
  for (const n of name) if (theirs.has(n)) both++;
  const off = [...name].some((n) => GEAR.has(n) && !w.gear.has(n)) ? 0.25 : 0;
  return (2 * both) / (name.size + theirs.size) - off;
}

/** Library lifts close enough to a name to ask whether they're the same lift, best first (common first among
 *  equals), at most `n`. None for a name that's exactly a library lift's, which needs no asking. */
export function closeMatches(name: string, all: readonly Exercise[] = CATALOGUE, n = 3): Exercise[] {
  const mine = new Set(words(name));
  if (!mine.size || libraryNamed(name)) return [];
  return all
    .map((x) => ({ x, s: likeness(mine, x) }))
    .filter((m) => m.s >= 0.6)
    .sort((a, b) => b.s - a.s || byCommon(a.x, b.x))
    .slice(0, n)
    .map((m) => m.x);
}

/* ---------- how a lift reads ---------- */

/** "Barbell, bench" or "Bodyweight". */
export const equipText = (x: Exercise) => (x.equip.length ? x.equip.map((e, i) => (i ? EQUIPMENT[e].toLowerCase() : EQUIPMENT[e])).join(", ") : "Bodyweight");
/** "Chest, with shoulders and triceps". */
export function muscleText(x: Exercise): string {
  const list = (ms: Muscle[]) => ms.map((m) => MUSCLES[m].toLowerCase()).reduce((s, m, i, a) => (i === 0 ? m : i === a.length - 1 ? `${s} and ${m}` : `${s}, ${m}`), "");
  if (!x.primary.length) return "No muscles given";
  const main = list(x.primary);
  return `${main[0].toUpperCase()}${main.slice(1)}${x.secondary.length ? `, with ${list(x.secondary)}` : ""}`;
}
