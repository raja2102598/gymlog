import { beforeEach, describe, expect, it, vi } from "vitest";
import { liftModel } from "@/lib/dashboard";
import { GymStore } from "@/lib/store";
import type { LiftLog } from "@/lib/types";
import { fakeSupabase } from "./fakeSupabase";
import { atWednesdayNoon, day, lift, memoryStorage, storeWith } from "./helpers";

// Renaming a lift in the plan editor, and carrying its history over to the new name (store.renameLift): every day it
// was logged or swapped in, every day of the plan it's on, and everything else that names it.
atWednesdayNoon();
beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { onLine: true });
});

/** One set, not yet ticked off. */
const oneSet = (reps: number, kg: number): LiftLog => ({ done: false, kg, sets: [{ reps, kg }] });
/** A phone signed in to the account, having loaded what Supabase has. */
async function phone(f: ReturnType<typeof fakeSupabase>) {
  const s = new GymStore();
  s.user = { id: "u1", created_at: "2026-08-26T05:00:00Z" } as GymStore["user"];
  s.auth = "signedIn";
  s.sb = f.sb;
  await s.pull();
  await s.pullPlan();
  f.sent.length = 0;
  return s;
}

describe("renaming a lift", () => {
  it("knows which lifts have history: by the name logged, or by a swap, not by being in the plan", () => {
    const s = storeWith({
      "2026-09-16": day({ exercises: { "Leg Press": lift([[10, 45]]) } }),
      "2026-09-20": day({ exercises: { "Hack Squat": { done: true, kg: 40, sets: [{ reps: 10, kg: 40 }], swap: "Leg Press Alt" } } }),
    });
    expect(s.hasHistory("Leg Press")).toBe(true);
    expect(s.hasHistory("Leg Press Alt")).toBe(true);
    expect(s.hasHistory("Calf Raise")).toBe(false); // in the plan, but never logged
  });

  it("carries a lift's logged history to a new name, including anything swapped for it", async () => {
    const s = storeWith({
      "2026-09-09": day({ exercises: { "Leg Press": lift([[10, 45]]) } }),
      "2026-09-16": day({ exercises: { "Hack Squat": { done: true, kg: 40, sets: [{ reps: 10, kg: 40 }], swap: "Leg Press" } } }),
    });
    const r = await s.renameLift("Leg Press", "Leg Press Machine");
    expect(r).toMatchObject({ ok: true, days: 2 });
    expect(r.msg).toBe("Carried Leg Press’s history over to Leg Press Machine: 2 days.");
    expect(s.logs["2026-09-09"].exercises["Leg Press"]).toBeUndefined();
    expect(s.logs["2026-09-09"].exercises["Leg Press Machine"]).toBeDefined();
    expect(s.logs["2026-09-16"].exercises["Hack Squat"].swap).toBe("Leg Press Machine");
    expect(s.hasHistory("Leg Press")).toBe(false);
    // Strength, a lift's own page and "last time" all read the new name's history without a gap.
    expect(liftModel(s, "2026-09-23", "Leg Press Machine").points.map((p) => p.day)).toEqual(["2026-09-09", "2026-09-16"]);
    expect(s.lastDone("Leg Press Machine", "2026-09-23")?.day).toBe("2026-09-16");
    // The plan itself now names the lift "Leg Press Machine" on the day it's on (Legs).
    expect(s.plan.days[2].exercises.find((x) => x.name === "Leg Press Machine")).toBeDefined();
    expect(s.plan.days[2].exercises.find((x) => x.name === "Leg Press")).toBeUndefined();
  });

  it("renames every plan day sharing the old name, so a lift on two days keeps one shared history", async () => {
    const s = storeWith({ "2026-09-08": day({ exercises: { "Seated Row": lift([[10, 40]]) } }) }); // Seated Row is on Pull and Upper
    const r = await s.renameLift("Seated Row", "Cable Row");
    expect(r.ok).toBe(true);
    expect(s.plan.days[1].exercises.find((x) => x.name === "Cable Row")).toBeDefined(); // Pull
    expect(s.plan.days[4].exercises.find((x) => x.name === "Cable Row")).toBeDefined(); // Upper
    expect(s.plan.days.some((d) => d.exercises.some((x) => x.name === "Seated Row"))).toBe(false);
    expect(liftModel(s, "2026-09-23", "Cable Row").planned).toEqual([
      { day: "Pull", reps: [10, 12] },
      { day: "Upper", reps: [10, 12] },
    ]);
  });

  it("still renames the plan's occurrences even when there's no logged history yet to carry", async () => {
    const s = storeWith({});
    const r = await s.renameLift("Leg Press", "Leg Press Machine");
    expect(r).toEqual({ ok: true, days: 0, msg: "Leg Press Machine is saved. Leg Press had no history yet to carry over." });
    expect(s.plan.days[2].exercises.find((x) => x.name === "Leg Press Machine")).toBeDefined();
  });

  it("moves its place in a day's own order", async () => {
    const s = storeWith({ "2026-09-16": day({ order: ["Leg Press", "Hack Squat"], exercises: { "Hack Squat": lift([[10, 40]]) } }) });
    expect(s.entry("2026-09-16").order).toEqual(["Leg Press", "Hack Squat"]);
    const r = await s.renameLift("Leg Press", "Leg Press Machine");
    // That day never logged a Leg Press, so no history moved; its place in the day's order did.
    expect(r).toMatchObject({ ok: true, days: 0 });
    expect(s.logs["2026-09-16"].order).toEqual(["Leg Press Machine", "Hack Squat"]);
    expect(s.liftsFor("2026-09-16")[0].name).toBe("Leg Press Machine");
  });

  it("moves it in a free-form workout", async () => {
    const s = storeWith({ ["2026-09-22"]: day({ free: { name: "", lifts: ["Leg Press", "Lunge"] } }) });
    const r = await s.renameLift("Leg Press", "Leg Press Machine");
    expect(r.days).toBe(0); // added but never logged: no history moved
    expect(s.entry("2026-09-22").free?.lifts).toEqual(["Leg Press Machine", "Lunge"]);
  });

  it("drops a lift's link when it's renamed to a lift the name alone says", async () => {
    const s = storeWith();
    const r = await s.renameLift("Hamstring Curl", "Seated Leg Curl");
    expect(r.ok).toBe(true);
    const renamed = s.plan.days.flatMap((d) => d.exercises).filter((x) => x.name === "Seated Leg Curl");
    expect(renamed.length).toBe(2);
    expect(renamed.every((x) => !("lib" in x))).toBe(true);
    expect(s.exerciseOf("Seated Leg Curl")?.id).toBe("Seated_Leg_Curl");
    await s.renameLift("Leg Extension", "Quad Extension"); // a name of its own: still the same lift
    expect(s.exerciseOf("Quad Extension")?.id).toBe("Leg_Extensions");
  });
});

