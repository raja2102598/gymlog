"use client";
import { Fragment } from "react";
import { useChartWidth } from "@/hooks/useChartWidth";
import type { WeightModel } from "@/lib/dashboard";
import { ago, dm } from "@/lib/dates";
import { signed } from "@/lib/format";
import { LineChart } from "./charts";

/** Is the weight trend moving at the intended pace? */
export function WeightCard({ m, onSetGoal }: { m: WeightModel; onSetGoal: () => void }) {
  const [ref, width] = useChartWidth<HTMLElement>();
  return (
    <section className="panel" id="dashWeight" ref={ref}>
      <h2>Weight trend</h2>
      {!m.series.length ? (
        <p className="empty">Log your body weight on the Today screen to start the trend.</p>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="v num">{m.trend!.toFixed(1)} kg</div>
              <div className="l">trend weight · weighed {ago(m.since!)}</div>
            </div>
            <div className="kpi">
              <div className="v num">{m.rate != null ? `${signed(m.rate, 2)} kg` : "-"}</div>
              <div className="l">{m.rate != null ? `a week (${signed(m.pct!, 2)}% of body weight)` : "a week: needs 6 weigh-ins over 2 weeks"}</div>
            </div>
            <div className="kpi">
              <GoalKpi goal={m.goal!} onSetGoal={onSetGoal} />
            </div>
          </div>
          {m.changes!.length ? (
            <p className="sub">
              Change over{" "}
              {m.changes!.map(([w, v], i) => (
                <Fragment key={w}>
                  {i ? ", " : ""}
                  {w} wk <span className="num">{signed(v)} kg</span>
                </Fragment>
              ))}
            </p>
          ) : null}
          {m.series.length >= 2 ? (
            <LineChart
              line={m.series.map((p) => [p.day, p.trend])}
              dots={m.series.filter((p) => p.measured).map((p) => [p.day, p.weight])}
              goal={m.chartGoal ?? null}
              width={width}
            />
          ) : (
            <p className="empty">One weigh-in so far. The trend line starts after a few more.</p>
          )}
          {m.waist ? (
            <p className="sub">
              Waist <span className="num">{m.waist.cm} cm</span> on {dm(m.waist.day)}
              {m.waist.change ? (
                <>
                  {" "}
                  · <span className="num">{signed(m.waist.change.cm)} cm</span> since {dm(m.waist.change.since)}
                </>
              ) : null}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function GoalKpi({ goal, onSetGoal }: { goal: NonNullable<WeightModel["goal"]>; onSetGoal: () => void }) {
  switch (goal.kind) {
    case "none":
      return (
        <>
          <div className="v">-</div>
          <div className="l">no goal weight yet</div>
          <button className="ghost tiny" data-goto="pe_goalw" onClick={onSetGoal}>
            Set a goal
          </button>
        </>
      );
    case "reached":
      return (
        <>
          <div className="v">Reached</div>
          <div className="l">goal {goal.goal} kg</div>
        </>
      );
    case "date":
      return (
        <>
          <div className="v num">{dm(goal.day)}</div>
          <div className="l">goal {goal.goal} kg at this pace</div>
        </>
      );
    case "unknown":
      return (
        <>
          <div className="v">-</div>
          <div className="l">
            goal {goal.goal} kg: {goal.why}
          </div>
        </>
      );
  }
}
