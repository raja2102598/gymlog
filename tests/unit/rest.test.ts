import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The rest timer (RAJ-35): its length, its countdown, pausing, more time, skipping, reaching zero, what a reload brings
// back, and, in the Android app, its alarm while the app is in the background and its end on the widget. The top bar
// and the plan editor's field are in tests/e2e/rest.e2e.mjs.
vi.mock("@capacitor/core", async () => (await import("./nativeMocks")).capacitorCore);
vi.mock("@capacitor/app", async () => ({ App: (await import("./nativeMocks")).app }));

import { todayKey } from "@/lib/dates";
import { mmss } from "@/lib/format";
import { DEFAULT_PLAN, normalizePlan } from "@/lib/plan";
import { GymStore, liveRest, restSecFor, type RestTimer } from "@/lib/store";
import { atWednesdayNoon, memoryStorage } from "./helpers";
import { app, restTimer, widget } from "./nativeMocks";

atWednesdayNoon();
beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { onLine: true, vibrate: vi.fn(() => true) });
});
afterEach(() => vi.unstubAllGlobals());

/** A signed-in store. */
function store() {
  const s = new GymStore();
  s.user = { id: "u" } as GymStore["user"];
  s.auth = "signedIn";
  return s;
}
const saved = () => JSON.parse(localStorage.getItem("gymlog.rest.v1")!) as { user: string; rest: RestTimer | null };

describe("rest length", () => {
  it("is the plan's default, 90 s unless changed, kept within 5 s and 10 minutes", () => {
    expect(normalizePlan({}, DEFAULT_PLAN).restSec).toBe(90);
    expect(normalizePlan({ restSec: 120 }, DEFAULT_PLAN).restSec).toBe(120);
    expect(normalizePlan({ restSec: 2 }, DEFAULT_PLAN).restSec).toBe(90);
    expect(normalizePlan({ restSec: 3600 }, DEFAULT_PLAN).restSec).toBe(90);
  });

  it("takes a lift's own override, within the same bounds, and keeps a plan with none unchanged", () => {
    const plan = normalizePlan({ restSec: 120 }, DEFAULT_PLAN), x = plan.days[0].exercises[0];
    expect(restSecFor(plan, x)).toBe(120);
    expect(restSecFor(plan, { ...x, rest: "45" })).toBe(45);
    expect(restSecFor(plan, { ...x, rest: "2" })).toBe(5);
    expect(restSecFor(plan, { ...x, rest: "9000" })).toBe(600);
    expect(restSecFor(plan, { ...x, rest: "" })).toBe(120);
    expect("rest" in normalizePlan(DEFAULT_PLAN, DEFAULT_PLAN).days[0].exercises[0]).toBe(false);
    const withRest = normalizePlan({ days: [{ name: "Push", exercises: [{ name: "Press", rest: "60" }] }] }, DEFAULT_PLAN);
    expect(withRest.days[0].exercises[0].rest).toBe("60");
  });

  it("reads as minutes and seconds, never negative", () => {
    expect([mmss(90), mmss(5), mmss(0), mmss(-3), mmss(600)]).toEqual(["1:30", "0:05", "0:00", "0:00", "10:00"]);
  });
});

