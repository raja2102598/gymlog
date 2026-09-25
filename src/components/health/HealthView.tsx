"use client";
import { Drop, Fire, Heartbeat, Moon, PersonSimpleRun, PersonSimple, type Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { ViewLink } from "@/components/ui/ViewLink";
import { useGym } from "@/hooks/useGym";
import { fmt, syncedWhen } from "@/lib/format";
import { hoursMin, workoutName } from "@/lib/health";
import { anyHealth, dayNumbers, fromHealthConnect, type DayNumbers } from "@/lib/healthView";
import { isNative } from "@/lib/native";
import { hashOf, type Metric } from "@/lib/route";
import type { DayKey } from "@/lib/types";
import { DaySwitch, dayWords, Meter, StageBar } from "./parts";
import { Rings } from "./Rings";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

interface Props {
  day: DayKey;
  onDay: (k: DayKey) => void;
  onOpen: (m: Metric) => void;
  onOpenSettings: () => void;
}

/** The Health tab: a day of Health Connect data at a glance. Activity rings against the day's goals, then a tile
 *  for each kind of data; everything opens its own page with charts by day, week and month. */
export function HealthView({ day, onDay, onOpen, onOpenSettings }: Props) {
  const store = useGym();
  const p = store.plan, n = dayNumbers(store, day);
  if (!anyHealth(store)) {
    return (
      <section className="panel hempty" id="healthEmpty">
        <h2>No Health Connect data yet</h2>
        {isNative() ? (
          <>
            <p className="sub">Connect Health Connect to see steps, sleep, heart rate, calories, workouts, weight and water here.</p>
            <ViewLink className="primary" id="toSettings" href="#settings" onOpen={onOpenSettings}>
              Connect in Settings
            </ViewLink>
          </>
        ) : (
          <p className="sub">It comes from Health Connect, through the Gym Log Android app. Once the app has synced, it shows here too.</p>
        )}
      </section>
    );
  }
  const link = (m: Metric, cls: string, children: ReactNode, id: string) => (
    <ViewLink className={cls} id={id} href={hashOf({ view: "health", metric: m })} onOpen={() => onOpen(m)}>
      {children}
    </ViewLink>
  );
  const rows: [Metric, string, string, number | null, number, string, string][] = [
    ["steps", "Steps", "var(--c-steps)", n.steps, p.stepGoal, "", "ringSteps"],
    ["exercise", "Exercise", "var(--c-exercise)", n.exerciseMin || null, p.exerciseGoalMin, " min", "ringExercise"],
    ["energy", "Active", "var(--c-energy)", n.activeKcal, p.activeGoalKcal, " kcal", "ringActive"],
  ];
  return (
    <>
      <DaySwitch day={day} onDay={onDay} step={1} label={dayWords(day)} />
      <section className="panel activity" id="activity" aria-label="Activity">
        <Rings
          label={rows.map(([, name, , v, goal, unit]) => `${name} ${v != null ? fmt(v) : 0} of ${fmt(goal)}${unit}`).join(", ")}
          rings={rows.map(([, , color, v, goal]) => ({ value: v ?? 0, goal, color }))}
        />
        <div className="act-rows">
          {rows.map(([m, name, color, v, goal, unit, id]) =>
            link(
              m,
              "act-row",
              <>
                <span className="act-n">
                  <i style={{ background: color }} aria-hidden="true" />
                  {name}
                </span>
                <span className="act-v">
                  <b>{v != null ? fmt(v) : "–"}</b>
                  <span className="sub">
                    {" "}
                    / {fmt(goal)}
                    {unit}
                  </span>
                </span>
              </>,
              id,
            ),
          )}
          {n.km || n.floors ? (
            <p className="sub act-more">{[n.km ? `${n.km} km` : "", n.floors ? `${fmt(n.floors)} floor${n.floors === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}</p>
          ) : null}
        </div>
      </section>
      <div className="tiles">
        {link("sleep", "tile", <SleepTile n={n} />, "tileSleep")}
        {link("heart", "tile", <HeartTile n={n} />, "tileHeart")}
        {link("energy", "tile", <EnergyTile n={n} />, "tileEnergy")}
        {link("body", "tile", <BodyTile n={n} />, "tileBody")}
        {link("water", "tile", <WaterTile n={n} goal={p.waterGoalMl} />, "tileWater")}
        {link("exercise", "tile", <ExerciseTile n={n} />, "tileExercise")}
      </div>
      <p className="note" id="healthNote">
        {fromHealthConnect(store)
          ? `From Health Connect${store.healthSyncedAt ? `, synced ${syncedWhen(store.healthSyncedAt)}` : ""}.`
          : `Only the measurements you’ve typed on Today so far. Steps, sleep, heart rate and the rest come from Health Connect, ${isNative() ? "once it’s connected in Settings" : "through the Gym Log Android app"}.`}
      </p>
    </>
  );
}

function Head({ icon: I, color, title }: { icon: Icon; color: string; title: string }) {
  return (
    <span className="tile-h">
      <span className="ico" style={{ ["--c" as string]: color }} aria-hidden="true">
        <I size={18} weight="fill" />
      </span>
      {title}
    </span>
  );
}
const None = ({ hint }: { hint: string }) => (
  <>
    <span className="tile-v none">No data</span>
    <span className="tile-s">{hint}</span>
  </>
);

function SleepTile({ n }: { n: DayNumbers }) {
  return (
    <>
      <Head icon={Moon} color="var(--c-sleep)" title="Sleep" />
      {n.sleepMin ? (
        <>
          <span className="tile-v">{hoursMin(n.sleepMin)}</span>
          <span className="tile-s">{n.bed && n.wake ? `${clock(n.bed)} – ${clock(n.wake)}` : "asleep the night before"}</span>
          {n.sleepStages ? <StageBar stages={n.sleepStages} legend={false} /> : null}
        </>
      ) : (
        <None hint="From a watch or sleep tracker" />
      )}
    </>
  );
}

function HeartTile({ n }: { n: DayNumbers }) {
  const more = [n.hrAvg ? `avg ${n.hrAvg}` : "", n.hrv ? `HRV ${n.hrv} ms` : "", n.spo2 ? `SpO₂ ${Math.round(n.spo2)}%` : ""].filter(Boolean);
  return (
    <>
      <Head icon={Heartbeat} color="var(--c-heart)" title="Heart" />
      {n.restingHr || n.hrAvg ? (
        <>
          <span className="tile-v">
            {n.restingHr ?? n.hrAvg}
            <small>&nbsp;bpm</small>
          </span>
          <span className="tile-s">{[n.restingHr ? "resting" : "average", ...more.slice(n.restingHr ? 0 : 1)].join(" · ")}</span>
        </>
      ) : (
        <None hint="From a watch or heart-rate sensor" />
      )}
    </>
  );
}

function EnergyTile({ n }: { n: DayNumbers }) {
  const burned = n.totalKcal ?? n.activeKcal;
  return (
    <>
      <Head icon={Fire} color="var(--c-energy)" title="Calories" />
      {burned || n.eatenKcal ? (
        <>
          <span className="tile-v">
            {burned ? fmt(burned) : "–"}
            <small>&nbsp;kcal</small>
          </span>
          <span className="tile-s">
            {[n.totalKcal ? "burned" : n.activeKcal ? "burned moving" : "", n.eatenKcal ? `${fmt(n.eatenKcal)} eaten` : ""].filter(Boolean).join(" · ")}
          </span>
        </>
      ) : (
        <None hint="From a watch or food app" />
      )}
    </>
  );
}

function BodyTile({ n }: { n: DayNumbers }) {
  // With no weight for the day, the measurements typed on Today: the first, and how many more.
  const measured = [n.bodyFat ? ([n.bodyFat, "%", "body fat"] as const) : null, ...CM.map((f) => (n[f] ? ([n[f], "\u00a0cm", f] as const) : null))].filter((m) => m != null);
  return (
    <>
      <Head icon={PersonSimple} color="var(--c-body)" title="Body" />
      {n.weight ? (
        <>
          <span className="tile-v">
            {n.weight.toFixed(1)}
            <small>&nbsp;kg</small>
          </span>
          <span className="tile-s">{[n.bodyFat ? `${n.bodyFat}% body fat` : "", n.bmi ? `BMI ${n.bmi}` : ""].filter(Boolean).join(" · ") || "body weight"}</span>
        </>
      ) : measured.length ? (
        <>
          <span className="tile-v">
            {measured[0][0]}
            <small>{measured[0][1]}</small>
          </span>
          <span className="tile-s">{[measured[0][2], measured.length > 1 ? `${measured.length - 1} more` : ""].filter(Boolean).join(" · ")}</span>
        </>
      ) : (
        <None hint="Weigh in, or type it on Today" />
      )}
    </>
  );
}
const CM = ["chest", "arms", "thighs", "hips"] as const;

function WaterTile({ n, goal }: { n: DayNumbers; goal: number }) {
  return (
    <>
      <Head icon={Drop} color="var(--c-water)" title="Water" />
      {n.waterMl ? (
        <>
          <span className="tile-v">
            {fmt(n.waterMl)}
            <small>&nbsp;ml</small>
          </span>
          <Meter value={n.waterMl} goal={goal} color="var(--c-water)" label={`Water, ${fmt(n.waterMl)} of ${fmt(goal)} ml`} />
          <span className="tile-s">of {fmt(goal)}&nbsp;ml</span>
        </>
      ) : (
        <None hint="From a water-tracking app" />
      )}
    </>
  );
}

function ExerciseTile({ n }: { n: DayNumbers }) {
  const w = n.workouts;
  return (
    <>
      <Head icon={PersonSimpleRun} color="var(--c-exercise)" title="Exercise" />
      {w.length ? (
        <>
          <span className="tile-v">{hoursMin(n.exerciseMin)}</span>
          <span className="tile-s">{[...new Set(w.map((x) => workoutName(x.type)))].join(", ")}</span>
        </>
      ) : (
        <None hint="Workouts from a watch or fitness app" />
      )}
    </>
  );
}
