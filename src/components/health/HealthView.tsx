"use client";
import { ChevronLeft, ChevronRight, Droplet, Flame, Footprints, HeartPulse, Minus, Moon, Plus, Weight as WeightIcon } from "lucide-react";
import { ActivityRings, RingLegend } from "@/components/ds/ActivityRings";
import { METRIC_INK, MetricTile } from "@/components/ds/MetricTile";
import { InsightCallout, LinkButton, MiniRange, StageLanes, TabHead } from "@/components/ds/parts";
import { MiniBars } from "@/components/ds/StepsBarChart";
import { ViewLink } from "@/components/ui/ViewLink";
import { useGym } from "@/hooks/useGym";
import { addDays, todayKey } from "@/lib/dates";
import { fmt, syncedWhen } from "@/lib/format";
import { hoursMin } from "@/lib/health";
import { dayNumbers, daysTo, fromHealthConnect } from "@/lib/healthView";
import { isNative } from "@/lib/native";
import { hashOf, type Metric } from "@/lib/route";
import type { DayKey } from "@/lib/types";
import { dayWords } from "./parts";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toLowerCase();

interface Props {
  day: DayKey;
  onDay: (k: DayKey) => void;
  onOpen: (m: Metric) => void;
  onOpenSettings: () => void;
  onOpenTrain: () => void;
}

/** The Health tab (Health board): the day's activity rings against its goals, then a tile per kind of data with a
 *  mini chart, water added in place, and one insight. Each tile opens the metric's own page. */
