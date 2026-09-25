"use client";
import type { ReactNode } from "react";
import { useChartWidth } from "@/hooks/useChartWidth";
import { addDays, dm, parseKey, todayKey } from "@/lib/dates";
import type { DayKey } from "@/lib/types";

/** A day with its date, for a day's own page: "Today, 25 Sept", "Yesterday, 24 Sept", "Wed, 23 Sept". */
export function dayDate(k: DayKey, t = todayKey()): string {
  const d = parseKey(k), date = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${k === t ? "Today" : k === addDays(t, -1) ? "Yesterday" : d.toLocaleDateString("en-IN", { weekday: "short" })}, ${date}`;
}

/** A day as the day switch shows it, in two lines: "Yesterday" over "24 Sept", "Wednesday" over "23 Sept". */
export function dayParts(k: DayKey, t = todayKey()): [string, string] {
  const d = parseKey(k);
  return [k === t ? "Today" : k === addDays(t, -1) ? "Yesterday" : d.toLocaleDateString("en-IN", { weekday: "long" }), d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })];
}

/** A labelled number in a stat row (a 3-up of small radius-lg tiles). */
export function Stat({ v, u, l, id, tone }: { v: ReactNode; u?: string; l: string; id?: string; tone?: string }) {
  return (
    <div className="stat" id={id}>
      <div className="v" style={tone ? { color: tone } : undefined}>
        {v}
        {u ? <span className="u"> {u}</span> : null}
      </div>
      <div className="l">{l}</div>
    </div>
  );
}

/** A card holding one chart, drawn at the card's own width: a caption, a big number, then the chart. */
export function ChartCard({ caption, value, unit, title, children, id, aside }: { caption?: ReactNode; value?: ReactNode; unit?: string; title?: string; children: (width: number) => ReactNode; id?: string; aside?: ReactNode }) {
  const [ref, width] = useChartWidth<HTMLElement>();
  return (
    <section className="card chart-card" ref={ref} id={id}>
      <div className="cc-h">
        <div className="cc-t">
          {title ? <h2 className="title-sm">{title}</h2> : null}
          {caption ? <div className="label">{caption}</div> : null}
          {value != null ? (
            <div className="cc-v">
              {value}
              {unit ? <span className="u"> {unit}</span> : null}
            </div>
          ) : null}
        </div>
        {aside}
      </div>
      {children(width)}
    </section>
  );
}

/** Axis labels for a run of days: weekday names for a week (the last "Today" when it is), otherwise every 7th date. */
export function dayAxis(days: DayKey[], t = todayKey()): string[] {
  if (days.length <= 7) return days.map((k) => (k === t ? "Today" : parseKey(k).toLocaleDateString("en-IN", { weekday: "short" })));
  return days.map((k, i) => ((days.length - 1 - i) % 7 === 0 ? (k === t ? "Today" : dm(k)) : ""));
}
