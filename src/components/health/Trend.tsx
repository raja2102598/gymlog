"use client";
import { Fragment, useRef, type KeyboardEvent } from "react";
import { cx } from "@/lib/cx";
import { trendScale } from "@/lib/scale";
import type { Bar } from "./Bars";

interface Props {
  points: Bar[];
  color: string;
  width: number;
  fmt: (v: number) => string;
  label: string;
  selected: number;
  onSelect: (i: number) => void;
  /** Keep the range at least this wide, so a steady line isn't drawn as a jagged one. */
  minSpan?: number;
}

/**
 * A measurement over days (resting heart rate, HRV, weight): a 2px line through the days that have one, across
 * the days between (a weigh-in every other day is still one line), and a dot on each. Picking and the table work
 * as in Bars.
 */
export function Trend({ points, color, width: W, fmt, label, selected, onSelect, minSpan = 4 }: Props) {
  const H = 164, L = 44, R = 12, T = 12, B = 24;
  const { lo, hi, ticks } = trendScale(points.map((p) => p.value).filter((v): v is number => v != null), minSpan);
  const slot = (W - L - R) / points.length;
  const x = (i: number) => L + i * slot + slot / 2;
  const y = (v: number) => T + ((hi - v) * (H - B - T)) / (hi - lo);
  const dot = slot < 14 ? 3 : 4; // smaller dots when a month's days are close together
  const d = points
    .map((p, i) => (p.value == null ? null : `${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`))
    .filter(Boolean)
    .map((xy, j) => `${j ? "L" : "M"}${xy}`)
    .join("");
  const hits = useRef<(SVGRectElement | null)[]>([]);
  const key = (ev: KeyboardEvent, i: number) => {
    const to = ev.key === "ArrowRight" ? i + 1 : ev.key === "ArrowLeft" ? i - 1 : ev.key === "Home" ? 0 : ev.key === "End" ? points.length - 1 : null;
    if (to == null || to < 0 || to >= points.length) return;
    ev.preventDefault();
    onSelect(to);
    hits.current[to]?.focus();
  };
  return (
    <>
      <svg className="hchart" viewBox={`0 0 ${W} ${H}`} style={{ ["--c" as string]: color }} role="group" aria-label={label}>
        {ticks.map((v) => (
          <Fragment key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="tk">
              {fmt(v)}
            </text>
          </Fragment>
        ))}
        <path d={d} className="line" />
        {points.map((p, i) => (p.value == null ? null : <circle key={i} cx={x(i)} cy={y(p.value)} r={(i === selected ? 1.5 : 0) + dot} className={cx("dot", i === selected && "on")} />))}
        {points.map((p, i) =>
          p.x ? (
            <text key={i} x={i === points.length - 1 && points.length > 7 ? W - R : x(i)} y={H - 6} textAnchor={i === points.length - 1 && points.length > 7 ? "end" : "middle"} className={cx("tk", i === selected && "on")}>
              {p.x}
            </text>
          ) : null,
        )}
        {points.map((p, i) => (
          <rect
            key={i}
            ref={(el) => {
              hits.current[i] = el;
            }}
            className="hit"
            x={L + i * slot}
            y={T}
            width={slot}
            height={H - B - T}
            role="button"
            tabIndex={i === selected ? 0 : -1}
            aria-label={p.tip}
            aria-pressed={i === selected}
            onClick={() => onSelect(i)}
            onFocus={() => onSelect(i)}
            onKeyDown={(ev) => key(ev, i)}
          />
        ))}
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td>{p.tip}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
