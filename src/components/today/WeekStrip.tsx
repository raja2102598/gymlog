"use client";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useGym } from "@/hooks/useGym";
import { cx } from "@/lib/cx";
import { addDays, DOW, mondayOf, parseKey, todayKey, weekLabel } from "@/lib/dates";
import type { DayKey } from "@/lib/types";

const DAY_WORDS = { done: "done", part: "partly done", miss: "missed" } as const;

/** The week's days, coloured like the dashboard calendar, with week-by-week navigation. */
export function WeekStrip({ sel, onSelect }: { sel: DayKey; onSelect: (k: DayKey) => void }) {
  const store = useGym();
  const mon = mondayOf(sel), t = todayKey(), start = store.firstDay();
  return (
    <section>
      <div className="top week-head">
        <h2 id="weekLabel">{weekLabel(mon)}</h2>
        <div className="nav">
          <button className="ghost icon" id="prevW" aria-label="Previous week" onClick={() => onSelect(addDays(sel, -7))}>
            <CaretLeft size={18} weight="bold" aria-hidden="true" />
          </button>
          <button className="ghost" id="todayB" onClick={() => onSelect(todayKey())}>
            Today
          </button>
          <button className="ghost icon" id="nextW" aria-label="Next week" onClick={() => onSelect(addDays(sel, 7))}>
            <CaretRight size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="week" id="week">
        {DOW.map((wd, i) => {
          const k = addDays(mon, i), name = store.planFor(k).name, st = store.dayState(k, start);
          return (
            <button
              key={k}
              className={cx("dchip", st, k === sel && "sel", k === t && "today")}
              aria-label={`${wd} ${k}, ${name}${st ? ", " + DAY_WORDS[st] : ""}`}
              aria-current={k === t ? "date" : undefined}
              onClick={() => onSelect(k)}
            >
              <span className="dw">{wd}</span>
              <span className="dn">{parseKey(k).getDate()}</span>
              <span className="dp">{name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
