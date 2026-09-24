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
// The app's own GymSync plugin, for background sync.
const gymSync = vi.hoisted(() => ({
  status: vi.fn(),
  requestBackground: vi.fn(),
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
  runNow: vi.fn(async () => {}),
}));
vi.mock("@capgo/capacitor-health", () => ({ Health: health }));
vi.mock("@capacitor/app", () => ({ App: app }));
// The app's own GoogleSignIn plugin: Android's account sheet, answering with Google's ID token.
const googleSignIn = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  registerPlugin: (name: string) => (name === "GoogleSignIn" ? googleSignIn : gymSync),
  SystemBars: { setStyle: vi.fn() },
  SystemBarsStyle: { Dark: "DARK", Light: "LIGHT", Default: "DEFAULT" },
}));

import { APP_LOGIN_PAGE, NATIVE_SIGN_IN } from "@/lib/native";
import { GymStore } from "@/lib/store";
import { connectHealth, healthAccess, READ, syncHealth } from "@/native/health";
import { signInWithGoogle } from "@/native/google";
import { checkBackgroundOwner, deviceName, turnOffBackground, turnOnBackground } from "@/native/sync";
import { createHash } from "node:crypto";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

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
  health.queryAggregated.mockImplementation(async ({ dataType, bucket }: { dataType: string; bucket: string }) => ({
    samples:
      dataType === "steps" && bucket === "hour"
        ? [{ startDate: new Date(2026, 8, 23, 9).toISOString(), value: 3012 }]
        : dataType === "steps"
          ? [{ startDate: mid(9, 22), value: 8421 }, { startDate: mid(9, 23), value: 3012 }]
          : dataType === "restingHeartRate"
            ? [{ startDate: mid(9, 23), value: 61 }]
            : [],
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
  /** A signed-out store in the Android app whose auth client records its calls and gives `answers`. */
  function signedOutApp(answers: { otp?: unknown; codeError?: unknown; password?: unknown; user?: unknown } = {}) {
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
    const s = new GymStore(), calls: unknown[][] = [];
    s.auth = "signedOut";
    s.sb = {
      auth: {
        signInWithOtp: async (o: unknown) => (calls.push(["otp", o]), answers.otp ?? { error: null }),
        exchangeCodeForSession: async (code: string, o?: unknown) => (calls.push(["code", code, o]), { error: code === "good" ? null : answers.codeError }),
        signInWithPassword: async (o: unknown) => (calls.push(["password", o]), answers.password ?? { error: null }),
        updateUser: async (o: unknown) => (calls.push(["user", o]), answers.user ?? { error: null }),
      },
    } as unknown as GymStore["sb"];
    return { s, calls };
  }
  const authError = (message: string, code: string, status = 400) => ({ error: Object.assign(new Error(message), { code, status }) });

  it("sends links through the site's app-login page, and finishes each with its own flow", async () => {
    const { s, calls } = signedOutApp();
    expect(await s.sendLink("t@example.com")).toEqual({
      sent: true,
      msg: "Check t@example.com for a sign-in link and open it on this phone. If you ask for another, use the newest email.",
    });
    expect(calls[0]).toEqual(["otp", { email: "t@example.com", options: { emailRedirectTo: APP_LOGIN_PAGE } }]);
    await s.finishSignIn(`${NATIVE_SIGN_IN}?sb_flow_id=f1&code=good`);
    expect(calls[1]).toEqual(["code", "good", { flowId: "f1" }]);
    expect(s.authMsg).toBe("");
    // Links from version 1.0.1 carry no flow id.
    await s.finishSignIn(`${NATIVE_SIGN_IN}?code=good`);
    expect(calls[2]).toEqual(["code", "good", undefined]);
  });

  it("says why a link didn't work, and what to do", async () => {
    const { s } = signedOutApp({ codeError: authError("PKCE code verifier not found in storage. This can happen…", "pkce_code_verifier_not_found").error });
    await s.finishSignIn(`${NATIVE_SIGN_IN}?sb_flow_id=f1&code=bad`);
    expect(s.authMsg).toBe("That link belongs to an older request or another phone. Send a new one from this app, and open the newest email on this phone.");
    await s.finishSignIn(`${NATIVE_SIGN_IN}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    expect(s.authMsg).toBe("That sign-in link has expired or was already used. Send a new one from this app.");
    await s.finishSignIn(`${NATIVE_SIGN_IN}?error_description=Something+odd`);
    expect(s.authMsg).toBe("That sign-in link didn’t work (Something odd). Send a new one from this app, and open it on this phone.");
  });

  it("leaves a link alone once signed in", async () => {
    const { s, calls } = signedOutApp();
    s.user = { id: "u1" } as GymStore["user"];
    await s.finishSignIn(`${NATIVE_SIGN_IN}?sb_flow_id=f1&code=good`);
    expect(calls).toEqual([]);
  });

  it("explains Supabase's limits on sign-in emails", async () => {
    const soon = signedOutApp({ otp: authError("For security purposes, you can only request this after 31 seconds.", "over_email_send_rate_limit", 429) });
    expect(await soon.s.sendLink("t@example.com")).toEqual({ sent: false, msg: "Wait 31 seconds before asking for another link. The one already sent still works." });
    const hour = signedOutApp({ otp: authError("email rate limit exceeded", "over_email_send_rate_limit", 429) });
    expect(await hour.s.sendLink("t@example.com")).toEqual({
      sent: false,
      msg: "Supabase only sends a few sign-in emails an hour, and they’re used up. Try again in an hour, or sign in with a password.",
    });
  });

  it("signs in with a password, and sets one", async () => {
    const { s, calls } = signedOutApp();
    expect(await s.signInWithPassword("t@example.com", "hunter22")).toBe("");
    expect(calls[0]).toEqual(["password", { email: "t@example.com", password: "hunter22" }]);
    const wrong = signedOutApp({ password: authError("Invalid login credentials", "invalid_credentials") });
    expect(await wrong.s.signInWithPassword("t@example.com", "nope")).toBe(
      "That email and password don’t match. No password yet? Sign in with an email link, then set one in Settings.",
    );
    expect(s.hasPassword).toBe(false);
    expect(await s.setPassword("a-long-password")).toEqual({ ok: true, msg: "Password saved. Sign in with your email and this password, in the Android app too." });
    // Flagged in the account's metadata, so Settings says "Change password" after a sign-in with a link, too.
    expect(calls[1]).toEqual(["user", { password: "a-long-password", data: { has_password: true } }]);
    expect(s.hasPassword).toBe(true);
    expect(await s.setPassword("another-long-one")).toEqual({ ok: true, msg: "Password changed." });
    const reauth = signedOutApp({ user: authError("Password update requires reauthentication", "reauthentication_needed") });
    expect(await reauth.s.setPassword("a-long-password")).toEqual({
      ok: false,
      msg: "Supabase wants a fresh sign-in before a password change. Sign out, sign in again with an email link, then set it straight away.",
    });
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

  it("makes a key for this phone and hands it to the worker", async () => {
    const { s, calls } = withKeys();
    gymSync.requestBackground.mockResolvedValue({ available: true, allowed: true });
    expect(await turnOnBackground(s)).toBe("Background sync is on. Gym Log reads Health Connect about every hour, even when it’s closed.");
    expect(deviceName()).toMatch(/^android-[0-9a-f]{8}$/);
    expect(calls).toEqual([["rpc", "create_health_sync_key", { device_name: deviceName() }]]);
    expect(gymSync.enable).toHaveBeenCalledWith({ key: "k".repeat(64), url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  });

  it("keeps the phone's name, so a new key replaces its old one", () => {
    expect(deviceName()).toBe(deviceName());
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

describe("Continue with Google in the app", () => {
  /** A signed-out store whose Supabase client records ID-token sign-ins and answers with `error`. */
  function withIdToken(error: unknown = null) {
    const s = new GymStore(), calls: unknown[] = [];
    s.sb = { auth: { signInWithIdToken: async (o: unknown) => (calls.push(o), { error }) } } as unknown as GymStore["sb"];
    return { s, calls };
  }
  beforeEach(() => googleSignIn.signIn.mockReset());

  it("hashes the nonce for Google, and gives Supabase the nonce itself with Google's token", async () => {
    const { s, calls } = withIdToken();
    googleSignIn.signIn.mockResolvedValue({ idToken: "google-id-token", email: "g@example.com" });
    expect(await signInWithGoogle(s)).toBe("");
    const asked = googleSignIn.signIn.mock.calls[0][0] as { webClientId: string; nonce: string };
    const sent = calls[0] as { provider: string; token: string; nonce: string };
    expect(sent.provider).toBe("google");
    expect(sent.token).toBe("google-id-token");
    expect(sent.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(asked.nonce).toBe(createHash("sha256").update(sent.nonce).digest("hex"));
    // A new nonce each time.
    await signInWithGoogle(s);
    expect((calls[1] as { nonce: string }).nonce).not.toBe(sent.nonce);
  });

  it("says nothing when you cancel, and what to do with no Google account on the phone", async () => {
    const { s, calls } = withIdToken();
    googleSignIn.signIn.mockRejectedValueOnce(Object.assign(new Error("Cancelled"), { code: "cancelled" }));
    expect(await signInWithGoogle(s)).toBe("");
    googleSignIn.signIn.mockRejectedValueOnce(Object.assign(new Error("No Google account on this phone"), { code: "no_account" }));
    expect(await signInWithGoogle(s)).toBe("There’s no Google account on this phone. Add one in the phone’s Settings → Accounts, or sign in with your email.");
    googleSignIn.signIn.mockRejectedValueOnce(Object.assign(new Error("Network error."), { code: "failed" }));
    expect(await signInWithGoogle(s)).toBe("Couldn’t sign in with Google: Network error. Try again, or sign in with your email.");
    expect(calls).toEqual([]);
  });

  it("explains when Supabase refuses the token", async () => {
    googleSignIn.signIn.mockResolvedValue({ idToken: "t", email: "g@example.com" });
    const off = withIdToken(Object.assign(new Error("Provider (issuer \"https://accounts.google.com\") is not enabled"), { code: "provider_disabled" }));
    expect(await signInWithGoogle(off.s)).toBe("Google sign-in isn’t switched on yet. Sign in with your email for now.");
    const bad = withIdToken(Object.assign(new Error("Nonces mismatch."), { code: "bad_oauth_callback" }));
    expect(await signInWithGoogle(bad.s)).toBe("Couldn’t sign in with Google: Nonces mismatch. Try again, or sign in with your email.");
  });
});

describe("Continue with Google on the website", () => {
  it("goes to Google's page and back to this page", async () => {
    vi.stubGlobal("location", { origin: "https://gym-log-omega-seven.vercel.app", pathname: "/" });
    const s = new GymStore(), calls: unknown[] = [];
    s.sb = { auth: { signInWithOAuth: async (o: unknown) => (calls.push(o), { error: null }) } } as unknown as GymStore["sb"];
    expect(await s.signInWithGoogle()).toBe("");
    expect(calls).toEqual([{ provider: "google", options: { redirectTo: "https://gym-log-omega-seven.vercel.app/" } }]);
  });
});

describe("signing out", () => {
  it("lets the app tidy up first, while the session still works, whatever goes wrong there", async () => {
    const s = new GymStore(), order: string[] = [];
    s.sb = { auth: { signOut: async () => void order.push("signed out") } } as unknown as GymStore["sb"];
    s.onSignOut(async () => void order.push("background sync off"));
    s.onSignOut(async () => {
      throw new Error("offline");
    });
    await s.signOut();
    expect(order).toEqual(["background sync off", "signed out"]);
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
