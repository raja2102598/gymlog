"use client";
import { StepsBarChart } from "@/components/ds/StepsBarChart";
import { WeightTrendChart } from "@/components/ds/WeightTrendChart";
import { ChartCard, dayAxis } from "@/components/health/parts";
import { HowTo } from "@/components/exercise/HowTo";
import { useGym } from "@/hooks/useGym";
import { liftModel, type LiftModel, type Planned } from "@/lib/dashboard";
import { addDays, dm, parseKey, todayKey } from "@/lib/dates";
import { fmt } from "@/lib/format";
import type { DayKey } from "@/lib/types";

/** A point or bar on a lift's chart: its axis label, value, and the point in words. */
interface Bar {
  x: string;
  value: number | null;
  tip: string;
}
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
  const libId = store.mediaIdOf(name);
  return (
    <>
      <section className="card" id="dashLift">
        {m.planned.length ? (
          <p className="sub" id="liftPlan">
            {planWords(m.planned)}
          </p>
        ) : null}
        {m.points.length ? (
          <div className="stats3 kpis">
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
      {libId ? (
        <section className="card howto" id="liftHowTo" aria-labelledby="liftHowToH">
          <h2 className="title-sm" id="liftHowToH">
            How to do it
          </h2>
          <HowTo id={libId} name={name} />
        </section>
      ) : null}
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

function LiftTrend({ id, title, points, unit }: { id: string; title: string; points: Bar[]; unit: (v: number) => string }) {
  const vals = points.filter((p) => p.value != null) as (Bar & { value: number })[];
  const first = vals[0], last = vals[vals.length - 1];
  return (
    <ChartCard id={id} title={title} caption={last ? `Latest ${unit(last.value)}` : undefined}>
      {(w) => (
        <WeightTrendChart
          points={points.map((p) => ({ value: p.value, tip: p.tip }))}
          tone="brand"
          width={w}
          smoothed={false}
          axis={[points[0].x || "", "", points[points.length - 1].x || ""]}
          label={vals.length > 1 ? `${title}: from ${unit(first.value)} to ${unit(last.value)}.` : `${title}: ${unit(first.value)}.`}
        />
      )}
    </ChartCard>
  );
}

function LiftBars({ id, title, points, unit }: { id: string; title: string; points: Bar[]; unit: (v: number) => string }) {
  const vals = points.filter((p) => p.value != null) as (Bar & { value: number })[];
  const best = vals.reduce<(Bar & { value: number }) | null>((b, p) => (!b || p.value > b.value ? p : b), null);
  return (
    <ChartCard id={id} title={title} caption={best ? `Most ${unit(best.value)}` : undefined}>
      {(w) => <StepsBarChart bars={points} tone="brand" width={w} height={170} label={`${title}, ${vals.length} sessions${best ? `; the most was ${unit(best.value)}` : ""}.`} />}
    </ChartCard>
  );
}
