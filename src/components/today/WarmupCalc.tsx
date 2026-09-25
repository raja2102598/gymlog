"use client";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { num, plural } from "@/lib/format";
import { warmupLadder } from "@/lib/stats";
import type { SetLog } from "@/lib/types";

interface Props {
  id: string;
  /** The bar the lift goes on (0 for none), and what its weights go up by: My gym's, for what it's loaded with. */
  barKg: number;
  inc: number;
  /** A working weight to suggest first: the progression hint, or last time's heaviest working set. */
  defaultKg: number | null;
  /** Warm-up sets already logged for this lift today, oldest first. */
  warmSets: SetLog[];
  onLog: (sets: { reps: number; kg: number }[]) => void;
  onRemove: () => void;
}

/** A lift's warm-up sets: 40, 60 and 80 percent of a working weight you type, rounded to what its equipment makes,
 *  with rep counts, and one tap to log all three as warm-up sets (WU-marked, so they never count toward the planned
 *  sets or a record). Folded to a button until opened, like "How to". */
export function WarmupCalc({ id, barKg, inc, defaultKg, warmSets, onLog, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  // The suggestion, until you type: it follows the lift's next weight, which a change to the plan or My gym moves.
  const [typed, setTyped] = useState<string | null>(null);
  const kgText = typed ?? (defaultKg != null ? String(defaultKg) : ""), kg = num(kgText);
  const ladder = kg != null && kg > 0 ? warmupLadder(kg, barKg, inc) : [];
  return (
    <div className="wset">
      <button type="button" className="btn btn-sm wset-t" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        Warm-up sets
        <ChevronDown className="chev" size={16} aria-hidden="true" />
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
              onChange={(ev) => setTyped(ev.target.value)}
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
            <button type="button" className="btn btn-sm" onClick={() => onLog(ladder.map((s) => ({ reps: s.reps, kg: s.kg })))}>
              Log warm-up sets
            </button>
          ) : null}
          {warmSets.length ? (
            <div className="wset-done">
              <span>{plural(warmSets.length, "warm-up set")} logged: {warmSets.map((s) => `${s.reps} × ${s.kg} kg`).join(", ")}.</span>
              <button type="button" className="btn btn-sm" onClick={onRemove}>
                Remove warm-up sets
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
