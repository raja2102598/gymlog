"use client";
import { useState } from "react";
import { InsightCallout, SegmentedControl, TabHead } from "@/components/ds/parts";
import { StepsBarChart } from "@/components/ds/StepsBarChart";
import { WeightTrendChart } from "@/components/ds/WeightTrendChart";
import { ChartCard, Stat } from "@/components/health/parts";
import { History } from "@/components/today/History";
import { ViewLink } from "@/components/ui/ViewLink";
import { useGym } from "@/hooks/useGym";
import { healthModel, HEAT_WORDS, kneeModel, musclesModel, planModel, stepsModel, strengthModel, weightModel, type HeatClass, type StrengthRow } from "@/lib/dashboard";
import { addDays, dm, mondayOf, parseKey, todayKey } from "@/lib/dates";
import { fmt, plural } from "@/lib/format";
import { hashOf } from "@/lib/route";
import { cx } from "@/lib/cx";
import type { DayKey } from "@/lib/types";
import { KneeCard } from "./KneeCard";
import { MusclesCard } from "./MusclesCard";
import { StrengthCard } from "./StrengthCard";
import { WeightCard } from "./WeightCard";

type Section = "overview" | "strength" | "body" | "muscles";
const SECTION_KEY = "gymlog.progressTab";

/** Progress (Progress board): Overview, Strength, Body and Muscles. Overview leads with the week in three numbers,
 *  the weight trend, the last 14 days' consistency and the pinned lifts. */
export function ProgressView({ onSetGoal, onOpenLift, onOpenTrain, onOpenSettings }: { onSetGoal: () => void; onOpenLift: (name: string) => void; onOpenTrain: () => void; onOpenSettings: () => void }) {
  const [tab, setTabState] = useState<Section>(() => {
    try {
      const v = sessionStorage.getItem(SECTION_KEY);
      return v === "strength" || v === "body" || v === "muscles" ? v : "overview";
    } catch {
      return "overview";
    }
  });
  const setTab = (v: Section) => {
    setTabState(v);
    try {
      sessionStorage.setItem(SECTION_KEY, v);
    } catch {
      /* not kept */
    }
  };
  const store = useGym();
  const t = todayKey();
  return (
    <>
      <TabHead eyebrow={`Week of ${parseKey(mondayOf(t)).toLocaleDateString("en-IN", { day: "numeric", month: "long" })}`} title="Progress" onProfile={onOpenSettings} />
      <div className="screen">
        <SegmentedControl
          id="progTabs"
          value={tab}
          label="Progress sections"
          onChange={setTab}
          options={[
            ["overview", "Overview"],
            ["strength", "Strength"],
            ["body", "Body"],
            ["muscles", "Muscles"],
          ]}
        />
        {tab === "overview" ? <Overview onOpenLift={onOpenLift} onAll={() => setTab("strength")} onOpenTrain={onOpenTrain} /> : null}
        {tab === "strength" ? <StrengthCard m={strengthModel(store, t)} onOpenLift={onOpenLift} /> : null}
        {tab === "body" ? <BodyTab onSetGoal={onSetGoal} /> : null}
        {tab === "muscles" ? <MusclesCard m={musclesModel(store, t)} /> : null}
      </div>
    </>
  );
}

