"use client";
import type { FormEvent } from "react";
import { SyncedInput } from "@/components/ui/SyncedField";
import { useGym } from "@/hooks/useGym";
import type { FocusNext } from "@/hooks/useFocusNext";
import { cx } from "@/lib/cx";
import { dayMonth } from "@/lib/dates";
import { num } from "@/lib/format";
import type { RecordKind } from "@/lib/stats";
import { minSets, performed, prTitle, setsOf, topKg, type LastDone, type LiftItem as Item } from "@/lib/store";
import type { DayKey, DayLog, LiftLog, SetLog } from "@/lib/types";
import type { LiftMenu } from "./types";

interface Props {
  item: Item;
  /** Position in the day's list; the element ids use it. */
  i: number;
  sel: DayKey;
  entry: DayLog;
  /** Records set on this day, as "exercise|set index" -> kinds. */
  marks: Map<string, RecordKind[]>;
  menu: LiftMenu["mode"] | null;
  setMenu: (m: LiftMenu | null) => void;
  focusNext: FocusNext;
}

/** What was done last time, so there's something to beat. */
function LastHint({ last, cur }: { last: LastDone | null; cur: number | null }) {
  if (!last) return <span className="last">first time</span>;
  const top = topKg(setsOf(last.r));
  if (top == null) return <span className="last">last · {dayMonth(last.day)}</span>;
  const up = cur != null && cur > top;
  return (
    <span className={cx("last", up && "up")}>
      last {top} kg · {dayMonth(last.day)}
      {up ? " ↑" : ""}
    </span>
  );
}

