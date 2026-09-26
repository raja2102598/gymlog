"use client";
import { useId } from "react";
import { useOnScreen } from "@/hooks/useOnScreen";
import { cx } from "@/lib/cx";
import { heartRing, type Heart } from "@/lib/heart";

export type RingTone = "steps" | "active" | "energy";
export interface RingValue {
  tone: RingTone;
  value: number;
  goal: number;
}

/** Box, stroke and the gap between the hearts for each place the rings show (ActivityRings spec). */
const SIZES = {
  home: { box: 124, stroke: 10, gap: 2.5, arrows: true },
  health: { box: 136, stroke: 11, gap: 2.5, arrows: true },
  inline: { box: 58, stroke: 5, gap: 1.5, arrows: false },
} as const;
/** Each size's three hearts, worked out once. */
const HEARTS = Object.fromEntries(Object.entries(SIZES).map(([k, v]) => [k, [0, 1, 2].map((i) => heartRing(v.box, v.stroke, v.gap, i))])) as Record<keyof typeof SIZES, Heart[]>;
/** How far a second lap's shadow reaches past its round end. */
const TIP_FADE = 4;

/** How far round a ring is, in percent of its goal: up to 200 (a full second lap). */
export const ringPct = (value: number, goal: number) => (goal > 0 ? Math.max(0, Math.min(200, (value / goal) * 100)) : 0);

/**
 * Steps (outer), active time and active calories (inner) as hearts one inside the other (lib/heart.ts), each a
 * gradient line filling clockwise from the dip at the top, over a 16% track of its own colour. Past 100% a ring goes round again in its end colour, with a soft shadow under
 * the tip so the overlap reads as a second lap. They draw once they're on screen. The accessible name gives each
 * percentage; the numbers themselves sit beside the rings in a legend, so the rings never carry a value alone.
 */
export function ActivityRings({ rings, size = "home", label }: { rings: RingValue[]; size?: keyof typeof SIZES; label: string }) {
  const id = useId().replace(/:/g, "");
  const [ref, on] = useOnScreen<SVGSVGElement>();
  const s = SIZES[size], hearts = HEARTS[size];
  const tipR = s.stroke / 2 + TIP_FADE, edge = s.stroke / 2 / tipR;
  return (
    <svg ref={ref} className={cx("rings", on && "in")} width={s.box} height={s.box} viewBox={`0 0 ${s.box} ${s.box}`} role="img" aria-label={label}>
      <defs>
        {/* A second lap's shadow: dark at the edge of its round end, fading out over 4px, like the blur it replaces. */}
        <radialGradient id={`${id}tip`}>
          <stop offset={edge.toFixed(3)} style={{ stopColor: "var(--ring-tip-shadow)", stopOpacity: 0.5 }} />
          <stop offset={(edge + (1 - edge) * 0.4).toFixed(3)} style={{ stopColor: "var(--ring-tip-shadow)", stopOpacity: 0.18 }} />
          <stop offset="1" style={{ stopColor: "var(--ring-tip-shadow)", stopOpacity: 0 }} />
        </radialGradient>
        {rings.map((r) => (
          <linearGradient key={r.tone} id={`${id}${r.tone}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: `var(--${r.tone}-start)` }} />
            <stop offset="1" style={{ stopColor: `var(--${r.tone}-end)` }} />
          </linearGradient>
        ))}
      </defs>
      {rings.map((r, i) => {
        const h = hearts[i], pct = ringPct(r.value, r.goal), { x, y } = h.start;
        const k = s.box / 124; // the start arrow scales with the ring's size
        const tip = pct > 100 ? h.at((pct - 100) / 100) : null;
        return (
          <g key={r.tone}>
            <path d={h.d} fill="none" strokeWidth={s.stroke} strokeLinejoin="round" className="ring-track" style={{ stroke: `var(--${r.tone}-end)` }} />
            {pct > 0 ? (
              <path
                className="ring-arc"
                d={h.d}
                fill="none"
                stroke={`url(#${id}${r.tone})`}
                strokeWidth={s.stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={100}
                strokeDasharray={`${Math.min(100, pct).toFixed(1)} 100`}
              />
            ) : null}
            {tip ? (
              // The second lap's tip: a soft shadow just under its round end, so the overlap reads as a second lap. A
              // still shape with a gradient, rather than an SVG shadow filter, which the phone redrew on every frame
              // of the draw.
              <circle className="ring-tip" cx={tip.x} cy={tip.y} r={tipR} fill={`url(#${id}tip)`} />
            ) : null}
            {pct > 100 ? (
              <path
                className="ring-arc"
                d={h.d}
                fill="none"
                strokeWidth={s.stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={100}
                strokeDasharray={`${(pct - 100).toFixed(1)} 100`}
                style={{ stroke: `var(--${r.tone}-end)` }}
              />
            ) : null}
            {s.arrows ? (
              // Where each ring starts, in the dip at the top, and the way it fills: up and round the right lobe.
              <path
                className="ring-arrow"
                transform={`rotate(${h.startAngle.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})`}
                d={`M${(x - 3.1 * k).toFixed(1)} ${y.toFixed(1)}h${(6.2 * k).toFixed(1)}M${(x + 0.3 * k).toFixed(1)} ${(y - 3.1 * k).toFixed(1)}l${(3.1 * k).toFixed(1)} ${(3.1 * k).toFixed(1)}-${(3.1 * k).toFixed(1)} ${(3.1 * k).toFixed(1)}`}
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
