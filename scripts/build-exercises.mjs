// Builds src/data/exercises.json, the exercise library, from free-exercise-db's dist/exercises.json
// (https://github.com/yuhonas/free-exercise-db, public domain under the Unlicense; see docs/exercise-library.md).
// It keeps the strength, powerlifting and Olympic lifts, without instructions or images; puts each lift's
// equipment in the app's own words (EQUIPMENT in src/lib/library.ts), adding what the name says it needs, such as
// a bench or a rack; and marks the lifts most people know, to list first. Run by hand when updating the data:
//
//   node scripts/build-exercises.mjs path/to/free-exercise-db/dist/exercises.json <upstream commit>
import fs from "node:fs";

const [src, commit] = process.argv.slice(2);
if (!src || !/^[0-9a-f]{40}$/.test(commit ?? "")) {
  console.error("usage: node scripts/build-exercises.mjs <dist/exercises.json> <40-character upstream commit>");
  process.exit(2);
}
const upstream = JSON.parse(fs.readFileSync(src, "utf8"));

const CATEGORIES = new Set(["strength", "powerlifting", "olympic weightlifting"]);
const BASE = {
  barbell: "barbell",
  "e-z curl bar": "ezbar",
  dumbbell: "dumbbell",
  kettlebells: "kettlebell",
  bands: "band",
  cable: "cable",
  machine: "machine",
  "medicine ball": "medball",
  "exercise ball": "ball",
  "foam roll": "foamroll",
  other: "other",
};
// The app's order, so a lift's equipment always reads the same way round.
const ORDER = ["barbell", "ezbar", "trapbar", "dumbbell", "kettlebell", "band", "bench", "rack", "pullupbar", "dipbars", "cable", "machine", "smith", "medball", "ball", "foamroll", "other"];
const FREE = ["barbell", "ezbar", "trapbar", "dumbbell", "kettlebell"];

/** What a lift needs, from the data's one piece of equipment and what its name says. Bodyweight only is none. */
function equipOf(x) {
  const n = x.name.toLowerCase(), out = new Set();
  if (BASE[x.equipment]) out.add(BASE[x.equipment]);
  const swap = (from, to) => {
    for (const f of from) out.delete(f);
    out.add(to);
  };
  if (/\bsmith\b/.test(n)) swap(["machine", "barbell", "other"], "smith");
  if (/\btrap bar\b/.test(n)) swap(["barbell", "other"], "trapbar");
  if (/\bez[- ]?(bar|curl)\b/.test(n)) swap(["barbell", "other"], "ezbar");
  if (/\bpull-?ups?\b|\bchin-?ups?\b|\bhanging\b/.test(n) && !out.has("cable") && !out.has("machine") && !out.has("band")) swap(["other"], "pullupbar");
  if (/\bdips?\b/.test(n) && !/bench dip|dip squat/.test(n) && !out.has("machine")) swap(["other"], "dipbars");
  const free = FREE.some((e) => out.has(e));
  if ((free && /\bbench\b|\bincline\b|\bdecline\b|\bpreacher\b|\bhip thrust\b|\blying\b|\bprone\b|\bseated\b/.test(n)) || (!free && /\bbench\b/.test(n) && !out.has("machine") && !out.has("cable") && !out.has("smith")))
    out.add("bench");
  if (out.has("barbell") && /\bsquat|\bbench press|\bmilitary press|\bshoulder press|\boverhead press|\bgood morning|\bpins\b|\brack\b/.test(n)) out.add("rack");
  return ORDER.filter((e) => out.has(e));
}

// The lifts most people know, most common first: listed ahead of the rest, and preferred when a name matches two
// lifts equally well.
const COMMON = [
  "Barbell Squat",
  "Barbell Bench Press - Medium Grip",
  "Barbell Deadlift",
  "Standing Military Press",
  "Bent Over Barbell Row",
  "Pullups",
  "Chin-Up",
  "Dips - Triceps Version",
  "Wide-Grip Lat Pulldown",
  "Seated Cable Rows",
  "Leg Press",
  "Hack Squat",
  "Leg Extensions",
  "Lying Leg Curls",
  "Seated Leg Curl",
  "Standing Calf Raises",
  "Seated Calf Raise",
  "Romanian Deadlift",
  "Barbell Hip Thrust",
  "Dumbbell Bench Press",
  "Incline Dumbbell Press",
  "Barbell Incline Bench Press - Medium Grip",
  "Dumbbell Shoulder Press",
  "Leverage Chest Press",
  "Leverage Incline Chest Press",
  "Leverage Shoulder Press",
  "Side Lateral Raise",
  "Face Pull",
  "Dumbbell Flyes",
  "Butterfly",
  "Cable Crossover",
  "Reverse Machine Flyes",
  "Cable Rear Delt Fly",
  "Triceps Pushdown",
  "Triceps Pushdown - Rope Attachment",
  "Cable Rope Overhead Triceps Extension",
  "EZ-Bar Skullcrusher",
  "Close-Grip Barbell Bench Press",
  "Barbell Curl",
  "Dumbbell Bicep Curl",
  "Hammer Curls",
  "EZ-Bar Curl",
  "Preacher Curl",
  "Standing Biceps Cable Curl",
  "One-Arm Dumbbell Row",
  "T-Bar Row with Handle",
  "Straight-Arm Pulldown",
  "Front Barbell Squat",
  "Goblet Squat",
  "Dumbbell Lunges",
  "Split Squat with Dumbbells",
  "Good Morning",
  "Barbell Shrug",
  "Dumbbell Shrug",
  "Thigh Abductor",
  "Thigh Adductor",
  "Hyperextensions (Back Extensions)",
  "Plank",
  "Crunches",
  "Cable Crunch",
  "Hanging Leg Raise",
  "Pushups",
  "Inverted Row",
  "One-Arm Kettlebell Swings",
  "Arnold Dumbbell Press",
  "Sumo Deadlift",
  "Power Clean",
];

const kept = upstream.filter((x) => CATEGORIES.has(x.category) && x.primaryMuscles?.length);
const byName = new Map(kept.map((x) => [x.name, x]));
const missing = COMMON.filter((n) => !byName.has(n));
if (missing.length) {
  console.error(`not in the data: ${missing.join(", ")}`);
  process.exit(1);
}
const exercises = kept
  .map((x) => {
    const primary = [...new Set(x.primaryMuscles)].sort();
    const out = { id: x.id, n: x.name.trim(), e: equipOf(x), p: primary, s: [...new Set(x.secondaryMuscles)].filter((m) => !primary.includes(m)).sort() };
    const rank = COMMON.indexOf(x.name);
    return rank >= 0 ? { ...out, c: rank + 1 } : out;
  })
  .sort((a, b) => a.n.localeCompare(b.n));

const out = {
  source: "https://github.com/yuhonas/free-exercise-db",
  commit,
  licence: "Unlicense (public domain): see docs/exercise-library.md",
  exercises,
};
// One lift a line: small diffs when the data is updated, and still valid JSON.
const text = `{\n${Object.entries(out)
  .filter(([k]) => k !== "exercises")
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`)
  .join("")}  "exercises": [\n${exercises.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]\n}\n`;
fs.writeFileSync(new URL("../src/data/exercises.json", import.meta.url), text);
console.log(`src/data/exercises.json: ${exercises.length} lifts, ${COMMON.length} marked common`);
