import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Health Connect from the Android app (src/native/health.ts and sync.ts): the full read on opening and Sync now, the
// quick read of today every 30 seconds, the Connect button, and background sync.
vi.mock("@capacitor/core", async () => (await import("./nativeMocks")).capacitorCore);
vi.mock("@capgo/capacitor-health", async () => ({ Health: (await import("./nativeMocks")).health }));

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";
import { GymStore } from "@/lib/store";
import { connectHealth, healthAccess, READ, syncHealth, syncToday } from "@/native/health";
import { checkBackgroundOwner, turnOffBackground, turnOnBackground, deviceName } from "@/native/sync";
import { atWednesdayNoon, flush, memoryStorage } from "./helpers";
import { gymSync, health } from "./nativeMocks";
import { mid, phoneHas, signedIn } from "./phone";

atWednesdayNoon({ onlyDate: true });
beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { onLine: true });
  for (const f of Object.values(health)) f.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("syncHealth", () => {
  it("says so when the phone has no Health Connect", async () => {
    const { s } = signedIn();
    health.isAvailable.mockResolvedValue({ available: false, reason: "Health Connect is unavailable on this device." });
    await syncHealth(s, true);
    expect(s.healthLink.state).toBe("unavailable");
    expect(s.healthLink.msg).toBe("Health Connect is unavailable on this device. Install or update Health Connect from Google Play, then try again.");
    expect(health.checkAuthorization).not.toHaveBeenCalled();
  });

  it("waits for the Connect button while nothing is allowed", async () => {
    const { s } = signedIn();
    health.isAvailable.mockResolvedValue({ available: true });
    health.checkAuthorization.mockResolvedValue({ readAuthorized: [] });
    await syncHealth(s, true);
    expect(s.healthLink).toEqual({ state: "off", msg: "Not connected yet." });
    expect(health.queryAggregated).not.toHaveBeenCalled();
  });

  it("first reads back to when the log started, then saves the days", async () => {
    const { s, upserts } = signedIn();
    phoneHas();
    await syncHealth(s, true);
    // Today is 23 Sept; the account started 26 Aug, and at least 30 days are read: from 24 Aug.
    expect(health.queryAggregated).toHaveBeenCalledWith({ dataType: "steps", startDate: mid(8, 24), endDate: new Date(2026, 8, 23, 12).toISOString(), bucket: "day", aggregation: "sum" });
    expect(health.readSamples).toHaveBeenCalledWith(expect.objectContaining({ dataType: "sleep", startDate: mid(8, 23) }));
    expect(upserts).toEqual([
      [
        { user_id: "u1", day: "2026-09-22", data: { steps: 8421 } },
        { user_id: "u1", day: "2026-09-23", data: { steps: 3012, stepsByHour: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3012, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], restingHr: 61, weight: 81.2 } },
      ],
    ]);
    expect(s.stepsOf("2026-09-22")).toBe(8421);
    expect(s.weightOf("2026-09-23")).toBe(81.2);
    expect(s.healthLink).toEqual({ state: "ok", msg: "2 days updated." });
  });

  it("reads the longer stretch again when more kinds of data are allowed", async () => {
    const { s } = signedIn();
    phoneHas();
    health.checkAuthorization.mockResolvedValue({ readAuthorized: ["steps"] });
    await syncHealth(s, true);
    health.queryAggregated.mockClear();
    health.checkAuthorization.mockResolvedValue({ readAuthorized: ["steps", "sleep"] });
    await syncHealth(s, true);
    expect(health.queryAggregated).toHaveBeenCalledWith(expect.objectContaining({ dataType: "steps", startDate: mid(8, 24) }));
    health.queryAggregated.mockClear();
    await syncHealth(s, true);
    expect(health.queryAggregated).toHaveBeenCalledWith(expect.objectContaining({ dataType: "steps", startDate: mid(9, 14) }));
  });

  it("says in words what's allowed and what isn't, for Settings", async () => {
    health.isAvailable.mockResolvedValue({ available: true });
    health.checkAuthorization.mockResolvedValue({ readAuthorized: ["steps", "sleep", "heartRate"] });
    const a = await healthAccess();
    expect(a?.granted).toEqual(["steps", "heart rate", "sleep"]);
    expect(a?.missing).toHaveLength(READ.length - 3);
    expect(a?.missing).toContain("blood oxygen");
    health.isAvailable.mockResolvedValue({ available: false });
    expect(await healthAccess()).toBeNull();
  });

  it("then reads the last 10 days, and writes nothing when nothing changed", async () => {
    const { s, upserts } = signedIn();
    phoneHas();
    await syncHealth(s, true);
    health.queryAggregated.mockClear();
    await syncHealth(s, true);
    expect(health.queryAggregated).toHaveBeenCalledWith(expect.objectContaining({ dataType: "steps", startDate: mid(9, 14) }));
    expect(upserts).toHaveLength(1);
    expect(s.healthLink.msg).toBe("Up to date.");
  });

  it("keeps going when one kind of data can't be read, and says which", async () => {
    const { s, upserts } = signedIn();
    phoneHas();
    health.readSamples.mockImplementation(async ({ dataType }: { dataType: string }) => {
      if (dataType === "sleep") throw new Error("SecurityException");
      return { samples: [] };
    });
    await syncHealth(s, true);
    expect(upserts).toHaveLength(1);
    expect(s.healthLink.msg).toBe("2 days updated; couldn’t read sleep.");
  });

  it("reads only what was allowed", async () => {
    const { s } = signedIn();
    phoneHas();
    health.checkAuthorization.mockResolvedValue({ readAuthorized: ["steps"] });
    await syncHealth(s, true);
    // Steps by the day, and by the hour.
    expect(health.queryAggregated.mock.calls.map((c) => [c[0].dataType, c[0].bucket])).toEqual([
      ["steps", "day"],
      ["steps", "hour"],
    ]);
    expect(health.readSamples).not.toHaveBeenCalled();
    expect(health.queryWorkouts).not.toHaveBeenCalled();
  });

  it("reports a failed save and tries again next time", async () => {
    const { s } = signedIn();
    phoneHas();
    s.sb = { from: () => ({ upsert: async () => ({ error: new Error("Failed to fetch") }) }) } as unknown as GymStore["sb"];
    await syncHealth(s, true);
    expect(s.healthLink).toEqual({ state: "error", msg: "Couldn’t sync Health Connect: Failed to fetch. It tries again next time the app opens." });
  });
});

