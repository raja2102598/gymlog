"use client";
import { CaretRight } from "@phosphor-icons/react";
import { ViewLink } from "@/components/ui/ViewLink";
import { useGym } from "@/hooks/useGym";
import { hoursMin, workoutName } from "@/lib/health";
import { syncedWhen } from "@/lib/format";
import type { DayKey } from "@/lib/types";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** The day from Health Connect: sleep, resting heart rate, active calories and workouts, and a way into the Health
 *  tab for the rest. Steps and weight go in their own boxes below the lifts. Hidden when the Android app hasn't
 *  synced anything for the day. */
export function HealthToday({ sel, onOpenHealth }: { sel: DayKey; onOpenHealth: () => void }) {
  const store = useGym();
  const h = store.healthOf(sel);
  const workouts = h?.workouts ?? [];
  if (!h || !(h.sleepMin || h.restingHr || h.activeKcal || workouts.length)) return null;
  const stats: [string, string][] = [];
  if (h.sleepMin) stats.push([hoursMin(h.sleepMin), "asleep the night before"]);
  if (h.restingHr) stats.push([`${h.restingHr}`, "resting heart rate, bpm"]);
  if (h.activeKcal) stats.push([h.activeKcal.toLocaleString("en-IN"), "active kcal"]);
  if (workouts.length) stats.push([hoursMin(workouts.reduce((m, w) => m + w.min, 0)), `in ${workouts.length} workout${workouts.length === 1 ? "" : "s"}`]);
  return (
    <div className="hc" id="healthToday">
      <div className="hc-head">
        <h3>Health Connect</h3>
        {store.healthSyncedAt ? <span className="sub">synced {syncedWhen(store.healthSyncedAt)}</span> : null}
      </div>
      <div className="stats hc-stats">
        {stats.map(([v, l]) => (
          <div className="stat" key={l}>
            <div className="v">{v}</div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>
      {workouts.length ? (
        <ul className="hc-list">
          {workouts.map((w) => (
            <li key={w.start}>
              <b>{workoutName(w.type)}</b>{" "}
              <span className="sub">
                {[clock(w.start), hoursMin(w.min), w.kcal && `${w.kcal}\u00a0kcal`, w.km && `${w.km}\u00a0km`, w.source].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <ViewLink className="ghost tiny hc-more" id="toHealth" href="#health" onOpen={onOpenHealth}>
        More in Health
        <CaretRight size={16} aria-hidden="true" />
      </ViewLink>
    </div>
  );
}
