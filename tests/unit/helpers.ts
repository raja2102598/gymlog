/* What the unit tests share: the day they're set on, days and lifts as the store keeps them, a signed-in store, and
 * the phone's storage in memory. */
import { afterEach, beforeEach, vi } from "vitest";
import { GymStore } from "@/lib/store";
import type { DayLog, LiftLog, SetLog } from "@/lib/types";

/** Wednesday 23 September 2026, as in the end-to-end tests: Legs, in the default plan. */
export const WED = "2026-09-23";
/** The Wednesday before: Legs too. */
export const LAST = "2026-09-16";
/** Default-plan Legs, in order. */
export const LEGS = ["Hack Squat", "Leg Press", "Leg Extension", "Hamstring Curl", "Calf Raise"];

/** Puts the clock at noon on WED for each test, and back after. `onlyDate` fakes the date alone, leaving timers real. */
export function atWednesdayNoon({ onlyDate = false } = {}) {
  beforeEach(() => {
    vi.useFakeTimers(onlyDate ? { toFake: ["Date"] } : undefined);
    vi.setSystemTime(new Date(`${WED}T12:00:00`));
  });
  afterEach(() => vi.useRealTimers());
}

/** A day as the store keeps it, empty but for `d`. */
export const day = (d: Partial<DayLog> = {}): DayLog => ({ exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "", ...d });
/** Working sets, [reps, kg] each. */
export const sets = (xs: [number, number][]): SetLog[] => xs.map(([reps, kg]) => ({ reps, kg }));
/** A lift done with these sets, its kg the heaviest. */
export const lift = (xs: [number, number][], more: Partial<LiftLog> = {}): LiftLog => ({ done: true, kg: Math.max(...xs.map((s) => s[1])), sets: sets(xs), ...more });

/** A store signed in to an account created on `created`, holding these days. */
export function storeWith(logs: Record<string, DayLog> = {}, created = "2026-08-26T05:00:00Z") {
  const s = new GymStore();
  s.logs = logs;
  s.user = { id: "u", created_at: created } as GymStore["user"];
  return s;
}

/** The phone's storage, in memory: `kept` is what's in it. */
export function memoryStorage() {
  const kept = new Map<string, string>();
  return { kept, getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k), clear: () => kept.clear() };
}

/** Lets promises and timers queued so far settle. */
export const flush = () => new Promise((r) => setTimeout(r, 0));
