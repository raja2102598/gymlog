"use client";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { addDays, dm, parseKey, todayKey } from "@/lib/dates";
import { cx } from "@/lib/cx";
import type { DayKey, HealthDay } from "@/lib/types";

/** "Today", "Yesterday" or "Wed, 23 Sept". */
export function dayWords(k: DayKey, t = todayKey()): string {
  if (k === t) return "Today";
  if (k === addDays(t, -1)) return "Yesterday";
  return parseKey(k).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** ‹ label ›: moves the day shown by `step` days, never past today. */
export function DaySwitch({ day, onDay, step, label }: { day: DayKey; onDay: (k: DayKey) => void; step: number; label: string }) {
  const t = todayKey(), next = addDays(day, step);
  return (
    <div className="dayswitch">
      <button className="ghost icon" id="hPrev" aria-label={`Back ${step === 1 ? "a day" : `${step} days`}`} onClick={() => onDay(addDays(day, -step))}>
        <CaretLeft size={20} aria-hidden="true" />
      </button>
      <span className="dayswitch-l" aria-live="polite">
        {label}
      </span>
      <button className="ghost icon" id="hNext" aria-label={`On ${step === 1 ? "a day" : `${step} days`}`} disabled={day >= t} onClick={() => onDay(next > t ? t : next)}>
        <CaretRight size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Day / Week / Month. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} className={cx("seg-b", v === value && "on")} aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** A value against its goal: the fill in the metric's colour, on a pale track of the same colour. */
export function Meter({ value, goal, color, label }: { value: number; goal: number; color: string; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / goal) * 100));
  return (
    <span className="meter" style={{ ["--c" as string]: color }} role="meter" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={value} aria-label={label}>
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}

const STAGES: ["deep" | "rem" | "light" | "awake", string][] = [
  ["deep", "Deep"],
  ["light", "Light"],
  ["rem", "REM"],
  ["awake", "Awake"],
];

/** The night by stage, deepest first, as one bar with a 2px gap between stages; the legend names each. */
export function StageBar({ stages, legend = true }: { stages: NonNullable<HealthDay["sleepStages"]>; legend?: boolean }) {
  const total = STAGES.reduce((m, [k]) => m + (stages[k] ?? 0), 0);
  if (!total) return null;
  return (
    <span className="stages">
      <span className="stagebar" aria-hidden="true">
        {STAGES.map(([k]) => (stages[k] ? <i key={k} className={`st-${k}`} style={{ flexGrow: stages[k] }} /> : null))}
      </span>
      {legend ? (
        <span className="stagekey">
          {STAGES.map(([k, name]) =>
            stages[k] ? (
              <span key={k}>
                <i className={`st-${k}`} aria-hidden="true" />
                <span>
                  {name} <b>{Math.round(stages[k]!)}</b>&nbsp;min
                </span>
              </span>
            ) : null,
          )}
        </span>
      ) : (
        <span className="sr-only">{STAGES.map(([k, name]) => (stages[k] ? `${name} ${Math.round(stages[k]!)} min` : "")).filter(Boolean).join(", ")}</span>
      )}
    </span>
  );
}

/** A labelled number in a detail page's summary grid. */
export function Stat({ v, l, id }: { v: string; l: string; id?: string }) {
  return (
    <div className="hstat" id={id}>
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </div>
  );
}

/** Axis labels for a run of days: every day for a week (M T W …), otherwise every 7th date. */
export function dayAxis(days: DayKey[]): string[] {
  if (days.length <= 7) return days.map((k) => parseKey(k).toLocaleDateString("en-IN", { weekday: "narrow" }));
  return days.map((k, i) => ((days.length - 1 - i) % 7 === 0 ? dm(k) : ""));
}
