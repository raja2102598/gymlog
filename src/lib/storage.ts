/* The phone keeps a copy of everything, so the app opens offline and edits survive poor signal. */

export const CACHE_KEY = "gymlog.cache.v1";
export const PENDING_KEY = "gymlog.pending.v1";
export const PLAN_KEY = "gymlog.plan.v1";
export const HEALTH_KEY = "gymlog.health.v1";
/** The rest timer: this phone only, never synced (a timer only means something where you're lifting). */
export const REST_KEY = "gymlog.rest.v1";

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Keeps `value` on the phone. False when it couldn't: storage full, or blocked (as in some private windows). */
export function lsSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Takes `key` off the phone, as if it had never been kept. */
export function lsDel(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* blocked storage: nothing was kept to take off */
  }
}

export const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
