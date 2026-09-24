import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSV_COLUMNS, csvField, toCsv } from "@/lib/backup";
import { DEFAULT_PLAN, normalizePlan } from "@/lib/plan";
import { GymStore } from "@/lib/store";
import type { DayLog, HealthDay, LiftLog } from "@/lib/types";
import { fakeSupabase, type Write } from "./fakeSupabase";

// Wednesday 23 September 2026, as in the end-to-end tests.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-23T12:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const day = (d: Partial<DayLog> = {}): DayLog => ({ exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "", ...d });
const lift = (sets: [number, number][]): LiftLog => ({ done: true, kg: Math.max(...sets.map((s) => s[1])), sets: sets.map(([reps, kg]) => ({ reps, kg })) });
function storeWith(logs: Record<string, DayLog>) {
  const s = new GymStore();
  s.logs = logs;
  s.user = { id: "u", created_at: "2026-08-26T05:00:00Z" } as GymStore["user"];
  return s;
}
/** A file as the file picker gives it. */
const file = (v: unknown) => new File([typeof v === "string" ? v : JSON.stringify(v)], "gym-log.json", { type: "application/json" });
/** Supabase, online, with `health` as its health_days table, by day. Records each write in `writes`. With `fail`,
 *  writes to health_days fail, as they do when the connection drops. */
function supabase(health: Record<string, HealthDay> = {}, fail = false) {
  vi.stubGlobal("navigator", { onLine: true });
  return fakeSupabase(health, { failHealth: fail });
}
/** The tables written to. */
const tables = (writes: Write[]) => [...new Set(writes.map((w) => w.table))].sort();
/** Every row written to a table. */
const rowsOf = (writes: Write[], table: string) => writes.filter((w) => w.table === table).flatMap((w) => w.rows);
const myPlan = () => normalizePlan({ ...DEFAULT_PLAN, tempo: "4:0:1:0", stepGoal: 12000, days: DEFAULT_PLAN.days.map((d, i) => (i === 0 ? { ...d, name: "Chest day" } : d)) }, DEFAULT_PLAN);
const backupOf = (v: { plan?: unknown; logs?: unknown[]; healthDays?: Record<string, HealthDay> }) => ({ format: "gymlog-backup", version: 1, exportedAt: "2026-09-20T08:00:00.000Z", plan: null, logs: [], healthDays: {}, ...v });

