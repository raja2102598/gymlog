"use client";
import { useGym } from "@/hooks/useGym";
import { mondayOf } from "@/lib/dates";
import { fmt } from "@/lib/format";
import type { DayKey } from "@/lib/types";

/** Totals for the selected day's week. */
export function WeekStats({ sel }: { sel: DayKey }) {
  const store = useGym();
  const { days, done, planned } = store.weekSessions(mondayOf(sel));
  let cardio = 0, steps = 0, stepDays = 0;
  for (const k of days) {
    const e = store.entry(k);
    if (e.cardio) cardio++;
    if (e.steps != null) {
      steps += e.steps;
      stepDays++;
    }
  }
  const stats: [string, string][] = [
    [`${done}/${planned}`, "gym sessions complete"],
    [`${cardio}/7`, "cardio finishers"],
    [fmt(stepDays ? Math.round(steps / stepDays) : null), "avg steps / logged day"],
    [fmt(steps), "total steps"],
  ];
  return (
    <section className="panel">
      <h2 className="panel-h stats-h">This week so far</h2>
      <div className="stats" id="stats">
        {stats.map(([v, l]) => (
          <div className="stat" key={l}>
            <div className="v num">{v}</div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
