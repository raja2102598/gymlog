"use client";
import { Fragment, useRef, type KeyboardEvent } from "react";
import { cx } from "@/lib/cx";
import { niceMax } from "@/lib/scale";

export interface Bar {
  /** Axis label under the bar ("" for none, e.g. between weekly marks). */
  x: string;
  value: number | null;
  /** The bar in words, for the readout, screen readers and the table: "Wed 23 Sept: 9,206 steps". */
  tip: string;
}

interface Props {
  bars: Bar[];
  /** The metric's colour, e.g. "var(--c-steps)". */
  color: string;
  width: number;
  goal?: { value: number; label: string } | null;
  avg?: { value: number; label: string } | null;
  /** Axis numbers. */
  fmt: (v: number) => string;
  label: string;
  selected: number;
  onSelect: (i: number) => void;
}

/** The goal and average lines, named under the chart rather than on it, where they'd cross the bars. */
export function RefKey({ goal, avg }: { goal?: { label: string } | null; avg?: { label: string } | null }) {
  if (!goal && !avg) return null;
  return (
    <p className="refkey">
      {goal ? (
        <span>
          <i className="goal" aria-hidden="true" />
          {goal.label}
        </span>
      ) : null}
      {goal && avg ? " " : null}
      {avg ? (
        <span>
          <i className="avg" aria-hidden="true" />
          {avg.label}
        </span>
      ) : null}
    </p>
  );
}

/** A column with a 4px rounded top and a square foot on the baseline. */
function column(x: number, y: number, w: number, base: number): string {
  const h = base - y, r = Math.min(4, w / 2, h);
  if (h <= 0) return "";
  return `M${x} ${base}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${base}Z`;
}

/**
 * Bars by day or hour in one colour, with the goal and the average as reference lines (named in a key below).
 * Tapping a bar (or arrow keys) picks it for the readout above the chart; the values are also in a table for
 * screen readers.
 */
export function Bars({ bars, color, width: W, goal, avg, fmt, label, selected, onSelect }: Props) {
  const H = 164, L = 44, R = 8, T = 12, B = 24, base = H - B;
  const top = niceMax(Math.max(1, ...bars.map((b) => b.value ?? 0), goal?.value ?? 0, avg?.value ?? 0) * 1.05);
  const y = (v: number) => T + ((top - v) * (base - T)) / top;
  const slot = (W - L - R) / bars.length, bw = Math.max(2, Math.min(24, slot * 0.62));
  const hits = useRef<(SVGRectElement | null)[]>([]);
  const key = (ev: KeyboardEvent, i: number) => {
    const to = ev.key === "ArrowRight" ? i + 1 : ev.key === "ArrowLeft" ? i - 1 : ev.key === "Home" ? 0 : ev.key === "End" ? bars.length - 1 : null;
    if (to == null || to < 0 || to >= bars.length) return;
    ev.preventDefault();
    onSelect(to);
    hits.current[to]?.focus();
  };
  return (
    <>
      <svg className="hchart" viewBox={`0 0 ${W} ${H}`} style={{ ["--c" as string]: color }} role="group" aria-label={label}>
        {[0, top / 2, top].map((v) => (
          <Fragment key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v ? "grid" : "axis"} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="tk">
              {fmt(v)}
            </text>
          </Fragment>
        ))}
        {bars.map((b, i) =>
          b.value && b.value > 0 ? <path key={i} d={column(L + i * slot + (slot - bw) / 2, y(b.value), bw, base)} className={cx("col", i === selected && "on")} /> : null,
        )}
        {avg ? <line className="ref avg" x1={L} x2={W - R} y1={y(avg.value)} y2={y(avg.value)} /> : null}
        {goal ? <line className="ref goal" x1={L} x2={W - R} y1={y(goal.value)} y2={y(goal.value)} /> : null}
        {bars.map((b, i) =>
          b.x ? (
            <text key={i} x={i === bars.length - 1 && bars.length > 7 ? W - R : L + i * slot + slot / 2} y={H - 6} textAnchor={i === bars.length - 1 && bars.length > 7 ? "end" : "middle"} className={cx("tk", i === selected && "on")}>
              {b.x}
            </text>
          ) : null,
        )}
        {bars.map((b, i) => (
          <rect
            key={i}
            ref={(el) => {
              hits.current[i] = el;
            }}
            className="hit"
            x={L + i * slot}
            y={T}
            width={slot}
            height={base - T}
            role="button"
            tabIndex={i === selected ? 0 : -1}
            aria-label={b.tip}
            aria-pressed={i === selected}
            onClick={() => onSelect(i)}
            onFocus={() => onSelect(i)}
            onKeyDown={(ev) => key(ev, i)}
          />
        ))}
      </svg>
      <RefKey goal={goal} avg={avg} />
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {bars.map((b, i) => (
            <tr key={i}>
              <td>{b.tip}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
