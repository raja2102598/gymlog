"use client";
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "@/lib/cx";

export type TrendTone = "body" | "heart" | "sleep" | "steps" | "energy" | "water" | "active" | "brand";

export interface TrendPoint {
  value: number | null;
  /** The point in words, for the bubble and screen readers: "Tue 22 Sep · 80.8 kg". */
  tip: string;
}

/** An exponential moving average of the readings (α 0.4), carried across days with none. */
export function smooth(values: (number | null)[], alpha = 0.4): (number | null)[] {
  let s: number | null = null;
  return values.map((v) => {
    if (v != null) s = s == null ? v : alpha * v + (1 - alpha) * s;
    return v == null ? null : s;
  });
}

/** A Catmull-Rom curve through points, as cubic Béziers. */
export function catmullRom(pts: [number, number][]): string {
  if (!pts.length) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

interface Props {
  points: TrendPoint[];
  tone: TrendTone;
  width: number;
  height?: number;
  /** Three axis labels under the chart: start, middle, end ("Today"). */
  axis: [string, string, string];
  label: string;
  /** Keep the vertical range at least this wide, so a steady line isn't drawn as a jagged one. */
  minSpan?: number;
  /** A reference line, e.g. the goal weight. */
  goal?: number | null;
  /** Draw the smoothed trend (noisy daily readings), or join the readings as they are. */
  smoothed?: boolean;
  /** A trend worked out elsewhere, one value per point, drawn as it is instead of smoothing the readings here: so
   *  the line matches the numbers shown beside it. */
  trend?: (number | null)[];
}

/**
 * A noisy daily measurement (WeightTrendChart spec): faint daily dots at 45%, a smoothed Catmull-Rom trend (3px, round
 * caps) over an area fading from 28% to 0, and the latest reading highlighted on a halo. No gridlines, no y-axis:
 * three x labels. Press and drag, or arrow keys, read out a day in a bubble.
 */
export function WeightTrendChart({ points, tone, width: W, height: H = 130, axis, label, minSpan = 1, goal = null, smoothed = true, trend: given }: Props) {
  const id = useId().replace(/:/g, "");
  const [pick, setPick] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const vals = points.map((p) => p.value);
  const trend = given ?? (smoothed ? smooth(vals) : vals);
  const all = [...vals, ...trend, goal].filter((v): v is number => v != null);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const T = 12, B = 12, L = 8, R = 12;
  const x = (i: number) => L + (points.length > 1 ? (i * (W - L - R)) / (points.length - 1) : (W - L - R) / 2);
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo || 1);
  const line: [number, number][] = trend.flatMap((v, i) => (v == null ? [] : [[x(i), y(v)] as [number, number]]));
  const d = catmullRom(line);
  const lastI = vals.reduce<number>((j, v, i) => (v != null ? i : j), -1);
  const at = (ev: PointerEvent<SVGSVGElement>) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let best = -1, dist = Infinity;
    vals.forEach((v, i) => {
      if (v != null && Math.abs(x(i) - px) < dist) {
        dist = Math.abs(x(i) - px);
        best = i;
      }
    });
    return best < 0 ? null : best;
  };
  const withData = vals.flatMap((v, i) => (v != null ? [i] : []));
  const key = (ev: KeyboardEvent) => {
    const cur = pick ?? lastI, k = withData.indexOf(cur);
    const to = ev.key === "ArrowRight" ? withData[k + 1] : ev.key === "ArrowLeft" ? withData[k - 1] : ev.key === "Home" ? withData[0] : ev.key === "End" ? withData[withData.length - 1] : ev.key === "Escape" ? null : undefined;
    if (to === undefined && !(pick == null && ["ArrowRight", "ArrowLeft"].includes(ev.key))) return;
    ev.preventDefault();
    setPick(to === undefined ? cur : to);
  };
  const p = pick != null ? points[pick] : null, bw = p ? Math.max(64, p.tip.length * 7 + 18) : 0;
  const bx = pick != null ? Math.max(0, Math.min(W - bw, x(pick) - bw / 2)) : 0;
  return (
    <div className={cx("tchart", `tone-${tone}`)} role="group" aria-label={label} tabIndex={0} onKeyDown={key} onBlur={() => setPick(null)}>
      <svg
        ref={svg}
        width="100%"
        height={H + 28}
        viewBox={`0 -28 ${W} ${H + 28}`}
        aria-hidden="true"
        onPointerDown={(ev) => {
          (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
          setPick(at(ev));
        }}
        onPointerMove={(ev) => {
          if (ev.buttons && pick != null) setPick(at(ev));
        }}
        onPointerUp={() => setPick(null)}
        onPointerCancel={() => setPick(null)}
      >
        <defs>
          <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--tc)", stopOpacity: 0.28 }} />
            <stop offset="1" style={{ stopColor: "var(--tc)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {goal != null ? <line className="tc-goal" x1={L} x2={W - R} y1={y(goal)} y2={y(goal)} /> : null}
        {line.length > 1 ? <path d={`${d} L${line[line.length - 1][0].toFixed(1)},${H} L${line[0][0].toFixed(1)},${H} Z`} fill={`url(#${id}a)`} /> : null}
        {smoothed ? vals.map((v, i) => (v == null ? null : <circle key={i} className="tc-dot" cx={x(i)} cy={y(v)} r="2.5" />)) : null}
        {line.length > 1 ? <path className="tc-line" d={d} /> : null}
        {!smoothed ? vals.map((v, i) => (v == null ? null : <circle key={i} className="tc-dot solid" cx={x(i)} cy={y(v)} r="2.5" />)) : null}
        {lastI >= 0 ? (
          <>
            <circle className="tc-halo" cx={x(lastI)} cy={y(vals[lastI]!)} r="9" />
            <circle className="tc-last" cx={x(lastI)} cy={y(vals[lastI]!)} r="5" />
          </>
        ) : null}
        {p && pick != null ? (
          <>
            <line className="bc-guide" x1={x(pick)} x2={x(pick)} y1={-4} y2={H} />
            <circle className="tc-last" cx={x(pick)} cy={y(vals[pick]!)} r="4" />
            <g className="bc-bubble">
              <rect x={bx} y="-28" width={bw} height="24" rx="12" />
              <text x={bx + bw / 2} y="-12" textAnchor="middle">
                {p.tip}
              </text>
            </g>
          </>
        ) : null}
      </svg>
      <div className="tc-ax" aria-hidden="true">
        {axis.map((a, i) => (
          <span key={i}>{a}</span>
        ))}
      </div>
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>
            {points.map((pt, i) =>
              pt.value != null ? (
                <tr key={i}>
                  <td>{pt.tip}</td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
