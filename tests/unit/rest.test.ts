import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The rest timer (RAJ-35): its length, its countdown, pausing, more time, skipping, reaching zero, what a reload brings
// back, and, in the Android app, its alarm while the app is in the background and its end on the widget. The top bar
// and the plan editor's field are in tests/e2e/rest.e2e.mjs.
vi.mock("@capacitor/core", async () => (await import("./nativeMocks")).capacitorCore);
vi.mock("@capacitor/app", async () => ({ App: (await import("./nativeMocks")).app }));

import { todayKey, wdIndex } from "@/lib/dates";
import { mmss } from "@/lib/format";
import { DEFAULT_PLAN, normalizePlan } from "@/lib/plan";
import { afterRest } from "@/lib/session";
import { GymStore, liveRest, restSecFor, type RestTimer } from "@/lib/store";
import type { LiftLog, SetLog } from "@/lib/types";
import { atWednesdayNoon, day, LEGS, lift, memoryStorage, sets, storeWith, WED } from "./helpers";
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

// What the lock screen's countdown and its "Rest over" say comes next (RestAlarm.kt shows it; lib/session.ts).
describe("what comes after a rest", () => {
  const legs = (exercises: Record<string, LiftLog>) => storeWith({ [WED]: day({ exercises }) });
  const after = (s: GymStore, lift: string) => afterRest(s, { day: WED, lift });
  const open = (xs: SetLog[], more: Partial<LiftLog> = {}): LiftLog => ({ done: false, kg: null, sets: xs, ...more });

  it("is the rested lift's next set while it has one to go: the set Complete set N is on", () => {
    expect(after(legs({ "Leg Press": open(sets([[12, 100]])) }), "Leg Press")).toBe("Next: set 2 of 3");
    // A warm-up isn't one of the rows; a drop set is.
    const warmedUp = open([{ reps: 10, kg: 40, type: "warmup" }, { reps: 12, kg: 100 }, { reps: 8, kg: 70, type: "drop" }]);
    expect(after(legs({ "Leg Press": warmedUp }), "Leg Press")).toBe("Next: set 3 of 3");
    // Logged out of order: the first row with no reps, not the count logged plus one.
    expect(after(legs({ "Leg Press": open([{ reps: null, kg: null }, { reps: null, kg: null }, { reps: 12, kg: 100 }]) }), "Leg Press")).toBe("Next: set 1 of 3");
    // A set added after the planned ones, which ticked it done: still that lift's.
    const added = open([...sets([[12, 100], [12, 100], [11, 100]]), { reps: null, kg: null }], { done: true });
    expect(after(legs({ "Leg Press": added }), "Leg Press")).toBe("Next: set 4 of 4");
    // The phone locked with the cursor still in a set's box: the workout is on that set, reps or not.
    const typed = legs({ "Leg Press": open([{ reps: 12, kg: 100 }, { reps: null, kg: null }, { reps: 1, kg: 100 }]) });
    typed.typeIn({ day: WED, lift: "Leg Press", set: 2 });
    expect(after(typed, "Leg Press")).toBe("Next: set 3 of 3");
    // Swapped: the rest names the lift performed.
    expect(after(legs({ "Leg Press": open(sets([[12, 100]]), { swap: "Belt Squat" }) }), "Belt Squat")).toBe("Next: set 2 of 3");
  });

  it("is a superset's next round", () => {
    const s = legs({ "Leg Extension": open(sets([[12, 40]])), "Hamstring Curl": open(sets([[10, 30]])) });
    s.plan.days[wdIndex(WED)].exercises[3].superset = true; // Hamstring Curl joins Leg Extension
    expect(after(s, "Hamstring Curl")).toBe("Next: round 2 of 3");
    s.typeIn({ day: WED, lift: "Hamstring Curl", set: 0 }); // its first round's reps still being typed
    expect(after(s, "Hamstring Curl")).toBe("Next: round 1 of 3");
  });

  it("is the workout's Next once the rested lift is through: the step after it, whatever its state, by the name it's done under", () => {
    const skip = { done: false, kg: null, skipped: true } as unknown as LiftLog;
    const s = legs({ "Leg Press": open(sets([[12, 100], [12, 100], [11, 100]])), "Leg Extension": skip });
    // Hack Squat, before it, not started: the workout's Next goes on from where it is, not back to the top.
    expect(after(s, "Leg Press")).toBe("Next: Leg Extension");
    s.logs[WED].exercises["Leg Extension"] = open([], { swap: "Sissy Squat" });
    expect(after(s, "Leg Press")).toBe("Next: Sissy Squat");
    // A superset next: both its lifts, as the workout's Next has them.
    s.plan.days[wdIndex(WED)].exercises[3].superset = true; // Hamstring Curl joins Leg Extension
    expect(after(s, "Leg Press")).toBe("Next: Sissy Squat + Hamstring Curl");
    // Ticked done after one set: the workout's Complete set 2 is still there, so the lock screen says it too.
    s.logs[WED].exercises["Leg Press"] = lift([[12, 100]]);
    expect(after(s, "Leg Press")).toBe("Next: set 2 of 3");
  });

  it("is the day's cardio after the last lift, and nothing after a free workout's", () => {
    const s = legs(Object.fromEntries(LEGS.map((n) => [n, lift([[10, 50], [10, 50], [10, 50], [10, 50]])])));
    expect(after(s, "Calf Raise")).toBe("Next: Cycling - 15-20 min");
    const free = storeWith({ [WED]: day({ free: { name: "Hotel gym", lifts: ["Leg Press"] }, exercises: { "Leg Press": lift([[12, 100], [12, 100], [12, 100]]) } }) });
    expect(after(free, "Leg Press")).toBe("");
  });
});