describe("syncToday (every 30 seconds while the app is open)", () => {
  /** Today's steps as Health Connect now has them, on top of phoneHas(). */
  const walked = (steps: number) =>
    health.queryAggregated.mockImplementation(async ({ dataType, bucket }: { dataType: string; bucket: string }) => ({
      samples: dataType === "steps" && bucket === "day" ? [{ startDate: mid(9, 23), value: steps }] : dataType === "steps" ? [{ startDate: new Date(2026, 8, 23, 9).toISOString(), value: steps }] : [],
    }));

  it("waits for a full read to have connected", async () => {
    const { s } = signedIn();
    phoneHas();
    await syncToday(s);
    expect(health.queryAggregated).not.toHaveBeenCalled();
  });

  it("reads only today, quietly, and saves it when it changed", async () => {
    const { s, upserts } = signedIn();
    phoneHas();
    await syncHealth(s, true);
    const link = s.healthLink, saves = upserts.length;
    health.queryAggregated.mockClear();
    health.isAvailable.mockClear();
    walked(4200);
    await syncToday(s);
    expect(health.queryAggregated).toHaveBeenCalledWith(expect.objectContaining({ dataType: "steps", startDate: mid(9, 23), bucket: "day" }));
    expect(health.queryAggregated.mock.calls.every((c) => c[0].startDate === mid(9, 23))).toBe(true);
    // No "Reading Health Connect…" each time, nor asking again whether it's there.
    expect(s.healthLink).toBe(link);
    expect(health.isAvailable).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(saves + 1);
    expect(upserts.at(-1)).toEqual([expect.objectContaining({ day: "2026-09-23", data: expect.objectContaining({ steps: 4200 }) })]);
    expect(s.health["2026-09-23"].steps).toBe(4200);
    // Nothing new: nothing written, nothing redrawn.
    let redraws = 0;
    s.subscribe(() => redraws++);
    await syncToday(s);
    expect(upserts).toHaveLength(saves + 1);
    expect(redraws).toBe(0);
  });

  it("saves nothing from a read where something failed that the full read could read", async () => {
    const { s, upserts } = signedIn();
    phoneHas();
    await syncHealth(s, true);
    const saves = upserts.length;
    walked(4200);
    health.readSamples.mockImplementation(async ({ dataType }: { dataType: string }) => {
      if (dataType === "weight") throw new Error("Rate limited");
      return { samples: [] };
    });
    await syncToday(s);
    expect(upserts).toHaveLength(saves);
    expect(s.health["2026-09-23"].weight).toBe(81.2);
  });

  it("never lands after a full read that started while it ran: the full read waits for it, and it saves nothing", async () => {
    const { s, upserts } = signedIn();
    phoneHas();
    await syncHealth(s, true);
    const saves = upserts.length;
    // A slow quick read: its first query waits, and gets the 4,200 steps Health Connect had then.
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    health.queryAggregated.mockImplementationOnce(async () => {
      await gate;
      return { samples: [{ startDate: mid(9, 23), value: 4200 }] };
    });
    const quick = syncToday(s);
    walked(5100); // by the time the full read (Sync now, say) reads, 5,100
    health.isAvailable.mockClear();
    const full = syncHealth(s, true);
    await flush();
    expect(health.isAvailable).not.toHaveBeenCalled(); // the full read waits for the quick one
    release();
    await Promise.all([quick, full]);
    expect(s.health["2026-09-23"].steps).toBe(5100);
    const rows = upserts.slice(saves).flat() as { data: { steps?: number } }[];
    expect(rows.some((r) => r.data.steps === 5100) && rows.every((r) => r.data.steps !== 4200)).toBe(true);
  });

  it("doesn't read while the app isn't on screen, or while the phone is offline", async () => {
    const { s } = signedIn();
    phoneHas();
    await syncHealth(s, true);
    health.queryAggregated.mockClear();
    vi.stubGlobal("document", { visibilityState: "hidden" });
    await syncToday(s);
    expect(health.queryAggregated).not.toHaveBeenCalled();
    // On screen but offline: what it read couldn't be saved, so it doesn't read every 30 seconds for nothing.
    vi.stubGlobal("document", { visibilityState: "visible" });
    vi.stubGlobal("navigator", { onLine: false });
    await syncToday(s);
    expect(health.queryAggregated).not.toHaveBeenCalled();
    // Back online, it reads again.
    vi.stubGlobal("navigator", { onLine: true });
    await syncToday(s);
    expect(health.queryAggregated).toHaveBeenCalled();
  });
});

