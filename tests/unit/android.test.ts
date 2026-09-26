import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Android app starting (src/native/app.ts), and the home-screen widget (widget.ts).
vi.mock("@capacitor/core", async () => (await import("./nativeMocks")).capacitorCore);
vi.mock("@capgo/capacitor-health", async () => ({ Health: (await import("./nativeMocks")).health }));
vi.mock("@capacitor/app", async () => ({ App: (await import("./nativeMocks")).app }));

import { todayKey, wdIndex } from "@/lib/dates";
import { NATIVE_SIGN_IN } from "@/lib/native";
import { speechSupported } from "@/lib/speech";
import { GymStore } from "@/lib/store";
import { atWednesdayNoon, flush, memoryStorage } from "./helpers";
import { app, health, speech, widget } from "./nativeMocks";
import { phoneHas, signedIn } from "./phone";

atWednesdayNoon({ onlyDate: true });
beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("starting in the Android app", () => {
  it("finishes sign-in from a link, reads Health Connect once signed in, and again on coming back", async () => {
    const { startNative } = await import("@/native/app");
    const { s } = signedIn();
    s.auth = "starting";
    const signIns: string[] = [];
    s.finishSignIn = async (url: string) => void signIns.push(url);
    phoneHas();
    app.getLaunchUrl.mockResolvedValue({ url: `${NATIVE_SIGN_IN}?code=abc` });
    await startNative(s);
    expect(signIns).toEqual([`${NATIVE_SIGN_IN}?code=abc`]);
    app.fire("appUrlOpen", { url: "https://example.com/other" });
    app.fire("appUrlOpen", { url: `${NATIVE_SIGN_IN}?code=def` });
    expect(signIns).toEqual([`${NATIVE_SIGN_IN}?code=abc`, `${NATIVE_SIGN_IN}?code=def`]);
    expect(health.isAvailable).not.toHaveBeenCalled();
    s.auth = "signedIn";
    s.setHealthLink({ state: "web", msg: "" }); // any change tells listeners
    await flush();
    await flush();
    expect(health.isAvailable).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(s.healthLink.state).toBe("ok"));
    // Back in front a while later (a read is at most every 5 minutes): read again.
    vi.setSystemTime(Date.now() + 6 * 60_000);
    app.fire("resume");
    await vi.waitFor(() => expect(health.isAvailable).toHaveBeenCalledTimes(2));
    // Voice logging: the phone was asked, once, whether it can listen, and Settings and Today follow its answer.
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
    await vi.waitFor(() => expect(speechSupported()).toBe(true));
    await startNative(s);
    expect(speech.available).toHaveBeenCalledTimes(1);
  });
});

