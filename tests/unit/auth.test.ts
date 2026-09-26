import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Signing in and out: email links and passwords in the Android app, Continue with Google in the app and on the website,
// signing out, and how a session signed in.
vi.mock("@capacitor/core", async () => (await import("./nativeMocks")).capacitorCore);

import { createHash } from "node:crypto";
import { APP_LOGIN_PAGE, NATIVE_SIGN_IN } from "@/lib/native";
import { GymStore, signInMethods } from "@/lib/store";
import { signInWithGoogle } from "@/native/google";
import { memoryStorage } from "./helpers";
import { googleSignIn } from "./nativeMocks";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("an email link or a password, in the Android app", () => {
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
    vi.stubGlobal("location", { origin: "https://gym-log.example", pathname: "/" });
    const s = new GymStore(), calls: unknown[] = [];
    s.sb = { auth: { signInWithOAuth: async (o: unknown) => (calls.push(o), { error: null }) } } as unknown as GymStore["sb"];
    expect(await s.signInWithGoogle()).toBe("");
    expect(calls).toEqual([{ provider: "google", options: { redirectTo: "https://gym-log.example/" } }]);
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

describe("how a session signed in", () => {
  const token = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
  it("reads the methods from the access token", () => {
    expect(signInMethods(token({ amr: [{ method: "password", timestamp: 1 }] }))).toEqual(["password"]);
    expect(signInMethods(token({ amr: [{ method: "otp", timestamp: 1 }] }))).toEqual(["otp"]);
    expect(signInMethods(token({}))).toEqual([]);
    expect(signInMethods("not-a-token")).toEqual([]);
  });
});
