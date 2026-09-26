import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATES } from "@/data/templates";
import { DOW } from "@/lib/dates";
import { DEFAULT_PLAN, normalizePlan } from "@/lib/plan";
import { GymStore } from "@/lib/store";
import type { Plan } from "@/lib/types";
import { fakeSupabase } from "./fakeSupabase";
import { atWednesdayNoon, day } from "./helpers";

// The plans the app comes with (src/data/templates), and choosing one on a new account's first run.
atWednesdayNoon();

const tpl = (id: string) => TEMPLATES.find((t) => t.id === id)!;
const gymDays = (p: Plan) => p.days.filter((d) => d.exercises.length).map((d) => d.weekday);
/** Every piece of text in a plan, as the app shows it. */
const texts = (p: Plan) => [
  p.tempo,
  ...p.warmups,
  ...p.days.flatMap((d) => [d.name, d.focus, d.cardio.name, d.cardio.detail, ...d.exercises.flatMap((x) => [x.name, x.sets, x.reps, x.cue, x.flag, x.step])]),
];

describe("plan templates", () => {
  it("are offered blank first, then 3, 4 and 5 days a week", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["blank", "full-body-3", "upper-lower-4", "five-day"]);
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))("%s passes normalizePlan unchanged, with seven days", (_, t) => {
    expect(normalizePlan(t.plan, null)).toEqual(t.plan);
    // Nothing comes from the default plan either: every field is the template's own.
    expect(normalizePlan(t.plan, DEFAULT_PLAN)).toEqual(t.plan);
    expect(t.plan.days.map((d) => d.weekday)).toEqual([...DOW]);
  });

  it("train on the days their summaries say", () => {
    expect(gymDays(tpl("blank").plan)).toEqual([]);
    expect(gymDays(tpl("full-body-3").plan)).toEqual(["Mon", "Wed", "Fri"]);
    expect(gymDays(tpl("upper-lower-4").plan)).toEqual(["Mon", "Tue", "Thu", "Fri"]);
    expect(gymDays(tpl("five-day").plan)).toEqual(["Mon", "Tue", "Wed", "Fri", "Sat"]);
    for (const t of TEMPLATES.slice(1)) expect(t.summary).toMatch(new RegExp(`^${gymDays(t.plan).length} days a week, `));
    for (const id of ["full-body-3", "upper-lower-4"]) expect(tpl(id).plan.days.every((d) => d.exercises.length === 0 || d.exercises.length === 5)).toBe(true);
  });

  it("give each lift a name, sets, reps and a one-line cue, each name once a day", () => {
    for (const t of TEMPLATES)
      for (const d of t.plan.days) {
        for (const x of d.exercises) expect(!!(x.name && x.sets && x.reps && x.cue) && !x.cue.includes("\n"), `${t.id}, ${d.weekday}: ${x.name}`).toBe(true);
        expect(new Set(d.exercises.map((x) => x.name)).size, `${t.id}, ${d.weekday}`).toBe(d.exercises.length);
      }
  });

  it("blank: every day a rest day with no lifts, warm-ups, and a 10,000 step goal", () => {
    const p = tpl("blank").plan;
    expect(p.days.every((d) => d.name === "Rest" && !d.exercises.length)).toBe(true);
    expect(p.warmups.length).toBeGreaterThanOrEqual(5);
    expect(p.stepGoal).toBe(10000);
  });

  it("five-day is the default plan, knee flags and all", () => {
    expect(tpl("five-day").plan).toEqual(DEFAULT_PLAN);
    expect(tpl("five-day").plan.days[2].exercises.filter((x) => x.knee).map((x) => x.name)).toEqual(["Hack Squat", "Leg Press", "Leg Extension"]);
  });

  it("only the five-day split has knee flags or knee notes, so knee tracking is opt-in with the others", () => {
    for (const t of TEMPLATES.filter((t) => t.id !== "five-day")) {
      expect(t.plan.days.flatMap((d) => d.exercises).filter((x) => x.knee || x.flag)).toEqual([]);
      expect(texts(t.plan).filter((s) => /knee/i.test(s))).toEqual([]);
    }
  });

  it("use plain hyphens, never an en or em dash", () => {
    for (const t of TEMPLATES) expect([t.name, t.summary, ...texts(t.plan)].filter((s) => /[\u2013\u2014]/.test(s))).toEqual([]);
  });
});

