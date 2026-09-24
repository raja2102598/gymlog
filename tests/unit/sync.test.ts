import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAN } from "@/lib/plan";
import { copy } from "@/lib/storage";
import { GymStore, mergeDays } from "@/lib/store";
import type { DayLog, LiftLog, Plan } from "@/lib/types";
import { fakeSupabase } from "./fakeSupabase";

const D = "2026-09-23";
const day = (d: Partial<DayLog> = {}): DayLog => ({ exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "", ...d });
const lift = (reps: number, kg: number): LiftLog => ({ done: false, kg, sets: [{ reps, kg }] });
/** A copy with its keys in another order, as Supabase's jsonb may give them back. */
const reordered = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).reverse()) as T;
const planWith = (p: Partial<Plan>): Plan => ({ ...copy(DEFAULT_PLAN), ...p });

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

type Fake = ReturnType<typeof fakeSupabase>;

/** A phone signed in to the account, having loaded what Supabase has. */
async function phone(f: Fake) {
  const s = new GymStore();
  s.user = { id: "u1", created_at: "2026-08-26T05:00:00Z" } as GymStore["user"];
  s.auth = "signedIn";
  s.sb = f.sb;
  await s.pull();
  await s.pullPlan();
  f.sent.length = 0;
  return s;
}

