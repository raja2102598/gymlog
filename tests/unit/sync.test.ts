import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "@/lib/dates";
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
    expect(f.sent).toEqual(["insert logs ×1", `update logs ${D} @${v1}`]);
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
    // Neither phone had Monday: this one adds it, finds the other's already there, saves it on its own, and merges.
    f.elsewhere("2026-09-21", day({ exercises: { "Chest Press Machine": lift(12, 40) } }));
    s.editLift("2026-09-21", "Incline Machine Press", (r) => void (r.sets = [{ reps: 8, kg: 40 }]), false);
    f.sent.length = 0;
    await s.flush();
    expect(f.sent).toEqual(["insert logs ×1", "insert logs 2026-09-21", "select logs 2026-09-21", expect.stringMatching(/^update logs 2026-09-21 @/)]);
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
    const s = await phone(f), load = f.holdNext("load");
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
    const s = await phone(f), load = f.holdNext("load");
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

describe("saving many days", () => {
  /** `n` days in a row from `from`. */
  const run = (n: number, from = "2025-06-01") => Array.from({ length: n }, (_, i) => addDays(from, i));
  /** A backup of these days, as Settings exports it. */
  const backup = (logs: { day: string; data: DayLog }[]) =>
    new File([JSON.stringify({ format: "gymlog-backup", version: 1, exportedAt: "2026-09-20T08:00:00.000Z", plan: null, logs, healthDays: {} })], "gym-log.json");
  /** A phone that has loaded these days, as another device saved them, and has changed every one since. */
  async function edited(f: Fake, days: string[]) {
    days.forEach((k, i) => f.elsewhere(k, day({ steps: i })));
    const s = await phone(f);
    for (const k of days) s.editDay(k, (n) => void (n.note = "edited"), false);
    return s;
  }

  it("adds days new here together, 200 to a request, as a restore into a new account does", async () => {
    const f = fakeSupabase(), s = await phone(f), days = run(250);
    expect(await s.importFile(backup(days.map((k, i) => ({ day: k, data: day({ steps: i }) }))), () => true)).toBe("Imported 250 days.");
    expect(f.sent).toEqual(["insert logs ×200", "insert logs ×50"]);
    expect(days.every((k, i) => f.row(k)?.data.steps === i)).toBe(true);
    expect([s.pending, s.status]).toEqual([{}, "Saved"]);
    // Each day got its version back, and the next edit is written over it.
    const v = f.row(days[7])!.updated_at;
    f.sent.length = 0;
    s.editDay(days[7], (n) => void (n.note = "edited"), false);
    await s.flush();
    expect(f.sent).toEqual([`update logs ${days[7]} @${v}`]);
  });

  it("saves a chunk day by day when one of its days is there already, and each still settles", async () => {
    const f = fakeSupabase(), s = await phone(f), plain = run(200);
    const [X, Y, Z, N] = run(4, "2026-09-20"), mine = { "Leg Press": lift(10, 50) };
    // Since this phone loaded, another device saved three of the days it's about to restore: the same, with another
    // lift, and with other steps.
    f.elsewhere(X, day({ steps: 5000 }));
    f.elsewhere(Y, day({ exercises: { "Leg Extension": lift(12, 27) } }));
    f.elsewhere(Z, day({ steps: 7000 }));
    const x = f.row(X)!.updated_at, y = f.row(Y)!.updated_at;
    const restored = [...plain.map((k) => ({ day: k, data: day({ cardio: true }) })), { day: X, data: day({ steps: 5000 }) }, { day: Y, data: day({ exercises: mine }) }, { day: Z, data: day({ steps: 9000 }) }, { day: N, data: day({ steps: 4000 }) }];
    await s.importFile(backup(restored), () => true);
    // The first 200 go in together; the chunk with the three is turned down whole, so its days are saved one by one.
    expect(f.sent.slice(0, 2)).toEqual(["insert logs ×200", "insert logs ×4"]);
    expect(f.sent.slice(2).sort()).toEqual([...[X, Y, Z, N].map((k) => `insert logs ${k}`), `select logs ${X}`, `select logs ${Y}`, `select logs ${Z}`, `update logs ${Y} @${y}`].sort());
    expect(plain.every((k) => f.row(k)?.data.cardio)).toBe(true);
    expect([f.row(X)!.updated_at, f.row(N)!.data.steps, f.row(Z)!.data.steps]).toEqual([x, 4000, 7000]); // taken as it was, added, left alone
    expect(Object.keys(f.row(Y)!.data.exercises).sort()).toEqual(["Leg Extension", "Leg Press"]); // merged
    expect(Object.keys(s.entry(Y).exercises).sort()).toEqual(["Leg Extension", "Leg Press"]);
    expect([Object.keys(s.pending), Object.keys(s.conflicts), s.conflicts[Z].data.steps, s.status]).toEqual([[Z], [Z], 7000, "Not synced yet"]); // kept for you
  });

  it("saves at most four days at once", async () => {
    const f = fakeSupabase(), days = run(10, "2026-09-01"), s = await edited(f, days);
    await s.flush();
    expect(f.sent).toHaveLength(10);
    expect(f.peak()).toBe(4);
    expect([days.every((k) => f.row(k)!.data.note === "edited"), s.pending, s.status]).toEqual([true, {}, "Saved"]);
  });

  it("after an error starts no more saves, lets those under way finish, and reports the first error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeSupabase(), days = run(10, "2026-09-01"), s = await edited(f, days);
    f.failWrites(days[0], days[1]);
    await s.flush();
    // The first four were under way when the first failed: the other two of them are saved, and no more are started.
    expect(f.sent).toEqual(days.slice(0, 4).map((k) => expect.stringMatching(new RegExp(`^update logs ${k} @`))));
    expect(days.map((k) => f.row(k)!.data.note === "edited")).toEqual([false, false, true, true, false, false, false, false, false, false]);
    expect(Object.keys(s.pending).sort()).toEqual([days[0], days[1], ...days.slice(4)]);
    expect([s.syncTrouble, s.status]).toEqual([true, "Not synced yet. Will retry"]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ message: `couldn’t save ${days[0]}` }));
    // Once they can be saved, the retry saves the rest.
    f.failWrites();
    await s.flush();
    expect([days.every((k) => f.row(k)!.data.note === "edited"), s.pending, s.syncTrouble, s.status]).toEqual([true, {}, false, "Saved"]);
    warn.mockRestore();
  });

  it("tries days new here again later when their request fails, starting no other saves", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeSupabase(), s = await edited(f, [D]), v = f.row(D)!.updated_at;
    s.editDay("2026-09-24", (n) => void (n.cardio = true), false);
    s.editDay("2026-09-25", (n) => void (n.cardio = true), false);
    f.failWrites("2026-09-25");
    await s.flush();
    expect(f.sent).toEqual(["insert logs ×2"]);
    expect([Object.keys(s.pending).sort(), s.syncTrouble, s.status]).toEqual([[D, "2026-09-24", "2026-09-25"], true, "Not synced yet. Will retry"]);
    f.failWrites();
    f.sent.length = 0;
    await s.flush();
    expect(f.sent).toEqual(["insert logs ×2", `update logs ${D} @${v}`]);
    expect([s.pending, s.status]).toEqual([{}, "Saved"]);
    warn.mockRestore();
  });

  it("keeps a day edited while it was being added waiting, to save over the version it got", async () => {
    const f = fakeSupabase(), s = await phone(f), [A, B] = run(2, "2026-09-22");
    s.editDay(A, (n) => void (n.steps = 1000), false);
    s.editDay(B, (n) => void (n.steps = 2000), false);
    const insert = f.holdNext("insert"), saving = s.flush();
    await insert.read; // the days are in…
    s.editDay(A, (n) => void (n.steps = 1500), false); // …when A changes again…
    insert.release(); // …before the answer arrives.
    await saving;
    const a = f.row(A)!.updated_at;
    expect([f.row(A)!.data.steps, Object.keys(s.pending), s.entry(A).steps]).toEqual([1000, [A], 1500]);
    f.sent.length = 0;
    await s.flush();
    expect(f.sent).toEqual([`update logs ${A} @${a}`]);
    expect([f.row(A)!.data.steps, s.pending]).toEqual([1500, {}]);
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

describe("renaming a lift's history", () => {
  it("carries history to every day with it, including one not loaded here yet, pulling first", async () => {
    const f = fakeSupabase();
    f.elsewhere("2026-09-09", day({ exercises: { "Leg Press": lift(10, 45) } }));
    const s = await phone(f);
    // Logged on another device after this phone loaded: not in s.logs yet.
    f.elsewhere("2026-09-16", day({ exercises: { "Leg Press": lift(10, 50) } }));
    expect(s.logs["2026-09-16"]).toBeUndefined();
    const r = await s.renameLift("Leg Press", "Leg Press Machine");
    expect(r).toMatchObject({ ok: true, days: 2 });
    expect(f.sent[0]).toBe("select logs"); // pulled first, so the day above was caught too
    expect(f.row("2026-09-09")!.data.exercises).toHaveProperty("Leg Press Machine");
    expect(f.row("2026-09-16")!.data.exercises).toHaveProperty("Leg Press Machine");
    expect(s.entry("2026-09-09").exercises["Leg Press"]).toBeUndefined();
    expect(s.entry("2026-09-16").exercises["Leg Press"]).toBeUndefined();
    expect([s.pending, s.conflicts, s.status]).toEqual([{}, {}, "Saved"]);
  });

  it("pulls first, but writes nothing when the new name already has history elsewhere", async () => {
    const f = fakeSupabase();
    f.elsewhere("2026-09-09", day({ exercises: { "Leg Press": lift(10, 45) } }));
    f.elsewhere("2026-09-16", day({ exercises: { "Leg Press Machine": lift(10, 50) } }));
    const s = await phone(f);
    const r = await s.renameLift("Leg Press", "Leg Press Machine");
    expect(r).toMatchObject({ ok: false, days: 0 });
    expect(f.sent).toEqual(["select logs"]); // only the pull-first check: nothing written
    expect(f.row("2026-09-09")!.data.exercises).toHaveProperty("Leg Press");
    expect(s.plan.days[2].exercises.find((x) => x.name === "Leg Press")).toBeDefined();
  });

  it("queues a rename offline and syncs it once back online", async () => {
    const f = fakeSupabase();
    f.elsewhere("2026-09-09", day({ exercises: { "Leg Press": lift(10, 45) } }));
    const s = await phone(f);
    vi.stubGlobal("navigator", { onLine: false });
    const r = await s.renameLift("Leg Press", "Leg Press Machine");
    expect(r).toMatchObject({ ok: true, days: 1 });
    expect(f.sent).toEqual([]); // offline: the pre-emptive pull and the flush both skip the network
    expect(s.pending["2026-09-09"]!.exercises).toHaveProperty("Leg Press Machine");
    expect(s.status).toBe("Offline. Saved on this phone, will sync");
    expect(f.row("2026-09-09")!.data.exercises).toHaveProperty("Leg Press"); // Supabase still has the old name
    vi.stubGlobal("navigator", { onLine: true });
    await s.flush();
    expect(f.row("2026-09-09")!.data.exercises).toHaveProperty("Leg Press Machine");
    expect([s.pending, s.status]).toEqual([{}, "Saved"]);
  });

  it("keeps an unrelated addition another device made to the same day, since it pulls first", async () => {
    const f = fakeSupabase();
    f.elsewhere("2026-09-09", day({ exercises: { "Leg Press": lift(10, 45) } }));
    const s = await phone(f);
    // Another device adds a different lift to the same day after this phone loaded.
    f.elsewhere("2026-09-09", day({ exercises: { "Leg Press": lift(10, 45), "Leg Extension": lift(12, 27) } }));
    const r = await s.renameLift("Leg Press", "Leg Press Machine");
    expect(r).toMatchObject({ ok: true, days: 1 });
    expect(Object.keys(f.row("2026-09-09")!.data.exercises).sort()).toEqual(["Leg Extension", "Leg Press Machine"]);
    expect(Object.keys(s.entry("2026-09-09").exercises).sort()).toEqual(["Leg Extension", "Leg Press Machine"]);
    expect(s.conflicts).toEqual({});
  });

  it("routes a rename through the same conflict check as any other edit", async () => {
    const f = fakeSupabase();
    f.elsewhere("2026-09-09", day({ exercises: { "Leg Press": lift(10, 45), "Leg Extension": lift(12, 27) } }));
    const s = await phone(f), load = f.holdNext("load");
    const renaming = s.renameLift("Leg Press", "Leg Press Machine");
    await load.read; // the rename's own pull reads the day as it was…
    f.elsewhere("2026-09-09", day({ exercises: { "Leg Press": lift(10, 45), "Leg Extension": lift(12, 30) } })); // …then another device changes the other lift…
    const found = f.row("2026-09-09")!.updated_at;
    load.release(); // …before the pull's answer arrives.
    const r = await renaming;
    expect(r).toMatchObject({ ok: true, days: 1 });
    // The rename itself doesn't clash (a different key), but the other device's own change to Leg Extension does,
    // and is kept for you to choose exactly as any other conflicting edit would be.
    expect(s.conflicts["2026-09-09"]).toMatchObject({ at: found });
    expect(s.conflicts["2026-09-09"].data.exercises["Leg Extension"]).toMatchObject({ kg: 30 });
    expect(s.entry("2026-09-09").exercises["Leg Press Machine"]).toBeDefined();
    expect(s.entry("2026-09-09").exercises["Leg Press"]).toBeUndefined();
    expect(s.status).toBe("Not synced yet");
    // Keeping this phone's version saves the rename over the other device's copy, as any conflict can be resolved.
    await s.keepDay("2026-09-09", "mine");
    expect(f.row("2026-09-09")!.data.exercises).toEqual({ "Leg Press Machine": lift(10, 45), "Leg Extension": lift(12, 27) });
    expect(s.conflicts).toEqual({});
  });
});
