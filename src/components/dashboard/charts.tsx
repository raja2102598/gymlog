/* Small SVG charts, drawn at the width they're shown at (see useChartWidth). */
import { Fragment } from "react";
import { cx } from "@/lib/cx";
import { dm } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { dayNum } from "@/lib/stats";
import { HEAT_WORDS, type PlanModel } from "@/lib/dashboard";
import type { DayKey } from "@/lib/types";

/** The weight trend over real dates, the weigh-ins as pale dots, and an optional goal line. */
export function LineChart({ line, dots, goal, width: W }: { line: [DayKey, number][]; dots: [DayKey, number][]; goal: number | null; width: number }) {
  const H = 180, L = 40, R = 8, T = 10, B = 22;
  const n0 = dayNum(line[0][0]), n1 = dayNum(line[line.length - 1][0]);
  const vals = line.map((p) => p[1]).concat(dots.map((p) => p[1]), goal != null ? [goal] : []);
  const pad = Math.max(0.3, (Math.max(...vals) - Math.min(...vals)) * 0.1);
  const lo = Math.floor((Math.min(...vals) - pad) * 2) / 2, hi = Math.ceil((Math.max(...vals) + pad) * 2) / 2;
  const x = (k: DayKey) => (L + ((dayNum(k) - n0) * (W - L - R)) / Math.max(1, n1 - n0)).toFixed(1);
  const y = (v: number) => (T + ((hi - v) * (H - T - B)) / (hi - lo)).toFixed(1);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Body weight trend">
      {[lo, (lo + hi) / 2, hi].map((v) => (
        <Fragment key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
          <text x={L - 6} y={+y(v) + 4} textAnchor="end">
            {v.toFixed(1)}
          </text>
        </Fragment>
      ))}
      {goal != null ? (
        <>
          <line x1={L} x2={W - R} y1={y(goal)} y2={y(goal)} className="goal" />
          <text x={W - R} y={+y(goal) - 5} textAnchor="end">
            goal {goal}
          </text>
        </>
      ) : null}
      {dots.map(([k, v]) => (
        <circle key={k} cx={x(k)} cy={y(v)} r="3" className="dot" />
      ))}
      <path d={line.map(([k, v], i) => `${i ? "L" : "M"}${x(k)} ${y(v)}`).join(" ")} className="trendline" />
      <text x={L} y={H - 6}>
        {dm(line[0][0])}
      </text>
      <text x={W - R} y={H - 6} textAnchor="end">
        {dm(line[line.length - 1][0])}
      </text>
    </svg>
  );
}

interface BarProps {
  bars: [DayKey, number | null][];
  /** Reference lines as [value, label]; bars at or above the first are green. */
  lines: [number, string][];
  width: number;
  label?: string;
  /** Each bar's tooltip, and the first bar's date label. Default: weekly step averages. */
  tip?: (day: DayKey, v: number) => string;
  from?: (day: DayKey) => string;
}

/** Bars by date with reference lines: weekly step averages by default, or e.g. hours of sleep a night. */
export function BarChart({
  bars,
  lines,
  width: W,
  label = "Average daily steps by week",
  tip = (m, v) => `Week of ${dm(m)}: ${fmt(Math.round(v))} a day`,
  from = (m) => `wk of ${dm(m)}`,
}: BarProps) {
  const H = 150, L = 54, R = 8, T = 10, B = 22;
  const hi = Math.max(...bars.map(([, v]) => v || 0), ...lines.map(([v]) => v)) * 1.1;
  const bw = Math.min((W - L - R) / bars.length, 44), y = (v: number) => (T + ((hi - v) * (H - T - B)) / hi).toFixed(1);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {lines.map(([v, lab], i) => (
        <Fragment key={i}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="ref" />
          <text x={L - 6} y={+y(v) + 4} textAnchor="end">
            {lab}
          </text>
        </Fragment>
      ))}
      {bars.map(([m, v], i) =>
        v == null ? null : (
          <rect key={m} x={(L + i * bw + bw * 0.15).toFixed(1)} y={y(v)} width={(bw * 0.7).toFixed(1)} height={(H - B - +y(v)).toFixed(1)} rx="4" className={cx("wbar", v >= lines[0][0] && "met")}>
            <title>{tip(m, v)}</title>
          </rect>
        ),
      )}
      <text x={L} y={H - 6}>
        {from(bars[0][0])}
      </text>
      {bars.length > 1 ? (
        <text x={W - R} y={H - 6} textAnchor="end">
          {dm(bars[bars.length - 1][0])}
        </text>
      ) : null}
    </svg>
  );
}

export function Sparkline({ vals }: { vals: number[] }) {
  if (vals.length < 2) return <svg className="spark" viewBox="0 0 120 32" aria-hidden="true" />;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pts = vals.map((v, i) => `${((i * 116) / (vals.length - 1) + 2).toFixed(1)},${(28 - ((v - lo) * 24) / span).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 120 32" aria-hidden="true">
      <polyline points={pts} />
    </svg>
  );
}

/** Workout days as a calendar: one column per week, Monday at the top. */
export function Heatmap({ weeks, today }: { weeks: PlanModel["heat"]; today: DayKey }) {
  return (
    <>
      <div className="heat" role="img" aria-label={`Calendar of the last ${weeks.length} week${weeks.length === 1 ? "" : "s"}`}>
        {weeks.map((w) => (
          <div className="hw" key={w[0].day}>
            {w.map(({ day, cls }) => (
              <i key={day} className={cx(cls, day === today && "now")} title={`${dm(day)}: ${HEAT_WORDS[cls]}`} />
            ))}
          </div>
        ))}
      </div>
      <p className="legend">
        <i className="done" />
        all lifts <i className="part" />
        some lifts <i className="miss" />
        missed <i className="rest" />
        rest
      </p>
    </>
  );
}
