"use client";
import { Check, Dumbbell, Plus } from "lucide-react";
import { ExerciseThumb } from "@/components/exercise/ExerciseThumb";
import { useGym } from "@/hooks/useGym";
import { cx } from "@/lib/cx";
import { DOW, todayKey, wdIndex } from "@/lib/dates";
import { equipText, MUSCLES, muscleText, type Exercise } from "@/lib/library";
import { tintOf } from "@/lib/session";
import { lowLine, lowMuscles, missedLifts, missedLine, missedTitle } from "@/lib/suggest";
import type { DayKey } from "@/lib/types";

/** Train's Add exercise, above the library's list (lib/suggest.ts): the lifts left on the days just before `day`,
 *  each added to that day only with its own button, and lifts for the muscles low this week, picked with + and added
 *  to the plan with the library's own picks. Read from the store as it is, so a lift added or done (or synced from
 *  another phone) leaves the list. Nothing until there's something to suggest. */
export function Suggested({ day, chosen, onToggle }: { day: DayKey; chosen: Exercise[]; onToggle: (x: Exercise) => void }) {
  const store = useGym();
  const t = todayKey(), missed = missedLifts(store, day, t), low = lowMuscles(store, day, t, missed.map((m) => m.name));
  if (!missed.length && !low.length) return null;
  const forDay = day === t ? "for today" : `for ${DOW[wdIndex(day)]}`;
  const addMissed = (i: number) => {
    const m = missed[i];
    store.addExtraLift(day, m.name, m.target);
    // Its row goes: focus moves to the button that takes its place, or the last one, or with none left to the top.
    requestAnimationFrame(() => {
      const bs = document.querySelectorAll<HTMLButtonElement>("#libMissed [data-missed]");
      (bs[Math.min(i, bs.length - 1)] ?? document.getElementById("libClose"))?.focus();
    });
  };
  const tile = (name: string, x?: Exercise) => (
    <span className={cx("ico-tile", tintOf(store, name, x && !x.custom ? { lib: x.id } : undefined))} aria-hidden="true">
      <Dumbbell size={20} />
    </span>
  );
  return (
    <>
      {missed.length ? (
        <section className="lib-sug" aria-labelledby="libMissedH">
          <h3 className="group-h" id="libMissedH">
            {missedTitle(missed)}
          </h3>
          <ul className="list" id="libMissed">
            {missed.map((m, i) => (
              <li key={m.name} className="lib-row">
                <span className="lib-sug-t">
                  <ExerciseThumb id={store.mediaIdOf(m.name)} fallback={tile(m.name)} />
                  <span className="lib-t">
                    <span className="lib-n">{m.name}</span>
                    <span className="row-d">{missedLine(m)}</span>
                  </span>
                </span>
                <button type="button" className="btn btn-sm" data-missed={m.name} aria-label={`Add ${m.name} ${forDay}`} onClick={() => addMissed(i)}>
                  Add {forDay}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {low.length ? (
        <section className="lib-sug" aria-labelledby="libLowH">
          <h3 className="group-h" id="libLowH">
            Low this week
          </h3>
          <ul className="list" id="libLow">
            {low.map((m) => (
              <li key={m.muscle} data-low-muscle={m.muscle}>
                <p className="lib-sug-m">
                  <span className="row-tt">{MUSCLES[m.muscle]}</span>
                  <span className="row-d">{lowLine(m)}</span>
                </p>
                <ul className="lib-sug-lifts">
                  {m.lifts.map((x) => {
                    const on = chosen.some((c) => c.id === x.id);
                    return (
                      <li key={x.id} className={cx("lib-row", on && "on")}>
                        <span className="lib-sug-t">
                          <ExerciseThumb id={x.custom ? null : x.id} fallback={tile(x.name, x)} />
                          <span className="lib-t">
                            <span className="lib-n">{x.name}</span>
                            <span className="row-d">
                              {equipText(x)} · {muscleText(x)}
                            </span>
                          </span>
                        </span>
                        <button type="button" className={cx("lib-add", on && "on")} data-low={x.id} aria-pressed={on} aria-label={on ? `Remove ${x.name}` : `Add ${x.name}`} onClick={() => onToggle(x)}>
                          {on ? <Check size={22} strokeWidth={3} aria-hidden="true" /> : <Plus size={22} aria-hidden="true" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <h3 className="group-h" id="libAllH">
        All lifts
      </h3>
    </>
  );
}
