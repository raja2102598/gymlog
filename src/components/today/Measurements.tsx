"use client";
import { useState } from "react";
import { SyncedInput } from "@/components/ui/SyncedField";
import { num } from "@/lib/format";
import type { DayLog, MeasureField } from "@/lib/types";

interface Range {
  min: number;
  max: number;
  step: number;
}
// Plausible ranges, wide enough for anyone: they catch a mistyped digit or the wrong field, not a real
// measurement. Body fat is a %; the rest are cm, like waist.
const RANGES: Record<MeasureField, Range> = {
  chest: { min: 50, max: 200, step: 0.5 },
  arms: { min: 15, max: 70, step: 0.5 },
  thighs: { min: 20, max: 100, step: 0.5 },
  hips: { min: 50, max: 200, step: 0.5 },
  bodyFat: { min: 3, max: 70, step: 0.1 },
};
const LABELS: Record<MeasureField, string> = { chest: "Chest (cm)", arms: "Arms (cm)", thighs: "Thighs (cm)", hips: "Hips (cm)", bodyFat: "Body fat (%)" };
const ORDER: MeasureField[] = ["chest", "arms", "thighs", "hips", "bodyFat"];

interface Props {
  entry: DayLog;
  onMeasure: (field: MeasureField, value: string) => void;
}

/** Chest, arms, thighs, hips and body fat: like waist, once a week is enough. A value that isn't a number, or
 *  is outside a plausible range, is refused with a message, the way a daily goal is in Settings. */
export function Measurements({ entry: e, onMeasure }: Props) {
  return (
    <div className="hc measure" id="measureCard">
      <h3>Measurements</h3>
      <div className="measure-grid">
        {ORDER.map((f) => (
          <MeasureField key={f} field={f} value={e[f]} onChange={onMeasure} />
        ))}
      </div>
    </div>
  );
}

function MeasureField({ field, value, onChange }: { field: MeasureField; value: number | undefined; onChange: (f: MeasureField, v: string) => void }) {
  const { min, max, step } = RANGES[field];
  const [bad, setBad] = useState(false);
  return (
    <label className="field" htmlFor={field}>
      <span>{LABELS[field]}</span>
      <SyncedInput
        id={field}
        data-num={field}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        placeholder="weekly"
        value={value}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? `${field}Err` : undefined}
        onChange={(ev) => {
          const raw = ev.target.value, v = num(raw);
          const ok = raw === "" || (v != null && v >= min && v <= max);
          setBad(!ok);
          if (ok) onChange(field, raw);
        }}
      />
      {bad ? (
        <span className="err" id={`${field}Err`}>
          From {min.toLocaleString("en-IN")} to {max.toLocaleString("en-IN")}
        </span>
      ) : null}
    </label>
  );
}
