"use client";
import { Check, Trophy } from "lucide-react";
import { useState } from "react";
import { ActivityRings } from "@/components/ds/ActivityRings";
import { Button, PainScale } from "@/components/ds/parts";
import { useGym } from "@/hooks/useGym";
import { fmt } from "@/lib/format";
import { dayNumbers } from "@/lib/healthView";
import { dayBests, dayTotals, longDay } from "@/lib/session";
import { PR_WORDS } from "@/lib/store";
import type { DayKey } from "@/lib/types";
import { clock, runOf, runSeconds } from "@/lib/workout";

/** Workout complete (its board): a check badge, the session's duration, kg lifted and sets, the day's personal
 *  bests, the knee after the session, where the day's rings stand, and Share and Done. */
export function CompleteView({ day, onDone }: { day: DayKey; onDone: () => void }) {
  const store = useGym();
  const p = store.planFor(day), e = store.entry(day), free = e.free ?? null;
  const name = free ? free.name.trim() || "Free workout" : p.name;
  const run = runOf(day), totals = dayTotals(store, day), bests = dayBests(store, day);
  const [shared, setShared] = useState("");
  const n = dayNumbers(store, day), plan = store.plan;
  const rings = [
    { tone: "steps" as const, name: "Steps", v: n.steps ?? 0, goal: plan.stepGoal },
    { tone: "active" as const, name: "Exercise", v: n.exerciseMin, goal: plan.exerciseGoalMin },
    { tone: "energy" as const, name: "Active calories", v: n.activeKcal ?? 0, goal: plan.activeGoalKcal },
  ];
  const met = rings.filter((r) => r.v >= r.goal).map((r) => r.name.toLowerCase());
  const stepsLeft = Math.max(0, plan.stepGoal - (n.steps ?? 0));
  const summary = `${name}: ${totals.sets} sets, ${fmt(totals.kg)} kg lifted${run ? ` in ${clock(runSeconds(run))}` : ""}.${bests.length ? ` ${bests.length} personal best${bests.length === 1 ? "" : "s"}.` : ""}`;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: "Gym Log", text: summary });
      else {
        await navigator.clipboard.writeText(summary);
        setShared("Copied to the clipboard.");
      }
    } catch {
      /* cancelled */
    }
  };
  return (
    <div className="complete">
      <div className="done-top">
        <span className="done-badge" aria-hidden="true">
          <span>
            <Check size={34} strokeWidth={3} />
          </span>
        </span>
        <h1 id="screenTitle">Workout complete</h1>
        <p className="sub">
          {name} · {longDay(day)}
        </p>
      </div>
      <div className="screen">
        <div className="stats3" id="doneStats">
          <div className="stat">
            <div className="v">{run ? clock(runSeconds(run)) : "–"}</div>
            <div className="l">duration</div>
          </div>
          <div className="stat">
            <div className="v">{fmt(totals.kg)}</div>
            <div className="l">kg lifted</div>
          </div>
          <div className="stat">
            <div className="v">
              {totals.sets}
              <span className="u">/{totals.planned}</span>
            </div>
            <div className="l">sets</div>
          </div>
        </div>
        {bests.length ? (
          <section className="card pbs" id="doneBests" aria-labelledby="pbH">
            <h2 className="pb-h" id="pbH">
              <Trophy size={18} aria-hidden="true" />
              {bests.length} personal best{bests.length === 1 ? "" : "s"}
            </h2>
            <ul className="pb-list">
              {bests.map((b) => (
                <li key={b.lift}>
                  <span className="lift-t">{b.lift}</span>
                  <span className="pb-v">
                    {b.kg != null ? `${b.kg} kg` : ""}
                    {b.reps != null ? ` × ${b.reps}` : ""} <span className="pb-k">{b.kinds.map((k) => PR_WORDS[k]).join(", ")}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {store.kneeDay(day) ? (
          <section className="card" id="doneKnee">
            <PainScale
              name="kneeAfter"
              value={e.kneeAfter}
              limit={plan.kneeLimit}
              title="How’s the knee now?"
              aside={e.kneeBefore != null ? `before: ${e.kneeBefore}` : undefined}
              label="Knee pain after the session, from 0 to 10"
              onPick={(v) =>
                store.editDay(
                  day,
                  (x) => {
                    x.kneeAfter = v;
                  },
                  true,
                )
              }
            />
            {e.kneeAfter != null && e.kneeAfter > plan.kneeLimit ? <p className="note">Above your limit: knee lifts hold their weight next time.</p> : null}
          </section>
        ) : null}
        <section className="card ring-sum" id="doneRings">
          <ActivityRings size="inline" rings={rings.map((r) => ({ tone: r.tone, value: r.v, goal: r.goal }))} label={rings.map((r) => `${r.name} ${Math.round((r.v / r.goal) * 100)}%`).join(", ")} />
          <p>
            {met.length ? <b>{`${met.join(" and ")[0].toUpperCase()}${met.join(" and ").slice(1)} goal${met.length > 1 ? "s" : ""} reached.`}</b> : null}{" "}
            {stepsLeft ? `${fmt(stepsLeft)} steps left for today.` : met.length ? "" : "Every goal is closed for today."}
          </p>
        </section>
        <p className="note" role="status">
          {shared}
        </p>
      </div>
      <div className="wfoot row2">
        <Button size="lg" className="share" id="shareBtn" onClick={() => void share()}>
          Share
        </Button>
        <Button variant="primary" className="grow" id="doneBtn" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
