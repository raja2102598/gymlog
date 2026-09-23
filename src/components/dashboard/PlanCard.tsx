"use client";
import type { PlanModel } from "@/lib/dashboard";
import { plural } from "@/lib/format";
import type { DayKey } from "@/lib/types";
import { Heatmap } from "./charts";

/** Am I keeping the plan? */
export function PlanCard({ m, today }: { m: PlanModel; today: DayKey }) {
  const { done, planned, weeks } = m.recent;
  return (
    <section className="panel" id="dashPlan">
      <h2>Plan kept</h2>
      <div className="kpis">
        <div className="kpi">
          <div className="v num">
            {m.week.done}/{m.week.planned}
          </div>
          <div className="l">sessions this week</div>
        </div>
        <div className="kpi">
          <div className="v num">{m.streak}</div>
          <div className="l">full week{m.streak === 1 ? "" : "s"} in a row</div>
        </div>
        <div className="kpi">
          <div className="v num">{planned ? Math.round((done / planned) * 100) : 0}%</div>
          <div className="l">
            {done} of {planned} sessions {weeks > 1 ? `in ${weeks} weeks` : "this week"}
          </div>
        </div>
      </div>
      <p className="sub">
        This week: cardio on {plural(m.cardioDays, "day")}
        {m.cardioMin ? (
          <>
            {" "}
            (<span className="num">{m.cardioMin}</span> min)
          </>
        ) : null}{" "}
        · {plural(m.weighIns, "weigh-in")}
      </p>
      <Heatmap weeks={m.heat} today={today} />
    </section>
  );
}
