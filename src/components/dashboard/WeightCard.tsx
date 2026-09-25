"use client";
import { Fragment } from "react";
import { ViewLink } from "@/components/ui/ViewLink";
import { useChartWidth } from "@/hooks/useChartWidth";
import type { WeightModel } from "@/lib/dashboard";
import { ago, dm } from "@/lib/dates";
import { signed } from "@/lib/format";
import { WeightTrendChart } from "@/components/ds/WeightTrendChart";

/** Is the weight trend moving at the intended pace? */
export function WeightCard({ m, onSetGoal }: { m: WeightModel; onSetGoal: () => void }) {
  const [ref, width] = useChartWidth<HTMLElement>();
  return (
    <section className="card" id="dashWeightBody" ref={ref}>
      <h2 className="title-sm">Weight trend</h2>
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
            <WeightTrendChart
              points={m.series.map((p) => ({ value: p.measured ? p.weight : null, tip: `${dm(p.day)} · ${p.measured ? `${p.weight} kg` : `trend ${p.trend.toFixed(1)} kg`}` }))}
              trend={m.series.map((p) => p.trend)}
              tone="body"
              width={width}
              height={160}
              goal={m.chartGoal ?? null}
              axis={[dm(m.series[0].day), dm(m.series[Math.floor((m.series.length - 1) / 2)].day), dm(m.series[m.series.length - 1].day)]}
              label={`Body weight trend from ${dm(m.series[0].day)}: ${m.series[0].trend.toFixed(1)} kg to ${m.trend!.toFixed(1)} kg${m.chartGoal != null ? `, goal ${m.chartGoal} kg` : ""}.`}
            />
          ) : (
            <p className="empty">1 weigh-in so far. The trend line starts after a few more.</p>
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
          <ViewLink className="btn btn-sm" data-goto="pe_goalw" href="#plan" onOpen={onSetGoal}>
            Set a goal
          </ViewLink>
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
