"use client";
import { useId } from "react";

export type RingTone = "steps" | "active" | "energy";
export interface RingValue {
  tone: RingTone;
  value: number;
  goal: number;
}

/** Box, radii (outer to inner) and stroke for each place the rings show (ActivityRings spec). */
const SIZES = {
  home: { box: 124, radii: [55, 41, 27], stroke: 11, arrows: true },
  health: { box: 136, radii: [61, 46, 31], stroke: 12, arrows: true },
  inline: { box: 58, radii: [25, 17.5, 10], stroke: 6, arrows: false },
} as const;

/** How far round a ring is, in percent of its goal: up to 200 (a full second lap). */
export const ringPct = (value: number, goal: number) => (goal > 0 ? Math.max(0, Math.min(200, (value / goal) * 100)) : 0);

/**
 * Steps (outer), active time and active calories (inner) as concentric rings, each a gradient arc from 12 o'clock
 * over a 16% track of its own colour. Past 100% a ring goes round again in its end colour, with a soft shadow under
 * the tip so the overlap reads as a second lap. The accessible name gives each percentage; the numbers themselves
 * sit beside the rings in a legend, so the rings never carry a value alone.
 */
export function ActivityRings({ rings, size = "home", label }: { rings: RingValue[]; size?: keyof typeof SIZES; label: string }) {
  const id = useId().replace(/:/g, "");
  const s = SIZES[size], c = s.box / 2;
  return (
    <svg className="rings" width={s.box} height={s.box} viewBox={`0 0 ${s.box} ${s.box}`} role="img" aria-label={label}>
      <defs>
        <filter id={`${id}tip`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="1.6" style={{ floodColor: "var(--ring-tip-shadow)" }} />
        </filter>
        {rings.map((r) => (
          <linearGradient key={r.tone} id={`${id}${r.tone}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: `var(--${r.tone}-start)` }} />
            <stop offset="1" style={{ stopColor: `var(--${r.tone}-end)` }} />
          </linearGradient>
        ))}
      </defs>
      {rings.map((r, i) => {
        const rad = s.radii[i], pct = ringPct(r.value, r.goal), y = c - rad;
        const k = s.box / 124; // the start arrow scales with the ring's size
        return (
          <g key={r.tone}>
            <circle cx={c} cy={c} r={rad} fill="none" strokeWidth={s.stroke} className="ring-track" style={{ stroke: `var(--${r.tone}-end)` }} />
            {pct > 0 ? (
              <circle
                className="ring-arc"
                cx={c}
                cy={c}
                r={rad}
                fill="none"
                stroke={`url(#${id}${r.tone})`}
                strokeWidth={s.stroke}
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray={`${Math.min(100, pct).toFixed(1)} 100`}
                transform={`rotate(-90 ${c} ${c})`}
              />
            ) : null}
            {pct > 100 ? (
              <circle
                className="ring-arc"
                cx={c}
                cy={c}
                r={rad}
                fill="none"
                strokeWidth={s.stroke}
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray={`${(pct - 100).toFixed(1)} 100`}
                transform={`rotate(-90 ${c} ${c})`}
                filter={`url(#${id}tip)`}
                style={{ stroke: `var(--${r.tone}-end)` }}
              />
            ) : null}
            {s.arrows ? (
              <path
                className="ring-arrow"
                d={`M${(c - 3.1 * k).toFixed(1)} ${y.toFixed(1)}h${(6.2 * k).toFixed(1)}M${(c + 0.3 * k).toFixed(1)} ${(y - 3.1 * k).toFixed(1)}l${(3.1 * k).toFixed(1)} ${(3.1 * k).toFixed(1)}-${(3.1 * k).toFixed(1)} ${(3.1 * k).toFixed(1)}`}
                fill="none"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

const DOT: Record<RingTone, string> = { steps: "var(--steps)", active: "var(--active)", energy: "var(--energy)" };

/** The rings' legend: a dot in the metric's colour, its name, then the value against the goal. */
export function RingLegend({ rows }: { rows: { tone: RingTone; name: string; value: string; goal: string; id?: string; href?: string; onOpen?: () => void }[] }) {
  return (
    <div className="ring-leg">
      {rows.map((r) => {
        const body = (
          <>
            <span className="dot" style={{ background: DOT[r.tone] }} aria-hidden="true" />
            <span>
              <span className="l">{r.name}</span>
              <span className="v">
                {r.value}
                <span className="u"> / {r.goal}</span>
              </span>
            </span>
          </>
        );
        return r.href && r.onOpen ? (
          <a
            key={r.tone}
            className="ring-it"
            id={r.id}
            href={r.href}
            onClick={(ev) => {
              if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
              ev.preventDefault();
              r.onOpen!();
            }}
          >
            {body}
          </a>
        ) : (
          <div key={r.tone} className="ring-it" id={r.id}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
