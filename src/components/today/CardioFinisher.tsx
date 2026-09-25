"use client";
import { Bike } from "lucide-react";
import { SyncedInput } from "@/components/ui/SyncedField";
import { cx } from "@/lib/cx";
import type { DayLog, NumField, PlanDay } from "@/lib/types";

interface Props {
  cardio: PlanDay["cardio"];
  entry: DayLog;
  /** Where it sits in the workout: "Exercise 6 of 6". */
  step?: string;
  onDone: (on: boolean) => void;
  onNumber: (field: NumField, value: string) => void;
}

/** The day's cardio finisher, the workout's last step: ticked off, with optional minutes, speed and incline. */
export function CardioFinisher({ cardio, entry: e, step, onDone, onNumber }: Props) {
  return (
    <section className={cx("card ex-card cardio", e.cardio && "checked")} aria-label={cardio.name || "Cardio"}>
      <div className="ex-head">
        <div className="ex-t">
          {step ? <div className="ex-step">{step}</div> : null}
          <h2 className="ex-name">{cardio.name || "Cardio"}</h2>
          {cardio.detail ? <div className="ex-meta">{cardio.detail}</div> : null}
        </div>
        <span className="ico-tile t-steps" aria-hidden="true">
          <Bike size={20} />
        </span>
      </div>
      <label htmlFor="cardio" className="acts-done">
        <input type="checkbox" className="tick" id="cardio" checked={e.cardio} onChange={(ev) => onDone(ev.target.checked)} />
        <span>Done</span>
      </label>
      <div className="cardio-log">
        <label className="field" htmlFor="cMin">
          <span>Minutes</span>
          <SyncedInput id="cMin" data-num="cardioMin" type="number" inputMode="numeric" min="0" step="1" placeholder="–" value={e.cardioMin} onChange={(ev) => onNumber("cardioMin", ev.target.value)} />
        </label>
        <label className="field" htmlFor="cKmh">
          <span>km/h</span>
          <SyncedInput id="cKmh" data-num="cardioKmh" type="number" inputMode="decimal" min="0" step="0.1" placeholder="–" value={e.cardioKmh} onChange={(ev) => onNumber("cardioKmh", ev.target.value)} />
        </label>
        <label className="field" htmlFor="cInc">
          <span>Incline %</span>
          <SyncedInput id="cInc" data-num="cardioIncline" type="number" inputMode="decimal" min="0" step="0.5" placeholder="–" value={e.cardioIncline} onChange={(ev) => onNumber("cardioIncline", ev.target.value)} />
        </label>
      </div>
    </section>
  );
}
