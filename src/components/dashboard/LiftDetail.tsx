"use client";
import { useState } from "react";
import { Bars, type Bar } from "@/components/health/Bars";
import { ChartCard, dayAxis } from "@/components/health/parts";
import { Trend } from "@/components/health/Trend";
import { useGym } from "@/hooks/useGym";
import { liftModel, type LiftModel, type Planned } from "@/lib/dashboard";
import { addDays, dm, parseKey, todayKey } from "@/lib/dates";
import { fmt } from "@/lib/format";
import type { DayKey } from "@/lib/types";

// Progress's one accent (svg.chart .trendline, .wbar.met, .spark polyline elsewhere on this tab), not one of
// Health's per-kind colours: this isn't Health data.
const COLOR = "var(--good)";
const longDay = (k: DayKey) => parseKey(k).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
/** At most this many calendar days on a chart, ending at the last session: enough to see a trend without
 *  drawing one point a day for a lift trained for years. A lift not done in a while still shows its last
 *  active stretch, rather than mostly empty days up to today. */
const CHART_DAYS = 90;

const reps = (r: [number, number]) => `${r[0] === r[1] ? r[0] : `${r[0]}-${r[1]}`} reps`;
const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** "Part of Legs, 10-12 reps.", "Part of Pull and Upper, 10-12 reps.", or each day's range when they differ. */
function planWords(planned: Planned): string {
  const r = planned[0].reps;
  if (planned.every((p) => String(p.reps) === String(r))) return `Part of ${and(planned.map((p) => p.day))}${r ? `, ${reps(r)}` : ""}.`;
  return `Part of ${and(planned.map((p) => (p.reps ? `${p.day} (${reps(p.reps)})` : p.day)))}.`;
}

/** Every day from `from` to `to`, inclusive. DayKey strings ("YYYY-MM-DD") sort the same as the dates they
 *  name, so the range can be built without parsing them. */
function denseDays(from: DayKey, to: DayKey): DayKey[] {
  const out: DayKey[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

/**
 * One lift's own page: heaviest set, estimated 1RM and volume over its sessions, and how often it's done,
 * drawn the way the Health tab draws a metric (same axes and interaction: tap a point or bar, or arrow
 * through them, for a readout above the chart and in a table for screen readers), with the plan's rep range
 * alongside. Reached from Strength or a lift's "···" menu on Today.
 */
export function LiftDetail({ name }: { name: string }) {
  const store = useGym();
  const m = liftModel(store, todayKey(), name);
  return (
    <>
      <section className="panel" id="dashLift">
        {m.planned.length ? (
          <p className="sub" id="liftPlan">
            {planWords(m.planned)}
          </p>
        ) : null}
        {m.points.length ? (
          <div className="kpis">
            <div className="kpi">
              <div className="v num">{m.bestTop ? `${m.bestTop[1]} kg` : "-"}</div>
              <div className="l">heaviest set{m.bestTop ? `, ${dm(m.bestTop[0])}` : ""}</div>
            </div>
            <div className="kpi">
              <div className="v num">{m.bestE1rm ? `${Math.round(m.bestE1rm[1])} kg` : "-"}</div>
              <div className="l">best estimated 1RM{m.bestE1rm ? `, ${dm(m.bestE1rm[0])}` : ""}</div>
            </div>
            <div className="kpi">
              <div className="v num">{fmt(Math.round(m.volume))} kg</div>
              <div className="l">total volume lifted</div>
            </div>
            <div className="kpi">
              <div className="v num">{m.perWeek != null ? m.perWeek.toFixed(1) : "-"}</div>
              <div className="l">{m.perWeek != null ? "sessions a week on average" : "not enough sessions yet for a weekly rate"}</div>
            </div>
          </div>
        ) : (
          <p className="empty">Nothing logged for {name} yet.</p>
        )}
      </section>
      {m.points.length ? <LiftCharts points={m.points} /> : null}
    </>
  );
}

/** The three charts, each over the same run of calendar days. One with nothing to draw is left out: sets logged
 *  with reps but no weight give no heaviest set, and an old entry with only a weight gives no 1RM or volume. */
function LiftCharts({ points }: { points: LiftModel["points"] }) {
  const last = points[points.length - 1].day, winStart = addDays(last, -(CHART_DAYS - 1));
  const start = points[0].day > winStart ? points[0].day : winStart;
  const days = denseDays(start, last), axis = dayAxis(days), byDay = new Map(points.map((p) => [p.day, p]));
  const top: Bar[] = days.map((k, i) => {
    const p = byDay.get(k);
    return { x: axis[i], value: p?.top ?? null, tip: `${longDay(k)}: ${p?.top != null ? `${p.top} kg${p.topReps ? ` × ${p.topReps}` : ""}` : "no session"}` };
  });
  const e1rm: Bar[] = days.map((k, i) => {
    const p = byDay.get(k);
    return { x: axis[i], value: p?.e1rm ?? null, tip: `${longDay(k)}: ${p?.e1rm != null ? `${Math.round(p.e1rm)} kg` : "no estimate"}` };
  });
  const volume: Bar[] = days.map((k, i) => {
    const p = byDay.get(k), v = p && p.volume > 0 ? p.volume : null;
    return { x: axis[i], value: v, tip: `${longDay(k)}: ${v != null ? `${fmt(Math.round(v))} kg` : "no volume"}` };
  });
  const any = (bars: Bar[]) => bars.some((b) => b.value != null);
  return (
    <>
      {any(top) ? <LiftTrend id="liftTop" title="Heaviest set" points={top} unit={(v) => `${v} kg`} /> : null}
      {any(e1rm) ? <LiftTrend id="liftE1rm" title="Estimated 1RM" points={e1rm} unit={(v) => `${Math.round(v)} kg`} /> : null}
      {any(volume) ? <LiftBars id="liftVolume" title="Volume a session" points={volume} unit={(v) => `${fmt(Math.round(v))} kg`} /> : null}
    </>
  );
}

/** The last point with a value: where a chart's readout starts. */
const lastWith = (points: Bar[]) => points.reduce((j, p, i) => (p.value != null ? i : j), points.length - 1);

function LiftTrend({ id, title, points, unit }: { id: string; title: string; points: Bar[]; unit: (v: number) => string }) {
  const [sel, setSel] = useState(() => lastWith(points));
  return (
    <ChartCard title={title} readout={points[sel]?.tip} id={id}>
      {(w) => <Trend points={points} color={COLOR} width={w} label={title} selected={sel} onSelect={setSel} fmt={(v) => unit(v).replace(/ .*/, "")} />}
    </ChartCard>
  );
}

function LiftBars({ id, title, points, unit }: { id: string; title: string; points: Bar[]; unit: (v: number) => string }) {
  const [sel, setSel] = useState(() => lastWith(points));
  return (
    <ChartCard title={title} readout={points[sel]?.tip} id={id}>
      {(w) => <Bars bars={points} color={COLOR} width={w} label={title} selected={sel} onSelect={setSel} fmt={(v) => unit(v).replace(/ .*/, "")} />}
    </ChartCard>
  );
}
