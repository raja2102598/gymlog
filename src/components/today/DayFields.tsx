"use client";
import { SyncedInput, SyncedTextarea } from "@/components/ui/SyncedField";
import type { DayLog, NumField } from "@/lib/types";

interface Props {
  entry: DayLog;
  stepGoal: number;
  onSteps: (value: string) => void;
  onWeight: (value: string) => void;
  onNumber: (field: NumField, value: string) => void;
  onNote: (value: string) => void;
}

/** Steps, body weight, waist and the day's note. */
export function DayFields({ entry: e, stepGoal, onSteps, onWeight, onNumber, onNote }: Props) {
  return (
    <div className="inputs">
      <label className="field" htmlFor="steps">
        <span>Steps</span>
        <SyncedInput id="steps" type="number" inputMode="numeric" min="0" step="100" placeholder="0" value={e.steps} onChange={(ev) => onSteps(ev.target.value)} />
        <div className="bar">
          <i style={{ width: `${Math.min(100, ((e.steps || 0) / stepGoal) * 100)}%` }} />
        </div>
      </label>
      <label className="field" htmlFor="weight">
        <span>Body weight (kg)</span>
        <SyncedInput id="weight" type="number" inputMode="decimal" min="0" step="0.1" placeholder="optional" value={e.weight} onChange={(ev) => onWeight(ev.target.value)} />
      </label>
      <label className="field" htmlFor="waist">
        <span>Waist (cm)</span>
        <SyncedInput id="waist" data-num="waist" type="number" inputMode="decimal" min="0" step="0.5" placeholder="weekly" value={e.waist} onChange={(ev) => onNumber("waist", ev.target.value)} />
      </label>
      <label className="field wide" htmlFor="note">
        <span>Notes / extra exercise</span>
        <SyncedTextarea id="note" placeholder="e.g. 65 jumping jacks, knee felt fine…" value={e.note} autoGrow onChange={(ev) => onNote(ev.target.value)} />
      </label>
    </div>
  );
}
