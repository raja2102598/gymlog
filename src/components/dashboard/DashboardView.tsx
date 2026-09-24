"use client";
import { useGym } from "@/hooks/useGym";
import { kneeModel, planModel, stepsModel, strengthModel, weightModel } from "@/lib/dashboard";
import { parseKey, todayKey } from "@/lib/dates";
import { KneeCard } from "./KneeCard";
import { PlanCard } from "./PlanCard";
import { StepsCard } from "./StepsCard";
import { StrengthCard } from "./StrengthCard";
import { WeightCard } from "./WeightCard";

/** How the plan is going: weight trend, sessions kept, steps, strength and the knee, with anything that
 *  needs attention flagged at the top. */
export function DashboardView({ onSetGoal }: { onSetGoal: () => void }) {
  const store = useGym();
  const t = todayKey();
  const weight = weightModel(store, t), strength = strengthModel(store, t), knee = kneeModel(store, t);
  const flags = [...weight.flags, ...strength.flags, ...knee.flags].sort((a, b) => a.pri - b.pri);
  return (
    <>
      <div className="top">
        <h2 className="display">Dashboard</h2>
        <span className="sub" id="dashAsOf">
          {parseKey(t).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        </span>
      </div>
      <section id="dashFlags" aria-live="polite" hidden={!flags.length}>
        <ul className="flags">
          {flags.map((f) => (
            <li key={f.text} className={f.warn ? "warn" : ""}>
              {f.text}
            </li>
          ))}
        </ul>
      </section>
      <WeightCard m={weight} onSetGoal={onSetGoal} />
      <PlanCard m={planModel(store, t)} today={t} />
      <StepsCard m={stepsModel(store, t)} />
      <StrengthCard m={strength} />
      <KneeCard m={knee} />
    </>
  );
}