describe("renaming a lift, with other phones on the account", () => {
  it("carries history to every day with it, including one not loaded here yet, pulling first", async () => {
    const f = fakeSupabase();
    f.elsewhere("2026-09-09", day({ exercises: { "Leg Press": oneSet(10, 45) } }));
    const s = await phone(f);
    // Logged on another device after this phone loaded: not in s.logs yet.
    f.elsewhere("2026-09-16", day({ exercises: { "Leg Press": oneSet(10, 50) } }));
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

  it("refuses to carry history onto a name that has its own: it pulls first, then changes and writes nothing", async () => {
    const f = fakeSupabase();
    f.elsewhere("2026-09-09", day({ exercises: { "Leg Press": oneSet(10, 45) } }));
    f.elsewhere("2026-09-16", day({ exercises: { "Leg Press Machine": oneSet(10, 50) } }));
    const s = await phone(f);
    const r = await s.renameLift("Leg Press", "Leg Press Machine");
    expect(r).toMatchObject({ ok: false, days: 0 });
    expect(r.msg).toBe("“Leg Press Machine” already has its own history, so Leg Press’s can’t be carried over there too.");
    expect(f.sent).toEqual(["select logs"]); // only the pull-first check: nothing written
    expect(f.row("2026-09-09")!.data.exercises).toHaveProperty("Leg Press");
    expect(s.entry("2026-09-16").exercises["Leg Press Machine"].kg).toBe(50);
    expect(s.plan.days[2].exercises.find((x) => x.name === "Leg Press")).toBeDefined(); // the plan is untouched too
  });

  it("moves nothing offline, or when the days won't load, so none logged on another device is left behind", async () => {
    const f = fakeSupabase();
    f.elsewhere("2026-09-09", day({ exercises: { "Leg Press": oneSet(10, 45) } }));
    const s = await phone(f);
    // Logged on another device after this phone loaded: carried over from this phone's days alone, it would stay
    // "Leg Press" once it arrived.
    f.elsewhere("2026-09-16", day({ exercises: { "Leg Press": oneSet(10, 50) } }));
    vi.stubGlobal("navigator", { onLine: false });
    let r = await s.renameLift("Leg Press", "Leg Press Machine");
    expect(r).toMatchObject({ ok: false, days: 0 });
    expect(r.msg).toBe("You’re offline, so Leg Press’s history stays with Leg Press: a day logged on another device could be left behind. Type Leg Press back, then rename it again once you’re online.");
    expect([f.sent, s.pending]).toEqual([[], {}]);
    expect(s.entry("2026-09-09").exercises).toHaveProperty("Leg Press");
    vi.stubGlobal("navigator", { onLine: true });
    f.failLoads();
    r = await s.renameLift("Leg Press", "Leg Press Machine");
    expect(r).toMatchObject({ ok: false, days: 0, msg: "Couldn’t load every logged day just now, so Leg Press’s history stays with Leg Press. Type Leg Press back, then rename it again in a moment." });
    expect([f.sent, s.pending]).toEqual([["select logs"], {}]);
    // Once they load, both days come across.
    f.failLoads(false);
    r = await s.renameLift("Leg Press", "Leg Press Machine");
    expect(r).toMatchObject({ ok: true, days: 2 });
    expect(f.row("2026-09-09")!.data.exercises).toHaveProperty("Leg Press Machine");
    expect(f.row("2026-09-16")!.data.exercises).toHaveProperty("Leg Press Machine");
  });

  it("keeps an unrelated addition another device made to the same day, since it pulls first", async () => {
    const f = fakeSupabase();
    f.elsewhere("2026-09-09", day({ exercises: { "Leg Press": oneSet(10, 45) } }));
    const s = await phone(f);
    // Another device adds a different lift to the same day after this phone loaded.
    f.elsewhere("2026-09-09", day({ exercises: { "Leg Press": oneSet(10, 45), "Leg Extension": oneSet(12, 27) } }));
    const r = await s.renameLift("Leg Press", "Leg Press Machine");
    expect(r).toMatchObject({ ok: true, days: 1, msg: "Carried Leg Press’s history over to Leg Press Machine: 1 day." });
    expect(Object.keys(f.row("2026-09-09")!.data.exercises).sort()).toEqual(["Leg Extension", "Leg Press Machine"]);
    expect(Object.keys(s.entry("2026-09-09").exercises).sort()).toEqual(["Leg Extension", "Leg Press Machine"]);
    expect(s.conflicts).toEqual({});
  });

  it("routes a rename through the same conflict check as any other edit", async () => {
    const f = fakeSupabase();
    f.elsewhere("2026-09-09", day({ exercises: { "Leg Press": oneSet(10, 45), "Leg Extension": oneSet(12, 27) } }));
    const s = await phone(f), load = f.holdNext("load");
    const renaming = s.renameLift("Leg Press", "Leg Press Machine");
    await load.read; // the rename's own pull reads the day as it was…
    f.elsewhere("2026-09-09", day({ exercises: { "Leg Press": oneSet(10, 45), "Leg Extension": oneSet(12, 30) } })); // …then another device changes the other lift…
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
    expect(f.row("2026-09-09")!.data.exercises).toEqual({ "Leg Press Machine": oneSet(10, 45), "Leg Extension": oneSet(12, 27) });
    expect(s.conflicts).toEqual({});
  });
});
