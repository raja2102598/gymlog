import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, todayKey, wdIndex } from "@/lib/dates";
import { DEFAULT_PLAN } from "@/lib/plan";
import { sampleDays } from "@/lib/sampleData";
import { GymStore } from "@/lib/store";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryStorage } from "./helpers";

describe("sampleDays", () => {
  const today = "2026-09-23"; // a Wednesday: Legs, in the default plan

  it("builds four weeks of history and three weeks of Health Connect data, ending today", () => {
    const { logs, health } = sampleDays(today, DEFAULT_PLAN.days);
    const days = Object.keys(logs).sort();
    expect(days.length).toBe(28);
    expect(days[0]).toBe("2026-08-27");
    expect(days[days.length - 1]).toBe(today);
    const healthDays = Object.keys(health).sort();
    expect(healthDays.length).toBe(21);
    expect(healthDays[healthDays.length - 1]).toBe(today);
  });

  it("moves with today: a week later, every date shifts a week on", () => {
    const a = sampleDays("2026-09-23", DEFAULT_PLAN.days);
    const b = sampleDays("2026-09-30", DEFAULT_PLAN.days);
    expect(Object.keys(a.logs).sort()[0]).toBe("2026-08-27");
    expect(Object.keys(b.logs).sort()[0]).toBe("2026-09-03");
  });

  it("is a pure function of today and the plan: the same inputs build the same data", () => {
    expect(sampleDays(today, DEFAULT_PLAN.days)).toEqual(sampleDays(today, DEFAULT_PLAN.days));
  });

  it("leaves today's session partway through: its last lift has one set logged, not yet done", () => {
    const { logs } = sampleDays(today, DEFAULT_PLAN.days);
    const names = DEFAULT_PLAN.days[2].exercises.map((x) => x.name); // Wed = index 2, Monday first
    const day = logs[today];
    expect(names.every((n) => day.exercises[n])).toBe(true);
    expect(names.slice(0, -1).every((n) => day.exercises[n].done)).toBe(true);
    const last = day.exercises[names[names.length - 1]];
    expect(last.done).toBe(false);
    expect(last.sets?.length).toBe(1);
  });

  it("a lift done most weeks gets heavier week to week", () => {
    const { logs } = sampleDays(today, DEFAULT_PLAN.days);
    const weights = Object.keys(logs)
      .sort()
      .map((d) => logs[d].exercises["Hack Squat"]?.kg)
      .filter((kg): kg is number => kg != null);
    expect(weights.length).toBeGreaterThan(1);
    expect(weights[weights.length - 1]).toBeGreaterThan(weights[0]);
  });

  it("a knee-sensitive session comes up sore, and the next morning's score is high too", () => {
    const { logs } = sampleDays(today, DEFAULT_PLAN.days);
    const sore = Object.keys(logs)
      .sort()
      .find((k) => logs[k].kneeAfter === 6);
    expect(sore).toBeTruthy();
    const wake = logs[addDays(sore!, 1)];
    expect(wake?.kneeWake).toBe(3);
  });

  it("rest days (no exercises in the plan) log no exercises, but can still have steps or weight", () => {
    const { logs } = sampleDays(today, DEFAULT_PLAN.days);
    const restDay = Object.keys(logs)
      .sort()
      .find((k) => DEFAULT_PLAN.days[wdIndex(k)].exercises.length === 0);
    expect(restDay).toBeTruthy();
    expect(Object.keys(logs[restDay!].exercises)).toEqual([]);
  });
});

