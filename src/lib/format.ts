/** "7,351", or "-" when there's no value. */
export const fmt = (n: number | string | null | undefined) => (n == null || n === "" ? "-" : Number(n).toLocaleString("en-IN"));

/** A number from a form field, or null when it's empty or not a number. */
export const num = (v: string | number | null | undefined): number | null => (v === "" || v == null || isNaN(+v) ? null : +v);

/** "+0.5", "−0.66" (a true minus sign), or "±0.0". */
export const signed = (v: number, dp = 1) => (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(dp);

export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
export const avg = (a: number[]) => (a.length ? sum(a) / a.length : null);

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A non-breaking space: a number stays on the same line as its "×" and unit.
const NB = "\u00a0";

/**
 * A lift's sets the way you'd say them: "10, 10, 8 × 45 kg"; "10 × 40, 8 × 45 kg" when the weight
 * changed; "50 kg" for older entries that hold only a weight; "12, 10 reps" with no weight. Lines can
 * break only after the commas.
 */
export function setsSummary(sets: { reps: number | null; kg: number | null }[]): string {
  const done = sets.filter((s) => s.reps != null || s.kg != null);
  if (!done.length) return "";
  const reps = (s: { reps: number | null }) => (s.reps == null ? "-" : String(s.reps));
  if (done.every((s) => s.reps == null)) return `${Math.max(...done.map((s) => s.kg as number))}${NB}kg`;
  const kgs = new Set(done.map((s) => s.kg));
  if (kgs.size === 1) {
    const [kg] = kgs;
    return kg == null ? `${done.map(reps).join(", ")}${NB}reps` : `${done.map(reps).join(", ")}${NB}×${NB}${kg}${NB}kg`;
  }
  return `${done.map((s) => `${reps(s)}${NB}×${NB}${s.kg ?? "-"}`).join(", ")}${NB}kg`;
}
