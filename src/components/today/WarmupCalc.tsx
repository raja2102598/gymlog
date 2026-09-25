"use client";
import { CaretDown } from "@phosphor-icons/react";
import { useState } from "react";
import { num, plural } from "@/lib/format";
import { warmupLadder } from "@/lib/stats";
import type { SetLog } from "@/lib/types";

interface Props {
  id: string;
  barKg: number;
  /** A working weight to suggest first: the progression hint, or last time's heaviest working set. */
  defaultKg: number | null;
  /** Warm-up sets already logged for this lift today, oldest first. */
  warmSets: SetLog[];
  onLog: (sets: { reps: number; kg: number }[]) => void;
  onRemove: () => void;
}

/** A lift's warm-up sets: 40, 60 and 80 percent of a working weight you type, with rep counts, and one tap to
 *  log all three as warm-up sets (WU-marked, so they never count toward the planned sets or a record). Folded
 *  to a button until opened, like "How to". */
export function WarmupCalc({ id, barKg, defaultKg, warmSets, onLog, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [kgText, setKgText] = useState(() => (defaultKg != null ? String(defaultKg) : ""));
  const kg = num(kgText);
  const ladder = kg != null && kg > 0 ? warmupLadder(kg, barKg) : [];
  return (
    <div className="wset">
      <button type="button" className="ghost tiny" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        Warm-up sets
        <CaretDown size={14} weight="bold" aria-hidden="true" />
      </button>
      {open ? (
        <div className="wset-panel" id={id}>
          <label className="field" htmlFor={`${id}_kg`}>
            <span>Working weight (kg)</span>
            <input
              id={`${id}_kg`}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              placeholder="e.g. 60"
              value={kgText}
              onChange={(ev) => setKgText(ev.target.value)}
            />
          </label>
          {ladder.length ? (
            <ul className="wset-ladder">
              {ladder.map((s) => (
                <li key={s.pct}>
                  <span className="wset-pct">{s.pct}%</span>
                  <span>
                    {s.reps} × {s.kg} kg
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {ladder.length ? (
            <button type="button" className="ghost tiny" onClick={() => onLog(ladder.map((s) => ({ reps: s.reps, kg: s.kg })))}>
              Log warm-up sets
            </button>
          ) : null}
          {warmSets.length ? (
            <div className="wset-done">
              <span>{plural(warmSets.length, "warm-up set")} logged: {warmSets.map((s) => `${s.reps} × ${s.kg} kg`).join(", ")}.</span>
              <button type="button" className="ghost tiny" onClick={onRemove}>
                Remove warm-up sets
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