describe("backup", () => {
  it("exports the plan, every logged day and the Health Connect days, and restores all three", async () => {
    const a = storeWith({ "2026-09-21": day({ exercises: { "Chest Press Machine": lift([[12, 40]]) } }), "2026-09-23": day({ steps: 9000 }) });
    a.plan = myPlan();
    a.health = { "2026-09-23": { steps: 8421, sleepMin: 432 }, "2026-09-22": { steps: 7000, workouts: [{ type: "walking", start: "2026-09-22T07:00:00", end: "2026-09-22T07:30:00", min: 30 }] } };
    const backup = a.exportBackup();
    expect(backup).toMatchObject({ format: "gymlog-backup", version: 1, exportedAt: new Date().toISOString(), plan: a.plan });
    expect(backup.logs.map((r) => r.day)).toEqual(["2026-09-21", "2026-09-23"]);
    expect(Object.keys(backup.healthDays)).toEqual(["2026-09-22", "2026-09-23"]);

    // Into a new account with an empty database, as on a new deployment
    const b = storeWith({}), db = supabase();
    b.sb = db.sb;
    const ask = vi.fn(() => true);
    expect(await b.importFile(file(JSON.stringify(backup, null, 1)), ask)).toBe("Imported 2 days, the plan and Health Connect data for 2 days.");
    // A new account has the default plan: the file's is different, so it asks first.
    expect(ask).toHaveBeenCalledWith({ days: 0, plan: true });
    expect([b.logs, b.plan, b.health]).toEqual([a.logs, a.plan, a.health]);
    expect(b.exportBackup()).toEqual(backup);
    // All three are saved to the database.
    expect(tables(db.writes)).toEqual(["health_days", "logs", "plans"]);
    expect(rowsOf(db.writes, "logs")).toHaveLength(2);
    expect(rowsOf(db.writes, "plans")).toEqual([{ user_id: "u", plan: a.plan }]);
    expect(db.health).toEqual(a.health);
    expect([b.pending, b.planDirty]).toEqual([{}, false]);
  });

  it("leaves out the plan while it's the app's default", () => {
    const s = storeWith({});
    expect(s.exportBackup()).toEqual({ format: "gymlog-backup", version: 1, exportedAt: new Date().toISOString(), plan: null, logs: [], healthDays: {} });
  });

  it("brings the default plan back from a backup made on it, asking before it replaces another", async () => {
    const s = storeWith({}), db = supabase();
    s.sb = db.sb;
    s.plan = myPlan();
    const ask = vi.fn(() => true);
    const backup = backupOf({ logs: [{ day: "2026-07-01", data: day({ cardio: true }) }] });
    expect(await s.importFile(file(backup), ask)).toBe("Imported 1 day and the plan.");
    expect(ask).toHaveBeenCalledWith({ days: 0, plan: true });
    expect(s.plan).toEqual(DEFAULT_PLAN);
    expect(rowsOf(db.writes, "plans")).toEqual([{ user_id: "u", plan: DEFAULT_PLAN }]);
    // Saying no keeps the account's own plan.
    const t = storeWith({}), db2 = supabase();
    t.sb = db2.sb;
    t.plan = myPlan();
    expect(await t.importFile(file(backup), () => false)).toBe("Import cancelled. Nothing changed.");
    expect([t.plan, db2.writes]).toEqual([myPlan(), []]);
  });

  it("doesn't ask about or name the plan when a backup made on the default meets the default", async () => {
    const s = storeWith({}), db = supabase();
    s.sb = db.sb;
    const ask = vi.fn(() => true);
    expect(await s.importFile(file(backupOf({ logs: [{ day: "2026-07-01", data: day({ cardio: true }) }] })), ask)).toBe("Imported 1 day.");
    expect(ask).not.toHaveBeenCalled();
    expect([s.plan, s.planDirty, tables(db.writes)]).toEqual([DEFAULT_PLAN, false, ["logs"]]);
  });

  it("still imports the first exports, a bare list of days, leaving the plan and Health Connect days alone", async () => {
    const s = storeWith({ "2026-09-22": day({ steps: 8000 }) });
    s.plan = myPlan();
    s.health = { "2026-09-22": { steps: 7000 } };
    const ask = vi.fn(() => true);
    const rows = [{ day: "2026-07-01", data: day({ cardio: true }) }, { day: "1 July", data: day() }, { day: "2026-07-02" }];
    expect(await s.importFile(file(rows), ask)).toBe("Imported 1 day.");
    expect(ask).not.toHaveBeenCalled();
    expect(Object.keys(s.logs).sort()).toEqual(["2026-07-01", "2026-09-22"]);
    expect(s.pending).toEqual({ "2026-07-01": rows[0].data });
    expect(s.plan).toEqual(myPlan());
    expect(s.health).toEqual({ "2026-09-22": { steps: 7000 } });
  });

  it("asks before replacing logged days or the plan, and No changes nothing", async () => {
    const s = storeWith({ "2026-09-22": day({ steps: 8000 }) }), db = supabase();
    s.sb = db.sb;
    const file1 = file(
      backupOf({
        plan: myPlan(),
        logs: [{ day: "2026-09-22", data: day({ steps: 1234 }) }, { day: "2026-07-01", data: day() }],
        healthDays: { "2026-07-01": { steps: 5000 }, "July 2": { steps: 1 } },
      }),
    );
    const no = vi.fn(() => false);
    expect(await s.importFile(file1, no)).toBe("Import cancelled. Nothing changed.");
    expect(no).toHaveBeenCalledWith({ days: 1, plan: true });
    expect([s.logs, s.pending, s.plan, s.health, db.writes]).toEqual([{ "2026-09-22": day({ steps: 8000 }) }, {}, DEFAULT_PLAN, {}, []]);

    expect(await s.importFile(file1, () => true)).toBe("Imported 2 days, the plan and Health Connect data for 1 day.");
    expect([s.logs["2026-09-22"].steps, s.plan, s.health]).toEqual([1234, myPlan(), { "2026-07-01": { steps: 5000 } }]);
    // The same file again: nothing it has differs, so there's nothing to ask.
    const again = vi.fn(() => false);
    expect(await s.importFile(file1, again)).toBe("Imported 2 days, the plan and Health Connect data for 1 day.");
    expect(again).not.toHaveBeenCalled();
  });

  it("says why a file can't be imported, and what to do instead", async () => {
    const s = storeWith({});
    const why = (v: unknown) => s.importFile(file(v), () => true);
    expect(await why("hello")).toMatch(/^That file couldn’t be imported: .+\. Choose a \.json file exported from Gym Log\.$/);
    expect(await why({ days: [] })).toBe("That file couldn’t be imported: it isn’t a Gym Log export. Choose a .json file exported from Gym Log.");
    expect(await why({ format: "gymlog-backup", version: 2, logs: [] })).toBe("That file couldn’t be imported: it comes from a newer version of Gym Log. Update Gym Log, then try again.");
    expect(await why({ format: "gymlog-backup", version: 1, plan: "Push" })).toBe("That file couldn’t be imported: its plan can’t be read. Choose a .json file exported from Gym Log.");
    expect(await why({ format: "gymlog-backup", version: 1, logs: {} })).toBe("That file couldn’t be imported: its logged days can’t be read. Choose a .json file exported from Gym Log.");
    expect([s.logs, s.plan, s.health]).toEqual([{}, DEFAULT_PLAN, {}]);
  });

  it("saves Health Connect days to the database, filling in only the days it doesn't have, then shows what it holds", async () => {
    // The database has its own, maybe newer, 22 September, and a day this device hasn't read yet.
    const s = storeWith({}), db = supabase({ "2026-09-20": { steps: 3000 }, "2026-09-22": { steps: 7100 } });
    s.sb = db.sb;
    const healthDays = { "2026-09-21": { steps: 5000, sleepMin: 400 }, "2026-09-22": { steps: 6900 } };
    const ask = vi.fn(() => true);
    expect(await s.importFile(file(backupOf({ healthDays })), ask)).toBe("Imported Health Connect data for 2 days.");
    // Nothing in the database is replaced, so there's nothing to ask.
    expect(ask).not.toHaveBeenCalled();
    expect(db.writes).toEqual([
      {
        table: "health_days",
        rows: [
          { user_id: "u", day: "2026-09-21", data: healthDays["2026-09-21"] },
          { user_id: "u", day: "2026-09-22", data: healthDays["2026-09-22"] },
        ],
        opts: { onConflict: "user_id,day", ignoreDuplicates: true },
      },
    ]);
    expect(db.health).toEqual({ "2026-09-20": { steps: 3000 }, "2026-09-21": { steps: 5000, sleepMin: 400 }, "2026-09-22": { steps: 7100 } });
    // This device's copy is read back from the database, not taken from the file.
    expect(s.health).toEqual(db.health);
    expect(s.healthSyncedAt).toBe("2026-09-23T04:12:00+00:00");
  });

  it("keeps none of the Health Connect days on this device when they can't be saved, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const backup = backupOf({ plan: myPlan(), logs: [{ day: "2026-07-01", data: day({ cardio: true }) }], healthDays: { "2026-07-01": { steps: 5000 } } });
    const offline = supabase(), failing = supabase({}, true);
    // Not connected to Supabase, the phone offline, and the write failing
    for (const [sb, online] of [[null, true], [offline.sb, false], [failing.sb, true]] as const) {
      const s = storeWith({});
      s.sb = sb;
      vi.stubGlobal("navigator", { onLine: online });
      expect(await s.importFile(file(backup), () => true)).toBe("Imported 1 day and the plan. The Health Connect days couldn’t be saved: import the file again when you’re online.");
      // The day and the plan are in, and sync as usual.
      expect([Object.keys(s.logs), s.plan, s.health]).toEqual([["2026-07-01"], myPlan(), {}]);
    }
    expect(offline.writes).toEqual([]);
    expect(tables(failing.writes)).toEqual(["health_days", "logs", "plans"]);
    expect(failing.health).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
  });

  it("takes Health Connect days from the database as they are there, so a day only this device had goes", async () => {
    const s = storeWith({}), db = supabase({ "2026-09-22": { steps: 7100 } });
    s.sb = db.sb;
    s.health = { "2025-01-05": { steps: 4000 }, "2026-09-22": { steps: 6900 } };
    await s.pullHealth();
    expect(s.health).toEqual({ "2026-09-22": { steps: 7100 } });
    expect(s.healthSyncedAt).toBe("2026-09-23T04:12:00+00:00");
  });
});