// Saves are called directly: the timers that would run them are faked and never fire.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-23T12:00:00"));
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("saving a day over the version it started from", () => {
  it("writes cleanly when nothing changed elsewhere, and adds a day new here", async () => {
    const f = fakeSupabase();
    f.elsewhere(D, day({ steps: 8000 }));
    const s = await phone(f), v1 = f.row(D)!.updated_at;
    s.editDay(D, (n) => void (n.steps = 9000), false);
    s.editDay("2026-09-24", (n) => void (n.cardio = true), false);
    await s.flush();
    expect(f.sent).toEqual([`update logs ${D} @${v1}`, "insert logs"]);
    expect([f.row(D)!.data.steps, f.row("2026-09-24")!.data.cardio]).toEqual([9000, true]);
    expect([s.pending, s.conflicts, s.status]).toEqual([{}, {}, "Saved"]);
    // The versions those writes returned are where the next ones start.
    const v2 = f.row(D)!.updated_at, w1 = f.row("2026-09-24")!.updated_at;
    f.sent.length = 0;
    s.editDay(D, (n) => void (n.steps = 9100), false);
    s.editDay("2026-09-24", (n) => void (n.cardio = false), false);
    await s.flush();
    expect(f.sent).toEqual([`update logs ${D} @${v2}`, `update logs 2026-09-24 @${w1}`]);
    expect([f.row(D)!.data.steps, f.row("2026-09-24")!.data.cardio]).toEqual([9100, false]);
  });

  it("takes the other device's version when it saved the same day", async () => {
    const f = fakeSupabase();
    f.elsewhere(D, day({ steps: 8000 }));
    const s = await phone(f), v1 = f.row(D)!.updated_at;
    f.elsewhere(D, reordered(day({ steps: 9000 })));
    const v2 = f.row(D)!.updated_at;
    s.editDay(D, (n) => void (n.steps = 9000), false);
    await s.flush();
    // One look at the other copy, and nothing written over it.
    expect(f.sent).toEqual([`update logs ${D} @${v1}`, `select logs ${D}`]);
    expect(f.row(D)!.updated_at).toBe(v2);
    expect([s.pending, s.conflicts, s.status]).toEqual([{}, {}, "Saved"]);
    f.sent.length = 0;
    s.editDay(D, (n) => void (n.steps = 9100), false);
    await s.flush();
    expect(f.sent).toEqual([`update logs ${D} @${v2}`]);
    expect(f.row(D)!.data.steps).toBe(9100);
  });

  it("merges edits to different lifts, and a day two phones both started", async () => {
    const f = fakeSupabase();
    f.elsewhere(D, day({ exercises: { "Leg Press": lift(10, 50) } }));
    const s = await phone(f), v1 = f.row(D)!.updated_at;
    f.elsewhere(D, day({ exercises: { "Leg Press": lift(10, 50), "Leg Extension": lift(12, 27) } }));
    const v2 = f.row(D)!.updated_at;
    s.editLift(D, "Hack Squat", (r) => void (r.sets = [{ reps: 10, kg: 20 }]), false);
    await s.flush();
    expect(f.sent).toEqual([`update logs ${D} @${v1}`, `select logs ${D}`, `update logs ${D} @${v2}`]);
    const all = ["Hack Squat", "Leg Extension", "Leg Press"];
    expect(Object.keys(f.row(D)!.data.exercises).sort()).toEqual(all);
    expect(Object.keys(s.entry(D).exercises).sort()).toEqual(all);
    expect([s.pending, s.conflicts, s.status]).toEqual([{}, {}, "Saved"]);
    // Neither phone had Monday: this one adds it, finds the other's already there, and merges.
    f.elsewhere("2026-09-21", day({ exercises: { "Chest Press Machine": lift(12, 40) } }));
    s.editLift("2026-09-21", "Incline Machine Press", (r) => void (r.sets = [{ reps: 8, kg: 40 }]), false);
    f.sent.length = 0;
    await s.flush();
    expect(f.sent).toEqual(["insert logs", "select logs 2026-09-21", expect.stringMatching(/^update logs 2026-09-21 @/)]);
    expect(Object.keys(f.row("2026-09-21")!.data.exercises).sort()).toEqual(["Chest Press Machine", "Incline Machine Press"]);
    expect(s.conflicts).toEqual({});
  });

  it("merges only when the copies differ in lifts one has and the other doesn't", () => {
    const lp = { "Leg Press": lift(10, 50) }, le = { "Leg Extension": lift(12, 27) };
    expect(mergeDays(day({ exercises: lp }), reordered(day({ exercises: le })))?.exercises).toEqual({ ...le, ...lp });
    expect(mergeDays(day({ exercises: { ...lp, ...le } }), day({ exercises: lp }))?.exercises).toEqual({ ...lp, ...le });
    expect(mergeDays(day({ exercises: lp }), day({ exercises: { "Leg Press": lift(8, 50) } }))).toBeNull();
    expect(mergeDays(day({ exercises: lp, steps: 9000 }), day({ exercises: le }))).toBeNull();
    expect(mergeDays(day({ exercises: lp }), day({ exercises: le, note: "Busy gym" }))).toBeNull();
  });

  it("keeps both when the same thing changed on both, until you choose one", async () => {
    const f = fakeSupabase();
    f.elsewhere(D, day({ steps: 8000 }));
    const s = await phone(f);
    f.elsewhere(D, day({ steps: 9000 }));
    s.editDay(D, (n) => void (n.steps = 9500), false);
    await s.flush();
    expect(s.conflicts[D]).toMatchObject({ data: { steps: 9000 }, at: f.row(D)!.updated_at });
    expect(s.entry(D).steps).toBe(9500); // this phone still shows its own
    expect(f.row(D)!.data.steps).toBe(9000); // and the other one is untouched
    expect([s.status, s.syncWaiting()]).toEqual(["Not synced yet", null]);
    // Later saves leave the day alone until you choose.
    f.sent.length = 0;
    await s.flush();
    expect(f.sent).toEqual([]);

    // Keep this phone's version: saved over the other one.
    await s.keepDay(D, "mine");
    expect(f.row(D)!.data.steps).toBe(9500);
    expect([s.pending, s.conflicts, s.status]).toEqual([{}, {}, "Synced"]);

    // Again, and this time keep the other version, with the phone offline by then: it takes that copy at once, and
    // writes nothing.
    f.elsewhere(D, day({ steps: 7000, note: "From the tablet" }));
    const other = f.row(D)!.updated_at;
    s.editDay(D, (n) => void (n.steps = 7500), false);
    await s.flush();
    expect(s.conflicts[D]).toMatchObject({ data: { steps: 7000 } });
    vi.stubGlobal("navigator", { onLine: false });
    f.sent.length = 0;
    await s.keepDay(D, "theirs");
    expect([s.entry(D).steps, s.entry(D).note]).toEqual([7000, "From the tablet"]);
    expect([s.pending, s.conflicts, f.sent]).toEqual([{}, {}, []]);
    // Back online, the next load says so, and the next edit saves cleanly over the version kept.
    vi.stubGlobal("navigator", { onLine: true });
    await s.pull();
    expect(s.status).toBe("Synced");
    f.sent.length = 0;
    s.editDay(D, (n) => void (n.steps = 7100), false);
    await s.flush();
    expect(f.sent).toEqual([`update logs ${D} @${other}`]);
    expect(f.row(D)!.data).toMatchObject({ steps: 7100, note: "From the tablet" });
  });

  it("doesn't let a load in between hand a waiting edit the other device's version", async () => {
    const f = fakeSupabase();
    f.elsewhere(D, day({ steps: 8000 }));
    const s = await phone(f);
    vi.stubGlobal("navigator", { onLine: false });
    s.editDay(D, (n) => void (n.steps = 9500), false);
    await s.flush(); // it waits on the phone
    f.elsewhere(D, day({ steps: 9000 }));
    vi.stubGlobal("navigator", { onLine: true });
    await s.pull();
    expect(s.entry(D).steps).toBe(9500);
    await s.flush();
    expect(f.row(D)!.data.steps).toBe(9000);
    expect(s.conflicts[D]).toMatchObject({ data: { steps: 9000 } });
  });

  it("doesn't bring back an older copy from a load that began before a save", async () => {
    const f = fakeSupabase();
    f.elsewhere(D, day({ steps: 8000 }));
    const s = await phone(f), load = f.holdNextLoad();
    const loading = s.pull();
    await load.read; // Supabase reads the day as it was…
    s.editDay(D, (n) => void (n.steps = 9100), false);
    await s.flush(); // …then this save lands…
    const v2 = f.row(D)!.updated_at;
    load.release(); // …and only then does the load's answer arrive.
    await loading;
    expect(s.entry(D).steps).toBe(9100);
    f.sent.length = 0;
    s.editDay(D, (n) => void (n.steps = 9200), false);
    await s.flush();
    expect(f.sent).toEqual([`update logs ${D} @${v2}`]);
    expect(s.conflicts).toEqual({});
  });

  it("offers the other device's latest copy when it changes again while you choose", async () => {
    const f = fakeSupabase();
    f.elsewhere(D, day({ steps: 8000 }));
    const s = await phone(f);
    f.elsewhere(D, day({ steps: 9000 }));
    s.editDay(D, (n) => void (n.steps = 9500), false);
    await s.flush();
    f.elsewhere(D, day({ steps: 9200 }));
    await s.pull();
    expect(s.conflicts[D]).toMatchObject({ data: { steps: 9200 }, at: f.row(D)!.updated_at });
    expect(s.entry(D).steps).toBe(9500);
    await s.keepDay(D, "theirs");
    expect(s.entry(D).steps).toBe(9200);
  });

  it("doesn't swap the other device's copy for an older one from a load that began before it was found", async () => {
    const f = fakeSupabase();
    f.elsewhere(D, day({ steps: 8000 }));
    const s = await phone(f), load = f.holdNextLoad();
    const loading = s.pull();
    await load.read; // Supabase reads the day before the other device's save…
    f.elsewhere(D, day({ steps: 9000 }));
    s.editDay(D, (n) => void (n.steps = 9500), false);
    await s.flush(); // …which this save then finds…
    const found = f.row(D)!.updated_at;
    load.release(); // …before the load's answer arrives.
    await loading;
    expect(s.conflicts[D]).toMatchObject({ data: { steps: 9000 }, at: found });
    await s.keepDay(D, "mine");
    expect([f.row(D)!.data.steps, s.conflicts]).toEqual([9500, {}]);
  });
});

