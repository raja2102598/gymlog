import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Health plugin and Capacitor's App plugin, answering as the Android app would.
const health = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  checkAuthorization: vi.fn(),
  requestAuthorization: vi.fn(),
  queryAggregated: vi.fn(),
  readSamples: vi.fn(),
  queryWorkouts: vi.fn(),
}));
const app = vi.hoisted(() => {
  const listeners: Record<string, (e: { url?: string }) => void> = {};
  return {
    listeners,
    getLaunchUrl: vi.fn(),
    addListener: vi.fn(async (name: string, fn: (e: { url?: string }) => void) => {
      listeners[name] = fn;
      return { remove: async () => {} };
    }),
  };
});
vi.mock("@capgo/capacitor-health", () => ({ Health: health }));
vi.mock("@capacitor/app", () => ({ App: app }));

import { NATIVE_SIGN_IN } from "@/lib/native";
import { GymStore } from "@/lib/store";
import { connectHealth, READ, syncHealth } from "@/native/health";

const mid = (m: number, d: number) => new Date(2026, m - 1, d).toISOString();
const flush = () => new Promise((r) => setTimeout(r, 0));

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
}
/** A signed-in store whose Supabase client records upserts to health_days. */
function signedIn() {
  const s = new GymStore(), upserts: unknown[][] = [];
  s.user = { id: "u1", created_at: "2026-08-26T05:00:00Z" } as GymStore["user"];
  s.auth = "signedIn";
  s.sb = {
    from: (table: string) => ({
      upsert: async (rows: unknown[]) => {
        if (table === "health_days") upserts.push(rows);
        return { error: null };
      },
    }),
  } as unknown as GymStore["sb"];
  return { s, upserts };
}
function phoneHas() {
  health.isAvailable.mockResolvedValue({ available: true, platform: "android" });
  health.checkAuthorization.mockResolvedValue({ readAuthorized: READ, readDenied: [], writeAuthorized: [], writeDenied: [] });
  health.queryAggregated.mockImplementation(async ({ dataType }: { dataType: string }) => ({
    samples: dataType === "steps" ? [{ startDate: mid(9, 22), value: 8421 }, { startDate: mid(9, 23), value: 3012 }] : dataType === "restingHeartRate" ? [{ startDate: mid(9, 23), value: 61 }] : [],
  }));
  health.readSamples.mockImplementation(async ({ dataType }: { dataType: string }) => ({
    samples: dataType === "weight" ? [{ startDate: new Date(2026, 8, 23, 7).toISOString(), endDate: new Date(2026, 8, 23, 7).toISOString(), value: 81.2 }] : [],
  }));
  health.queryWorkouts.mockResolvedValue({ workouts: [] });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 23, 12));
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { onLine: true });
  for (const f of Object.values(health)) f.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
        { user_id: "u1", day: "2026-09-23", data: { steps: 3012, restingHr: 61, weight: 81.2 } },
      ],
    ]);
    expect(s.stepsOf("2026-09-22")).toBe(8421);
    expect(s.weightOf("2026-09-23")).toBe(81.2);
    expect(s.healthLink).toEqual({ state: "ok", msg: "2 days updated." });
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
    expect(health.queryAggregated.mock.calls.map((c) => c[0].dataType)).toEqual(["steps"]);
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

describe("startNative", () => {
  it("finishes sign-in from a link, reads Health Connect once signed in, and again on coming back", async () => {
    vi.useRealTimers();
    const { startNative } = await import("@/native/app");
    const { s } = signedIn();
    s.auth = "starting";
    const signIns: string[] = [];
    s.finishSignIn = async (url: string) => void signIns.push(url);
    phoneHas();
    app.getLaunchUrl.mockResolvedValue({ url: `${NATIVE_SIGN_IN}?code=abc` });
    await startNative(s);
    expect(signIns).toEqual([`${NATIVE_SIGN_IN}?code=abc`]);
    app.listeners.appUrlOpen({ url: "https://example.com/other" });
    app.listeners.appUrlOpen({ url: `${NATIVE_SIGN_IN}?code=def` });
    expect(signIns).toEqual([`${NATIVE_SIGN_IN}?code=abc`, `${NATIVE_SIGN_IN}?code=def`]);
    expect(health.isAvailable).not.toHaveBeenCalled();
    s.auth = "signedIn";
    s.setHealthLink({ state: "web", msg: "" }); // any change tells listeners
    await flush();
    await flush();
    expect(health.isAvailable).toHaveBeenCalledTimes(1);
    expect(app.listeners.resume).toBeTypeOf("function");
  });
});

describe("store sign-in in the app", () => {
  it("sends links that open the app, and turns the code into a session", async () => {
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
    const { s } = signedIn();
    const calls: unknown[] = [];
    s.sb = {
      auth: {
        signInWithOtp: async (o: unknown) => (calls.push(o), { error: null }),
        exchangeCodeForSession: async (code: string) => (calls.push(code), code === "good" ? { error: null } : { error: new Error("Invalid code.") }),
      },
    } as unknown as GymStore["sb"];
    await s.sendLink("t@example.com");
    expect(calls[0]).toEqual({ email: "t@example.com", options: { emailRedirectTo: NATIVE_SIGN_IN } });
    await s.finishSignIn(`${NATIVE_SIGN_IN}?code=good`);
    expect(calls[1]).toBe("good");
    expect(s.authMsg).toBe("");
    await s.finishSignIn(`${NATIVE_SIGN_IN}?code=bad`);
    expect(s.authMsg).toBe("That sign-in link didn’t work (Invalid code). Send a new one from this app, and open it on this phone.");
  });
});

describe("steps and weight from both sources", () => {
  it("prefers what you typed, falls back to Health Connect, and trends weight from both", () => {
    const s = new GymStore();
    s.logs = { "2026-09-20": { exercises: {}, warmup: [], cardio: false, steps: 9000, weight: 82, note: "" } };
    s.health = { "2026-09-20": { steps: 8800, weight: 81.8 }, "2026-09-21": { steps: 7000, weight: 81.6 } };
    expect([s.stepsOf("2026-09-20"), s.stepsOf("2026-09-21"), s.stepsOf("2026-09-22")]).toEqual([9000, 7000, null]);
    expect([s.weightOf("2026-09-20"), s.weightOf("2026-09-21")]).toEqual([82, 81.6]);
    expect(s.weightSeries().filter((p) => p.measured).map((p) => [p.day, p.weight])).toEqual([
      ["2026-09-20", 82],
      ["2026-09-21", 81.6],
    ]);
  });
});
