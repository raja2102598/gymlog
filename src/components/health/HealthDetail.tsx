"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { InsightCallout, SegmentedControl, StageLanes } from "@/components/ds/parts";
import { RangeChart, StepsBarChart, type BarDatum, type BarTone } from "@/components/ds/StepsBarChart";
import { WeightTrendChart, type TrendTone } from "@/components/ds/WeightTrendChart";
import { useGym } from "@/hooks/useGym";
import { addDays, dm, parseKey, todayKey } from "@/lib/dates";
import { fmt, signed } from "@/lib/format";
import { hoursMin, workoutName } from "@/lib/health";
import { clockText, dayNumbers, daysTo, goalOf, metricValue, seriesOf, sleepTimes, summarize, type DayNumbers, type Series } from "@/lib/healthView";
import type { Metric } from "@/lib/route";
import { measureChange, type MeasureChange } from "@/lib/stats";
import type { DayKey, HealthWorkout, MeasureField } from "@/lib/types";
import { ChartCard, dayAxis, dayDate, Stat } from "./parts";

type Range = "day" | "week" | "month" | "year";

const TONE: Record<Metric, BarTone> = { steps: "steps", sleep: "sleep", heart: "heart", energy: "energy", exercise: "active", body: "body", water: "water" };
const MEASURES: { field: MeasureField; title: string; chartId: string; noteId: string }[] = [
  { field: "chest", title: "Chest", chartId: "hChest", noteId: "hChestChange" },
  { field: "arms", title: "Arms", chartId: "hArms", noteId: "hArmsChange" },
  { field: "thighs", title: "Thighs", chartId: "hThighs", noteId: "hThighsChange" },
  { field: "hips", title: "Hips", chartId: "hHips", noteId: "hHipsChange" },
];
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toLowerCase();
const longDay = (k: DayKey) => parseKey(k).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const kcal = (v: number) => `${fmt(Math.round(v))} kcal`;
/** A goal as its pill says it: 10k, 8 h, 2.5 L, 30 min. */
const short = (m: Metric, v: number) =>
  m === "steps" ? (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v)) : m === "sleep" ? `${v} h` : m === "water" ? `${Math.round(v / 100) / 10} L` : m === "exercise" ? `${v} min` : fmt(v);

/** A metric's page (Steps detail board, the pattern for every metric): Day / Week / Month / Year, the period's chart
 *  under its big number, three stats and an insight. */
export function HealthDetail({ metric, day, onDay }: { metric: Metric; day: DayKey; onDay: (k: DayKey) => void }) {
  const [range, setRange] = useState<Range>(metric === "body" ? "month" : "week");
  return (
    <div className="screen detail">
      <SegmentedControl
        id="hRange"
        value={range}
        label="Time range"
        onChange={setRange}
        options={[
          ["day", "Day"],
          ["week", "Week"],
          ["month", "Month"],
          ["year", "Year"],
        ]}
      />
      {range === "day" ? (
        <DayPage key={`${metric}-${day}`} metric={metric} day={day} onDay={onDay} />
      ) : range === "year" ? (
        <YearPage key={`${metric}-y-${day}`} metric={metric} end={day} onDay={onDay} />
      ) : (
        <RangePage key={`${metric}-${range}-${day}`} metric={metric} days={daysTo(day, range === "week" ? 7 : 30)} onDay={onDay} />
      )}
    </div>
  );
}

