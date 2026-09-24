/* Axes for the Health charts: round numbers at the gridlines, so a reading can be placed without guessing. */

/** A round top for the axis just over `v`, whose half is round too: 12,000 over 11,550, 3,000 over 2,770. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((n) => n >= f - 1e-9)! * p;
}

/** Round gridlines around the values: 1, 2 or 5 times a power of ten apart, about three gaps in all. */
export function trendScale(vals: number[], minSpan: number): { lo: number; hi: number; ticks: number[] } {
  if (!vals.length) return { lo: 0, hi: 1, ticks: [] };
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max - min < minSpan) [min, max] = [(min + max - minSpan) / 2, (min + max + minSpan) / 2];
  const raw = Math.max((max - min) / 3, 1e-6), p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  const lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi: hi > lo ? hi : lo + step, ticks };
}