describe("home-screen widget", () => {
  beforeEach(() => {
    widget.update.mockClear();
    widget.clear.mockClear();
  });

  it("writes today's session and progress once signed in, again only when they change, and clears on sign-out", async () => {
    const { startWidget } = await import("@/native/widget");
    const s = new GymStore(), today = todayKey();
    s.plan.days[wdIndex(today)] = {
      weekday: "day",
      name: "Push day",
      focus: "",
      exercises: [{ name: "Bench press", sets: "3", reps: "8-10", cue: "", flag: "", step: "", knee: false }],
      cardio: { name: "", detail: "" },
    };
    s.auth = "starting";
    startWidget(s);
    expect(widget.update).not.toHaveBeenCalled();

    s.auth = "signedIn";
    s.setHealthLink({ state: "web", msg: "" }); // any store change tells listeners
    expect(widget.update).toHaveBeenCalledTimes(1);
    expect(widget.update).toHaveBeenCalledWith({ date: today, session: "Push day", done: 0, planned: 1, restEndsAt: null, workoutSince: null, skipped: false });

    // A change that touches neither today's session nor its lifts: no second write.
    s.setHealthLink({ state: "ok", msg: "Up to date." });
    expect(widget.update).toHaveBeenCalledTimes(1);

    // Skipping the day says so, instead of 0/1 lifts; taking the skip back undoes that.
    s.skipDay(today, "travelling");
    expect(widget.update).toHaveBeenCalledTimes(2);
    expect(widget.update).toHaveBeenLastCalledWith({ date: today, session: "Push day", done: 0, planned: 1, restEndsAt: null, workoutSince: null, skipped: true });
    s.unskipDay(today);
    expect(widget.update).toHaveBeenCalledTimes(3);
    expect(widget.update).toHaveBeenLastCalledWith({ date: today, session: "Push day", done: 0, planned: 1, restEndsAt: null, workoutSince: null, skipped: false });

    // Ticking the lift changes the count, so it writes again.
    s.editLift(today, "Bench press", (r) => (r.done = true), true);
    expect(widget.update).toHaveBeenCalledTimes(4);
    expect(widget.update).toHaveBeenLastCalledWith({ date: today, session: "Push day", done: 1, planned: 1, restEndsAt: null, workoutSince: null, skipped: false });

    // Signed out, whether by Sign out or by a session that expired or was revoked: cleared, once.
    s.auth = "signedOut";
    s.setHealthLink({ state: "off", msg: "" });
    s.setHealthLink({ state: "off", msg: "Not connected yet." });
    expect(widget.clear).toHaveBeenCalledTimes(1);

    // Signed in again, the same snapshot as before counts as new once cleared.
    s.auth = "signedIn";
    s.setHealthLink({ state: "ok", msg: "Up to date." });
    expect(widget.update).toHaveBeenCalledTimes(5);
  });

  it("shows nothing from the demo: the widget is for a real account's day", async () => {
    const { startWidget } = await import("@/native/widget");
    const s = new GymStore();
    s.auth = "signedOut";
    startWidget(s);
    s.startDemo();
    s.setHealthLink({ state: "ok", msg: "" });
    expect(s.demo).toBe(true);
    expect(widget.update).not.toHaveBeenCalled();
  });

  it("gives it a workout under way's start, for its clock, and follows the clock paused, resumed and finished", async () => {
    const { startWidget } = await import("@/native/widget");
    const { endRun, pauseRun, resumeRun, runsFor, startRun } = await import("@/lib/workout");
    const s = new GymStore(), today = todayKey();
    s.user = { id: "u" } as GymStore["user"];
    s.auth = "signedIn";
    runsFor("u");
    startWidget(s);
    const since = () => (widget.update.mock.lastCall as unknown as [{ workoutSince: string | null }] | undefined)?.[0].workoutSince;
    expect(since()).toBeNull();
    const started = new Date(2026, 8, 23, 11, 40).getTime();
    startRun(today, started); // opening the workout: no store change, but the clock's own
    expect(since()).toBe(new Date(started).toISOString());
    pauseRun(today, started + 10 * 60_000);
    expect(since()).toBeNull(); // a paused clock isn't counting
    resumeRun(today, started + 15 * 60_000);
    expect(since()).toBe(new Date(started + 5 * 60_000).toISOString()); // the five minutes paused don't count
    endRun(today, started + 30 * 60_000);
    expect(since()).toBeNull();
  });

  it("tries a write that failed again on the next change, rather than taking it as shown", async () => {
    const { startWidget } = await import("@/native/widget");
    const s = new GymStore(), today = todayKey();
    s.plan.days[wdIndex(today)] = {
      weekday: "day",
      name: "Leg day",
      focus: "",
      exercises: [{ name: "Squat", sets: "3", reps: "5", cue: "", flag: "", step: "", knee: false }],
      cardio: { name: "", detail: "" },
    };
    s.auth = "signedIn";
    widget.update.mockRejectedValueOnce(new Error("the bridge dropped it"));
    startWidget(s);
    expect(widget.update).toHaveBeenCalledTimes(1);
    await flush();

    s.setHealthLink({ state: "ok", msg: "Up to date." });
    expect(widget.update).toHaveBeenCalledTimes(2);
    expect(widget.update).toHaveBeenLastCalledWith({ date: today, session: "Leg day", done: 0, planned: 1, restEndsAt: null, workoutSince: null, skipped: false });
  });
});
