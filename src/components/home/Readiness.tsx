"use client";
import { Lightbulb } from "lucide-react";
import { useGym } from "@/hooks/useGym";
import { readiness, readinessLine } from "@/lib/readiness";
import type { DayKey } from "@/lib/types";

/** The readiness note (lib/readiness.ts): one line on the day's workout when its signals say take it easier (a short
 *  night, a raised resting heart rate, a sore knee), with Hold today, which keeps the day's lifts at last time's weights
 *  (DayLog.hold), and Undo. It stays while the day holds, so the hold can always be taken back, and is calm, like an
 *  insight: nothing is wrong. Nothing at all on a good day, or with nothing to go on. */
export function ReadinessNote({ day, id }: { day: DayKey; id: string }) {
  const store = useGym();
  const r = readiness(store, day), held = store.entry(day).hold === true;
  if (!r && !held) return null;
  return (
    <div className="callout ready" id={id}>
      <Lightbulb size={20} aria-hidden="true" />
      <div className="ready-t">
        <span>{readinessLine(r, held)}</span>
        <button type="button" className="btn btn-sm btn-raised" id={`${id}Hold`} aria-label={held ? "Undo hold for today" : undefined} onClick={() => store.holdDay(day, !held)}>
          {held ? "Undo" : "Hold today"}
        </button>
      </div>
    </div>
  );
}