describe("demo mode", () => {
  let phone: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T12:00:00"));
    phone = memoryStorage();
    vi.stubGlobal("localStorage", phone);
    vi.stubGlobal("navigator", { onLine: true });
    // The sign-in screen asks Supabase which ways in are on; offline here.
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
  });
  /** A store connected to a project, as the sign-in screen's is: `live` stands for its real client. */
  function signedOutStore(live: object = { auth: {} }) {
    const s = new GymStore();
    s.sb = live as SupabaseClient;
    return s;
  }
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("drops straight into a fully signed-in app, with no plan step first", () => {
    const s = new GymStore();
    s.startDemo();
    expect(s.demo).toBe(true);
    expect(s.auth).toBe("signedIn");
    expect(s.user).toBeTruthy();
    expect(s.days().length).toBe(28);
    expect(s.planStep()).toBeNull();
  });

  it("starting or leaving twice does nothing the second time", () => {
    const s = signedOutStore();
    s.startDemo();
    const days = s.days().length;
    s.startDemo();
    expect(s.days().length).toBe(days);
    s.exitDemo();
    s.exitDemo();
    expect(s.auth).toBe("signedOut");
  });

  it("leaving the demo resets to signed out, with the real client back and nothing left of the sample data", () => {
    const live = { auth: {} };
    const s = signedOutStore(live);
    s.startDemo();
    expect(s.sb).not.toBe(live);
    s.exitDemo();
    expect(s.demo).toBe(false);
    expect(s.auth).toBe("signedOut");
    expect(s.user).toBeNull();
    // Signing in next goes through the real client, not the demo's stand-in.
    expect(s.sb).toBe(live);
    expect(s.days().length).toBe(0);
    expect(s.plan).toEqual(DEFAULT_PLAN);
  });

  it("with no Supabase project in the build, leaving the demo goes back to the setup screen", () => {
    const s = new GymStore();
    s.startDemo();
    s.exitDemo();
    expect(s.auth).toBe("setup");
    expect(s.sb).toBeNull();
  });

  it("a sign-in link opened during the demo ends it, and signs in with the real client", async () => {
    const exchangeCodeForSession = vi.fn(async () => ({ error: null }));
    const s = signedOutStore({ auth: { exchangeCodeForSession } });
    s.startDemo();
    await s.finishSignIn("io.github.raja2102598.gymlog://login?code=abc");
    expect(s.demo).toBe(false);
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc", undefined);
  });

  it("writes nothing to the phone: logging a set and editing the plan stay in memory only", async () => {
    const s = new GymStore();
    s.startDemo();
    s.editDay(todayKey(), (d) => void (d.steps = 12345), true);
    s.editPlan((p) => void (p.stepGoal = 12000));
    await s.flush();
    await s.flushPlan();
    expect(phone.kept.size).toBe(0);
  });

  it("saves and loads through the fake client: ends Synced with nothing pending, and a pull changes nothing", async () => {
    const s = new GymStore();
    s.startDemo();
    const day = todayKey();
    s.editDay(day, (d) => void (d.note = "hello"), true);
    expect(s.pending[day]).toBeTruthy();
    await s.flush();
    expect(s.pending[day]).toBeUndefined();
    expect(s.status).toBe("Saved");
    expect(s.syncWaiting()).toBeNull();
    const before = JSON.stringify(s.logs);
    await s.pull();
    expect(JSON.stringify(s.logs)).toBe(before);
    expect(phone.kept.size).toBe(0);
  });

  it("logging a brand-new day, past the seeded history, saves through the insert path too", async () => {
    const s = new GymStore();
    s.startDemo();
    const tomorrow = addDays(todayKey(), 1);
    s.editDay(tomorrow, (d) => void (d.steps = 5000), true);
    await s.flush();
    expect(s.pending[tomorrow]).toBeUndefined();
    expect(s.conflicts[tomorrow]).toBeUndefined();
  });

  it("editing the same day twice in a row saves cleanly both times: there's never another device to conflict with", async () => {
    const s = new GymStore();
    s.startDemo();
    const day = todayKey();
    s.editDay(day, (d) => void (d.note = "one"), true);
    await s.flush();
    s.editDay(day, (d) => void (d.note = "two"), true);
    await s.flush();
    expect(s.logs[day].note).toBe("two");
    expect(s.pending[day]).toBeUndefined();
    expect(s.conflicts[day]).toBeUndefined();
  });

  it("pullHealth is a no-op once synced: nothing changed, so no extra re-render", async () => {
    const s = new GymStore();
    s.startDemo();
    const v = s.getVersion();
    await s.pullHealth();
    expect(s.getVersion()).toBe(v);
  });
});