/** ‹ › for the period: back or on by its length, never past today. */
function Stepper({ end, step, onDay }: { end: DayKey; step: number; onDay: (k: DayKey) => void }) {
  const t = todayKey(), next = addDays(end, step);
  const what = step === 1 ? "day" : step === 7 ? "week" : step === 30 ? "month" : "year";
  return (
    <div className="dayswitch">
      <button type="button" className="btn btn-icon btn-quiet" id="hPrev" aria-label={`Previous ${what}`} onClick={() => onDay(addDays(end, -step))}>
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <button type="button" className="btn btn-icon btn-quiet" id="hNext" aria-label={`Next ${what}`} disabled={end >= t} onClick={() => onDay(next > t ? t : next)}>
        <ChevronRight size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

/** The period's days as bars: the chart's data, and a sentence naming the goal days and the best one. */
function barsOf(s: Series, unit: (v: number) => string, goal: number | null, title: string) {
  const t = todayKey(), axis = dayAxis(s.map(([k]) => k), t);
  const bars: BarDatum[] = s.map(([k, v], i) => ({ x: axis[i], value: v, today: k === t, tip: `${longDay(k)} · ${v != null ? unit(v) : "no data"}` }));
  const sum = summarize(s, goal), days = s.filter(([, v]) => v != null);
  const met = goal != null ? s.filter(([, v]) => v != null && v >= goal).map(([k]) => parseKey(k).toLocaleDateString("en-IN", { weekday: "long" })) : [];
  const label = `${title}, ${dm(s[0][0])} to ${dm(s[s.length - 1][0])}. ${days.length ? "" : "No data. "}${goal != null && days.length ? (met.length ? `Goal reached on ${met.length > 7 ? `${met.length} days` : met.join(", ")}. ` : "Goal not reached. ") : ""}${sum.best ? `Highest ${longDay(sum.best[0])} at ${unit(sum.best[1])}.` : ""}`;
  return { bars, label };
}

/** The period's big chart card: a caption, the big number, and the chart. */
function MainChart({ metric, s, unit, goal, caption, value, valueUnit, onDay }: { metric: Metric; s: Series; unit: (v: number) => string; goal: number | null; caption: string; value: string; valueUnit?: string; onDay: (k: DayKey) => void }) {
  const title = { steps: "Steps a day", sleep: "Sleep a night", heart: "Resting heart rate", energy: "Calories burned a day", exercise: "Exercise a day", body: "Body weight", water: "Water a day" }[metric];
  const store = useGym();
  const end = s[s.length - 1][0], step = s.length;
  const nums = metric === "heart" ? s.map(([k]) => dayNumbers(store, k)) : [];
  return (
    <ChartCard id="hChart" caption={caption} value={value} unit={valueUnit} aside={<Stepper end={end} step={step} onDay={onDay} />}>
      {(w) => {
        if (metric === "body" || metric === "heart") {
          const pts = s.map(([k, v]) => ({ value: v, tip: `${longDay(k)} · ${v != null ? unit(v) : "no data"}` }));
          const vals = s.filter(([, v]) => v != null) as [DayKey, number][];
          if (metric === "heart") {
            return <HeartChart s={s} nums={nums} width={w} unit={unit} />;
          }
          const dir = vals.length > 1 ? (vals[vals.length - 1][1] < vals[0][1] ? "falling" : vals[vals.length - 1][1] > vals[0][1] ? "rising" : "steady") : "";
          return (
            <WeightTrendChart
              points={pts}
              tone="body"
              width={w}
              axis={axis3(s)}
              label={vals.length ? `${title}: ${unit(vals[0][1])} on ${dm(vals[0][0])} to ${unit(vals[vals.length - 1][1])} on ${dm(vals[vals.length - 1][0])}; the trend is ${dir}.` : `${title}: no readings in this period.`}
            />
          );
        }
        const { bars, label } = barsOf(s, unit, goal, title);
        return <StepsBarChart bars={bars} tone={TONE[metric]} width={w} goal={goal != null ? { value: goal, short: short(metric, goal) } : null} label={label} />;
      }}
    </ChartCard>
  );
}

function HeartChart({ s, nums, width, unit }: { s: Series; nums: DayNumbers[]; width: number; unit: (v: number) => string }) {
  const t = todayKey(), axis = dayAxis(s.map(([k]) => k), t);
  const days = s.map(([k], i) => {
    const n = nums[i];
    const bits = [n.restingHr != null ? `resting ${unit(n.restingHr)}` : "", n.hrMin != null && n.hrMax != null ? `${n.hrMin}–${n.hrMax} bpm` : ""].filter(Boolean);
    return { x: axis[i], lo: n.hrMin, hi: n.hrMax, dot: n.restingHr, today: k === t, tip: `${longDay(k)} · ${bits.join(", ") || "no data"}` };
  });
  const rest = s.filter(([, v]) => v != null) as [DayKey, number][];
  const lows = days.flatMap((d) => (d.lo != null ? [d.lo] : [])), highs = days.flatMap((d) => (d.hi != null ? [d.hi] : []));
  const label = rest.length
    ? `Heart rate each day, lowest to highest, with the resting rate: resting from ${unit(rest[0][1])} to ${unit(rest[rest.length - 1][1])}.`
    : lows.length
      ? `Heart rate each day, lowest to highest: from ${Math.min(...lows)} to ${Math.max(...highs)} bpm across ${lows.length} day${lows.length === 1 ? "" : "s"}.`
      : "Heart rate each day: no data in this period.";
  return <RangeChart days={days} width={width} label={label} />;
}

const axis3 = (s: Series): [string, string, string] => {
  const t = todayKey(), last = s[s.length - 1][0];
  return [dm(s[0][0]), dm(s[Math.floor((s.length - 1) / 2)][0]), last === t ? "Today" : dm(last)];
};

function Stats({ children }: { children: ReactNode }) {
  return <div className="stats3">{children}</div>;
}

/** A measurement's four-week change, under its trend. */
function ChangeNote({ id, label, suffix, m }: { id: string; label: string; suffix: string; m: MeasureChange }) {
  return (
    <p className="note change-note" id={id}>
      {label} {m.value}
      {suffix} on {dm(m.day)}
      {m.change ? ` · ${signed(m.change.value)}${suffix} since ${dm(m.change.since)}` : ""}
    </p>
  );
}

/** A secondary trend (HRV, body fat, a measurement) in its own card. */
function SideTrend({ s, title, unit, id, tone, minSpan }: { s: Series; title: string; unit: (v: number) => string; id: string; tone: TrendTone; minSpan?: number }) {
  const vals = s.filter(([, v]) => v != null) as [DayKey, number][];
  const last = vals[vals.length - 1];
  return (
    <ChartCard id={id} title={title} caption={last ? `Latest ${unit(last[1])} · ${dm(last[0])}` : undefined}>
      {(w) => (
        <WeightTrendChart
          points={s.map(([k, v]) => ({ value: v, tip: `${longDay(k)} · ${v != null ? unit(v) : "no data"}` }))}
          tone={tone}
          width={w}
          axis={axis3(s)}
          minSpan={minSpan}
          smoothed={false}
          label={vals.length > 1 ? `${title}: ${unit(vals[0][1])} on ${dm(vals[0][0])}, ${unit(last[1])} on ${dm(last[0])}.` : `${title}: ${vals.length ? unit(vals[0][1]) : "no readings"}.`}
        />
      )}
    </ChartCard>
  );
}

/* ---------- a week or a month ---------- */

function RangePage({ metric, days, onDay }: { metric: Metric; days: DayKey[]; onDay: (k: DayKey) => void }) {
  const store = useGym();
  const p = store.plan;
  const nums = days.map((k) => dayNumbers(store, k));
  const s = seriesOf(store, metric, days), goal = goalOf(metric, p), sum = summarize(s, goal);
  const span = `${dm(days[0])} – ${dm(days[days.length - 1])}`, within = `of ${days.length}`;
  const bestDay = (b: [DayKey, number] | null) => (b ? parseKey(b[0]).toLocaleDateString("en-IN", { weekday: "short" }) : "");
  switch (metric) {
    case "steps": {
      const wk = s.filter(([k, v]) => v != null && [0, 5, 6].includes(parseKey(k).getDay()));
      const wkAvg = wk.length ? wk.reduce((m, [, v]) => m + v!, 0) / wk.length : null;
      const left = sum.avg != null && sum.avg < p.stepGoal;
      return (
        <>
          <MainChart metric="steps" s={s} unit={(v) => fmt(Math.round(v))} goal={goal} caption={`Daily average · ${span}`} value={sum.avg != null ? fmt(Math.round(sum.avg)) : "–"} valueUnit="steps" onDay={onDay} />
          <Stats>
            <Stat v={fmt(sum.total)} l="total" />
            <Stat v={`${sum.goalDays}`} u={within} l="goal days" id="hGoalDays" />
            <Stat v={sum.best ? fmt(sum.best[1]) : "–"} l={sum.best ? `best · ${bestDay(sum.best)}` : "best"} />
          </Stats>
          {sum.n ? (
            <InsightCallout id="hInsight">
              {wkAvg != null && sum.avg != null && wkAvg < sum.avg * 0.9 && days.length >= 7
                ? `Weekends ran short: Fri–Sun averaged ${fmt(Math.round(wkAvg))}. A longer weekend walk would lift your average.`
                : left
                  ? `${fmt(Math.round(p.stepGoal - sum.avg!))} a day short of your goal on average. A 20-minute walk closes most of it.`
                  : `You averaged over your ${fmt(p.stepGoal)} goal. Keep it rolling.`}
            </InsightCallout>
          ) : null}
        </>
      );
    }
    case "sleep": {
      const times = sleepTimes(nums);
      return (
        <>
          <MainChart metric="sleep" s={s} unit={(v) => hoursMin(v * 60)} goal={goal} caption={`Average a night · ${span}`} value={sum.avg != null ? hoursMin(sum.avg * 60) : "–"} onDay={onDay} />
          <Stats>
            <Stat v={`${sum.goalDays}`} u={`of ${sum.n}`} l={`nights at ${p.sleepGoalH} h`} id="hGoalDays" />
            <Stat v={times ? clockText(times.bed) : "–"} l="average bedtime" />
            <Stat v={times ? clockText(times.wake) : "–"} l="average waking" />
          </Stats>
          {sum.avg != null ? (
            <InsightCallout id="hInsight">
              {sum.avg * 60 < p.sleepGoalH * 60 ? `${hoursMin(Math.round(p.sleepGoalH * 60 - sum.avg * 60))} short of your goal a night. Try a set bedtime.` : `Averaging your ${p.sleepGoalH} h goal. Recovery is on track.`}
            </InsightCallout>
          ) : null}
        </>
      );
    }
    case "heart": {
      const hrv = seriesOf(store, metric, days, (x) => x.hrv), hs = summarize(hrv);
      const vit = (f: (x: DayNumbers) => number | null) => summarize(seriesOf(store, metric, days, f));
      const spo2 = vit((x) => x.spo2), resp = vit((x) => x.respRate);
      const bp = [...nums].reverse().find((x) => x.bp)?.bp, vo2 = [...nums].reverse().find((x) => x.vo2max)?.vo2max;
      // No resting rate (not every watch gives one): the day's average and lowest stand in, as the bars show them.
      const resting = sum.n > 0, avgHr = summarize(seriesOf(store, metric, days, (x) => x.hrAvg));
      const lows = resting ? s.flatMap(([, v]) => (v != null ? [v] : [])) : nums.flatMap((x) => (x.hrMin != null ? [x.hrMin] : []));
      const lowest = lows.length ? Math.min(...lows) : null, head = resting ? sum.avg : avgHr.avg;
      const measured = nums.filter((x) => x.restingHr != null || x.hrAvg != null || x.hrMin != null).length;
      return (
        <>
          <MainChart metric="heart" s={s} unit={(v) => `${Math.round(v)} bpm`} goal={null} caption={`${resting ? "Resting average" : "Average"} · ${span}`} value={head != null ? `${Math.round(head)}` : "–"} valueUnit="bpm" onDay={onDay} />
          <Stats>
            <Stat v={lowest != null ? `${Math.round(lowest)}` : "–"} u="bpm" l={resting ? "lowest resting" : "lowest"} id="hLowest" />
            <Stat v={hs.avg != null ? `${Math.round(hs.avg)}` : "–"} u="ms" l="HRV average" />
            <Stat v={`${measured}`} u={within} l="days measured" id="hMeasured" />
          </Stats>
          {hs.n ? <SideTrend s={hrv} title="Heart rate variability" unit={(v) => `${Math.round(v)} ms`} id="hHrv" tone="heart" minSpan={10} /> : null}
          {spo2.n || resp.n || bp || vo2 ? (
            <section className="card" id="hVitals">
              <h2 className="title-sm">Vitals</h2>
              <Stats>
                {spo2.avg != null ? <Stat v={`${Math.round(spo2.avg * 10) / 10}%`} l="blood oxygen" /> : null}
                {resp.avg != null ? <Stat v={`${Math.round(resp.avg * 10) / 10}`} l="breaths a minute" /> : null}
                {bp ? <Stat v={`${bp.sys}/${bp.dia}`} l="blood pressure" /> : null}
                {vo2 ? <Stat v={`${vo2}`} l="VO₂ max" /> : null}
              </Stats>
            </section>
          ) : null}
        </>
      );
    }
    case "energy": {
      const eaten = seriesOf(store, metric, days, (x) => x.eatenKcal), es = summarize(eaten);
      const both = nums.filter((x) => x.eatenKcal != null && metricValue("energy", x) != null);
      const balance = both.length ? both.reduce((m, x) => m + x.eatenKcal! - metricValue("energy", x)!, 0) / both.length : null;
      return (
        <>
          <MainChart metric="energy" s={s} unit={kcal} goal={null} caption={`Burned a day · ${span}`} value={sum.avg != null ? fmt(Math.round(sum.avg)) : "–"} valueUnit="kcal" onDay={onDay} />
          <Stats>
            <Stat v={es.avg != null ? fmt(Math.round(es.avg)) : "–"} u="kcal" l="eaten a day" />
            {balance != null ? <Stat v={`${balance > 0 ? "+" : balance < 0 ? "−" : ""}${fmt(Math.round(Math.abs(balance)))}`} u="kcal" l={balance <= 0 ? "under, a day" : "over, a day"} id="hBalance" /> : <Stat v="–" l="balance" />}
            <Stat v={`${sum.n}`} u={within} l="days measured" />
          </Stats>
          {es.n ? (
            <ChartCard id="hEaten" title="Calories eaten a day">
              {(w) => {
                const { bars, label } = barsOf(eaten, kcal, null, "Calories eaten a day");
                return <StepsBarChart bars={bars} tone="energy" width={w} label={label} />;
              }}
            </ChartCard>
          ) : null}
        </>
      );
    }
    case "exercise": {
      const all = nums.flatMap((x) => x.workouts);
      return (
        <>
          <MainChart metric="exercise" s={s} unit={(v) => hoursMin(v)} goal={goal} caption={`Active time · ${span}`} value={hoursMin(sum.total)} valueUnit="in all" onDay={onDay} />
          <Stats>
            <Stat v={`${all.length}`} l={all.length === 1 ? "workout" : "workouts"} />
            <Stat v={`${sum.goalDays}`} u={within} l="goal days" id="hGoalDays" />
            <Stat v={sum.avg != null ? hoursMin(Math.round(sum.avg)) : "–"} l="on active days" />
          </Stats>
          {all.length ? <Sessions title="Workouts" list={[...all].reverse().slice(0, 12)} dated /> : null}
        </>
      );
    }
    case "body": {
      const fat = seriesOf(store, metric, days, (x) => x.bodyFat), fs = summarize(fat);
      const w = s.filter((x): x is [DayKey, number] => x[1] != null);
      const change = w.length > 1 ? w[w.length - 1][1] - w[0][1] : null;
      const upTo = (r: [DayKey, number][]) => r.filter(([k]) => k <= days[days.length - 1]);
      const fatChange = measureChange(upTo(store.measureReadings("bodyFat")));
      return (
        <>
          <MainChart metric="body" s={s} unit={(v) => `${v.toFixed(1)} kg`} goal={null} caption={`Body weight · ${span}`} value={w.length ? w[w.length - 1][1].toFixed(1) : "–"} valueUnit="kg" onDay={onDay} />
          <Stats>
            <Stat v={change != null ? `${change > 0 ? "+" : change < 0 ? "−" : "±"}${Math.abs(change).toFixed(1)}` : "–"} u="kg" l={`since ${w.length ? dm(w[0][0]) : "the start"}`} id="hChange" tone={change != null && change < 0 ? "var(--success)" : undefined} />
            <Stat v={`${w.length}`} u={within} l="weigh-ins" />
            <Stat v={fs.avg != null ? `${Math.round(fs.avg * 10) / 10}%` : "–"} l="body fat" />
          </Stats>
          {fs.n ? (
            <>
              <SideTrend s={fat} title="Body fat" unit={(v) => `${Math.round(v * 10) / 10}%`} id="hFat" tone="body" minSpan={2} />
              {fatChange ? <ChangeNote id="hFatChange" label="Body fat" suffix="%" m={fatChange} /> : null}
            </>
          ) : null}
          {MEASURES.map(({ field, title, chartId, noteId }) => {
            const ser = seriesOf(store, metric, days, (x) => x[field]);
            if (!summarize(ser).n) return null;
            const mc = measureChange(upTo(store.measureReadings(field)));
            return (
              <Fragment key={field}>
                <SideTrend s={ser} title={title} unit={(v) => `${v} cm`} id={chartId} tone="body" minSpan={2} />
                {mc ? <ChangeNote id={noteId} label={title} suffix=" cm" m={mc} /> : null}
              </Fragment>
            );
          })}
          <p className="note">The trend line and your pace to the goal weight are in Progress → Body.</p>
        </>
      );
    }
    case "water":
      return (
        <>
          <MainChart metric="water" s={s} unit={(v) => `${fmt(Math.round(v))} ml`} goal={goal} caption={`Daily average · ${span}`} value={sum.avg != null ? fmt(Math.round(sum.avg)) : "–"} valueUnit="ml" onDay={onDay} />
          <Stats>
            <Stat v={`${sum.goalDays}`} u={within} l="goal days" id="hGoalDays" />
            <Stat v={fmt(Math.round(sum.total))} u="ml" l="total" />
            <Stat v={sum.best ? fmt(sum.best[1]) : "–"} u="ml" l="best day" />
          </Stats>
        </>
      );
  }
}

/* ---------- a year: a month a bar ---------- */

function YearPage({ metric, end, onDay }: { metric: Metric; end: DayKey; onDay: (k: DayKey) => void }) {
  const store = useGym();
  const days = daysTo(end, 365);
  const months: { key: DayKey; vals: number[] }[] = [];
  for (const k of days) {
    const m = k.slice(0, 7);
    if (months[months.length - 1]?.key.slice(0, 7) !== m) months.push({ key: `${m}-01`, vals: [] });
    const v = metricValue(metric, dayNumbers(store, k));
    if (v != null) months[months.length - 1].vals.push(v);
  }
  const avgOf = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  const s: Series = months.map((m) => [m.key, avgOf(m.vals)]);
  const unit = metric === "sleep" ? (v: number) => hoursMin(Math.round(v * 60)) : metric === "body" ? (v: number) => `${v.toFixed(1)} kg` : metric === "heart" ? (v: number) => `${Math.round(v)} bpm` : (v: number) => fmt(Math.round(v));
  const vals = s.filter(([, v]) => v != null) as [DayKey, number][];
  const avg = avgOf(vals.map(([, v]) => v));
  const goal = goalOf(metric, store.plan);
  const monthName = (k: DayKey) => parseKey(k).toLocaleDateString("en-IN", { month: "short" });
  const best = vals.reduce<[DayKey, number] | null>((b, p) => (!b || p[1] > b[1] ? p : b), null);
  return (
    <>
      <ChartCard id="hChart" caption={`Monthly averages · ${monthName(s[0][0])} – ${monthName(s[s.length - 1][0])}`} value={avg != null ? unit(avg).replace(/ (kg|bpm)$/, "") : "–"} unit={metric === "body" ? "kg" : metric === "heart" ? "bpm" : metric === "steps" ? "steps a day" : undefined} aside={<Stepper end={end} step={365} onDay={onDay} />}>
        {(w) =>
          metric === "body" || metric === "heart" ? (
            <WeightTrendChart points={s.map(([k, v]) => ({ value: v, tip: `${monthName(k)} · ${v != null ? unit(v) : "no data"}` }))} tone={metric} width={w} axis={[monthName(s[0][0]), monthName(s[6][0]), monthName(s[s.length - 1][0])]} smoothed={false} label={`${metric === "body" ? "Body weight" : "Resting heart rate"}, month by month.`} />
          ) : (
            <StepsBarChart
              bars={s.map(([k, v]) => ({ x: monthName(k).slice(0, 1), value: v, tip: `${monthName(k)} · ${v != null ? unit(v) : "no data"}` }))}
              tone={TONE[metric]}
              width={w}
              goal={goal != null ? { value: goal, short: short(metric, goal) } : null}
              label={`Monthly averages over the last year.${best ? ` Best month ${monthName(best[0])} at ${unit(best[1])}.` : ""}`}
            />
          )
        }
      </ChartCard>
      <Stats>
        <Stat v={`${vals.length}`} l="months with data" />
        <Stat v={best ? monthName(best[0]) : "–"} l="highest month" />
        <Stat v={best ? unit(best[1]) : "–"} l="its average" />
      </Stats>
    </>
  );
}

/* ---------- one day ---------- */

/** A day's big number, under its date and what the number is, with ‹ › to the day before or after. */
function Hero({ value, unit, caption, children, day, onDay }: { value: string; unit?: string; caption?: string; children?: ReactNode; day: DayKey; onDay: (k: DayKey) => void }) {
  return (
    <section className="card hero" id="hHero">
      <div className="cc-h">
        <div className="cc-t">
          <div className="label" id="hDate">{[dayDate(day), caption].filter(Boolean).join(" · ")}</div>
          <div className="cc-v">
            {value}
            {unit ? <span className="u"> {unit}</span> : null}
          </div>
        </div>
        <Stepper end={day} step={1} onDay={onDay} />
      </div>
      {children}
    </section>
  );
}

function Meter({ value, goal, tone, label }: { value: number; goal: number; tone: string; label: string }) {
  return (
    <span className="meter" style={{ ["--c" as string]: tone }} role="meter" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={value} aria-label={label}>
      <i style={{ width: `${Math.max(0, Math.min(100, (value / goal) * 100))}%` }} />
    </span>
  );
}

function DayPage({ metric, day, onDay }: { metric: Metric; day: DayKey; onDay: (k: DayKey) => void }) {
  const store = useGym();
  const p = store.plan, n = dayNumbers(store, day);
  // A day with nothing still has its date and ‹ ›, so another day is a tap away.
  const empty = (
    <Hero value="–" day={day} onDay={onDay}>
      <p className="sub" id="hEmpty">
        Nothing from Health Connect for {day === todayKey() ? "today yet" : "this day"}.
      </p>
    </Hero>
  );
  switch (metric) {
    case "steps":
      return (
        <>
          <Hero value={n.steps != null ? fmt(n.steps) : "–"} unit={`/ ${fmt(p.stepGoal)} steps`} day={day} onDay={onDay}>
            <Meter value={n.steps ?? 0} goal={p.stepGoal} tone="var(--steps)" label={`Steps, ${fmt(n.steps ?? 0)} of ${fmt(p.stepGoal)}`} />
          </Hero>
          <Stats>
            <Stat v={n.km ? `${n.km}` : "–"} u="km" l="distance" />
            <Stat v={n.floors != null ? fmt(n.floors) : "–"} l="floors" />
            <Stat v={n.activeKcal != null ? fmt(n.activeKcal) : "–"} u="kcal" l="burned moving" />
          </Stats>
          {n.stepsByHour ? <HourBars hours={n.stepsByHour} /> : null}
        </>
      );
    case "sleep":
      return n.sleepMin ? (
        <>
          <Hero caption={n.bed && n.wake ? `${clock(n.bed)} – ${clock(n.wake)}` : "the night before"} value={hoursMin(n.sleepMin)} unit="asleep" day={day} onDay={onDay}>
            {n.sleepStages ? <StageLanes stages={n.sleepStages} full /> : null}
          </Hero>
          <InsightCallout id="hGoal">{`${sleepGoalWords(n.sleepMin - p.sleepGoalH * 60)} your ${p.sleepGoalH} h goal.`}</InsightCallout>
        </>
      ) : (
        empty
      );
    case "heart":
      return n.restingHr || n.hrAvg || n.spo2 || n.bp ? (
        <>
          <Hero caption={n.restingHr != null ? "resting" : "average"} value={n.restingHr != null ? `${n.restingHr}` : n.hrAvg != null ? `${n.hrAvg}` : "–"} unit="bpm" day={day} onDay={onDay} />
          <Stats>
            {n.hrAvg != null ? <Stat v={`${n.hrAvg}`} u="bpm" l="average" /> : null}
            {n.hrMin != null && n.hrMax != null ? <Stat v={`${n.hrMin}–${n.hrMax}`} l="lowest to highest" /> : null}
            {n.hrv != null ? <Stat v={`${n.hrv}`} u="ms" l="HRV" /> : null}
            {n.spo2 != null ? <Stat v={`${n.spo2}%`} l="blood oxygen" /> : null}
            {n.respRate != null ? <Stat v={`${n.respRate}`} l="breaths a minute" /> : null}
            {n.bp ? <Stat v={`${n.bp.sys}/${n.bp.dia}`} l="blood pressure" /> : null}
            {n.vo2max != null ? <Stat v={`${n.vo2max}`} l="VO₂ max" /> : null}
          </Stats>
        </>
      ) : (
        empty
      );
    case "energy": {
      const burned = n.totalKcal ?? n.activeKcal, resting = n.totalKcal != null && n.activeKcal != null ? n.totalKcal - n.activeKcal : n.bmr;
      const balance = burned != null && n.eatenKcal != null ? n.eatenKcal - burned : null;
      return burned != null || n.eatenKcal != null ? (
        <>
          <Hero caption={n.totalKcal != null ? "burned" : "burned moving"} value={burned != null ? fmt(burned) : "–"} unit="kcal" day={day} onDay={onDay}>
            <Meter value={n.activeKcal ?? 0} goal={p.activeGoalKcal} tone="var(--energy)" label={`Active calories, ${fmt(n.activeKcal ?? 0)} of ${fmt(p.activeGoalKcal)}`} />
          </Hero>
          <Stats>
            <Stat v={n.activeKcal != null ? fmt(n.activeKcal) : "–"} u="kcal" l={`moving, of ${fmt(p.activeGoalKcal)}`} />
            <Stat v={resting != null ? fmt(resting) : "–"} u="kcal" l="at rest" />
            {balance != null ? <Stat v={`${balance > 0 ? "+" : balance < 0 ? "−" : ""}${fmt(Math.abs(balance))}`} u="kcal" l={balance <= 0 ? "under what you burned" : "over what you burned"} id="hBalance" /> : <Stat v={n.eatenKcal != null ? fmt(n.eatenKcal) : "–"} u="kcal" l="eaten" />}
          </Stats>
        </>
      ) : (
        empty
      );
    }
    case "exercise":
      return (
        <>
          <Hero value={hoursMin(n.exerciseMin)} unit={`/ ${p.exerciseGoalMin} min`} day={day} onDay={onDay}>
            <Meter value={n.exerciseMin} goal={p.exerciseGoalMin} tone="var(--active)" label={`Exercise, ${n.exerciseMin} of ${p.exerciseGoalMin} minutes`} />
          </Hero>
          {n.workouts.length ? <Sessions title="Workouts" list={n.workouts} /> : <p className="empty card">No workouts recorded {day === todayKey() ? "today yet" : "this day"}.</p>}
        </>
      );
    case "body":
      return n.weight || n.bodyFat || n.chest || n.arms || n.thighs || n.hips ? (
        <>
          <Hero value={n.weight ? n.weight.toFixed(1) : "–"} unit="kg" day={day} onDay={onDay} />
          <Stats>
            {n.bodyFat != null ? <Stat v={`${n.bodyFat}%`} l="body fat" /> : null}
            {n.bmi != null ? <Stat v={`${n.bmi}`} l="body mass index" /> : null}
            {n.chest != null ? <Stat v={`${n.chest}`} u="cm" l="chest" /> : null}
            {n.arms != null ? <Stat v={`${n.arms}`} u="cm" l="arms" /> : null}
            {n.thighs != null ? <Stat v={`${n.thighs}`} u="cm" l="thighs" /> : null}
            {n.hips != null ? <Stat v={`${n.hips}`} u="cm" l="hips" /> : null}
          </Stats>
        </>
      ) : (
        empty
      );
    case "water":
      return (
        <Hero value={n.waterMl != null ? fmt(n.waterMl) : "–"} unit={`/ ${fmt(p.waterGoalMl)} ml`} day={day} onDay={onDay}>
          <Meter value={n.waterMl ?? 0} goal={p.waterGoalMl} tone="var(--water)" label={`Water, ${fmt(n.waterMl ?? 0)} of ${fmt(p.waterGoalMl)} ml`} />
        </Hero>
      );
  }
}

/** How a night compares with the goal, in minutes over (or under, negative). */
const sleepGoalWords = (over: number) => (over > 0 ? `${hoursMin(over)} over` : over < 0 ? `${hoursMin(-over)} short of` : "Right on");

/** Steps hour by hour, with the busiest hour named. */
function HourBars({ hours }: { hours: number[] }) {
  const hr = (h: number) => new Date(2026, 0, 1, h).toLocaleTimeString("en-IN", { hour: "numeric" }).toLowerCase();
  const peak = hours.reduce((b, v, i) => (v > hours[b] ? i : b), 0);
  const bars: BarDatum[] = hours.map((v, h) => ({ x: h % 6 === 0 ? hr(h) : "", value: v, tip: `${hr(h)}–${hr((h + 1) % 24)} · ${fmt(v)}` }));
  return (
    <ChartCard id="hHours" title="Steps by the hour" caption={`Busiest ${hr(peak)} to ${hr((peak + 1) % 24)}`}>
      {(w) => <StepsBarChart bars={bars} tone="steps" width={w} height={170} label={`Steps by the hour. Busiest from ${hr(peak)}, with ${fmt(hours[peak])}.`} />}
    </ChartCard>
  );
}

function Sessions({ title, list, dated = false }: { title: string; list: HealthWorkout[]; dated?: boolean }) {
  return (
    <section className="card" id="hSessions">
      <h2 className="title-sm">{title}</h2>
      <ul className="list inset">
        {list.map((w) => (
          <li key={w.start} className="row">
            <span className="row-t">
              <span className="row-tt">{workoutName(w.type)}</span>
              <span className="row-d">{[dated ? longDay(w.start.slice(0, 10)) : "", clock(w.start), hoursMin(w.min), w.kcal ? kcal(w.kcal) : "", w.km ? `${w.km} km` : "", w.source ?? ""].filter(Boolean).join(" · ")}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
