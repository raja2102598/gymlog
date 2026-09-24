"use client";
import { useChartWidth } from "@/hooks/useChartWidth";
import { useGym } from "@/hooks/useGym";
import type { HealthModel } from "@/lib/dashboard";
import { dm } from "@/lib/dates";
import { syncedWhen } from "@/lib/format";
import { hoursMin } from "@/lib/health";
import { isNative } from "@/lib/native";
import { BarChart } from "./charts";

/** How are sleep, resting heart rate and training outside the log going? From Health Connect. */
export function HealthCard({ m }: { m: HealthModel }) {
  const store = useGym();
  const [ref, width] = useChartWidth<HTMLElement>();
  return (
    <section className="panel" id="dashHealth" ref={ref}>
      <h2>Sleep, heart and workouts</h2>
      {!m.any ? (
        <p className="empty">
          {isNative()
            ? "Connect Health Connect from the menu to see sleep, resting heart rate and workouts here."
            : "Sleep, resting heart rate and workouts come from Health Connect, through the Gym Log Android app."}
        </p>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="v">{m.sleep7 != null ? hoursMin(m.sleep7) : "-"}</div>
              <div className="l">asleep a night, last 7 days{m.sleepPrev != null ? ` (week before ${hoursMin(m.sleepPrev)})` : ""}</div>
            </div>
            <div className="kpi">
              <div className="v num">{m.rhr7 != null ? Math.round(m.rhr7) : "-"}</div>
              <div className="l">resting heart rate, bpm{m.rhrPrev != null ? ` (week before ${Math.round(m.rhrPrev)})` : ""}</div>
            </div>
            <div className="kpi">
              <div className="v num">{m.workoutsWeek}</div>
              <div className="l">
                workout{m.workoutsWeek === 1 ? "" : "s"} this week{m.workoutMinWeek ? `, ${hoursMin(m.workoutMinWeek)}` : ""}
              </div>
            </div>
            <div className="kpi">
              <div className="v num">{m.kcalWeek != null ? m.kcalWeek.toLocaleString("en-IN") : "-"}</div>
              <div className="l">active kcal this week</div>
            </div>
          </div>
          {m.nights.some(([, v]) => v != null) ? (
            <BarChart
              bars={m.nights}
              lines={[[7, "7 h"]]}
              width={width}
              label="Hours asleep each night, last 14 nights"
              tip={(k, v) => `Night before ${dm(k)}: ${hoursMin(v * 60)}`}
              from={(k) => dm(k)}
            />
          ) : null}
          <p className="note">From Health Connect{store.healthSyncedAt ? `, synced by the Android app ${syncedWhen(store.healthSyncedAt)}` : ""}. Nights of 7 hours or more are green.</p>
        </>
      )}
    </section>
  );
}
