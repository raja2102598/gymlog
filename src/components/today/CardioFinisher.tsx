"use client";
import { SyncedInput } from "@/components/ui/SyncedField";
import type { DayLog, NumField, PlanDay } from "@/lib/types";

interface Props {
  cardio: PlanDay["cardio"];
  entry: DayLog;
  onDone: (on: boolean) => void;
  onNumber: (field: NumField, value: string) => void;
}

/** The day's cardio finisher: ticked off, with optional minutes, speed and incline. */
export function CardioFinisher({ cardio, entry: e, onDone, onNumber }: Props) {
  return (
    <ul className="ex cardio">
      <li className={e.cardio ? "checked" : ""}>
        <label htmlFor="cardio">
          <input type="checkbox" id="cardio" checked={e.cardio} onChange={(ev) => onDone(ev.target.checked)} />
          <span>
            <div className="nm">{cardio.name || "Cardio"}</div>
            <div className="nt">{cardio.detail}</div>
          </span>
          <span className="sr">cardio</span>
        </label>
        <div className="cardio-log">
          <label htmlFor="cMin">
            <SyncedInput id="cMin" data-num="cardioMin" type="number" inputMode="numeric" min="0" step="1" placeholder="-" value={e.cardioMin} onChange={(ev) => onNumber("cardioMin", ev.target.value)} />
            <span>min</span>
          </label>
          <label htmlFor="cKmh">
            <SyncedInput id="cKmh" data-num="cardioKmh" type="number" inputMode="decimal" min="0" step="0.1" placeholder="-" value={e.cardioKmh} onChange={(ev) => onNumber("cardioKmh", ev.target.value)} />
            <span>km/h</span>
          </label>
          <label htmlFor="cInc">
            <SyncedInput id="cInc" data-num="cardioIncline" type="number" inputMode="decimal" min="0" step="0.5" placeholder="-" value={e.cardioIncline} onChange={(ev) => onNumber("cardioIncline", ev.target.value)} />
            <span>% incline</span>
          </label>
        </div>
      </li>
    </ul>
  );
}
