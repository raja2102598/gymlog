"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, type TouchEvent } from "react";
import { useGym } from "@/hooks/useGym";
import { cx } from "@/lib/cx";
import { addDays, DOW, mondayOf, parseKey, todayKey } from "@/lib/dates";
import type { DayKey } from "@/lib/types";

const WORDS = { done: "done", part: "partly done", miss: "missed" } as const;

/** Home's seven days (WeekStrip spec): done days get a brand dot, today is filled brand, planned days a line-strong
 *  dot, rest days are subtle with none. A day opens in Train. */
export function WeekStrip({ onOpen }: { onOpen: (k: DayKey) => void }) {
  const store = useGym();
  const t = todayKey(), mon = mondayOf(t), start = store.firstDay();
  return (
    <div className="card weekstrip" id="week" role="group" aria-label="This week">
      {DOW.map((wd, i) => {
        const k = addDays(mon, i), p = store.planFor(k), st = store.dayState(k, start), rest = !p.exercises.length && !store.entry(k).free;
        const kind = k === t ? "today" : st === "done" || st === "part" ? st : rest ? "rest" : "plan";
        return (
          <button
            key={k}
            type="button"
            className={cx("wd", kind)}
            aria-label={`${wd} ${parseKey(k).getDate()}, ${p.name}${st ? ", " + WORDS[st] : ""}${k === t ? ", today" : ""}`}
            aria-current={k === t ? "date" : undefined}
            onClick={() => onOpen(k)}
          >
            <span className="wd-l">{wd}</span>
            <span className="wd-n">{parseKey(k).getDate()}</span>
            <span className="wd-dot" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

/** A session's name cut to fit a day chip: its first word, and past six letters its first letter and consonants
 *  ("Shoulders" → "Shldr"). */
const short = (name: string) => {
  const w = name.trim().split(/\s+/)[0] ?? "";
  return w.length > 6 ? (w[0] + w.slice(1).replace(/[aeiou]/gi, "")).slice(0, 5) : w;
};

/** Train's day chips: the larger WeekStrip (62px, the session under the weekday), the selected day filled brand.
 *  Swipe, or the chevrons, change the week. */
export function DayChips({ sel, onSelect }: { sel: DayKey; onSelect: (k: DayKey) => void }) {
  const store = useGym();
  const mon = mondayOf(sel), t = todayKey(), start = store.firstDay();
  const touch = useRef<number | null>(null);
  const onStart = (ev: TouchEvent) => (touch.current = ev.touches[0].clientX);
  const onEnd = (ev: TouchEvent) => {
    if (touch.current == null) return;
    const dx = ev.changedTouches[0].clientX - touch.current;
    touch.current = null;
    if (Math.abs(dx) > 60) onSelect(addDays(sel, dx < 0 ? 7 : -7));
  };
  const week = mon === mondayOf(t) ? "This week" : mon === addDays(mondayOf(t), -7) ? "Last week" : mon === addDays(mondayOf(t), 7) ? "Next week" : `Week of ${parseKey(mon).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
  return (
    <div className="daychips-w">
      <div className="weeknav">
        <button type="button" className="btn btn-icon btn-quiet" id="prevW" aria-label="Previous week" onClick={() => onSelect(addDays(sel, -7))}>
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <span className="label" id="weekLabel" aria-live="polite">
          {week}
        </span>
        {mon !== mondayOf(t) ? (
          <button type="button" className="btn btn-sm btn-quiet" id="todayB" onClick={() => onSelect(t)}>
            Today
          </button>
        ) : null}
        <button type="button" className="btn btn-icon btn-quiet" id="nextW" aria-label="Next week" onClick={() => onSelect(addDays(sel, 7))}>
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="daychips" id="dayChips" role="group" aria-label="Day of the week" onTouchStart={onStart} onTouchEnd={onEnd}>
        {DOW.map((wd, i) => {
          const k = addDays(mon, i), p = store.planFor(k), e = store.entry(k), st = store.dayState(k, start);
          const rest = !p.exercises.length && !e.free;
          const name = e.free ? e.free.name || "Free" : rest ? "Rest" : p.name;
          return (
            <button
              key={k}
              type="button"
              className={cx("dchip", st, rest && "rest", k === sel && "sel", k === t && "today")}
              aria-label={`${wd} ${parseKey(k).getDate()}, ${name}${st ? ", " + WORDS[st] : ""}${k === t ? ", today" : ""}`}
              aria-pressed={k === sel}
              onClick={() => onSelect(k)}
            >
              <span className="dw">{wd}</span>
              <span className="dp">{short(name)}</span>
              {st === "done" || st === "part" ? <span className="dd" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