/** One lift on the day: its sets (reps × kg), last time's numbers, the next-weight hint, and skip or swap. */
export function LiftItem({ item, i, sel, entry, marks, menu, setMenu, focusNext }: Props) {
  const store = useGym();
  const { x, name, extra } = item, r: Partial<LiftLog> = entry.exercises[name] || {};
  const did = performed(name, r as LiftLog), last = store.lastDone(did, sel), next = r.skipped ? null : store.nextWeight(x, did, sel);
  const sets = setsOf(r as LiftLog), min = extra ? 1 : minSets(x), rows = Math.max(min, sets.length);
  const edit = (fn: (r: LiftLog) => void, immediate: boolean) => store.editLift(sel, name, fn, immediate);

  const setField = (j: number, f: keyof SetLog, value: string) =>
    edit((r) => {
      const sets = setsOf(r).map((s) => ({ reps: s.reps ?? null, kg: s.kg ?? null }));
      while (sets.length <= j) sets.push({ reps: null, kg: null });
      const v = num(value);
      sets[j][f] = v == null ? null : f === "kg" ? Math.round(v * 2) / 2 : Math.max(0, Math.round(v));
      // A new set usually uses the same weight as the one before it.
      if (f === "reps" && v != null && j > 0 && sets[j].kg == null && sets[j - 1].kg != null) sets[j].kg = sets[j - 1].kg;
      r.sets = sets;
      r.kg = topKg(sets);
      // Logging the planned number of sets ticks the lift off.
      if (!r.done && !r.skipped && sets.filter((s) => (s.reps ?? 0) > 0).length >= min) r.done = true;
    }, false);

  const swap = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const v = (ev.currentTarget.elements.namedItem(`swap${i}`) as HTMLInputElement).value.trim();
    if (!v || v === name) return;
    setMenu(null);
    edit((r) => {
      r.swap = v;
    }, true);
  };

  let actions = null;
  if (menu === "menu") {
    actions = (
      <div className="acts">
        {r.skipped ? (
          <>
            <label className="field grow" htmlFor={`reason${i}`}>
              <span>Reason (optional)</span>
              <SyncedInput
                id={`reason${i}`}
                data-reason={i}
                value={r.reason}
                placeholder="e.g. machine busy"
                autoComplete="off"
                onChange={(ev) => {
                  const v = ev.target.value;
                  edit((r) => {
                    r.reason = v;
                  }, false);
                }}
              />
            </label>
            <button
              className="ghost tiny"
              data-unskip={i}
              onClick={() => {
                setMenu(null);
                edit((r) => {
                  delete r.skipped;
                  delete r.reason;
                }, true);
              }}
            >
              Undo skip
            </button>
          </>
        ) : r.swap ? (
          <button
            className="ghost tiny"
            data-unswap={i}
            onClick={() => {
              setMenu(null);
              edit((r) => {
                delete r.swap;
              }, true);
            }}
          >
            Back to {name}
          </button>
        ) : (
          <>
            <button
              className="ghost tiny"
              data-skip={i}
              onClick={() => {
                edit((r) => {
                  r.skipped = true;
                  r.done = false;
                }, true);
                focusNext(`#reason${i}`);
              }}
            >
              Skip today
            </button>
            <button
              className="ghost tiny"
              data-swapopen={i}
              onClick={() => {
                setMenu({ day: sel, name, mode: "swap" });
                focusNext(`#swap${i}`);
              }}
            >
              Swap for another lift
            </button>
          </>
        )}
      </div>
    );
  } else if (menu === "swap") {
    actions = (
      <>
        <form className="acts" data-swapform={i} onSubmit={swap}>
          <label className="field grow" htmlFor={`swap${i}`}>
            <span>Did instead</span>
            <input id={`swap${i}`} list="swapList" placeholder="e.g. Smith machine squat" autoComplete="off" required />
          </label>
          <button className="ghost tiny" type="submit">
            Swap
          </button>
          <button className="ghost tiny" type="button" data-actsclose="" onClick={() => setMenu(null)}>
            Cancel
          </button>
        </form>
        <datalist id="swapList">
          {store.swapSuggestions(name).map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </>
    );
  }

  const body = r.skipped ? (
    <div className="skipnote">Skipped{r.reason ? ` · ${r.reason}` : ""}</div>
  ) : (
    <>
      {next ? (
        <div className={cx("prog", next.held && "hold")}>
          {next.held ? (
            `Hold ${next.from} kg: your knee was sore after ${dayMonth(next.day)}.`
          ) : (
            <>
              Go up to <b>{next.to} kg</b>: every set hit {next.top} reps last time.
            </>
          )}
        </div>
      ) : null}
      <div className="sets">
        {Array.from({ length: rows }, (_, j) => {
          const s: Partial<SetLog> = sets[j] || {}, [phR, phK] = store.placeholders(x, last, j, next), pr = marks.get(`${did}|${j}`);
          return (
            <div key={j} className={cx("set", pr && "pr", (s.reps ?? 0) > 0 && "logged")}>
              <span className="sn">{j + 1}</span>
              <SyncedInput
                id={`s${i}_${j}_r`}
                data-set={`${i}:${j}:reps`}
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder={phR}
                value={s.reps}
                aria-label={`${did}, set ${j + 1}, reps`}
                onChange={(ev) => setField(j, "reps", ev.target.value)}
              />
              <span className="x">×</span>
              <SyncedInput
                id={`s${i}_${j}_k`}
                data-set={`${i}:${j}:kg`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.5"
                placeholder={phK}
                value={s.kg}
                aria-label={`${did}, set ${j + 1}, weight in kg`}
                onChange={(ev) => setField(j, "kg", ev.target.value)}
              />
              <span className="u">kg</span>
              <span className="prb" title={prTitle(pr)}>
                PR
              </span>
            </div>
          );
        })}
        <div className="setbtns">
          <button
            className="ghost tiny"
            data-addset={i}
            onClick={() =>
              edit((r) => {
                const sets = setsOf(r).map((s) => ({ ...s }));
                while (sets.length < min) sets.push({ reps: null, kg: null });
                sets.push({ reps: null, kg: null });
                r.sets = sets;
              }, true)
            }
          >
            + Set
          </button>
          {sets.length > min ? (
            <button
              className="ghost tiny"
              data-rmset={i}
              onClick={() =>
                edit((r) => {
                  r.sets = setsOf(r).slice(0, -1);
                  r.kg = topKg(r.sets);
                }, true)
              }
            >
              − Set
            </button>
          ) : null}
        </div>
      </div>
    </>
  );

  return (
    <li className={cx(r.done && "checked", r.skipped && "skipped", r.swap && "swapped")}>
      <div className="exrow">
        <label htmlFor={`ex${i}`}>
          <input
            type="checkbox"
            id={`ex${i}`}
            data-i={i}
            checked={!!r.done}
            disabled={!!r.skipped}
            onChange={(ev) => {
              const on = ev.target.checked;
              edit((r) => {
                r.done = on;
              }, true);
            }}
          />
          <span>
            <div className="nm">
              {did}
              {r.swap ? (
                <>
                  {" "}
                  <span className="was">instead of {name}</span>
                </>
              ) : null}
            </div>
            {r.skipped || r.swap || !x.cue ? null : <div className="nt">{x.cue}</div>}
            {x.flag && !r.skipped && !r.swap ? <div className="ch">{x.flag}</div> : null}
            {extra ? <div className="ch">Not in this workout</div> : null}
          </span>
        </label>
        <div className="load">
          {x.sets || x.reps ? (
            <span className="sr">
              {x.sets} × {x.reps}
            </span>
          ) : null}
          {r.skipped ? null : (
            <span className="hint">
              <LastHint last={last} cur={r.kg ?? null} />
            </span>
          )}
          <button
            className="ghost tiny more"
            data-more={i}
            aria-expanded={menu ? "true" : "false"}
            aria-label={`More for ${did}`}
            onClick={() => setMenu(menu ? null : { day: sel, name, mode: "menu" })}
          >
            ···
          </button>
        </div>
      </div>
      {actions}
      {body}
    </li>
  );
}
