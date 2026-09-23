"use client";
import { useChartWidth } from "@/hooks/useChartWidth";
import type { StepsModel } from "@/lib/dashboard";
import { fmt } from "@/lib/format";
import { BarChart } from "./charts";

/** Am I walking enough? */
export function StepsCard({ m }: { m: StepsModel }) {
  const [ref, width] = useChartWidth<HTMLElement>();
  return (
    <section className="panel" id="dashSteps" ref={ref}>
      <h2>Steps</h2>
      <div className="kpis">
        <div className="kpi">
          <div className="v num">{m.avg7 != null ? fmt(Math.round(m.avg7)) : "-"}</div>
          <div className="l">7-day average (goal {fmt(m.goal)})</div>
        </div>
        <div className="kpi">
          <div className="v num">
            {m.atGoal}/{m.daysSoFar}
          </div>
          <div className="l">days at goal this week</div>
        </div>
      </div>
      {m.bars.some(([, v]) => v != null) ? (
        <BarChart
          bars={m.bars}
          lines={[
            [m.goal, fmt(m.goal)],
            [7000, "7,000"],
          ]}
          width={width}
        />
      ) : (
        <p className="empty">Log your daily steps on the Today screen to see weekly averages.</p>
      )}
      <p className="note">Most of the health benefit of walking is in by about 7,000 steps a day, so days between that line and your goal still count.</p>
    </section>
  );
}