describe("first run", () => {
  beforeEach(() => vi.stubGlobal("navigator", { onLine: true }));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A store just signed in to the account in `f`. As sign-in leaves it: this phone has nothing for the account, and
   *  the first load is on its way. */
  function signedIn(f: ReturnType<typeof fakeSupabase>) {
    const s = new GymStore();
    s.user = { id: "u1", created_at: "2026-09-23T05:00:00Z" } as GymStore["user"];
    s.auth = "signedIn";
    s.firstLoad = true;
    s.sb = f.sb;
    return s;
  }
  /** The first load after signing in: the logged days and the plan, then the load is done. */
  async function load(s: GymStore) {
    await Promise.all([s.pull(), s.pullPlan()]);
    s.firstLoad = false;
  }

  it("a new account (no plan saved, nothing logged) chooses a plan, which is saved as its own", async () => {
    const f = fakeSupabase();
    const s = signedIn(f);
    expect(s.planStep()).toBe("wait"); // new or not isn't known yet: no Today with a plan that isn't theirs
    await load(s);
    expect(s.planSource).toBe("default");
    expect(s.planStep()).toBe("choose");

    s.startFrom(tpl("full-body-3").plan);
    expect(s.planStep()).toBeNull();
    expect(s.plan).toEqual(tpl("full-body-3").plan);
    expect(s.planFor("2026-09-23").name).toBe("Full body B");
    await s.flushPlan(); // the plan editor's save
    expect(f.plan()?.data).toEqual(tpl("full-body-3").plan);
    expect(s.planSource).toBe("server");

    // Signed in again (another phone): the saved plan, and no picker.
    const again = signedIn(f);
    await load(again);
    expect([again.planSource, again.planStep()]).toEqual(["server", null]);
    expect(again.plan).toEqual(tpl("full-body-3").plan);
  });

  it("an account with logs and no saved plan keeps the default plan, with no picker", async () => {
    const f = fakeSupabase();
    f.elsewhere("2026-09-21", day({ steps: 8000 }));
    const s = signedIn(f);
    await load(s);
    expect(s.planSource).toBe("default");
    expect(s.planStep()).toBeNull();
    expect(s.plan).toEqual(DEFAULT_PLAN);
  });

  it("an account whose days are already on this phone goes straight to Today, without waiting for the load", () => {
    const s = signedIn(fakeSupabase());
    s.logs = { "2026-09-21": day({ steps: 8000 }) };
    expect(s.planStep()).toBeNull();
  });

  it("an account with a saved plan uses it, with no picker", async () => {
    const f = fakeSupabase();
    f.planElsewhere(tpl("upper-lower-4").plan);
    const s = signedIn(f);
    await load(s);
    expect(s.planSource).toBe("server");
    expect(s.planStep()).toBeNull();
    expect(s.plan).toEqual(tpl("upper-lower-4").plan);
  });

  it("an account that can't be loaded gets Today with the default plan, as before, not the picker", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeSupabase();
    f.failAll();
    const s = signedIn(f);
    await load(s);
    expect(s.planSource).toBe("unknown");
    expect(s.planStep()).toBeNull();
    expect(s.plan).toEqual(DEFAULT_PLAN);
  });

  it("a backup restored on the picker ends the first run once it brings logged days or a plan, and not before", async () => {
    const file = (text: string) => new File([text], "gym-log.json", { type: "application/json" });
    const backup = (v: object) => file(JSON.stringify({ format: "gymlog-backup", version: 1, exportedAt: "2026-09-20T08:00:00.000Z", plan: null, logs: [], healthDays: {}, ...v }));
    /** A new account on the picker, gone offline: what's restored stays on the phone to sync later, so nothing here
     *  waits on Supabase. The picker's restore never asks: there's nothing of the account's own to replace. */
    const onPicker = async () => {
      vi.stubGlobal("navigator", { onLine: true });
      const s = signedIn(fakeSupabase());
      await load(s);
      vi.stubGlobal("navigator", { onLine: false });
      expect(s.planStep()).toBe("choose");
      return s;
    };
    const s = await onPicker();
    expect(await s.importFile(file('{"hello": "world"}'), () => true)).toBe("That file couldn’t be imported: it isn’t a Gym Log export. Choose a .json file exported from Gym Log.");
    expect(await s.importFile(backup({ healthDays: { "2026-09-01": { steps: 5000 } } }), () => true)).toBe(
      "Imported 0 days. The Health Connect days couldn’t be saved: import the file again when you’re online.",
    );
    expect([s.planStep(), s.planDirty, s.days()]).toEqual(["choose", false, []]);

    // Logged days: an account with logs, on the default plan until it saves one, as ever
    const days = await onPicker();
    expect(await days.importFile(backup({ logs: [{ day: "2026-09-21", data: day({ steps: 8000 }) }] }), () => true)).toBe("Imported 1 day.");
    expect([days.planStep(), days.planDirty, days.plan]).toEqual([null, false, DEFAULT_PLAN]);

    // A plan and no days: the account's own plan, saved like an edit in the plan editor
    const plan = await onPicker();
    expect(await plan.importFile(backup({ plan: tpl("upper-lower-4").plan }), () => true)).toBe("Imported the plan.");
    expect([plan.planStep(), plan.planDirty, plan.plan]).toEqual([null, true, tpl("upper-lower-4").plan]);
  });

  it("starting from a template in the plan editor keeps the goals and copies the template", () => {
    const s = new GymStore();
    s.plan = { ...s.plan, stepGoal: 12000, sleepGoalH: 8, goalWeight: 75, weeklyRatePct: 0.5, kneeLimit: 3 };
    s.startFrom(tpl("upper-lower-4").plan);
    const { tempo, warmups, days } = tpl("upper-lower-4").plan;
    expect({ tempo: s.plan.tempo, warmups: s.plan.warmups, days: s.plan.days }).toEqual({ tempo, warmups, days });
    expect([s.plan.stepGoal, s.plan.sleepGoalH, s.plan.goalWeight, s.plan.weeklyRatePct, s.plan.kneeLimit]).toEqual([12000, 8, 75, 0.5, 3]);
    expect(s.planDirty).toBe(true);
    s.editPlan((p) => {
      p.days[0].name = "Push day";
    });
    expect(tpl("upper-lower-4").plan.days[0].name).toBe("Upper A");
  });
});
