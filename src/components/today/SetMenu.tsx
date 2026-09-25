"use client";
import { useState } from "react";
import { SegmentedControl } from "@/components/ds/parts";
import { SyncedInput } from "@/components/ui/SyncedField";
import { num } from "@/lib/format";
import type { Effort, SetLog } from "@/lib/types";

/** The kinds of set a lift's row can be. Warm-ups aren't among them: they have their own panel (WarmupCalc). */
export type SetKind = "working" | "failure" | "drop";
export const kindOf = (s: Partial<SetLog>): SetKind => (s.type === "failure" || s.type === "drop" ? s.type : "working");
const MARK: Record<SetKind, string> = { working: "", failure: "F", drop: "D" };
const WORD: Record<SetKind, string> = { working: "", failure: ", to failure", drop: ", drop set" };

/** A set's number, as the button that opens its menu: 3, or 3F for a set to failure and 3D for a drop set. In a
 *  superset, the lift's place there (A1) stands in for the number, which the round gives. */
export function SetNumber({ n, tag, s, id, did, open, onToggle }: { n: number; tag?: string; s: Partial<SetLog>; id: string; did: string; open: boolean; onToggle: () => void }) {
  const kind = kindOf(s);
  return (
    <button type="button" className="sn" data-kind={kind} aria-expanded={open} aria-controls={id} aria-label={`${did}, set ${n}${WORD[kind]}: kind of set`} onClick={onToggle}>
      <span>
        {tag ?? n}
        {MARK[kind]}
      </span>
    </button>
  );
}

/** What a number typed as effort saves: RPE 1 to 10 in half steps, or reps in reserve 0 to 10; null clears it, and
 *  anything else is refused (undefined), so a stray value never reaches the log. */
export function effortValue(effort: Effort, text: string): number | null | undefined {
  const v = num(text);
  if (v == null) return text.trim() ? undefined : null;
  if (effort === "rpe") return v >= 1 && v <= 10 ? Math.round(v * 2) / 2 : undefined;
  return v >= 0 && v <= 10 ? Math.round(v) : undefined;
}

/** A set's menu, under its row: its kind (working, to failure, a drop set) and, when the plan logs it, its RPE or
 *  reps in reserve. */
export function SetMenu({ id, s, effort, onChange }: { id: string; s: Partial<SetLog>; effort: Effort; onChange: (patch: Partial<SetLog>) => void }) {
  const kind = kindOf(s), field = effort === "rir" ? "rir" : "rpe";
  const [bad, setBad] = useState(false);
  return (
    <div className="setmenu" id={id}>
      <SegmentedControl<SetKind>
        value={kind}
        label="Kind of set"
        onChange={(k) => onChange({ type: k === "working" ? undefined : k })}
        options={[
          ["working", "Working"],
          ["failure", "To failure"],
          ["drop", "Drop set"],
        ]}
      />
      {kind === "drop" ? <p className="note">A drop set adds to the lift&rsquo;s volume, not to its planned sets or a record.</p> : null}
      {effort !== "off" ? (
        <label className="field" htmlFor={`${id}_e`}>
          <span>{effort === "rpe" ? "RPE, 1 to 10" : "Reps in reserve, 0 to 10"}</span>
          <SyncedInput
            id={`${id}_e`}
            type="number"
            inputMode="decimal"
            min={effort === "rpe" ? 1 : 0}
            max={10}
            step={effort === "rpe" ? 0.5 : 1}
            value={s[field]}
            aria-invalid={bad || undefined}
            onChange={(ev) => {
              const v = effortValue(effort, ev.target.value);
              setBad(v === undefined);
              if (v !== undefined) onChange({ [field]: v ?? undefined });
            }}
          />
          {bad ? <span className="err">{effort === "rpe" ? "RPE is 1 to 10." : "Reps in reserve is 0 to 10."}</span> : null}
        </label>
      ) : null}
    </div>
  );
}
