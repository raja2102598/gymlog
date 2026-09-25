"use client";
import { SyncedInput, SyncedTextarea } from "@/components/ui/SyncedField";
import type { DayLog, HealthDay, NumField } from "@/lib/types";

interface Props {
  entry: DayLog;
  /** The day's Health Connect data, if the Android app has synced any. */
  health: HealthDay | null;
  stepGoal: number;
  onSteps: (value: string) => void;
  onWeight: (value: string) => void;
  onNumber: (field: NumField, value: string) => void;
  onNote: (value: string) => void;
}

/** Steps, body weight, waist and the day's note. Health Connect's numbers show in grey until you type your own. */
export function DayFields({ entry: e, health, stepGoal, onSteps, onWeight, onNumber, onNote }: Props) {
  const hcSteps = e.steps == null ? health?.steps : undefined, hcWeight = e.weight == null ? health?.weight : undefined;
  const steps = e.steps ?? hcSteps ?? 0;
  // One line under both boxes says where the grey numbers came from; in the labels it wrapped and put the boxes out of line.
  const from = [hcSteps != null && `${hcSteps.toLocaleString("en-IN")}\u00a0steps`, hcWeight != null && `${hcWeight}\u00a0kg`].filter(Boolean);
  return (
    <section className="card" aria-labelledby="dayFieldsH">
      <h2 className="title-sm" id="dayFieldsH">
        Steps, weight and notes
      </h2>
      <div className="fields2">
      <label className="field" htmlFor="steps">
        <span>Steps</span>
        <SyncedInput id="steps" type="number" inputMode="numeric" min="0" step="100" placeholder={hcSteps != null ? String(hcSteps) : "0"} aria-describedby={hcSteps != null ? "hcNote" : undefined} value={e.steps} onChange={(ev) => onSteps(ev.target.value)} />
        <span className="meter" style={{ ["--c" as string]: "var(--steps)" }} aria-hidden="true">
          <i style={{ width: `${Math.min(100, (steps / stepGoal) * 100)}%` }} />
        </span>
      </label>
      <label className="field" htmlFor="weight">
        <span>Body weight (kg)</span>
        <SyncedInput id="weight" type="number" inputMode="decimal" min="0" step="0.1" placeholder={hcWeight != null ? String(hcWeight) : "optional"} aria-describedby={hcWeight != null ? "hcNote" : undefined} value={e.weight} onChange={(ev) => onWeight(ev.target.value)} />
      </label>
      {from.length ? (
        <p className="note" id="hcNote">
          From Health Connect: {from.join(", ")}. Type your own to replace {from.length > 1 ? "them" : "it"}.
        </p>
      ) : null}
      <label className="field" htmlFor="waist">
        <span>Waist (cm)</span>
        <SyncedInput id="waist" data-num="waist" type="number" inputMode="decimal" min="0" step="0.5" placeholder="weekly" value={e.waist} onChange={(ev) => onNumber("waist", ev.target.value)} />
      </label>
      <label className="field wide" htmlFor="note">
        <span>Notes / extra exercise</span>
        <SyncedTextarea id="note" placeholder="e.g. 65 jumping jacks, knee felt fine…" value={e.note} autoGrow onChange={(ev) => onNote(ev.target.value)} />
      </label>
      </div>
    </section>
  );
}