describe("rest timer", () => {
  it("counts down from when a set was logged, by the clock rather than by ticks", () => {
    const s = store();
    s.startRest("2026-09-23", "Leg Press", 90);
    expect(s.rest).toMatchObject({ lift: "Leg Press", day: "2026-09-23", pausedAt: null, ended: false });
    expect(s.restRemaining()).toBe(90);
    vi.setSystemTime(new Date("2026-09-23T12:00:30")); // no timer ran: the number still follows the clock
    expect(s.restRemaining()).toBe(60);
    expect(saved()).toMatchObject({ user: "u", rest: { lift: "Leg Press" } });
  });

  it("pauses, holding what's left, and resumes from there", () => {
    const s = store();
    s.startRest("2026-09-23", "Leg Press", 90);
    vi.advanceTimersByTime(20_000);
    s.pauseRest();
    vi.advanceTimersByTime(300_000);
    expect(s.restRemaining()).toBe(70);
    expect(s.rest!.ended).toBe(false);
    s.resumeRest();
    expect(s.restRemaining()).toBe(70);
    vi.advanceTimersByTime(69_000);
    expect(s.restRemaining()).toBe(1);
  });

  it("buzzes and says so once at zero, and +30 s after that counts down again", () => {
    const s = store(), changed = vi.fn();
    s.subscribe(changed);
    s.startRest("2026-09-23", "Leg Press", 5);
    vi.advanceTimersByTime(5_200);
    expect(s.rest!.ended).toBe(true);
    expect(s.restRemaining()).toBe(0);
    expect(navigator.vibrate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(navigator.vibrate).toHaveBeenCalledTimes(1);
    s.addRestTime(30);
    expect(s.rest!.ended).toBe(false);
    expect(s.restRemaining()).toBe(30);
    vi.advanceTimersByTime(30_200);
    expect(s.rest!.ended).toBe(true);
    expect(navigator.vibrate).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalled();
  });

  it("adds time while paused too, and a new set restarts it from the full length", () => {
    const s = store();
    s.startRest("2026-09-23", "Leg Press", 90);
    s.pauseRest();
    s.addRestTime(30);
    expect(s.restRemaining()).toBe(120);
    s.startRest("2026-09-23", "Hack Squat", 60);
    expect(s.rest).toMatchObject({ lift: "Hack Squat", pausedAt: null });
    expect(s.restRemaining()).toBe(60);
  });

  it("skips without buzzing, and forgets it on this phone", () => {
    const s = store();
    s.startRest("2026-09-23", "Leg Press", 5);
    s.skipRest();
    vi.advanceTimersByTime(10_000);
    expect(s.rest).toBeNull();
    expect(navigator.vibrate).not.toHaveBeenCalled();
    expect(saved().rest).toBeNull();
  });

  it("goes on signing out, here and on this phone, so signing back in doesn't bring it back", () => {
    const s = store();
    s.startRest("2026-09-23", "Leg Press", 90);
    expect(saved().rest).not.toBeNull();
    (s as unknown as { onSignedOut(): void }).onSignedOut();
    expect(s.rest).toBeNull();
    expect(localStorage.getItem("gymlog.rest.v1")).toBeNull();
  });
});

describe("a saved rest timer, after a reload", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const timer = (o: Partial<RestTimer>): RestTimer => ({ lift: "Leg Press", day: "2026-09-23", endAt: at("2026-09-23T12:01:00"), pausedAt: null, ended: false, ...o });

  it("comes back while running, just over, or paused a little while", () => {
    expect(liveRest(timer({}))).not.toBeNull();
    expect(liveRest(timer({ endAt: at("2026-09-23T11:55:00"), ended: true }))).not.toBeNull();
    expect(liveRest(timer({ pausedAt: at("2026-09-23T11:30:00") }))).not.toBeNull();
  });

  it("doesn't come back long over, or long paused", () => {
    expect(liveRest(timer({ endAt: at("2026-09-23T11:45:00"), ended: true }))).toBeNull();
    expect(liveRest(timer({ endAt: at("2026-09-22T19:00:00"), pausedAt: at("2026-09-22T18:59:00") }))).toBeNull();
    expect(liveRest(null)).toBeNull();
  });
});