function Overview({ onOpenLift, onAll, onOpenTrain }: { onOpenLift: (name: string) => void; onAll: () => void; onOpenTrain: () => void }) {
  const store = useGym();
  const t = todayKey();
  const weight = weightModel(store, t), strength = strengthModel(store, t), knee = kneeModel(store, t), health = healthModel(store, t), plan = planModel(store, t), steps = stepsModel(store, t);
  const flags = [...weight.flags, ...strength.flags, ...knee.flags, ...health.flags].sort((a, b) => a.pri - b.pri);
  // The week's weight change: the latest weigh-in against the first in the last seven days.
  const wk = Array.from({ length: 8 }, (_, i) => addDays(t, i - 7)).map((k) => store.weightOf(k)).filter((v): v is number => v != null);
  const wkChange = wk.length > 1 ? Math.round((wk[wk.length - 1] - wk[0]) * 100) / 100 : null;
  const toward = wkChange != null && (store.plan.goalWeight == null ? wkChange <= 0 : Math.abs(wk[wk.length - 1] - store.plan.goalWeight) <= Math.abs(wk[0] - store.plan.goalWeight));
  return (
    <>
      <div className="stats3" id="dashStats">
        <Stat v={`${plan.week.done}`} u={`of ${plan.week.planned}`} l="sessions" tone="var(--brand-text)" />
        <Stat v={steps.avg7 != null ? fmt(Math.round(steps.avg7)) : "–"} l="avg steps" tone="var(--steps-text)" />
        <Stat v={wkChange != null ? `${wkChange > 0 ? "+" : wkChange < 0 ? "−" : "±"}${Math.abs(wkChange)}` : "–"} l="kg this week" tone={wkChange != null && toward ? "var(--success)" : undefined} />
      </div>
      <section id="dashFlags" aria-live="polite" hidden={!flags.length}>
        {flags.slice(0, 2).map((f) => (
          <InsightCallout key={f.text} kind={f.warn ? "caution" : "insight"}>
            {f.text}
          </InsightCallout>
        ))}
      </section>
      <WeightTrendCard />
      <Consistency t={t} />
      <Pinned rows={strength.rows} onOpenLift={onOpenLift} onAll={onAll} anyLogged={strength.anyLogged} onOpenTrain={onOpenTrain} />
      {steps.bars.some(([, v]) => v != null) ? (
        <ChartCard id="dashSteps" title="Steps by week" caption={`${steps.atGoal} of ${steps.daysSoFar} days at ${fmt(steps.goal)} this week`}>
          {(w) => (
            <StepsBarChart
              bars={steps.bars.map(([m, v], i) => ({ x: i === steps.bars.length - 1 ? "This wk" : i % 2 ? "" : dm(m), value: v, today: i === steps.bars.length - 1, tip: `Week of ${dm(m)} · ${v != null ? `${fmt(Math.round(v))} a day` : "no data"}` }))}
              tone="steps"
              width={w}
              height={170}
              goal={{ value: steps.goal, short: steps.goal >= 1000 ? `${Math.round(steps.goal / 100) / 10}k` : String(steps.goal) }}
              label={`Average daily steps by week, the last ${steps.bars.length} weeks.`}
            />
          )}
        </ChartCard>
      ) : null}
      <History />
    </>
  );
}

/** The weight trend over the last 14 days (WeightTrendChart spec), with its change in a chip. */
function WeightTrendCard() {
  const store = useGym();
  const t = todayKey(), days = Array.from({ length: 14 }, (_, i) => addDays(t, i - 13));
  const pts = days.map((k) => {
    const v = store.weightOf(k);
    return { value: v, tip: `${parseKey(k).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} · ${v != null ? `${v} kg` : "no weigh-in"}` };
  });
  const have = days.map((k) => [k, store.weightOf(k)] as const).filter((p): p is readonly [DayKey, number] => p[1] != null);
  const latest = [...store.weightSeries()].reverse().find((p) => p.measured);
  const change = have.length > 1 ? Math.round((have[have.length - 1][1] - have[0][1]) * 10) / 10 : null;
  const good = change != null && (store.plan.goalWeight == null ? change <= 0 : Math.abs(have[have.length - 1][1] - store.plan.goalWeight) <= Math.abs(have[0][1] - store.plan.goalWeight));
  return (
    <ChartCard
      id="dashWeight"
      caption={undefined}
      aside={change != null ? <span className={cx("pill", good ? "good" : "")}>{`${change < 0 ? "↓" : change > 0 ? "↑" : "±"} ${Math.abs(change)} kg · 14 days`}</span> : null}
      value={
        <>
          <span className="trend-lab">Body weight</span>
          {latest ? latest.weight.toFixed(1) : "–"}
        </>
      }
      unit={latest ? "kg" : undefined}
    >
      {(w) =>
        have.length ? (
          <WeightTrendChart
            points={pts}
            tone="body"
            width={w}
            axis={[dm(days[0]), dm(days[6]), "Today"]}
            label={have.length > 1 ? `Body weight, 14 days: daily readings went from ${have[0][1]} kg to ${have[have.length - 1][1]} kg; the smoothed trend is ${change! < 0 ? "falling" : change! > 0 ? "rising" : "steady"}.` : `Body weight: one reading, ${have[0][1]} kg.`}
          />
        ) : (
          <p className="empty">Log your weight on Home to start the trend.</p>
        )
      }
    </ChartCard>
  );
}