describe("in the background, in the Android app", () => {
  beforeEach(() => {
    app.forget();
    for (const f of Object.values(restTimer)) f.mockClear();
    widget.update.mockClear();
  });
  const appIs = (isActive: boolean) => app.fire("appStateChange", { isActive });
  // Each test's own: stopped after it, since the workout's clock tells every one still listening (workout.ts).
  let stop: (() => void) | null = null;
  afterEach(() => stop?.());
  const sync = async (s: GymStore) => (stop = (await import("@/native/rest")).syncOngoingNotifications(s));
  const NOON = new Date(2026, 8, 23, 12).getTime(), MIN = 60_000;

  it("arms the alarm for a running timer as the app goes to the background, and takes it down on coming back", async () => {
    const s = store();
    await sync(s);
    expect(restTimer.cancel).toHaveBeenCalledTimes(1); // opening the app takes down whatever an earlier run left
    s.startRest("2026-09-23", "Leg Press", 90);
    const endAt = NOON + 90_000;
    expect(restTimer.schedule).not.toHaveBeenCalled(); // in front, the page says "Rest over" itself
    appIs(false);
    expect(restTimer.schedule).toHaveBeenLastCalledWith({ lift: "Leg Press", endAt, next: "Next: set 1 of 3" });
    s.setHealthLink({ state: "ok", msg: "" }); // an unrelated change: nothing sent again
    expect(restTimer.schedule).toHaveBeenCalledTimes(1);
    appIs(true);
    expect(restTimer.cancel).toHaveBeenCalledTimes(2);
    s.addRestTime(30);
    expect(restTimer.schedule).toHaveBeenCalledTimes(1);
    // Scheduled afresh each time it goes to the background, so notifications allowed in between still get this
    // timer's alert.
    appIs(false);
    expect(restTimer.schedule).toHaveBeenLastCalledWith(expect.objectContaining({ lift: "Leg Press", endAt: endAt + 30_000 }));
    appIs(true);
    s.pauseRest();
    appIs(false);
    expect(restTimer.schedule).toHaveBeenCalledTimes(2); // a paused timer has nothing to alert about
    expect(restTimer.cancel).toHaveBeenCalledTimes(3);
  });

  it("leaves ‘Rest over’ to the alarm when the app is in the background, and takes it down on coming back", async () => {
    const s = store();
    await sync(s);
    s.startRest("2026-09-23", "Leg Press", 30);
    appIs(false);
    vi.advanceTimersByTime(31_000);
    expect(s.rest?.ended).toBe(true);
    // Nothing sent: cancelling the rest now would take its alarm down before it rang.
    expect(restTimer.cancelRest).not.toHaveBeenCalled();
    expect(restTimer.cancel).toHaveBeenCalledTimes(1); // only opening the app's
    appIs(true);
    expect(restTimer.cancel).toHaveBeenCalledTimes(2);
  });

  it("never arms the alarm with the app in front, which says ‘Rest over’ itself", async () => {
    const s = store();
    await sync(s);
    appIs(true);
    s.startRest("2026-09-23", "Leg Press", 30);
    vi.advanceTimersByTime(31_000);
    expect(s.rest?.ended).toBe(true);
    expect(restTimer.schedule).not.toHaveBeenCalled();
    appIs(false); // and going to the background after it's over has nothing to add
    expect(restTimer.schedule).not.toHaveBeenCalled();
  });

  it("shows the workout under way, with a rest's countdown over it apart, and takes it down on coming back or when paused", async () => {
    const { pauseRun, runsFor, startRun } = await import("@/lib/workout");
    const s = store();
    runsFor("u");
    startRun(todayKey(), NOON - 10 * MIN);
    await sync(s);
    appIs(false);
    expect(restTimer.workout).toHaveBeenLastCalledWith({ title: "Legs", text: "0 of 5 exercises done", chip: "0/5 done", since: NOON - 10 * MIN, forMs: 3 * 60 * MIN - 10 * MIN });
    appIs(true);
    s.startRest(todayKey(), "Leg Press", 90);
    appIs(false); // resting: the countdown too, sent after the clock, so Android puts the newer first
    expect(restTimer.workout).toHaveBeenCalledTimes(2);
    expect(restTimer.schedule).toHaveBeenLastCalledWith({ lift: "Leg Press", endAt: NOON + 90_000, next: "Next: set 1 of 3" });
    expect(restTimer.workout.mock.invocationCallOrder[1]).toBeLessThan(restTimer.schedule.mock.invocationCallOrder[0]);
    vi.advanceTimersByTime(91_000); // over out of sight: the clock was never taken down, so nothing to send again
    expect(restTimer.workout).toHaveBeenCalledTimes(2);
    expect(restTimer.cancelWorkout).not.toHaveBeenCalled();
    appIs(true);
    s.skipRest();
    appIs(false); // no rest: the clock alone
    expect(restTimer.workout).toHaveBeenCalledTimes(3);
    expect(restTimer.schedule).toHaveBeenCalledTimes(1);
    appIs(true);
    const cancels = restTimer.cancel.mock.calls.length;
    pauseRun(todayKey());
    appIs(false); // a paused clock isn't under way
    expect(restTimer.workout).toHaveBeenCalledTimes(3);
    expect(restTimer.cancel).toHaveBeenCalledTimes(cancels);
  });

  it("follows the clock changing out of sight, as reopening a workout left for hours starts it again", async () => {
    const { runsFor, startRun } = await import("@/lib/workout");
    const s = store();
    runsFor("u");
    await sync(s);
    appIs(false);
    expect(restTimer.workout).not.toHaveBeenCalled();
    startRun(todayKey()); // no change to the store: the clock's own
    expect(restTimer.workout).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Legs", since: NOON }));
  });

  it("shows what's under way when already in the background as it starts, which Android said before anything listened", async () => {
    const { runsFor, startRun } = await import("@/lib/workout");
    const s = store();
    runsFor("u");
    startRun(todayKey(), NOON - 10 * MIN);
    app.getState.mockResolvedValueOnce({ isActive: false });
    await sync(s);
    await vi.waitFor(() => expect(restTimer.workout).toHaveBeenCalledWith(expect.objectContaining({ title: "Legs", since: NOON - 10 * MIN })));
    appIs(true);
    expect(restTimer.cancel).toHaveBeenCalledTimes(2);
    // Its answer overtaken by Android's word that the app came to the front: that's the newer.
    stop?.();
    restTimer.workout.mockClear();
    let answer: (s: { isActive: boolean }) => void = () => {};
    app.getState.mockReturnValueOnce(new Promise((r) => (answer = r)));
    await sync(s);
    appIs(true);
    answer({ isActive: false });
    await vi.advanceTimersByTimeAsync(0); // lets that answer arrive
    expect(restTimer.workout).not.toHaveBeenCalled();
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