describe("connectHealth", () => {
  it("asks for access, older history included, then reads", async () => {
    const { s } = signedIn();
    phoneHas();
    health.requestAuthorization.mockResolvedValue({ readAuthorized: READ });
    await connectHealth(s);
    expect(health.requestAuthorization).toHaveBeenCalledWith({ read: READ, requestHistoryAccess: true });
    expect(s.healthLink.state).toBe("ok");
  });
});

describe("background sync", () => {
  /** A signed-in store whose Supabase client makes keys and deletes them. */
  function withKeys(key: string | null = "k".repeat(64)) {
    const { s } = signedIn(), calls: unknown[][] = [];
    s.sb = {
      rpc: async (fn: string, args: unknown) => (calls.push(["rpc", fn, args]), key ? { data: key, error: null } : { data: null, error: new Error("offline") }),
      from: (table: string) => ({ delete: () => ({ eq: async (col: string, v: string) => (calls.push(["delete", table, col, v]), { error: null }) }) }),
    } as unknown as GymStore["sb"];
    return { s, calls };
  }
  beforeEach(() => {
    for (const f of Object.values(gymSync)) f.mockClear();
  });

  it("says so when the phone's Health Connect can't read in the background", async () => {
    const { s, calls } = withKeys();
    gymSync.requestBackground.mockResolvedValue({ available: false, allowed: false });
    expect(await turnOnBackground(s)).toMatch(/^This phone’s Health Connect can’t read in the background yet/);
    expect(calls).toEqual([]);
    expect(gymSync.enable).not.toHaveBeenCalled();
  });

  it("needs the background permission", async () => {
    const { s } = withKeys();
    gymSync.requestBackground.mockResolvedValue({ available: true, allowed: false });
    expect(await turnOnBackground(s)).toMatch(/Access data in the background/);
    expect(gymSync.enable).not.toHaveBeenCalled();
  });

  it("makes a key for this phone, under a name the phone keeps, and hands it to the worker", async () => {
    const { s, calls } = withKeys();
    gymSync.requestBackground.mockResolvedValue({ available: true, allowed: true });
    expect(await turnOnBackground(s)).toBe("Background sync is on. Gym Log reads Health Connect about every hour, even when it’s closed.");
    expect(gymSync.enable).toHaveBeenCalledWith({ key: "k".repeat(64), url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
    // Turned on again later: the same name, so the new key replaces this phone's old one rather than adding another.
    await turnOnBackground(s);
    const names = calls.map((c) => (c[2] as { device_name: string }).device_name);
    expect(calls.map((c) => c.slice(0, 2))).toEqual([["rpc", "create_health_sync_key"], ["rpc", "create_health_sync_key"]]);
    expect(names[0]).toMatch(/^android-[0-9a-f]{8}$/);
    expect(names[1]).toBe(names[0]);
  });

  it("doesn't start the worker when no key came back", async () => {
    const { s } = withKeys(null);
    gymSync.requestBackground.mockResolvedValue({ available: true, allowed: true });
    expect(await turnOnBackground(s)).toMatch(/^Couldn’t turn on background sync: offline\./);
    expect(gymSync.enable).not.toHaveBeenCalled();
  });

  it("turns off: stops the worker and removes this phone's key", async () => {
    const { s, calls } = withKeys();
    expect(await turnOffBackground(s)).toBe("Background sync is off. Gym Log syncs when you open it.");
    expect(gymSync.disable).toHaveBeenCalled();
    expect(calls).toEqual([["delete", "health_sync_keys", "device", deviceName()]]);
  });

  it("stops when another account signs in on this phone", async () => {
    const { s } = withKeys();
    gymSync.requestBackground.mockResolvedValue({ available: true, allowed: true });
    await turnOnBackground(s);
    gymSync.disable.mockClear();
    gymSync.status.mockResolvedValue({ on: true, available: true, allowed: true, lastRunAt: 0, lastOk: true, lastMsg: "" });
    await checkBackgroundOwner(s);
    expect(gymSync.disable).not.toHaveBeenCalled();
    s.user = { id: "someone-else" } as GymStore["user"];
    await checkBackgroundOwner(s);
    expect(gymSync.disable).toHaveBeenCalledTimes(1);
  });
});
