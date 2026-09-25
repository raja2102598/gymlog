"use client";
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "@/lib/cx";

/** A metric's colour set for bars: steps, active time and calories have gradient pairs; the rest use their solid
 *  colour for a met goal and a faded one below it. */
export type BarTone = "steps" | "active" | "energy" | "sleep" | "water" | "heart" | "body" | "brand";

export interface BarDatum {
  /** Axis label ("Mon", "Today", "" for none). */
  x: string;
  value: number | null;
  /** The bar in words: "Mon 21 Sep · 11,475". Shown in the scrub bubble and the screen-reader table. */
  tip: string;
  /** The day still under way: outlined rather than filled. */
  today?: boolean;
}

interface Props {
  bars: BarDatum[];
  tone: BarTone;
  width: number;
  height?: number;
  /** The daily goal: a dashed success line with a pill ("10k") at its right end. Bars at or over it are "met". */
  goal?: { value: number; short: string } | null;
  /** One sentence saying what the chart shows: its accessible name. */
  label: string;
  /** Text in the scrub bubble for a bar; its tip by default. */
  bubble?: (b: BarDatum) => string;
  /** Hears the bar picked by a press, drag or arrow key (null when released). */
  onPick?: (i: number | null) => void;
}

/**
 * The capsule bar chart (StepsBarChart spec): 22px capsules on a line-strong baseline, scaled to about 120% of the
 * goal; goal-met days in the gradient, days below it muted, today outlined; a dashed goal line with its pill. Press
 * and drag (or focus and arrow keys) moves a dashed guide and a value bubble over the bars; letting go hides it.
 * The bars grow from the baseline on open, except under reduce-motion.
 */