export function HealthView({ day, onDay, onOpen, onOpenSettings }: Props) {
  const store = useGym();
  const p = store.plan, n = dayNumbers(store, day), t = todayKey();
  const hc = fromHealthConnect(store);
  const week = daysTo(day, 7), wn = week.map((k) => dayNumbers(store, k));
  const link = (m: Metric) => ({ href: hashOf({ view: "health", metric: m }), onOpen: () => onOpen(m) });
  const rows = [
    { tone: "steps" as const, name: "Steps", v: n.steps ?? 0, goal: p.stepGoal, unit: "", m: "steps" as Metric, id: "ringSteps" },
    { tone: "active" as const, name: "Active time", v: n.exerciseMin, goal: p.exerciseGoalMin, unit: " min", m: "exercise" as Metric, id: "ringExercise" },
    { tone: "energy" as const, name: "Active calories", v: n.activeKcal ?? 0, goal: p.activeGoalKcal, unit: " kcal", m: "energy" as Metric, id: "ringActive" },
  ];
  // Body: the change over the week to this day, toward the goal weight counting as good.
  const weights = wn.map((x) => x.weight).filter((w): w is number => w != null);
  const change = weights.length > 1 ? Math.round((weights[weights.length - 1] - weights[0]) * 100) / 100 : null;
  const goodWay = change != null && (p.goalWeight == null ? change <= 0 : Math.abs((n.weight ?? weights[weights.length - 1]) - p.goalWeight) < Math.abs(weights[0] - p.goalWeight));
  const burned = n.totalKcal ?? n.activeKcal;
  const water = n.waterMl ?? 0;
  return (
    <>
      <TabHead
        eyebrow={hc ? `Health Connect${store.healthSyncedAt ? ` · synced ${syncedWhen(store.healthSyncedAt)}` : ""}` : "Logged in Gym Log"}
        eyebrowId="healthNote"
        title="Health"
        action={
          <LinkButton variant="raised" id="editGoals" href="#settings" aria-label="Edit daily goals" onOpen={onOpenSettings}>
            Edit
          </LinkButton>
        }
      />
      <div className="screen">
        {!hc ? (
          <section className="card" id="healthEmpty">
            <h2 className="title-sm">No Health Connect data yet</h2>
            {isNative() ? (
              <>
                <p className="sub">Connect it to see steps, sleep, heart rate, calories, workouts and weight here.</p>
                <LinkButton variant="primary" id="toSettings" href="#settings" onOpen={onOpenSettings}>
                  Connect in Settings
                </LinkButton>
              </>
            ) : (
              <p className="sub">It comes through the Gym Log Android app. Once the app has synced, it shows here too. Until then, what you log in Gym Log shows.</p>
            )}
          </section>
        ) : null}
        <section className="card activity" id="activity" aria-labelledby="activityH">
          <div className="card-h">
            <h2 id="activityH">Daily activity</h2>
            <div className="dayswitch">
              <button type="button" className="btn btn-icon btn-quiet" id="hPrev" aria-label="Previous day" onClick={() => onDay(addDays(day, -1))}>
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <span className="label" aria-live="polite">
                {dayWords(day)}
              </span>
              <button type="button" className="btn btn-icon btn-quiet" id="hNext" aria-label="Next day" disabled={day >= t} onClick={() => onDay(addDays(day, 1))}>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="activity-body">
            <ActivityRings
              size="health"
              rings={rows.map((r) => ({ tone: r.tone, value: r.v, goal: r.goal }))}
              label={rows.map((r) => `${r.name} ${fmt(r.v)} of ${fmt(r.goal)}${r.unit}, ${Math.round((r.v / r.goal) * 100)}%`).join("; ")}
            />
            <RingLegend rows={rows.map((r) => ({ tone: r.tone, name: r.name, value: fmt(r.v), goal: `${fmt(r.goal)}${r.unit}`, id: r.id, ...link(r.m) }))} />
          </div>
        </section>

        <div className="grid2 tiles">
          <MetricTile
            id="tileSteps"
            icon={Footprints}
            name="Steps"
            ink={METRIC_INK.steps}
            value={n.steps != null ? fmt(n.steps) : "–"}
            support={n.km ? `${n.km} km ${day === t ? "today" : ""}`.trim() : `of ${fmt(p.stepGoal)}`}
            chart={<MiniBars values={wn.map((x) => x.steps)} goal={p.stepGoal} tone="steps" />}
            {...link("steps")}
          />
          <MetricTile
            id="tileSleep"
            icon={Moon}
            name="Sleep"
            ink={METRIC_INK.sleep}
            value={n.sleepMin ? hoursMin(n.sleepMin) : "–"}
            support={n.sleepMin ? (n.bed && n.wake ? `${clock(n.bed)} – ${clock(n.wake)}` : "the night before") : "From a watch or tracker"}
            chart={n.sleepStages ? <StageLanes stages={n.sleepStages} /> : null}
            {...link("sleep")}
          />
          <MetricTile
            id="tileHeart"
            icon={HeartPulse}
            name="Heart"
            ink={METRIC_INK.heart}
            value={n.restingHr ?? n.hrAvg ?? "–"}
            unit={n.restingHr ?? n.hrAvg ? "bpm" : undefined}
            support={n.restingHr || n.hrAvg ? [n.restingHr ? "resting" : "average", n.hrv ? `HRV ${n.hrv} ms` : ""].filter(Boolean).join(" · ") : "From a watch or sensor"}
            chart={<MiniRange days={wn.map((x) => ({ lo: x.hrMin, hi: x.hrMax, rest: x.restingHr }))} />}
            {...link("heart")}
          />
          <MetricTile
            id="tileEnergy"
            icon={Flame}
            name="Calories"
            ink={METRIC_INK.energy}
            value={burned != null ? fmt(burned) : "–"}
            unit={burned != null ? "kcal" : undefined}
            support={burned != null || n.eatenKcal ? [n.totalKcal ? "burned" : n.activeKcal ? "burned moving" : "", n.eatenKcal ? `${fmt(n.eatenKcal)} eaten` : ""].filter(Boolean).join(" · ") : "From a watch or food app"}
            chart={
              n.activeKcal != null ? (
                <span className="mt-track" style={{ ["--tt" as string]: "var(--line-strong)", ["--tf" as string]: "var(--energy)" }} role="img" aria-label={`Active calories ${fmt(n.activeKcal)} of ${fmt(p.activeGoalKcal)}`}>
                  <i style={{ width: `${Math.min(100, (n.activeKcal / p.activeGoalKcal) * 100)}%` }} />
                </span>
              ) : null
            }
            {...link("energy")}
          />
          <MetricTile
            id="tileBody"
            icon={WeightIcon}
            name="Body"
            ink={METRIC_INK.body}
            value={n.weight != null ? n.weight.toFixed(1) : "–"}
            unit={n.weight != null ? "kg" : undefined}
            support={n.weight != null ? [n.bodyFat ? `${n.bodyFat}% body fat` : "", n.bmi ? `BMI ${n.bmi}` : ""].filter(Boolean).join(" · ") || "body weight" : "Weigh in, or log it in Train"}
            chart={
              change != null ? (
                <span className={goodWay ? "mt-good" : "mt-s"}>
                  {change < 0 ? "↓" : change > 0 ? "↑" : "±"} {Math.abs(change).toFixed(2).replace(/0$/, "")} kg this week
                </span>
              ) : null
            }
            {...link("body")}
          />
          <div className="tile" id="tileWaterBox">
            <ViewLink className="mt-l mt-link" id="tileWater" href={hashOf({ view: "health", metric: "water" })} onOpen={() => onOpen("water")} style={{ color: METRIC_INK.water }}>
              <Droplet size={16} aria-hidden="true" />
              Water
            </ViewLink>
            <span className="mt-v" id="waterValue">
              {fmt(water)}
              <span className="u"> ml</span>
            </span>
            <span className="mt-s">of {fmt(p.waterGoalMl)} ml</span>
            <span className="mt-c">
              <span className="mt-track" style={{ ["--tt" as string]: "var(--water-tint)", ["--tf" as string]: "var(--water)" }} role="meter" aria-valuemin={0} aria-valuemax={p.waterGoalMl} aria-valuenow={water} aria-label={`Water, ${fmt(water)} of ${fmt(p.waterGoalMl)} ml`}>
                <i style={{ width: `${Math.min(100, (water / p.waterGoalMl) * 100)}%` }} />
              </span>
              <span className="water-btns">
                <button type="button" className="btn" id="waterMinus" aria-label="Remove 250 ml of water" disabled={!water} onClick={() => store.addWater(day, -250)}>
                  <Minus size={20} aria-hidden="true" />
                </button>
                <button type="button" className="btn add" id="waterPlus" aria-label="Add 250 ml of water" onClick={() => store.addWater(day, 250)}>
                  <Plus size={20} aria-hidden="true" />
                </button>
              </span>
            </span>
          </div>
        </div>
        <Insight day={day} />
      </div>
    </>
  );
}

/** One coach line under the tiles: the steps left to the goal today, or the goal met, or sleep short of its goal. */
function Insight({ day }: { day: DayKey }) {
  const store = useGym();
  const p = store.plan, n = dayNumbers(store, day), t = todayKey();
  let text = "";
  if (n.steps != null && n.steps < p.stepGoal && day === t) {
    const left = p.stepGoal - n.steps, min = Math.max(5, Math.round(left / 110 / 5) * 5);
    text = `${fmt(left)} steps to go. A ${min}-minute walk ${new Date().getHours() >= 17 ? "after dinner " : ""}will close it.`;
  } else if (n.steps != null && n.steps >= p.stepGoal) text = `Steps goal reached with ${fmt(n.steps)}. Nice work.`;
  else if (n.sleepMin && n.sleepMin < p.sleepGoalH * 60) text = `${hoursMin(p.sleepGoalH * 60 - n.sleepMin)} short of your sleep goal. An earlier night would help recovery.`;
  if (!text) return null;
  return <InsightCallout id="healthInsight">{text}</InsightCallout>;
}
