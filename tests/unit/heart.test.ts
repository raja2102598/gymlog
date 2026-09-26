import { describe, expect, it } from "vitest";
import { heartRing } from "@/lib/heart";

// The three places the rings show (ActivityRings.tsx's SIZES).
const SIZES = [
  { box: 124, stroke: 10, gap: 2.5 },
  { box: 136, stroke: 11, gap: 2.5 },
  { box: 58, stroke: 5, gap: 1.5 },
];

/** The heart's outline, as many points round it. */
const outline = (h: ReturnType<typeof heartRing>) => Array.from({ length: 2001 }, (_, n) => h.at(n / 2000));
const extent = (pts: { x: number; y: number }[]) => ({
  left: Math.min(...pts.map((p) => p.x)),
  right: Math.max(...pts.map((p) => p.x)),
  top: Math.min(...pts.map((p) => p.y)),
  bottom: Math.max(...pts.map((p) => p.y)),
});

describe("the rings' hearts", () => {
  for (const { box, stroke, gap } of SIZES) {
    const hearts = [0, 1, 2].map((i) => heartRing(box, stroke, gap, i)), step = stroke + gap;

    it(`at ${box}px: fits the box, the outer line half a stroke in from its sides`, () => {
      const e = extent(outline(hearts[0]));
      expect(e.left).toBeCloseTo(stroke / 2 + 0.5, 1);
      expect(e.right).toBeCloseTo(box - stroke / 2 - 0.5, 1);
      expect(e.top).toBeGreaterThanOrEqual(stroke / 2);
      expect(e.bottom).toBeLessThanOrEqual(box - stroke / 2);
    });

    it(`at ${box}px: each heart sits a step inside the last at the top, the sides and the point`, () => {
      for (const i of [1, 2]) {
        const outer = extent(outline(hearts[i - 1])), inner = extent(outline(hearts[i]));
        expect(inner.left - outer.left).toBeCloseTo(step, 1);
        expect(outer.right - inner.right).toBeCloseTo(step, 1);
        expect(inner.top - outer.top).toBeCloseTo(step, 1);
        expect(outer.bottom - inner.bottom).toBeCloseTo(step, 1);
      }
    });

    it(`at ${box}px: starts in the dip on the middle line, heading up and right, and goes all the way round`, () => {
      for (const [i, h] of hearts.entries()) {
        expect(h.start.x).toBeCloseTo(box / 2, 5);
        // A dip: lower than the tops of the lobes either side of it.
        expect(h.start.y).toBeGreaterThan(extent(outline(h)).top + 1);
        expect(h.startAngle).toBeLessThan(0);
        expect(h.startAngle).toBeGreaterThan(-90);
        expect(h.at(1).x).toBeCloseTo(h.start.x, 5);
        expect(h.at(1).y).toBeCloseTo(h.start.y, 5);
        expect(h.d.startsWith("M")).toBe(true);
        // The next heart in dips lower by more than a stroke, so the rings never touch there.
        if (i) expect(h.start.y - hearts[i - 1].start.y - stroke).toBeGreaterThanOrEqual(1);
      }
    });
  }
});
