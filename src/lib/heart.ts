/* The activity rings' heart (ActivityRings.tsx), after Samsung Health's daily activity heart: three rings one inside
 * the other, each exactly the same distance in from the last all the way round, so the gaps between them are even.
 *
 * The heart's outer edge is drawn with compass and ruler, in proportions measured from Samsung Health's: two round
 * lobes that cross at the top, making the dip; sides that are long, gentle arcs, each touching its lobe; and a round
 * point where the sides meet, touching both. A ring's line is that edge moved in: every arc keeps its centre and loses
 * the distance moved in from its radius, and at the dip, where the edge has a corner, the line rounds it with an arc
 * of that distance around the corner. So the inner rings' dips come out rounder, and their points sharper, as in
 * Samsung's. Each ring's path starts at the dip, in the middle, and runs clockwise, as the rings fill.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Heart {
  /** SVG path data, from the dip at the top, clockwise. */
  d: string;
  /** Its length, for the point along it. */
  length: number;
  /** Where it starts: the dip at the top, in the middle. */
  start: Pt;
  /** The point `frac` (0–1) of the way round from the start. */
  at: (frac: number) => Pt;
}

/**
 * The outer edge, of its half-width: how far each lobe's centre is from the middle (its radius is the rest of the
 * half-width), the radius of the sides and of the point, and the height. Then each ring's width and the step from
 * one ring's line to the next (the ring and the gap). Measured from Samsung Health's heart, whose edge is 574 px
 * wide: lobes 208 px round and 78 px either side of the middle, sides 724 px round, the point 150 px round, 513 px
 * tall; rings 35 px wide, 11 px apart.
 */
export const SHAPE = { lobe: 0.2735, side: 2.52, point: 0.52, height: 1.786, ring: 0.122, step: 0.16 };
export type HeartShape = typeof SHAPE;

/** A circular arc: its centre, radius, the angle it starts at, and how far it turns (positive: clockwise on screen). */
type Arc = { cx: number; cy: number; r: number; from: number; sweep: number };
const TAU = Math.PI * 2;
/** An angle turned clockwise (on screen, y down) from `from` to `to`, in (0, 2π]. */
const clockwise = (from: number, to: number) => {
  const s = (to - from) % TAU;
  return s <= 0 ? s + TAU : s;
};
const angle = (p: Pt, c: Pt) => Math.atan2(p.y - c.y, p.x - c.x);
const onArc = (a: Arc, s: number): Pt => ({ x: a.cx + a.r * Math.cos(a.from + a.sweep * s), y: a.cy + a.r * Math.sin(a.from + a.sweep * s) });
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Where two circles cross: the one of the two with the smaller x. */
function crossing(p: Pt, rp: number, q: Pt, rq: number): Pt {
  const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
  const along = (rp * rp - rq * rq + d * d) / (2 * d), off = Math.sqrt(Math.max(0, rp * rp - along * along));
  const mx = p.x + (along * dx) / d, my = p.y + (along * dy) / d;
  const a = { x: mx + (off * dy) / d, y: my - (off * dx) / d }, b = { x: mx - (off * dy) / d, y: my + (off * dx) / d };
  return a.x < b.x ? a : b;
}

/** A closed path through arcs, from `start`: its SVG data, length and the point along it. */
function path(start: Pt, arcs: Arc[]): Heart {
  const d =
    `M${r2(start.x)} ${r2(start.y)}` +
    arcs
      .map((q) => {
        const e = onArc(q, 1);
        return `A${r2(q.r)} ${r2(q.r)} 0 ${Math.abs(q.sweep) > Math.PI ? 1 : 0} ${q.sweep > 0 ? 1 : 0} ${r2(e.x)} ${r2(e.y)}`;
      })
      .join("") +
    "Z";
  const lengths = arcs.map((q) => q.r * Math.abs(q.sweep)), length = lengths.reduce((x, y) => x + y, 0);
  const at = (frac: number): Pt => {
    let left = Math.min(1, Math.max(0, frac)) * length;
    for (let j = 0; j < arcs.length; j++) {
      if (left <= lengths[j] || j === arcs.length - 1) return onArc(arcs[j], lengths[j] ? Math.min(1, left / lengths[j]) : 0);
      left -= lengths[j];
    }
    return start;
  };
  return { d, length, start, at };
}

/**
 * The three rings of a heart filling a `box`-sized square (outermost first), and how wide each ring's line is. The
 * outer edge comes half a pixel short of the sides, centred top to bottom.
 */
export function heartRings(box: number, shape: HeartShape = SHAPE): { stroke: number; rings: Heart[] } {
  const c = box / 2, w = c - 0.5, h = shape.height * w, top = c - h / 2;
  const a = shape.lobe * w, r = w - a, R = shape.side * w, t = shape.point * w;
  const lobe = { x: c + a, y: top + r }, tip = { x: c, y: top + h - t };
  const corner = { x: c, y: lobe.y - Math.sqrt(r * r - a * a) }; // the dip, where the lobes cross
  // The right side: a big circle holding both the lobe and the point inside it, touching each, centred out to the
  // left so it curves out to the right.
  const side = crossing(lobe, R - r, tip, R - t);
  const mirror = (p: Pt): Pt => ({ x: 2 * c - p.x, y: p.y });
  const toLobe = angle(lobe, corner), dipOnLobe = angle(corner, lobe), lobeToSide = angle(lobe, side), tipFromSide = angle(tip, side);
  const ring = (inset: number): Heart =>
    path({ x: c, y: corner.y + inset }, [
      // Round the corner at the dip, from the middle out to the right lobe: anticlockwise, as it curves the other way.
      { cx: corner.x, cy: corner.y, r: inset, from: Math.PI / 2, sweep: -(Math.PI / 2 - toLobe) },
      { cx: lobe.x, cy: lobe.y, r: r - inset, from: dipOnLobe, sweep: clockwise(dipOnLobe, lobeToSide) },
      { cx: side.x, cy: side.y, r: R - inset, from: lobeToSide, sweep: clockwise(lobeToSide, tipFromSide) },
      { cx: tip.x, cy: tip.y, r: Math.max(0.5, t - inset), from: tipFromSide, sweep: clockwise(tipFromSide, Math.PI - tipFromSide) },
      { cx: mirror(side).x, cy: side.y, r: R - inset, from: Math.PI - tipFromSide, sweep: clockwise(Math.PI - tipFromSide, Math.PI - lobeToSide) },
      { cx: mirror(lobe).x, cy: lobe.y, r: r - inset, from: Math.PI - lobeToSide, sweep: clockwise(Math.PI - lobeToSide, Math.PI - dipOnLobe) },
      { cx: corner.x, cy: corner.y, r: inset, from: Math.PI - toLobe, sweep: -(Math.PI / 2 - toLobe) },
    ]);
  const stroke = shape.ring * w, step = shape.step * w;
  return { stroke, rings: [0, 1, 2].map((i) => ring(stroke / 2 + i * step)) };
}
