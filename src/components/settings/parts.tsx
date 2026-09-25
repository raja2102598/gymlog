"use client";
import { useState, type ReactNode } from "react";
import { SyncedInput } from "@/components/ui/SyncedField";

/** A titled card of rows, as in a phone's settings. */
export function Group({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section className="pref" id={id} aria-labelledby={`${id}H`}>
      <h2 className="pref-h" id={`${id}H`}>
        {title}
      </h2>
      <div className="panel pref-card">{children}</div>
    </section>
  );
}

/** A row's words: its title and, under it, what it does or how it stands. */
export function Text({ title, sub, id }: { title: ReactNode; sub?: ReactNode; id?: string }) {
  return (
    <span className="pref-t">
      <span className="pref-tt" id={id ? `${id}T` : undefined}>
        {title}
      </span>
      {sub ? (
        <span className="sub" id={id ? `${id}D` : undefined}>
          {sub}
        </span>
      ) : null}
    </span>
  );
}

/** A number saved to the plan as you type, once it's from `min` to `max` (the ranges the plan is read with,
 *  lib/plan.ts); while it isn't, the range shows under it. */
export function NumField({
  id,
  label,
  value,
  min,
  max,
  step,
  decimal = false,
  onSave,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimal?: boolean;
  onSave: (v: number) => void;
}) {
  const [bad, setBad] = useState(false);
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <SyncedInput
        id={id}
        type="number"
        inputMode={decimal ? "decimal" : "numeric"}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? `${id}Err` : undefined}
        onChange={(ev) => {
          const v = +ev.target.value, ok = ev.target.value !== "" && v >= min && v <= max;
          setBad(!ok);
          if (ok) onSave(v);
        }}
      />
      {bad ? (
        <span className="err" id={`${id}Err`}>
          From {min.toLocaleString("en-IN")} to {max.toLocaleString("en-IN")}
        </span>
      ) : null}
    </label>
  );
}
