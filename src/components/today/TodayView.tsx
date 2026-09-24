"use client";
import { useGym } from "@/hooks/useGym";
import { History } from "./History";
import { SessionCard, type SessionProps } from "./SessionCard";
import { WeekStats } from "./WeekStats";
import { WeekStrip } from "./WeekStrip";
import { WeightLine } from "./WeightLine";
import type { DayKey } from "@/lib/types";

interface Props extends SessionProps {
  onSelect: (k: DayKey) => void;
  onOpenDash: () => void;
}

/** The Today screen: the week, the selected day's session, the week's totals, weight and history. */
export function TodayView({ onSelect, onOpenDash, ...session }: Props) {
  const { plan } = useGym();
  return (
    <>
      <WeekStrip sel={session.sel} onSelect={onSelect} />
      <section className="session" id="session">
        <SessionCard key={session.sel} {...session} />
      </section>
      <WeekStats sel={session.sel} />
      <WeightLine onOpenDash={onOpenDash} />
      <History />
      <p className="note" id="tempoNote" hidden={!plan.tempo}>
        {plan.tempo
          ? `Tempo on every lift: ${plan.tempo} (seconds down, pause, up, pause). Warm up at 60 to 75% of working weight before the first main lift.`
          : ""}
      </p>
    </>
  );
}
