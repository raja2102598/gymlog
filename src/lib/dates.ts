import type { DayKey } from "./types";

export const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const pad = (n: number) => String(n).padStart(2, "0");
export const keyOf = (d: Date): DayKey => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = (): DayKey => keyOf(new Date());
export function parseKey(k: DayKey): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(k: DayKey, n: number): DayKey {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return keyOf(d);
}
/** 0 = Monday. */
export const wdIndex = (k: DayKey) => (parseKey(k).getDay() + 6) % 7;
export const mondayOf = (k: DayKey) => addDays(k, -wdIndex(k));
/** "23/09" */
export const dayMonth = (k: DayKey) => `${k.slice(8)}/${k.slice(5, 7)}`;
/** "23 Sept" */
export const dm = (k: DayKey) => parseKey(k).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const ago = (n: number) => (n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);

/** "21-27 Sept", or "28 Sept - 4 Oct" across a month end. */
export function weekLabel(mon: DayKey): string {
  const a = parseKey(mon), z = parseKey(addDays(mon, 6));
  const mo = (d: Date) => d.toLocaleDateString("en-IN", { month: "short" });
  return mo(a) === mo(z) ? `${a.getDate()}-${z.getDate()} ${mo(z)}` : `${a.getDate()} ${mo(a)} - ${z.getDate()} ${mo(z)}`;
}