describe("in the background, in the Android app", () => {
  beforeEach(() => {
    app.forget();
    restTimer.schedule.mockClear();
    restTimer.workout.mockClear();
    restTimer.cancel.mockClear();
    widget.update.mockClear();
  });
  const appIs = (isActive: boolean) => app.fire("appStateChange", { isActive });

  it("arms the alarm for a running timer as the app goes to the background, and takes it down on coming back", async () => {
    const { syncOngoingNotifications } = await import("@/native/rest");
    const s = store();
    syncOngoingNotifications(s);
    expect(restTimer.cancel).toHaveBeenCalledTimes(1); // opening the app takes down whatever an earlier run left
    s.startRest("2026-09-23", "Leg Press", 90);
    const endAt = new Date(2026, 8, 23, 12, 1, 30).getTime();
    expect(restTimer.schedule).not.toHaveBeenCalled(); // in front, the page says "Rest over" itself
    appIs(false);
    expect(restTimer.schedule).toHaveBeenLastCalledWith({ lift: "Leg Press", endAt });
    s.setHealthLink({ state: "ok", msg: "" }); // an unrelated change: nothing sent again
    expect(restTimer.schedule).toHaveBeenCalledTimes(1);
    appIs(true);
    expect(restTimer.cancel).toHaveBeenCalledTimes(2);
    s.addRestTime(30);
    expect(restTimer.schedule).toHaveBeenCalledTimes(1);
    // Scheduled afresh each time it goes to the background, so notifications allowed in between still get this
    // timer's alert.
    appIs(false);
    expect(restTimer.schedule).toHaveBeenLastCalledWith({ lift: "Leg Press", endAt: endAt + 30_000 });
    appIs(true);
    s.pauseRest();
    appIs(false);
    expect(restTimer.schedule).toHaveBeenCalledTimes(2); // a paused timer has nothing to alert about
    expect(restTimer.cancel).toHaveBeenCalledTimes(3);
  });

  it("leaves ‘Rest over’ to the alarm when the app is in the background, and takes it down on coming back", async () => {
    const { syncOngoingNotifications } = await import("@/native/rest");
    const s = store();
    syncOngoingNotifications(s);
    s.startRest("2026-09-23", "Leg Press", 30);
    appIs(false);
    vi.advanceTimersByTime(31_000);
    expect(s.rest?.ended).toBe(true);
    expect(restTimer.cancel).toHaveBeenCalledTimes(1); // only opening the app's
    appIs(true);
    expect(restTimer.cancel).toHaveBeenCalledTimes(2);
  });

  it("never arms the alarm with the app in front, which says ‘Rest over’ itself", async () => {
    const { syncOngoingNotifications } = await import("@/native/rest");
    const s = store();
    syncOngoingNotifications(s);
    appIs(true);
    s.startRest("2026-09-23", "Leg Press", 30);
    vi.advanceTimersByTime(31_000);
    expect(s.rest?.ended).toBe(true);
    expect(restTimer.schedule).not.toHaveBeenCalled();
    appIs(false); // and going to the background after it's over has nothing to add
    expect(restTimer.schedule).not.toHaveBeenCalled();
  });

  it("shows the workout under way instead when no rest timer runs, and takes it down on coming back or when paused", async () => {
    const { syncOngoingNotifications } = await import("@/native/rest");
    const { pauseRun, runsFor, startRun } = await import("@/lib/workout");
    const s = store();
    runsFor("u");
    const started = new Date(2026, 8, 23, 11, 50).getTime();
    startRun(todayKey(), started);
    syncOngoingNotifications(s);
    appIs(false);
    expect(restTimer.workout).toHaveBeenLastCalledWith({ title: "Legs", text: "0 of 5 exercises done", since: started, forMs: 3 * 60 * 60_000 - 10 * 60_000 });
    appIs(true);
    s.startRest(todayKey(), "Leg Press", 90);
    appIs(false); // resting: the countdown, not the clock
    expect(restTimer.schedule).toHaveBeenLastCalledWith({ lift: "Leg Press", endAt: new Date(2026, 8, 23, 12, 1, 30).getTime() });
    appIs(true);
    s.skipRest();
    appIs(false); // no rest: the clock again
    expect(restTimer.workout).toHaveBeenCalledTimes(2);
    appIs(true);
    const cancels = restTimer.cancel.mock.calls.length;
    pauseRun(todayKey());
    appIs(false); // a paused clock isn't under way
    expect(restTimer.workout).toHaveBeenCalledTimes(2);
    expect(restTimer.cancel).toHaveBeenCalledTimes(cancels);
  });

  it("puts a running timer's end on the widget, and takes it off when paused", async () => {
    const { startWidget } = await import("@/native/widget");
    const s = store();
    startWidget(s);
    s.startRest(todayKey(), "Leg Press", 90);
    expect(widget.update).toHaveBeenLastCalledWith(expect.objectContaining({ restEndsAt: new Date(2026, 8, 23, 12, 1, 30).toISOString() }));
    s.pauseRest();
    expect(widget.update).toHaveBeenLastCalledWith(expect.objectContaining({ restEndsAt: null }));
  });
});