const CELL: Record<HeatClass, string> = { done: "done", part: "part", miss: "miss", todo: "todo", rest: "rest", fut: "fut", pre: "pre" };

/** The last 14 days as squares (Consistency): a full workout, a partial one, rest, missed; today outlined. */
function Consistency({ t }: { t: DayKey }) {
  const store = useGym();
  const plan = planModel(store, t);
  const byDay = new Map(plan.heat.flat().map((c) => [c.day, c.cls]));
  const days = Array.from({ length: 14 }, (_, i) => addDays(t, i - 13));
  const { done, planned, weeks } = plan.recent;
  return (
    <section className="card" id="dashPlan" aria-labelledby="consH">
      <div className="card-h">
        <h2 id="consH">Consistency</h2>
        <span className="label">last 14 days</span>
      </div>
      <div className="cons" role="img" aria-label={`Last 14 days: ${days.filter((k) => byDay.get(k) === "done").length} full workouts, ${days.filter((k) => byDay.get(k) === "part").length} partial, ${days.filter((k) => byDay.get(k) === "miss").length} missed.`}>
        {days.map((k) => {
          const cls = byDay.get(k) ?? "pre";
          return (
            <span key={k} className={cx("cell", CELL[cls], k === t && "now")} title={`${dm(k)}: ${HEAT_WORDS[cls]}`}>
              {parseKey(k).getDate()}
            </span>
          );
        })}
      </div>
      <p className="legend">
        <span>
          <i className="done" />
          Workout
        </span>
        <span>
          <i className="part" />
          Part done
        </span>
        <span>
          <i className="miss" />
          Missed
        </span>
        <span>
          <i className="rest" />
          Rest
        </span>
      </p>
      <p className="note" id="planKept">
        {`${plan.week.done} of ${plan.week.planned} this week${plan.week.extra ? `, and ${plan.week.extra} extra` : ""} · ${plural(plan.streak, "full week")} in a row · ${planned ? Math.round((done / planned) * 100) : 0}% of sessions ${weeks > 1 ? `in ${weeks} weeks` : "this week"}`}
      </p>
    </section>
  );
}

/** Three lifts to watch: the ones most recently trained, each with its change chip. */
function Pinned({ rows, onOpenLift, onAll, anyLogged, onOpenTrain }: { rows: StrengthRow[]; onOpenLift: (n: string) => void; onAll: () => void; anyLogged: boolean; onOpenTrain: () => void }) {
  const pinned = rows
    .filter((r) => r.points.length)
    .sort((a, b) => (b.points[b.points.length - 1][0] > a.points[a.points.length - 1][0] ? 1 : -1))
    .slice(0, 3);
  return (
    <>
      <div className="sec-h">
        <h2 className="title-sm">Pinned lifts</h2>
        <button type="button" className="btn-link btn" id="allLifts" onClick={onAll}>
          All {rows.length} lifts
        </button>
      </div>
      {pinned.length ? (
        <ul className="list" id="pinned">
          {pinned.map((r) => {
            const first = r.points[0][1], last = r.points[r.points.length - 1][1], d = Math.round((last - first) * 2) / 2;
            return (
              <li key={r.name}>
                <ViewLink className="row" href={hashOf({ view: "progress", lift: r.name })} onOpen={() => onOpenLift(r.name)}>
                  <span className="row-t">
                    <span className="row-tt">{r.name}</span>
                    <span className="row-d">Estimated 1RM {Math.round(last)} kg</span>
                  </span>
                  <span className={cx("pill", d > 0 ? "brand" : "")}>{d > 0 ? `+${d} kg` : d < 0 ? `${d} kg` : "Steady"}</span>
                </ViewLink>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="card">
          <p className="empty">{anyLogged ? "Lifts show here once they have a set with weight and 1 to 12 reps." : "Log a session to start tracking strength."}</p>
          {anyLogged ? null : (
            <button type="button" className="btn" onClick={onOpenTrain}>
              Go to Train
            </button>
          )}
        </div>
      )}
    </>
  );
}

function BodyTab({ onSetGoal }: { onSetGoal: () => void }) {
  const store = useGym();
  const t = todayKey();
  return (
    <>
      <WeightCard m={weightModel(store, t)} onSetGoal={onSetGoal} />
      <KneeCard m={kneeModel(store, t)} />
    </>
  );
}
