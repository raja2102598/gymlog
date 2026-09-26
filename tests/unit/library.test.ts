import { describe, expect, it } from "vitest";
import data from "@/data/exercises.json";
import { TEMPLATES } from "@/data/templates";
import { CATALOGUE, closeMatches, EQUIPMENT, exerciseFor, libraryLift, libraryNamed, MUSCLES, muscleText, searchLibrary, words } from "@/lib/library";
import { DEFAULT_PLAN, normalizePlan } from "@/lib/plan";
import { GymStore } from "@/lib/store";
import { atWednesdayNoon, storeWith } from "./helpers";

// The exercise library (RAJ-55): the catalogue, search, matching the plan's names to it, and your own lifts. Swaps by
// muscle are in gym.test.ts, a rename's link in rename.test.ts, and how the plan keeps your own lifts in plan.test.ts.
atWednesdayNoon();

/** A plan as an account saved it before the library: no lift points at it. */
function unlinked(s: GymStore) {
  for (const d of s.plan.days) for (const x of d.exercises) delete x.lib;
  return s;
}
const lift = (name: string) => libraryNamed(name)!;

describe("the catalogue", () => {
  it("is free-exercise-db's lifts, each with a main muscle, known equipment and its source recorded", () => {
    expect(CATALOGUE.length).toBeGreaterThan(600);
    expect(new Set(CATALOGUE.map((x) => x.id)).size).toBe(CATALOGUE.length);
    expect(new Set(CATALOGUE.map((x) => x.name.toLowerCase())).size).toBe(CATALOGUE.length);
    // The data as stored, before the app drops anything it doesn't know.
    for (const x of data.exercises as { n: string; e: string[]; p: string[]; s: string[] }[]) {
      expect(x.p.length, x.n).toBeGreaterThan(0);
      expect(x.e.every((e) => e in EQUIPMENT) && [...x.p, ...x.s].every((m) => m in MUSCLES), x.n).toBe(true);
      expect(x.s.some((m) => x.p.includes(m)), x.n).toBe(false);
    }
    expect(data.source).toBe("https://github.com/yuhonas/free-exercise-db");
    expect(data.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("says what a lift needs, from its name as well as the data", () => {
    expect(lift("Barbell Bench Press - Medium Grip").equip).toEqual(["barbell", "bench", "rack"]);
    expect(lift("Pullups").equip).toEqual(["pullupbar"]);
    expect(lift("EZ-Bar Curl").equip).toEqual(["ezbar"]);
    expect(lift("Trap Bar Deadlift").equip).toEqual(["trapbar"]);
    expect(lift("Smith Machine Calf Raise").equip).toEqual(["smith"]);
    expect(lift("Plank").equip).toEqual([]);
  });
});

describe("words", () => {
  it("read a name the same however it's written", () => {
    expect(words("DB Lateral Raises")).toEqual(words("Dumbbell lateral raise"));
    expect(words("Pull-ups")).toEqual(["pullup"]);
    expect(words("Lat Pull Down")).toEqual(["lat", "pulldown"]);
    expect(words("Bench Presses & Flyes")).toEqual(["bench", "press", "fly"]);
  });
});

describe("search", () => {
  it("lists common lifts first, then the rest A to Z, or all of them A to Z", () => {
    const all = searchLibrary(CATALOGUE);
    expect(all).toHaveLength(CATALOGUE.length);
    expect(all.slice(0, 3).map((x) => x.name)).toEqual(["Barbell Squat", "Barbell Bench Press - Medium Grip", "Barbell Deadlift"]);
    const az = searchLibrary(CATALOGUE, { sort: "az" }).map((x) => x.name);
    expect(az).toEqual([...az].sort((a, b) => a.localeCompare(b)));
  });

  it("finds every word typed at the start of a word of its name, its muscles or its equipment", () => {
    expect(searchLibrary(CATALOGUE, { text: "db bench" }).map((x) => x.name)).toContain("Dumbbell Bench Press");
    expect(searchLibrary(CATALOGUE, { text: "lat pull" }).map((x) => x.name)).toContain("Wide-Grip Lat Pulldown");
    const quads = searchLibrary(CATALOGUE, { text: "quads machine" });
    expect(quads.map((x) => x.name)).toContain("Leg Press");
    // A machine, the Smith machine included; never a cable.
    expect(quads.every((x) => (x.equip.includes("machine") || x.equip.includes("smith")) && [...x.primary, ...x.secondary].includes("quadriceps"))).toBe(true);
    expect(searchLibrary(CATALOGUE, { text: "zumba" })).toEqual([]);
  });

  it("filters by main muscle and by equipment", () => {
    const chest = searchLibrary(CATALOGUE, { muscle: "chest", equip: "cable" });
    expect(chest.length).toBeGreaterThan(3);
    expect(chest.every((x) => x.primary.includes("chest") && x.equip.includes("cable"))).toBe(true);
    expect(chest[0].name).toBe("Cable Crossover"); // the common one first
  });
});

describe("matching a name to the library", () => {
  it("offers the library lift a name most looks like, the common one among equals", () => {
    expect(closeMatches("Chest Press Machine")[0].name).toBe("Leverage Chest Press");
    expect(closeMatches("Leg Extension")[0].name).toBe("Leg Extensions");
    expect(closeMatches("DB Lateral Raises")[0].name).toBe("Side Lateral Raise");
    expect(closeMatches("Hamstring Curl")[0].name).toBe("Lying Leg Curls");
    expect(closeMatches("Seated Row")[0].name).toBe("Seated Cable Rows");
    expect(closeMatches("Cable Triceps Pushdown")[0].name).toBe("Triceps Pushdown");
  });

  it("won't offer a lift done with other equipment than the name says", () => {
    const m = closeMatches("Incline Machine Press").map((x) => x.name);
    expect(m[0]).toBe("Leverage Incline Chest Press");
    expect(m).not.toContain("Incline Dumbbell Press");
  });

  it("has nothing to ask about a name that's exactly the library's, or like none of it", () => {
    expect(closeMatches("leg press")).toEqual([]);
    expect(closeMatches("Zumba class")).toEqual([]);
    expect(closeMatches("   ")).toEqual([]);
  });
});

describe("a lift's exercise", () => {
  it("is the library lift it points at, else your own of its name, else the library's of its name", () => {
    const own = [{ name: "Chest-Supported Row", equip: ["machine" as const], primary: ["middle back" as const], secondary: [] }];
    expect(exerciseFor("Anything", own, { lib: lift("Leverage Chest Press").id })?.name).toBe("Leverage Chest Press");
    expect(exerciseFor("chest-supported row", own)).toMatchObject({ id: "custom:Chest-Supported Row", custom: true, primary: ["middle back"] });
    expect(exerciseFor("LEG PRESS", own)?.name).toBe("Leg Press");
    expect(exerciseFor("Zumba", own)).toBeNull();
    expect(muscleText(lift("Barbell Bench Press - Medium Grip"))).toBe("Chest, with shoulders and triceps");
  });

  it("finds the photos and steps for a lift a plan saved before the library never linked, and none for your own", () => {
    const s = storeWith();
    s.plan = normalizePlan({ days: [{ name: "Upper", exercises: [{ name: "Lateral Raises" }, { name: "Leg Extension", lib: "Leg_Extensions" }, { name: "My Odd Lift" }] }] }, DEFAULT_PLAN);
    expect(s.mediaIdOf("Lateral Raises")).toBe("Side_Lateral_Raise"); // unlinked: the lift picked for that name by hand
    expect(s.exerciseOf("Lateral Raises")).toBeNull(); // its equipment and weight steps are left as they were
    expect(s.mediaIdOf("Leg Extension")).toBe("Leg_Extensions");
    expect(s.mediaIdOf("My Odd Lift")).toBeNull();
    s.plan.custom = [{ name: "Lateral Raises", equip: [], primary: [], secondary: [] }];
    expect(s.mediaIdOf("Lateral Raises")).toBeNull(); // kept as your own lift: not the library's
  });
});

describe("your own lifts", () => {
  it("are saved by name, never over the library's or another of yours", () => {
    const s = storeWith();
    expect(s.saveCustom({ name: "Sled Push", equip: ["other"], primary: ["quadriceps"], secondary: [] })).toBe("");
    expect(s.saveCustom({ name: "sled push", equip: [], primary: [], secondary: [] })).toBe("You have a lift called sled push already.");
    expect(s.saveCustom({ name: "leg press", equip: [], primary: [], secondary: [] })).toBe("The library has Leg Press: pick it from the list instead.");
    expect(s.saveCustom({ name: "  ", equip: [], primary: [], secondary: [] })).toBe("Give it a name.");
    expect(s.library()[0]).toMatchObject({ name: "Sled Push", custom: true });
    expect(s.saveCustom({ name: "Sled Push", equip: ["other"], primary: ["glutes"], secondary: [] }, true)).toBe(""); // changing it
    expect(s.plan.custom).toEqual([{ name: "Sled Push", equip: ["other"], primary: ["glutes"], secondary: [] }]);
  });
});

describe("the plan and the library", () => {
  it("points every lift of the plans the app comes with at a library lift that's there", () => {
    for (const p of [DEFAULT_PLAN, ...TEMPLATES.map((t) => t.plan)])
      for (const d of p.days)
        for (const x of d.exercises) {
          if (x.lib) expect(libraryLift(x.lib), `${x.name}: ${x.lib}`).not.toBeNull();
          expect(exerciseFor(x.name, [], x), x.name).not.toBeNull();
        }
  });

  it("ships with every lift known, so a new account has nothing to answer", () => {
    const s = storeWith();
    expect(s.libraryQuestions()).toEqual([]);
    for (const d of s.plan.days) for (const x of d.exercises) expect(s.exerciseOf(x.name, x)).not.toBeNull();
  });

  it("asks once about each lift of a plan saved before the library, and each answer takes one away", () => {
    const s = unlinked(storeWith());
    const qs = s.libraryQuestions();
    const names = qs.map((q) => q.name);
    // Named exactly as the library names them, these need no asking.
    expect(names).not.toContain("Leg Press");
    expect(names).not.toContain("Hack Squat");
    expect(names).toContain("Chest Press Machine");
    expect(new Set(names).size).toBe(names.length); // a lift on two days is asked about once
    // A name from the plans the app comes with is asked about with the lift picked for it by hand first.
    const first = (name: string) => qs.find((q) => q.name === name)?.like[0].name;
    expect(first("Cable Curls")).toBe("Standing Biceps Cable Curl");
    expect(first("Cable Chest Fly")).toBe("Cable Crossover");
    expect(first("Rear Delt Fly")).toBe("Reverse Machine Flyes");
    const cpm = qs.find((q) => q.name === "Chest Press Machine")!;
    s.linkLift("Chest Press Machine", cpm.like[0]);
    expect(s.plan.days[0].exercises[1]).toMatchObject({ name: "Chest Press Machine", lib: lift("Leverage Chest Press").id });
    expect(s.exerciseOf("Chest Press Machine")?.name).toBe("Leverage Chest Press");
    s.keepOwn("Seated Row");
    expect(s.plan.custom).toEqual([{ name: "Seated Row", equip: [], primary: [], secondary: [] }]);
    expect(s.exerciseOf("Seated Row")).toMatchObject({ custom: true, primary: [] }); // untagged, not guessed
    expect(s.libraryQuestions().map((q) => q.name)).toEqual(names.filter((n) => n !== "Chest Press Machine" && n !== "Seated Row"));
  });

  it("links a lift to one of your own of another name by lending its muscles to a lift of its own name", () => {
    const s = unlinked(storeWith());
    s.saveCustom({ name: "Machine Row", equip: ["machine"], primary: ["middle back"], secondary: ["lats"] });
    s.linkLift("Chest-Supported Row", s.library()[0]);
    expect(s.exerciseOf("Chest-Supported Row")).toMatchObject({ custom: true, equip: ["machine"], primary: ["middle back"], secondary: ["lats"] });
  });

  it("adds library lifts to a day, pointing at the library, each once", () => {
    const s = storeWith();
    // Leg Press is on Legs by name, and Leg Extensions as Leg Extension, pointing at it.
    s.addLibraryLifts(2, [lift("Goblet Squat"), lift("Barbell Hip Thrust"), lift("Leg Press"), lift("Leg Extensions")]);
    const legs = s.plan.days[2].exercises;
    expect(legs.slice(-2)).toEqual([
      { name: "Goblet Squat", sets: "3", reps: "10-12", cue: "", flag: "", step: "", knee: false, rest: "", lib: lift("Goblet Squat").id },
      { name: "Barbell Hip Thrust", sets: "3", reps: "10-12", cue: "", flag: "", step: "", knee: false, rest: "", lib: lift("Barbell Hip Thrust").id },
    ]);
    expect(legs.filter((x) => x.name === "Leg Press")).toHaveLength(1);
    expect(legs.filter((x) => x.lib === lift("Leg Extensions").id).map((x) => x.name)).toEqual(["Leg Extension"]);
  });
});
