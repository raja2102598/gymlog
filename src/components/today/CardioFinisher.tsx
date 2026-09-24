"use client";
import { SyncedInput } from "@/components/ui/SyncedField";
import { cx } from "@/lib/cx";
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
      <li className={cx("lift", e.cardio && "checked")}>
        <div className="lift-head">
          <label htmlFor="cardio" className="lift-name">
            <input type="checkbox" className="tick" id="cardio" checked={e.cardio} onChange={(ev) => onDone(ev.target.checked)} />
            <span className="nm">{cardio.name || "Cardio"}</span>
          </label>
          <span className="sr">Cardio</span>
        </div>
        {cardio.detail ? <p className="nt">{cardio.detail}</p> : null}
        <div className="cardio-log">
          <label className="field" htmlFor="cMin">
            <span>Minutes</span>
            <SyncedInput id="cMin" data-num="cardioMin" type="number" inputMode="numeric" min="0" step="1" placeholder="-" value={e.cardioMin} onChange={(ev) => onNumber("cardioMin", ev.target.value)} />
          </label>
          <label className="field" htmlFor="cKmh">
            <span>km/h</span>
            <SyncedInput id="cKmh" data-num="cardioKmh" type="number" inputMode="decimal" min="0" step="0.1" placeholder="-" value={e.cardioKmh} onChange={(ev) => onNumber("cardioKmh", ev.target.value)} />
          </label>
          <label className="field" htmlFor="cInc">
            <span>Incline %</span>
            <SyncedInput id="cInc" data-num="cardioIncline" type="number" inputMode="decimal" min="0" step="0.5" placeholder="-" value={e.cardioIncline} onChange={(ev) => onNumber("cardioIncline", ev.target.value)} />
          </label>
        </div>
      </li>
    </ul>
  );
}