describe("saving the plan over the version it started from", () => {
  it("adds it when Supabase has none, then writes over its own version", async () => {
    const f = fakeSupabase(), s = await phone(f);
    s.editPlan((p) => void (p.stepGoal = 12000));
    await s.flushPlan();
    const v1 = f.plan()!.updated_at;
    s.editPlan((p) => void (p.stepGoal = 12500));
    await s.flushPlan();
    expect(f.sent).toEqual(["insert plans", `update plans @${v1}`]);
    expect([f.plan()!.data.stepGoal, s.planDirty, s.planMsg, s.planConflict]).toEqual([12500, false, "Saved", null]);
  });

  it("keeps both plans when another device changed it first, until you choose one", async () => {
    const f = fakeSupabase();
    f.planElsewhere(planWith({ stepGoal: 10000 }));
    const s = await phone(f);
    f.planElsewhere(planWith({ stepGoal: 11000 }));
    s.editPlan((p) => void (p.stepGoal = 12000));
    await s.flushPlan();
    expect(s.planConflict).toMatchObject({ plan: { stepGoal: 11000 }, at: f.plan()!.updated_at });
    expect([s.plan.stepGoal, f.plan()!.data.stepGoal, s.planDirty]).toEqual([12000, 11000, true]);
    expect(s.planMsg).toBe("Not synced yet: the plan was changed on another device too.");
    // Keep this phone's version: saved over the other one.
    await s.keepPlan("mine");
    expect([f.plan()!.data.stepGoal, s.planConflict, s.planDirty, s.planMsg]).toEqual([12000, null, false, "Saved"]);

    // Again, and keep the other version, offline by then: this phone takes it at once, and writes nothing.
    f.planElsewhere(planWith({ stepGoal: 13000, tempo: "3:1:1:0" }));
    const other = f.plan()!.updated_at;
    s.editPlan((p) => void (p.stepGoal = 14000));
    await s.flushPlan();
    expect(s.planConflict?.plan.stepGoal).toBe(13000);
    const shape = s.planShape;
    vi.stubGlobal("navigator", { onLine: false });
    f.sent.length = 0;
    await s.keepPlan("theirs");
    expect([s.plan.stepGoal, s.plan.tempo, s.planConflict, s.planDirty, s.planMsg, f.sent]).toEqual([13000, "3:1:1:0", null, false, "Saved", []]);
    expect(s.planShape).toBeGreaterThan(shape); // the plan editor's fields reload
    vi.stubGlobal("navigator", { onLine: true });
    // The next edit saves cleanly over the version kept.
    s.editPlan((p) => void (p.stepGoal = 13500));
    await s.flushPlan();
    expect(f.sent).toEqual([`update plans @${other}`]);
  });

  it("takes the other device's version when it saved the same plan", async () => {
    const f = fakeSupabase();
    f.planElsewhere(planWith({ stepGoal: 10000 }));
    const s = await phone(f);
    f.planElsewhere(reordered(planWith({ stepGoal: 12000 })));
    s.editPlan((p) => void (p.stepGoal = 12000));
    await s.flushPlan();
    expect([s.planConflict, s.planDirty, s.planMsg]).toEqual([null, false, "Saved"]);
    const v = f.plan()!.updated_at;
    f.sent.length = 0;
    s.editPlan((p) => void (p.stepGoal = 12500));
    await s.flushPlan();
    expect(f.sent).toEqual([`update plans @${v}`]);
  });
});
