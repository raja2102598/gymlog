/* The activity rings' heart (ActivityRings.tsx): three hearts one inside the other, as the rings used to be circles.
 * A heart here is two round lobes that cross at the top, making the dip, and straight sides down to a rounded point.
 * Each ring in from the last is `step` further in at the top, the sides and the point, so the gaps between them stay
 * even there; its lobes also move a little in and down as they shrink, so they still cross, and the dip stays a
 * clear V on the inner hearts rather than flattening out. Each path starts at the dip and runs clockwise, as the
 * rings fill. */

export interface Pt {
  x: number;
  y: number;
}

type Seg = { kind: "arc"; cx: number; cy: number; r: number; from: number; sweep: number } | { kind: "line"; a: Pt; b: Pt };

export interface Heart {
  /** SVG path data, from the dip at the top, clockwise. */
  d: string;
  /** Its length, for the point along it. */
  length: number;
  /** Where it starts: the dip at the top. */
  start: Pt;
  /** Which way it starts off, in degrees clockwise from pointing right: up and to the right, round the right lobe. */
  startAngle: number;
  /** The point `frac` (0–1) of the way round from the start. */
  at: (frac: number) => Pt;
}

/** The outer heart's proportions, of its half-width: how far each lobe's centre is from the middle, how round the
 *  point is, and its height (of its width); and how much of each ring's step goes into moving the lobes in. */
export const SHAPE = { lobe: 0.42, point: 0.5, height: 0.94, shift: 0.35 };

const TAU = Math.PI * 2;
/** An angle turned clockwise (on screen, y down) from `from` to `to`, in (0, 2π]. */
const clockwise = (from: number, to: number) => {
  const s = (to - from) % TAU;
  return s <= 0 ? s + TAU : s;
};
const onCircle = (cx: number, cy: number, r: number, a: number): Pt => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Ring `i` (0 outermost) of hearts filling a `box`-sized square: `stroke` wide, `gap` apart. The outer heart's line
 * sits half a stroke (and half a pixel) in from the sides, and is centred top to bottom.
 */
export function heartRing(box: number, stroke: number, gap: number, i: number, shape = SHAPE): Heart {
  const c = box / 2, m = stroke / 2 + 0.5, w = c - m, h = 2 * w * shape.height, top0 = c - h / 2;
  const inset = i * (stroke + gap), k = shape.shift * inset;
  // The outer lobes are centred a0 either side of the middle, radius r0, touching the sides and the top. Ring i's
  // move k in and down and shrink by inset − k: still touching its own sides and top, `inset` in.
  const a0 = shape.lobe * w, r0 = w - a0;
  const a = a0 - k, r = r0 - (inset - k), cy = top0 + r0 + k;
  // The point: a circle touching the bottom, `inset` up, smaller by as much (never below half a pixel).
  const t = Math.max(0.5, shape.point * w - inset), ty = top0 + h - inset - t;
  const lobe = { x: c + a, y: cy }, tip = { x: c, y: ty };
  // The dip, where the lobes cross on the middle line.
  const dy = Math.sqrt(Math.max(0, r * r - a * a)), start = { x: c, y: cy - dy };
  // The right side: the line touching both the lobe and the point's circle, on the outside.
  const vx = tip.x - lobe.x, vy = tip.y - lobe.y, len = Math.hypot(vx, vy), th = Math.acos(Math.max(-1, Math.min(1, (r - t) / len)));
  const rot = (s: number) => ({ x: (vx * Math.cos(s * th) - vy * Math.sin(s * th)) / len, y: (vx * Math.sin(s * th) + vy * Math.cos(s * th)) / len });
  const n = [rot(1), rot(-1)].sort((u, v) => v.x - u.x)[0]; // pointing out to the right
  const side = Math.atan2(n.y, n.x), fromDip = Math.atan2(start.y - lobe.y, start.x - lobe.x);
  const pa = { x: lobe.x + r * n.x, y: lobe.y + r * n.y }, pb = { x: tip.x + t * n.x, y: tip.y + t * n.y };
  const mirror = (p: Pt): Pt => ({ x: 2 * c - p.x, y: p.y });
  const segs: Seg[] = [
    { kind: "arc", cx: lobe.x, cy: lobe.y, r, from: fromDip, sweep: clockwise(fromDip, side) },
    { kind: "line", a: pa, b: pb },
    { kind: "arc", cx: tip.x, cy: tip.y, r: t, from: side, sweep: clockwise(side, Math.PI - side) },
    { kind: "line", a: mirror(pb), b: mirror(pa) },
    { kind: "arc", cx: 2 * c - lobe.x, cy: lobe.y, r, from: Math.PI - side, sweep: clockwise(Math.PI - side, Math.PI - fromDip) },
  ];
  const lengths = segs.map((s) => (s.kind === "arc" ? s.sweep * s.r : Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)));
  const length = lengths.reduce((x, y) => x + y, 0);
  const end = (s: Seg): Pt => (s.kind === "arc" ? onCircle(s.cx, s.cy, s.r, s.from + s.sweep) : s.b);
  const d =
    `M${r2(start.x)} ${r2(start.y)}` +
    segs.map((s) => {
      const e = end(s);
      return s.kind === "line" ? `L${r2(e.x)} ${r2(e.y)}` : `A${r2(s.r)} ${r2(s.r)} 0 ${s.sweep > Math.PI ? 1 : 0} 1 ${r2(e.x)} ${r2(e.y)}`;
    }).join("") +
    "Z";
  const at = (frac: number): Pt => {
    let left = Math.min(1, Math.max(0, frac)) * length;
    for (let j = 0; j < segs.length; j++) {
      const s = segs[j];
      if (left <= lengths[j] || j === segs.length - 1) {
        const p = lengths[j] ? Math.min(1, left / lengths[j]) : 0;
        return s.kind === "arc" ? onCircle(s.cx, s.cy, s.r, s.from + s.sweep * p) : { x: s.a.x + (s.b.x - s.a.x) * p, y: s.a.y + (s.b.y - s.a.y) * p };
      }
      left -= lengths[j];
    }
    return start;
  };
  // Clockwise round the right lobe from the dip: the radius there, turned a quarter.
  const startAngle = ((fromDip + Math.PI / 2) * 180) / Math.PI;
  return { d, length, start, startAngle, at };
}
