"use client";
import { Check, ChevronRight, Droplet, Play, Plus, Weight as WeightIcon } from "lucide-react";
import { useState } from "react";
import { ActivityRings, RingLegend } from "@/components/ds/ActivityRings";
import { Button, InsightCallout, PainScale, TabHead } from "@/components/ds/parts";
import { WeekStrip } from "@/components/ds/WeekStrip";
import { SyncedInput } from "@/components/ui/SyncedField";
import { ViewLink } from "@/components/ui/ViewLink";
import type { FocusNext } from "@/hooks/useFocusNext";
import { useGym } from "@/hooks/useGym";
import { addDays, DOW, todayKey } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { hoursMin, workoutName } from "@/lib/health";
import { dayNumbers } from "@/lib/healthView";
import { sessionSummary, weekPosition } from "@/lib/session";
import { firstName } from "@/components/ds/ProfileButton";
import type { DayKey, KneeField } from "@/lib/types";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toLowerCase();

const greeting = (h: number) => (h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");

interface Props {
  onOpenDay: (k: DayKey) => void;
  onStart: (k: DayKey) => void;
  onOpenSettings: () => void;
  onOpenHealth: () => void;
  focusNext: FocusNext;
}

/** Home: today at a glance. The greeting, the week, today's workout (the hero), the day's activity rings, water and
 *  weight quick-adds, and what the day holds. */
export function HomeView({ onOpenDay, onStart, onOpenSettings, onOpenHealth, focusNext }: Props) {
  const store = useGym();
  const t = todayKey(), name = firstName(store.user?.user_metadata);
  const date = new Date(`${t}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  return (
    <>
      <TabHead
        eyebrow={date}
        title={name ? `${greeting(new Date().getHours())}, ${name}` : greeting(new Date().getHours())}
        onProfile={onOpenSettings}
      />
      <div className="screen">
        <WeekStrip onOpen={onOpenDay} />
        <WorkoutCard t={t} onStart={onStart} onOpenDay={onOpenDay} focusNext={focusNext} />
        <Activity t={t} onOpen={onOpenHealth} />
        <QuickAdds t={t} focusNext={focusNext} />
        <Timeline t={t} />
      </div>
    </>
  );
}

/* ---------- today's workout ---------- */

function WorkoutCard({ t, onStart, onOpenDay, focusNext }: { t: DayKey; onStart: (k: DayKey) => void; onOpenDay: (k: DayKey) => void; focusNext: FocusNext }) {
  const store = useGym();
  const p = store.planFor(t), e = store.entry(t), free = e.free ?? null;
  const items = store.liftsFor(t).filter((it) => !it.extra);
  const sum = sessionSummary(store, t), pos = weekPosition(store, t);
  const done = items.length > 0 && items.every((it) => e.exercises[it.name]?.done || e.exercises[it.name]?.skipped);
  const started = store.worked(t);
  const [kneeOpen, setKneeOpen] = useState(false);
  const lim = store.plan.kneeLimit;
  const score = (f: KneeField, v: number) =>
    store.editDay(
      t,
      (n) => {
        n[f] = v;
      },
      true,
    );
  const knee = store.kneeDay(t);
  const yest = addDays(t, -1), wake = store.kneeDay(yest) && (store.worked(yest) || store.entry(yest).kneeAfter != null);
  const rest = !items.length && !free;
  const missed = rest ? store.missedThisWeek(t) : [];
  const title = free ? free.name.trim() || "Free workout" : rest ? "Rest day" : p.name;
  const skipped = !rest && e.skip != null;
  const sub = skipped
    ? ["Skipped today", e.skip?.trim()].filter(Boolean).join(" · ")
    : rest
    ? missed.length
      ? `Missed this week: ${missed.map((i) => `${store.plan.days[i].name} (${DOW[i]})`).join(", ")}.`
      : "Recover today. A walk counts."
    : [`${sum.lifts} lift${sum.lifts === 1 ? "" : "s"}`, `${sum.sets} sets`, sum.min ? `about ${sum.min} min` : ""].filter(Boolean).join(" · ") + (p.cardio.name && !free ? `, then ${p.cardio.name.toLowerCase()}` : "");
  return (
    <section className="card hero today-card" id="todayCard" aria-labelledby="todayName">
      <div className="card-h">
        <span className="eyebrow brand">Today’s workout</span>
        {pos && !free ? <span className="label">{`Week ${pos.week} · Day ${pos.day} of ${pos.of}`}</span> : null}
      </div>
      <div>
        <h2 className="hero-t" id="todayName">
          {title}
        </h2>
        <p className="sub" id="todaySub">
          {sub}
        </p>
      </div>
      {wake ? (
        <PainScale
          name="kneeWake"
          value={e.kneeWake}
          limit={lim}
          title="Knee on waking"
          aside={`after ${store.planFor(yest).name}`}
          label="Knee pain on waking, from 0 to 10"
          onPick={(v) => score("kneeWake", v)}
        />
      ) : null}
      {/* Not on a skipped day: there's no session for it to be before. */}
      {knee && !rest && !skipped ? (
        e.kneeBefore != null && !kneeOpen ? (
          <InsightCallout
            kind="caution"
            id="kneeNote"
            label={`Knee ${e.kneeBefore} out of 10 today. Change it`}
            onClick={() => {
              setKneeOpen(true);
              focusNext(`[data-knee="kneeBefore:${e.kneeBefore}"]`);
            }}
          >
            {e.kneeBefore > lim ? `Knee ${e.kneeBefore}/10 today. Knee lifts hold their weight.` : `Knee ${e.kneeBefore}/10 today. Keep knee lifts light.`}
          </InsightCallout>
        ) : (
          <PainScale
            name="kneeBefore"
            value={e.kneeBefore}
            limit={lim}
            title="How’s the knee today?"
            aside={`limit ${lim}`}
            label="Knee pain before you start, from 0 to 10"
            onPick={(v) => {
              score("kneeBefore", v);
              setKneeOpen(false);
              focusNext("#kneeNote");
            }}
          />
        )
      ) : null}
      {rest ? (
        <div className="btn-row">
          {missed.map((i) => (
            <Button
              key={i}
              variant="primary"
              data-catch={i}
              onClick={() =>
                store.editDay(
                  t,
                  (n) => {
                    n.session = i;
                  },
                  true,
                )
              }
            >
              Do {store.plan.days[i].name}
            </Button>
          ))}
          <Button
            id="freeStartHome"
            onClick={() => {
              store.startFree(t);
              onOpenDay(t);
              focusNext("#freeName");
            }}
          >
            Start an empty workout
          </Button>
        </div>
      ) : skipped ? (
        <div className="btn-row start-row">
          <Button id="unskipHome" className="grow" onClick={() => store.unskipDay(t)}>
            Undo skip
          </Button>
        </div>
      ) : (
        <div className="btn-row start-row">
          <Button variant="primary" id="startWorkout" className="grow" onClick={() => onStart(t)}>
            {done ? <Check size={18} aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}
            {done ? "Workout done" : started ? "Continue" : "Start workout"}
          </Button>
          <Button id="viewLifts" size="lg" onClick={() => onOpenDay(t)}>
            View lifts
          </Button>
        </div>
      )}
      {!rest && !skipped && !done && !started ? (
        <button type="button" className="btn btn-sm btn-quiet skip-today" id="skipHome" onClick={() => store.skipDay(t)}>
          Skip today’s workout
        </button>
      ) : null}
    </section>
  );
}

/* ---------- daily activity ---------- */

function Activity({ t, onOpen }: { t: DayKey; onOpen: () => void }) {
  const store = useGym();
  const p = store.plan, n = dayNumbers(store, t);
  const rows = [
    { tone: "steps" as const, name: "Steps", v: n.steps ?? 0, goal: p.stepGoal, unit: "" },
    { tone: "active" as const, name: "Exercise", v: n.exerciseMin, goal: p.exerciseGoalMin, unit: " min" },
    { tone: "energy" as const, name: "Active calories", v: n.activeKcal ?? 0, goal: p.activeGoalKcal, unit: " kcal" },
  ];
  return (
    <ViewLink className="card activity" id="homeActivity" href="#health" onOpen={onOpen}>
      <span className="card-h">
        <span className="title-sm">Daily activity</span>
        <ChevronRight size={18} className="chev" aria-hidden="true" />
      </span>
      <span className="activity-body">
        <ActivityRings
          size="home"
          rings={rows.map((r) => ({ tone: r.tone, value: r.v, goal: r.goal }))}
          label={rows.map((r) => `${r.name} ${Math.round((r.v / r.goal) * 100)}%`).join(", ")}
        />
        <RingLegend rows={rows.map((r) => ({ tone: r.tone, name: r.name, value: fmt(r.v), goal: `${fmt(r.goal)}${r.unit}` }))} />
      </span>
    </ViewLink>
  );
}

/* ---------- water and weight ---------- */

function QuickAdds({ t, focusNext }: { t: DayKey; focusNext: FocusNext }) {
  const store = useGym();
  const [weighing, setWeighing] = useState(false);
  const water = store.waterOf(t), w = store.weightOf(t);
  const last = w ?? [...store.weightSeries()].reverse().find((p) => p.measured)?.weight ?? null;
  return (
    <div className="grid2">
      <div className="card quick" id="quickWater">
        <div className="quick-t">
          <span className="mt-l" style={{ color: "var(--water)" }}>
            <Droplet size={16} aria-hidden="true" />
            Water
          </span>
          <span className="quick-v" id="waterToday">
            {fmt(water ?? 0)}
            <span className="u"> ml</span>
          </span>
        </div>
        <button type="button" className="btn btn-icon tint t-water" id="waterAdd" aria-label="Add 250 ml of water" onClick={() => store.addWater(t, 250)}>
          <Plus size={24} aria-hidden="true" />
        </button>
      </div>
      <div className="card quick" id="quickWeight">
        {weighing ? (
          <label className="field quick-field" htmlFor="homeWeight">
            <span>Weight today (kg)</span>
            <SyncedInput
              id="homeWeight"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              placeholder={last != null ? String(last) : "kg"}
              value={store.entry(t).weight}
              onChange={(ev) =>
                store.editDay(
                  t,
                  (n) => {
                    n.weight = ev.target.value === "" ? null : Math.round(+ev.target.value * 10) / 10;
                  },
                  false,
                )
              }
              onBlur={() => setWeighing(false)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") setWeighing(false);
              }}
            />
          </label>
        ) : (
          <>
            <div className="quick-t">
              <span className="mt-l" style={{ color: "var(--body)" }}>
                <WeightIcon size={16} aria-hidden="true" />
                Weight
              </span>
              <span className="quick-v" id="weightToday">
                {last != null ? last.toFixed(1) : "–"}
                <span className="u"> kg</span>
              </span>
            </div>
            <button
              type="button"
              className="btn btn-icon tint t-body"
              id="weightAdd"
              aria-label="Log weight"
              onClick={() => {
                setWeighing(true);
                focusNext("#homeWeight");
              }}
            >
              <Plus size={24} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- the day's timeline ---------- */

function Timeline({ t }: { t: DayKey }) {
  const store = useGym();
  const n = dayNumbers(store, t), p = store.planFor(t), e = store.entry(t), free = e.free ?? null;
  const items: { at: string; what: string; kind: "past" | "next" | "later" | "skipped"; key: string }[] = [];
  if (n.sleepMin) items.push({ key: "sleep", at: n.wake ? clock(n.wake) : "Last night", what: `${n.wake ? "Woke up · " : ""}${hoursMin(n.sleepMin)} sleep`, kind: "past" });
  for (const w of n.workouts) items.push({ key: w.start, at: clock(w.start), what: `${workoutName(w.type)} · ${hoursMin(w.min)}`, kind: "past" });
  const lifts = store.liftsFor(t).filter((it) => !it.extra);
  if (lifts.length || free) {
    const done = lifts.length > 0 && lifts.every((it) => e.exercises[it.name]?.done || e.exercises[it.name]?.skipped);
    // Skipped today (Home's card, Train's Skip day): said so, with why, and no cardio "after lifting" to come.
    const skipped = !done && e.skip != null;
    const name = free ? free.name.trim() || "Free workout" : `${p.name} workout`;
    if (skipped) items.push({ key: "lift", at: "Skipped", what: [name, e.skip?.trim()].filter(Boolean).join(" · "), kind: "skipped" });
    else items.push({ key: "lift", at: done ? "Done" : "Up next", what: `${name}${lifts.length ? ` · ${lifts.length} lift${lifts.length === 1 ? "" : "s"}` : ""}`, kind: done ? "past" : "next" });
    if (p.cardio.name && !free && (!skipped || e.cardio)) items.push({ key: "cardio", at: e.cardio ? "Done" : "After lifting", what: [p.cardio.name, p.cardio.detail].filter(Boolean).join(" · "), kind: e.cardio ? "past" : "later" });
  }
  if (!items.length) return null;
  return (
    <section className="card timeline" id="timeline" aria-labelledby="timelineH">
      <h2 className="title-sm" id="timelineH">
        Today
      </h2>
      <ol className="tl">
        {items.map((it) => (
          <li key={it.key} className={`tl-i ${it.kind}`} data-k={it.key === "sleep" ? "sleep" : undefined}>
            <span className="tl-rail" aria-hidden="true">
              <i />
            </span>
            <span className="tl-t">
              <span className="tl-at">{it.at}</span>
              <span className="tl-w">{it.what}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