export function StepsBarChart({ bars, tone, width: W, height: H = 210, goal, label, bubble = (b) => b.tip, onPick }: Props) {
  const id = useId().replace(/:/g, "");
  const [pick, setPick] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const base = H - 29, top = 24, pillW = goal ? 34 : 0;
  const plotR = W - (goal ? pillW + 4 : 0);
  const max = Math.max(1, ...bars.map((b) => b.value ?? 0), goal ? goal.value * 1.2 : 0);
  const y = (v: number) => base - ((base - top - 8) * v) / max;
  const slot = plotR / bars.length, bw = Math.max(4, Math.min(22, slot * 0.62));
  const cxOf = (i: number) => slot * i + slot / 2;
  const every = bars.length > 14 ? 7 : bars.length > 8 ? 2 : 1;
  const choose = (i: number | null) => {
    if (i === pick) return;
    setPick(i);
    onPick?.(i);
    if (i != null && "vibrate" in navigator) navigator.vibrate?.(4);
  };
  const at = (ev: PointerEvent<SVGSVGElement>) => {
    const r = svg.current!.getBoundingClientRect();
    return Math.max(0, Math.min(bars.length - 1, Math.floor(((ev.clientX - r.left) / r.width) * (W / slot))));
  };
  const key = (ev: KeyboardEvent) => {
    // Only the chart's own keys: Tab and the rest go on as usual.
    if (!["ArrowRight", "ArrowLeft", "Home", "End", "Escape"].includes(ev.key)) return;
    const cur = pick ?? bars.length - 1;
    const to = ev.key === "ArrowRight" ? cur + 1 : ev.key === "ArrowLeft" ? cur - 1 : ev.key === "Home" ? 0 : ev.key === "End" ? bars.length - 1 : ev.key === "Escape" ? null : cur;
    if (to === cur && pick != null) return;
    ev.preventDefault();
    choose(to == null ? null : Math.max(0, Math.min(bars.length - 1, to)));
  };
  const p = pick != null ? bars[pick] : null;
  const bx = pick != null ? cxOf(pick) : 0, text = p ? bubble(p) : "", bubW = Math.max(64, text.length * 7 + 18);
  const bubX = Math.max(0, Math.min(W - bubW, bx - bubW / 2));
  return (
    <div className={cx("bchart", `tone-${tone}`)} role="group" aria-label={label} tabIndex={0} onKeyDown={key} onBlur={() => choose(null)}>
      <svg
        ref={svg}
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        aria-hidden="true"
        onPointerDown={(ev) => {
          (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
          choose(at(ev));
        }}
        onPointerMove={(ev) => {
          if (pick != null && ev.buttons) choose(at(ev));
        }}
        onPointerUp={() => choose(null)}
        onPointerCancel={() => choose(null)}
      >
        <defs>
          <linearGradient id={`${id}g`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" style={{ stopColor: "var(--bc-start)" }} />
            <stop offset="1" style={{ stopColor: "var(--bc-end)" }} />
          </linearGradient>
        </defs>
        <line className="bc-base" x1="0" x2={W} y1={base + 0.5} y2={base + 0.5} />
        {goal ? (
          <>
            <line className="bc-goal" x1="0" x2={plotR} y1={y(goal.value)} y2={y(goal.value)} />
            <rect className="bc-gpill" x={W - pillW} y={y(goal.value) - 10} width={pillW} height="20" rx="10" />
            <text className="bc-gtext" x={W - pillW / 2} y={y(goal.value) + 4} textAnchor="middle">
              {goal.short}
            </text>
          </>
        ) : null}
        {p ? <line className="bc-guide" x1={bx} x2={bx} y1={top} y2={base} /> : null}
        {bars.map((b, i) => {
          if (!b.value || b.value <= 0) return null;
          const h = Math.max(bw, base - y(b.value));
          const met = goal ? b.value >= goal.value : true;
          return (
            <rect
              key={i}
              className={cx("bar", b.today ? "bc-today" : met ? "bc-met" : "bc-off")}
              x={cxOf(i) - bw / 2}
              y={base - h}
              width={bw}
              height={h}
              rx={bw / 2}
              fill={!b.today && met ? `url(#${id}g)` : undefined}
            />
          );
        })}
        {bars.map((b, i) =>
          b.x && (i % every === 0 || i === bars.length - 1) ? (
            <text key={i} className={cx("bc-ax", (i === pick || b.today) && "on", b.today && "today")} x={cxOf(i)} y={H - 8} textAnchor="middle">
              {b.x}
            </text>
          ) : null,
        )}
        {p ? (
          <g className="bc-bubble">
            <rect x={bubX} y="0" width={bubW} height="24" rx="12" />
            <text x={bubX + bubW / 2} y="16" textAnchor="middle">
              {text}
            </text>
          </g>
        ) : null}
      </svg>
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>
            {bars.map((b, i) => (
              <tr key={i}>
                <td>{b.tip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A tile's mini version: 30–34px of capsules, the goal line faint and dashed, today outlined. */
export function MiniBars({ values, goal, tone }: { values: (number | null)[]; goal: number | null; tone: BarTone }) {
  const id = useId().replace(/:/g, "");
  const W = 100, H = 34, n = values.length, slot = W / n, bw = Math.min(8, slot * 0.6);
  const max = Math.max(1, ...values.map((v) => v ?? 0), goal ? goal * 1.1 : 0);
  const y = (v: number) => H - 2 - ((H - 5) * v) / max;
  return (
    <svg className={cx("mini", `tone-${tone}`)} width="100" height="34" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" style={{ stopColor: "var(--bc-start)" }} />
          <stop offset="1" style={{ stopColor: "var(--bc-end)" }} />
        </linearGradient>
      </defs>
      {goal ? <line className="mini-goal" x1="0" x2={W} y1={y(goal)} y2={y(goal)} /> : null}
      {values.map((v, i) => {
        if (!v) return null;
        const h = Math.max(bw, H - 2 - y(v)), today = i === n - 1, met = goal ? v >= goal : true;
        return (
          <rect
            key={i}
            className={cx("bar", today ? "bc-today" : met ? "bc-met" : "bc-off")}
            x={slot * i + (slot - bw) / 2}
            y={H - 2 - h}
            width={bw}
            height={h}
            rx={bw / 2}
            fill={!today && met ? `url(#${id}g)` : undefined}
          />
        );
      })}
    </svg>
  );
}

export interface RangeDatum {
  x: string;
  lo: number | null;
  hi: number | null;
  /** The dot: resting heart rate. */
  dot: number | null;
  tip: string;
  today?: boolean;
}

/** Heart rate a day as a min–max capsule at 35% with a solid dot at the resting rate (Data visualisation: range
 *  capsules). Press, drag or arrow keys read a day out in the bubble. */
export function RangeChart({ days, width: W, height: H = 190, label }: { days: RangeDatum[]; width: number; height?: number; label: string }) {
  const [pick, setPick] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const vals = days.flatMap((d) => [d.lo, d.hi, d.dot]).filter((v): v is number => v != null);
  const lo = vals.length ? Math.min(...vals) - 4 : 0, hi = vals.length ? Math.max(...vals) + 4 : 1;
  const base = H - 29, top = 28, y = (v: number) => top + ((hi - v) * (base - top)) / (hi - lo || 1);
  const slot = W / days.length, bw = Math.max(4, Math.min(14, slot * 0.5)), cxOf = (i: number) => slot * i + slot / 2;
  const every = days.length > 14 ? 7 : days.length > 8 ? 2 : 1;
  const at = (ev: PointerEvent<SVGSVGElement>) => {
    const r = svg.current!.getBoundingClientRect();
    return Math.max(0, Math.min(days.length - 1, Math.floor(((ev.clientX - r.left) / r.width) * days.length)));
  };
  const key = (ev: KeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "Escape"].includes(ev.key)) return;
    const cur = pick ?? days.length - 1;
    const to = ev.key === "ArrowRight" ? cur + 1 : ev.key === "ArrowLeft" ? cur - 1 : ev.key === "Escape" ? null : cur;
    if (to === cur && pick != null) return;
    ev.preventDefault();
    setPick(to == null ? null : Math.max(0, Math.min(days.length - 1, to)));
  };
  const p = pick != null ? days[pick] : null, bubW = p ? Math.max(64, p.tip.length * 7 + 18) : 0, bx = pick != null ? Math.max(0, Math.min(W - bubW, cxOf(pick) - bubW / 2)) : 0;
  return (
    <div className="bchart tone-heart" role="group" aria-label={label} tabIndex={0} onKeyDown={key} onBlur={() => setPick(null)}>
      <svg
        ref={svg}
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
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
        <line className="bc-base" x1="0" x2={W} y1={base + 0.5} y2={base + 0.5} />
        {p ? <line className="bc-guide" x1={cxOf(pick!)} x2={cxOf(pick!)} y1={top - 4} y2={base} /> : null}
        {days.map((d, i) => (
          <g key={i}>
            {d.lo != null && d.hi != null ? <line className="rg-cap" x1={cxOf(i)} x2={cxOf(i)} y1={y(d.hi)} y2={y(d.lo)} strokeWidth={bw} /> : null}
            {d.dot != null ? <circle className="rg-dot" cx={cxOf(i)} cy={y(d.dot)} r={Math.max(3, bw / 2.4)} /> : null}
          </g>
        ))}
        {days.map((d, i) =>
          d.x && (i % every === 0 || i === days.length - 1) ? (
            <text key={i} className={cx("bc-ax", (i === pick || d.today) && "on", d.today && "today")} x={cxOf(i)} y={H - 8} textAnchor="middle">
              {d.x}
            </text>
          ) : null,
        )}
        {p ? (
          <g className="bc-bubble">
            <rect x={bx} y="0" width={bubW} height="24" rx="12" />
            <text x={bx + bubW / 2} y="16" textAnchor="middle">
              {p.tip}
            </text>
          </g>
        ) : null}
      </svg>
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>
            {days.map((d, i) => (
              <tr key={i}>
                <td>{d.tip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
