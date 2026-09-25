"use client";
import { useGym } from "@/hooks/useGym";
import { healthModel, kneeModel, musclesModel, planModel, stepsModel, strengthModel, weightModel } from "@/lib/dashboard";
import { todayKey } from "@/lib/dates";
import { KneeCard } from "./KneeCard";
import { MusclesCard } from "./MusclesCard";
import { PlanCard } from "./PlanCard";
import { StepsCard } from "./StepsCard";
import { StrengthCard } from "./StrengthCard";
import { WeightCard } from "./WeightCard";

/** Progress: how the plan is going. Weight trend, sessions kept, steps, strength, sets per muscle and the knee,
 *  with anything that needs attention flagged at the top (sleep and resting heart rate from Health Connect too;
 *  their charts are in the Health tab). */
export function DashboardView({ onSetGoal, onOpenLift }: { onSetGoal: () => void; onOpenLift: (name: string) => void }) {
  const store = useGym();
  const t = todayKey();
  const weight = weightModel(store, t), strength = strengthModel(store, t), knee = kneeModel(store, t), health = healthModel(store, t);
  const flags = [...weight.flags, ...strength.flags, ...knee.flags, ...health.flags].sort((a, b) => a.pri - b.pri);
  return (
    <>
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
      <StrengthCard m={strength} onOpenLift={onOpenLift} />
      <MusclesCard m={musclesModel(store, t)} />
      <KneeCard m={knee} />
    </>
  );
}
