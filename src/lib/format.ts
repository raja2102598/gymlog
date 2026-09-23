/** "7,351", or "-" when there's no value. */
export const fmt = (n: number | string | null | undefined) => (n == null || n === "" ? "-" : Number(n).toLocaleString("en-IN"));

/** A number from a form field, or null when it's empty or not a number. */
export const num = (v: string | number | null | undefined): number | null => (v === "" || v == null || isNaN(+v) ? null : +v);

/** "+0.5", "−0.66" (a true minus sign), or "±0.0". */
export const signed = (v: number, dp = 1) => (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(dp);

export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
export const avg = (a: number[]) => (a.length ? sum(a) / a.length : null);

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