describe("workout CSV", () => {
  it("quotes a field with a quote, a comma or a line break, doubling its quotes", () => {
    expect([csvField("Leg Press"), csvField('Said "hi", then left'), csvField("one\ntwo"), csvField("a\rb"), csvField(null), csvField(42.5), csvField(false)]).toEqual([
      "Leg Press",
      '"Said ""hi"", then left"',
      '"one\ntwo"',
      '"a\rb"',
      "",
      "42.5",
      "false",
    ]);
    expect(toCsv([["a", "b,c"], [1, null]])).toBe('a,"b,c"\r\n1,\r\n');
  });

  it("puts a ' before text a spreadsheet would run as a formula, and leaves numbers alone", () => {
    expect([csvField("+1 rep next week"), csvField("-2 kg, knee sore"), csvField("=HYPERLINK(\"http://x\")"), csvField("@home"), csvField("\tTab"), csvField(-5), csvField("Push")]).toEqual([
      "'+1 rep next week",
      '"\'-2 kg, knee sore"',
      '"\'=HYPERLINK(""http://x"")"',
      "'@home",
      "'\tTab",
      "-5",
      "Push",
    ]);
  });

  it("has a row for each set, marking skipped and swapped lifts; days without sets have none", () => {
    const note = 'Busy, "leg day" crowd\nshort rests';
    const s = storeWith({
      // Monday, Push: in the plan's order, whatever order they were logged in
      "2026-09-21": day({
        note,
        exercises: {
          "Chest Press Machine": lift([[12, 40], [10, 42.5]]),
          "Incline Machine Press": { done: true, kg: 30, swap: "Incline DB Press", sets: [{ reps: 10, kg: 30 }] },
          // Skipping keeps a set logged before it; an empty set has no row
          "Machine Shoulder Press": { done: false, kg: 20, skipped: true, reason: "shoulder", sets: [{ reps: 8, kg: 20 }, { reps: null, kg: null }] },
          "DB Lateral Raises": { done: false, kg: null, skipped: true },
          "Push-up, weighted": { done: true, kg: 10, sets: [{ reps: 15, kg: 10 }] },
        },
      }),
      "2026-09-22": day({ steps: 9000, note: "Rest" }),
      // An older entry: one weight, as set 1
      "2026-09-23": day({ exercises: { "Leg Press": { done: true, kg: 50 } } }),
      // Thursday, a rest day, doing Tuesday's Pull
      "2026-09-24": day({ session: 1, exercises: { "Lat Pulldown": lift([[10, 45]]) } }),
    });
    const rows = s.workoutRows();
    expect(rows).toEqual([
      ["2026-09-21", "Push", "Incline Machine Press", 1, 10, 30, false, "Incline DB Press", note],
      ["2026-09-21", "Push", "Chest Press Machine", 1, 12, 40, false, "", note],
      ["2026-09-21", "Push", "Chest Press Machine", 2, 10, 42.5, false, "", note],
      ["2026-09-21", "Push", "Machine Shoulder Press", 1, 8, 20, true, "", note],
      ["2026-09-21", "Push", "Push-up, weighted", 1, 15, 10, false, "", note],
      ["2026-09-23", "Legs", "Leg Press", 1, null, 50, false, "", ""],
      ["2026-09-24", "Pull", "Lat Pulldown", 1, 10, 45, false, "", ""],
    ]);
    const quoted = '"Busy, ""leg day"" crowd\nshort rests"';
    expect(toCsv([CSV_COLUMNS, ...rows]).split("\r\n")).toEqual([
      "day,session,lift,set,reps,kg,skipped,swapped_for,note",
      `2026-09-21,Push,Incline Machine Press,1,10,30,false,Incline DB Press,${quoted}`,
      `2026-09-21,Push,Chest Press Machine,1,12,40,false,,${quoted}`,
      `2026-09-21,Push,Chest Press Machine,2,10,42.5,false,,${quoted}`,
      `2026-09-21,Push,Machine Shoulder Press,1,8,20,true,,${quoted}`,
      `2026-09-21,Push,"Push-up, weighted",1,15,10,false,,${quoted}`,
      "2026-09-23,Legs,Leg Press,1,,50,false,,",
      "2026-09-24,Pull,Lat Pulldown,1,10,45,false,,",
      "",
    ]);
  });
});
