"use client";
import { useState, type ReactNode } from "react";
import { useGym } from "@/hooks/useGym";
import { dm, parseKey } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { hoursMin, workoutName } from "@/lib/health";
import {
  clockText,
  dayNumbers,
  daysTo,
  goalOf,
  metricValue,
  seriesOf,
  sleepTimes,
  summarize,
  type DayNumbers,
  type HealthSource,
  type Series,
} from "@/lib/healthView";
import type { Metric } from "@/lib/route";
import type { DayKey, HealthWorkout } from "@/lib/types";
import { Bars, type Bar } from "./Bars";
import { ChartCard, DaySwitch, dayAxis, dayWords, Meter, Segmented, StageBar, Stat } from "./parts";
import { Trend } from "./Trend";

type Range = "day" | "week" | "month";

const COLOR: Record<Metric, string> = {
  steps: "var(--c-steps)",
  sleep: "var(--c-sleep)",
  heart: "var(--c-heart)",
  energy: "var(--c-energy)",
  exercise: "var(--c-exercise)",
  body: "var(--c-body)",
  water: "var(--c-water)",
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const longDay = (k: DayKey) => parseKey(k).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const kcal = (v: number) => `${fmt(Math.round(v))} kcal`;

/** A metric's page: the day in detail, or a week or month as a chart with its averages and goal. */
export function HealthDetail({ metric, day, onDay }: { metric: Metric; day: DayKey; onDay: (k: DayKey) => void }) {
  const [range, setRange] = useState<Range>(metric === "body" ? "month" : "week");
  const n = range === "week" ? 7 : 30;
  const days = daysTo(day, n);
  return (
    <>
      <Segmented
        value={range}
        label="Period"
        onChange={setRange}
        options={[
          ["day", "Day"],
          ["week", "Week"],
          ["month", "Month"],
        ]}
      />
      <DaySwitch day={day} onDay={onDay} step={range === "day" ? 1 : n} label={range === "day" ? dayWords(day) : `${dm(days[0])} – ${dm(day)}`} />
      {range === "day" ? <DayPage key={`${metric}-${day}`} metric={metric} day={day} /> : <RangePage key={`${metric}-${range}-${day}`} metric={metric} days={days} />}
    </>
  );
}

/** Bars for a series, with its goal and average, and the picked bar read out above. */
function SeriesBars({ s, metric, title, unit, id, goal = null }: { s: Series; metric: Metric; title: string; unit: (v: number) => string; id?: string; goal?: number | null }) {
  const [sel, setSel] = useState(s.length - 1);
  const sum = summarize(s, goal);
  const axis = dayAxis(s.map(([k]) => k));
  const bars: Bar[] = s.map(([k, v], i) => ({ x: axis[i], value: v, tip: `${longDay(k)}: ${v != null ? unit(v) : "no data"}` }));
  return (
    <ChartCard title={title} readout={bars[sel]?.tip} id={id}>
      {(w) => (
        <Bars
          bars={bars}
          color={COLOR[metric]}
          width={w}
          label={title}
          selected={sel}
          onSelect={setSel}
          fmt={(v) => (metric === "sleep" ? `${Math.round(v)} h` : fmt(Math.round(v)))}
          goal={goal != null ? { value: goal, label: `Goal ${unit(goal)}` } : null}
          avg={sum.avg != null && sum.n > 1 ? { value: sum.avg, label: `Average ${unit(sum.avg)}` } : null}
        />
      )}
    </ChartCard>
  );
}

function SeriesTrend({ s, metric, title, unit, id, minSpan }: { s: Series; metric: Metric; title: string; unit: (v: number) => string; id?: string; minSpan?: number }) {
  const lastWith = s.reduce((j, [, v], i) => (v != null ? i : j), s.length - 1);
  const [sel, setSel] = useState(lastWith);
  const axis = dayAxis(s.map(([k]) => k));
  const pts: Bar[] = s.map(([k, v], i) => ({ x: axis[i], value: v, tip: `${longDay(k)}: ${v != null ? unit(v) : "no data"}` }));
  return (
    <ChartCard title={title} readout={pts[sel]?.tip} id={id}>
      {(w) => <Trend points={pts} color={COLOR[metric]} width={w} label={title} selected={sel} onSelect={setSel} fmt={(v) => unit(v).replace(/ .*/, "")} minSpan={minSpan} />}
    </ChartCard>
  );
}

function Stats({ children }: { children: ReactNode }) {
  return <div className="hstats">{children}</div>;
}

/* ---------- a week or a month ---------- */

function RangePage({ metric, days }: { metric: Metric; days: DayKey[] }) {
  const store = useGym();
  const p = store.plan;
  const nums = days.map((k) => dayNumbers(store, k));
  const s = seriesOf(store, metric, days), goal = goalOf(metric, p), sum = summarize(s, goal);
  const within = `of ${days.length} days`;
  switch (metric) {
    case "steps":
      return (
        <>
          <SeriesBars s={s} metric="steps" title="Steps a day" unit={(v) => `${fmt(Math.round(v))} steps`} goal={goal} id="hChart" />
          <Stats>
            <Stat v={sum.avg != null ? fmt(Math.round(sum.avg)) : "–"} l="average a day" />
            <Stat v={fmt(sum.total)} l="in all" />
            <Stat v={`${sum.goalDays}`} l={`days at ${fmt(p.stepGoal)}, ${within}`} id="hGoalDays" />
            <Stat v={kmOf(nums)} l="walked and run" />
          </Stats>
        </>
      );
    case "sleep": {
      const times = sleepTimes(nums);
      return (
        <>
          <SeriesBars s={s} metric="sleep" title="Asleep each night" unit={(v) => hoursMin(v * 60)} goal={goal} id="hChart" />
          <Stats>
            <Stat v={sum.avg != null ? hoursMin(sum.avg * 60) : "–"} l="a night on average" />
            <Stat v={`${sum.goalDays}`} l={`nights of ${p.sleepGoalH} h or more, of ${sum.n}`} id="hGoalDays" />
            <Stat v={times ? clockText(times.bed) : "–"} l="average bedtime" />
            <Stat v={times ? clockText(times.wake) : "–"} l="average waking time" />
          </Stats>
        </>
      );
    }
    case "heart": {
      const hrv = seriesOf(store, metric, days, (x) => x.hrv), hs = summarize(hrv);
      const vit = (f: (x: DayNumbers) => number | null) => summarize(seriesOf(store, metric, days, f));
      const spo2 = vit((x) => x.spo2), resp = vit((x) => x.respRate);
      const bp = [...nums].reverse().find((x) => x.bp)?.bp, vo2 = [...nums].reverse().find((x) => x.vo2max)?.vo2max;
      return (
        <>
          <SeriesTrend s={s} metric="heart" title="Resting heart rate" unit={(v) => `${Math.round(v)} bpm`} id="hChart" />
          <Stats>
            <Stat v={sum.avg != null ? `${Math.round(sum.avg)}` : "–"} l="resting bpm on average" />
            <Stat v={sum.n ? `${Math.min(...s.flatMap(([, v]) => (v != null ? [v] : [])))}` : "–"} l="lowest resting bpm" />
          </Stats>
          {hs.n ? <SeriesTrend s={hrv} metric="heart" title="Heart rate variability" unit={(v) => `${Math.round(v)} ms`} id="hHrv" minSpan={10} /> : null}
          {spo2.n || resp.n || bp || vo2 ? (
            <section className="panel hcard" id="hVitals">
              <h2>Vitals</h2>
              <Stats>
                {spo2.avg != null ? <Stat v={`${Math.round(spo2.avg * 10) / 10}%`} l="blood oxygen on average" /> : null}
                {resp.avg != null ? <Stat v={`${Math.round(resp.avg * 10) / 10}`} l="breaths a minute on average" /> : null}
                {bp ? <Stat v={`${bp.sys}/${bp.dia}`} l="latest blood pressure, mmHg" /> : null}
                {vo2 ? <Stat v={`${vo2}`} l="latest VO₂ max, mL/kg/min" /> : null}
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
          <SeriesBars s={s} metric="energy" title="Calories burned a day" unit={kcal} id="hChart" />
          {es.n ? <SeriesBars s={eaten} metric="energy" title="Calories eaten a day" unit={kcal} id="hEaten" /> : null}
          <Stats>
            <Stat v={sum.avg != null ? kcal(sum.avg) : "–"} l="burned a day on average" />
            <Stat v={es.avg != null ? kcal(es.avg) : "–"} l="eaten a day on average" />
            {balance != null ? <Stat v={`${balance > 0 ? "+" : balance < 0 ? "−" : ""}${kcal(Math.abs(balance))}`} l={balance <= 0 ? "under what you burned, a day" : "over what you burned, a day"} id="hBalance" /> : null}
          </Stats>
        </>
      );
    }
    case "exercise": {
      const all = nums.flatMap((x) => x.workouts);
      return (
        <>
          <SeriesBars s={s} metric="exercise" title="Minutes of exercise a day" unit={(v) => hoursMin(v)} goal={goal} id="hChart" />
          <Stats>
            <Stat v={hoursMin(sum.total)} l="in all" />
            <Stat v={`${all.length}`} l={all.length === 1 ? "workout" : "workouts"} />
            <Stat v={`${sum.goalDays}`} l={`days of ${p.exerciseGoalMin} min or more, ${within}`} id="hGoalDays" />
          </Stats>
          {all.length ? <Sessions title="Workouts" list={[...all].reverse().slice(0, 12)} dated /> : null}
        </>
      );
    }
    case "body": {
      const fat = seriesOf(store, metric, days, (x) => x.bodyFat), fs = summarize(fat);
      const w = s.filter((x): x is [DayKey, number] => x[1] != null);
      const change = w.length > 1 ? w[w.length - 1][1] - w[0][1] : null;
      return (
        <>
          <SeriesTrend s={s} metric="body" title="Body weight" unit={(v) => `${v.toFixed(1)} kg`} id="hChart" minSpan={1} />
          <Stats>
            <Stat v={w.length ? `${w[w.length - 1][1].toFixed(1)} kg` : "–"} l="latest weigh-in" />
            <Stat v={change != null ? `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change).toFixed(1)} kg` : "–"} l={`since ${w.length ? dm(w[0][0]) : "the first weigh-in"}`} id="hChange" />
            <Stat v={`${w.length}`} l={`weigh-ins, ${within}`} />
          </Stats>
          {fs.n ? <SeriesTrend s={fat} metric="body" title="Body fat" unit={(v) => `${Math.round(v * 10) / 10}%`} id="hFat" minSpan={2} /> : null}
          <p className="note">The trend line and your pace to the goal weight are in Progress.</p>
        </>
      );
    }
    case "water":
      return (
        <>
          <SeriesBars s={s} metric="water" title="Water a day" unit={(v) => `${fmt(Math.round(v))} ml`} goal={goal} id="hChart" />
          <Stats>
            <Stat v={sum.avg != null ? `${fmt(Math.round(sum.avg))} ml` : "–"} l="a day on average" />
            <Stat v={`${sum.goalDays}`} l={`days at ${fmt(p.waterGoalMl)} ml, ${within}`} id="hGoalDays" />
          </Stats>
        </>
      );
  }
}

const kmOf = (nums: DayNumbers[]) => {
  const km = nums.reduce((m, x) => m + (x.km ?? 0), 0);
  return km ? `${Math.round(km * 10) / 10} km` : "–";
};

/* ---------- one day ---------- */

function Hero({ value, of, children }: { value: string; of?: string; children?: ReactNode }) {
  return (
    <section className="panel hhero" id="hHero">
      <p className="hv">
        <b>{value}</b>
        {of ? <span className="sub"> {of}</span> : null}
      </p>
      {children}
    </section>
  );
}

function DayPage({ metric, day }: { metric: Metric; day: DayKey }) {
  const store = useGym();
  const p = store.plan, n = dayNumbers(store as HealthSource, day);
  const empty = <p className="empty">Nothing from Health Connect for {dayWords(day).toLowerCase() === "today" ? "today yet" : dayWords(day)}.</p>;
  switch (metric) {
    case "steps":
      return (
        <>
          <Hero value={n.steps != null ? fmt(n.steps) : "–"} of={`/ ${fmt(p.stepGoal)} steps`}>
            <Meter value={n.steps ?? 0} goal={p.stepGoal} color="var(--c-steps)" label={`Steps, ${fmt(n.steps ?? 0)} of ${fmt(p.stepGoal)}`} />
            <Stats>
              <Stat v={n.km ? `${n.km} km` : "–"} l="distance" />
              <Stat v={n.floors != null ? fmt(n.floors) : "–"} l="floors" />
              <Stat v={n.activeKcal != null ? kcal(n.activeKcal) : "–"} l="burned moving" />
            </Stats>
          </Hero>
          {n.stepsByHour ? <HourBars hours={n.stepsByHour} /> : null}
        </>
      );
    case "sleep":
      return n.sleepMin ? (
        <Hero value={hoursMin(n.sleepMin)} of="asleep">
          <p className="sub">{n.bed && n.wake ? `${clock(n.bed)} – ${clock(n.wake)}` : "the night before"}</p>
          {n.sleepStages ? <StageBar stages={n.sleepStages} /> : null}
          <p className="note" id="hGoal">
            {sleepGoalWords(n.sleepMin - p.sleepGoalH * 60)} your {p.sleepGoalH}&nbsp;h goal.
          </p>
        </Hero>
      ) : (
        empty
      );
    case "heart":
      return n.restingHr || n.hrAvg || n.spo2 || n.bp ? (
        <Hero value={n.restingHr != null ? `${n.restingHr}` : n.hrAvg != null ? `${n.hrAvg}` : "–"} of={n.restingHr != null ? "bpm resting" : "bpm on average"}>
          <Stats>
            {n.hrAvg != null ? <Stat v={`${n.hrAvg}`} l="average bpm" /> : null}
            {n.hrMin != null && n.hrMax != null ? <Stat v={`${n.hrMin}–${n.hrMax}`} l="lowest to highest bpm" /> : null}
            {n.hrv != null ? <Stat v={`${n.hrv} ms`} l="heart rate variability" /> : null}
            {n.spo2 != null ? <Stat v={`${n.spo2}%`} l="blood oxygen" /> : null}
            {n.respRate != null ? <Stat v={`${n.respRate}`} l="breaths a minute" /> : null}
            {n.bp ? <Stat v={`${n.bp.sys}/${n.bp.dia}`} l="blood pressure, mmHg" /> : null}
            {n.vo2max != null ? <Stat v={`${n.vo2max}`} l="VO₂ max, mL/kg/min" /> : null}
          </Stats>
        </Hero>
      ) : (
        empty
      );
    case "energy": {
      const burned = n.totalKcal ?? n.activeKcal, resting = n.totalKcal != null && n.activeKcal != null ? n.totalKcal - n.activeKcal : n.bmr;
      const balance = burned != null && n.eatenKcal != null ? n.eatenKcal - burned : null;
      return burned != null || n.eatenKcal != null ? (
        <Hero value={burned != null ? fmt(burned) : "–"} of={n.totalKcal != null ? "kcal burned" : "kcal burned moving"}>
          <Meter value={n.activeKcal ?? 0} goal={p.activeGoalKcal} color="var(--c-energy)" label={`Active calories, ${fmt(n.activeKcal ?? 0)} of ${fmt(p.activeGoalKcal)}`} />
          <Stats>
            <Stat v={n.activeKcal != null ? kcal(n.activeKcal) : "–"} l={`moving, of ${fmt(p.activeGoalKcal)}`} />
            <Stat v={resting != null ? kcal(resting) : "–"} l="at rest" />
            <Stat v={n.eatenKcal != null ? kcal(n.eatenKcal) : "–"} l="eaten" />
            {balance != null ? <Stat v={`${balance > 0 ? "+" : balance < 0 ? "−" : ""}${kcal(Math.abs(balance))}`} l={balance <= 0 ? "under what you burned" : "over what you burned"} id="hBalance" /> : null}
          </Stats>
        </Hero>
      ) : (
        empty
      );
    }
    case "exercise":
      return (
        <>
          <Hero value={hoursMin(n.exerciseMin)} of={`/ ${p.exerciseGoalMin} min`}>
            <Meter value={n.exerciseMin} goal={p.exerciseGoalMin} color="var(--c-exercise)" label={`Exercise, ${n.exerciseMin} of ${p.exerciseGoalMin} minutes`} />
          </Hero>
          {n.workouts.length ? <Sessions title="Workouts" list={n.workouts} /> : empty}
        </>
      );
    case "body":
      return n.weight || n.bodyFat ? (
        <Hero value={n.weight ? n.weight.toFixed(1) : "–"} of="kg">
          <Stats>
            {n.bodyFat != null ? <Stat v={`${n.bodyFat}%`} l="body fat" /> : null}
            {n.bmi != null ? <Stat v={`${n.bmi}`} l="body mass index" /> : null}
          </Stats>
        </Hero>
      ) : (
        empty
      );
    case "water":
      return (
        <Hero value={n.waterMl != null ? fmt(n.waterMl) : "–"} of={`/ ${fmt(p.waterGoalMl)} ml`}>
          <Meter value={n.waterMl ?? 0} goal={p.waterGoalMl} color="var(--c-water)" label={`Water, ${fmt(n.waterMl ?? 0)} of ${fmt(p.waterGoalMl)} ml`} />
        </Hero>
      );
  }
}

/** How a night compares with the goal, in minutes over (or under, negative): "46 min over", "1 h 5 min short of". */
const sleepGoalWords = (over: number) => (over > 0 ? `${hoursMin(over)} over` : over < 0 ? `${hoursMin(-over)} short of` : "Right on");

/** Steps hour by hour, with the busiest hour named. */
function HourBars({ hours }: { hours: number[] }) {
  const peak = hours.reduce((b, v, i) => (v > hours[b] ? i : b), 0);
  const [sel, setSel] = useState(peak);
  const hr = (h: number) => new Date(2026, 0, 1, h).toLocaleTimeString("en-IN", { hour: "numeric" });
  const bars: Bar[] = hours.map((v, h) => ({ x: h % 6 === 0 ? hr(h) : "", value: v, tip: `${hr(h)} to ${hr((h + 1) % 24)}: ${fmt(v)} steps` }));
  return (
    <ChartCard title="Steps by the hour" readout={bars[sel].tip} id="hHours">
      {(w) => <Bars bars={bars} color="var(--c-steps)" width={w} label="Steps by the hour" selected={sel} onSelect={setSel} fmt={(v) => fmt(Math.round(v))} />}
    </ChartCard>
  );
}

function Sessions({ title, list, dated = false }: { title: string; list: HealthWorkout[]; dated?: boolean }) {
  return (
    <section className="panel hcard" id="hSessions">
      <h2>{title}</h2>
      <ul className="sessions">
        {list.map((w) => (
          <li key={w.start}>
            <b>{workoutName(w.type)}</b>
            <span className="sub">
              {[dated ? `${longDay(w.start.slice(0, 10))}` : "", clock(w.start), hoursMin(w.min), w.kcal ? kcal(w.kcal) : "", w.km ? `${w.km} km` : "", w.source ?? ""]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
