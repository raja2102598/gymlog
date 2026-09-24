"use client";
import { ViewLink } from "@/components/ui/ViewLink";
import { useGym } from "@/hooks/useGym";
import { ago, todayKey } from "@/lib/dates";
import { signed } from "@/lib/format";
import { daysBetween, weeklyRate } from "@/lib/stats";

/** Today keeps a one-line weight trend; the chart lives in Progress. */
export function WeightLine({ onOpenDash }: { onOpenDash: () => void }) {
  const store = useGym();
  const s = store.weightSeries();
  let body;
  if (!s.length) body = <p className="empty">Log your weight to start the trend.</p>;
  else {
    const last = s[s.length - 1], rate = weeklyRate(s), lastIn = s.filter((p) => p.measured).pop()!.day;
    body = (
      <>
        <p className="sub">
          <span className="num">{last.trend.toFixed(1)} kg</span> trend
          {rate != null ? (
            <>
              , <span className="num">{signed(rate, 2)} kg</span> a week
            </>
          ) : null}{" "}
          · weighed {ago(daysBetween(lastIn, todayKey()))}
        </p>
        <ViewLink className="ghost tiny" id="toDash" href="#progress" onOpen={onOpenDash}>
          See it in Progress
        </ViewLink>
      </>
    );
  }
  return (
    <section className="panel">
      <h2 className="panel-h">Body weight</h2>
      <div id="chart">{body}</div>
    </section>
  );
}
