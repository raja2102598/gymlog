import { describe, expect, it } from "vitest";
import { heartRings, SHAPE } from "@/lib/heart";

type P = { x: number; y: number };
/** A ring's line, as many points round it. */
const outline = (h: { at: (f: number) => P }, n = 1200) => Array.from({ length: n + 1 }, (_, k) => h.at(k / n));
/** How far a point is from a line through `pts`. */
function distance(p: P, pts: P[]): number {
  let best = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    const s = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - s * dx, p.y - a.y - s * dy));
  }
  return best;
}

describe("the rings' hearts", () => {
  // The three places the rings show (ActivityRings.tsx's SIZES).
  for (const box of [124, 136, 58]) {
    const { stroke, rings } = heartRings(box), w = box / 2 - 0.5, step = SHAPE.step * w;

    it(`at ${box}px: the outer ring's edge fits the box, half a pixel in from the sides`, () => {
      const xs = outline(rings[0]).map((p) => p.x), ys = outline(rings[0]).map((p) => p.y);
      expect(Math.min(...xs) - stroke / 2).toBeCloseTo(0.5, 1);
      expect(Math.max(...xs) + stroke / 2).toBeCloseTo(box - 0.5, 1);
      expect(Math.min(...ys) - stroke / 2).toBeGreaterThan(0);
      expect(Math.max(...ys) + stroke / 2).toBeLessThan(box);
    });

    it(`at ${box}px: each ring is the same step inside the last all the way round, so the gaps are even`, () => {
      for (const i of [1, 2]) {
        const outer = outline(rings[i - 1], 1600), gaps = outline(rings[i], 300).map((p) => distance(p, outer));
        expect(Math.min(...gaps)).toBeGreaterThan(step - 0.05);
        expect(Math.max(...gaps)).toBeLessThan(step + 0.05);
      }
      // And the gap between the rings' edges is a gap, not an overlap.
      expect(step - stroke).toBeGreaterThan(0);
    });

    it(`at ${box}px: each ring starts at the dip, in the middle, and goes all the way round`, () => {
      for (const h of rings) {
        expect(h.start.x).toBeCloseTo(box / 2, 5);
        const top = Math.min(...outline(h).map((p) => p.y));
        expect(h.start.y).toBeGreaterThan(top + 0.5); // a dip: below the tops of the lobes
        expect(h.at(1).x).toBeCloseTo(h.start.x, 5);
        expect(h.at(1).y).toBeCloseTo(h.start.y, 5);
        expect(h.d.startsWith("M")).toBe(true);
      }
    });
  }
});
