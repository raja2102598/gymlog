/* The phone keeps a copy of everything, so the app opens offline and edits survive poor signal. */

export const CACHE_KEY = "gymlog.cache.v1";
export const PENDING_KEY = "gymlog.pending.v1";
export const PLAN_KEY = "gymlog.plan.v1";

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
}

export const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
