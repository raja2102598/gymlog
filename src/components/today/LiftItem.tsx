"use client";
import { CaretDown, DotsThree, Microphone } from "@phosphor-icons/react";
import { useRef, useState, type FormEvent } from "react";
import { SyncedInput } from "@/components/ui/SyncedField";
import { useGym } from "@/hooks/useGym";
import type { FocusNext } from "@/hooks/useFocusNext";
import { useVoice, useVoicePref } from "@/hooks/useVoice";
import { cx } from "@/lib/cx";
import { dayMonth } from "@/lib/dates";
import { num, setsSummary } from "@/lib/format";
import { speechSupported } from "@/lib/speech";
import type { RecordKind } from "@/lib/stats";
import { minSets, performed, prTitle, setsOf, topKg, type LastDone, type LiftItem as Item } from "@/lib/store";
import type { DayKey, DayLog, LiftLog, SetLog } from "@/lib/types";
import type { VoiceResult } from "@/lib/voice";
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

/** What was done last time, set by set, so there's something to beat; the arrow shows today's heaviest
 *  set is already heavier. */
function LastHint({ last, cur }: { last: LastDone | null; cur: number | null }) {
  if (!last) return <span className="last">First time</span>;
  const sets = setsOf(last.r), top = topKg(sets), up = cur != null && top != null && cur > top;
  return (
    <span className={cx("last", up && "up")}>
      Last {setsSummary(sets)} · {dayMonth(last.day)}
      {up ? (
        <>
          <span aria-hidden="true"> ↑</span>
          <span className="sr-only"> (heavier than last time)</span>
        </>
      ) : null}
    </span>
  );
}

/** One lift on the day: its sets (reps × kg), last time's numbers, the next-weight hint, and skip or swap. */
export function LiftItem({ item, i, sel, entry, marks, menu, setMenu, focusNext }: Props) {
  const store = useGym();
  const { x, name, extra } = item, r: Partial<LiftLog> = entry.exercises[name] || {};
  const did = performed(name, r as LiftLog), last = store.lastDone(did, sel), next = r.skipped ? null : store.nextWeight(x, did, sel);
  const sets = setsOf(r as LiftLog), min = extra ? 1 : minSets(x), rows = Math.max(min, sets.length);
  // How to do the lift: folded, since it's the same every week. Warnings (e.g. a KNEE NOTE) always show.
  const cue = r.skipped || r.swap ? "" : x.cue;
  const [howOpen, setHowOpen] = useState(false);
  const edit = (fn: (r: LiftLog) => void, immediate: boolean) => store.editLift(sel, name, fn, immediate);
  // The set whose logging ticked the lift off, on which day, so voice's "undo" of that set can take the tick back.
  // Any tick given or taken by hand forgets it.
  const autoTick = useRef<{ day: string; set: number } | null>(null);

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
      if (!r.done && !r.skipped && sets.filter((s) => (s.reps ?? 0) > 0).length >= min) {
        r.done = true;
        autoTick.current = { day: sel, set: j };
      }
    }, false);
  const addSet = () =>
    edit((r) => {
      const sets = setsOf(r).map((s) => ({ ...s }));
      while (sets.length < min) sets.push({ reps: null, kg: null });
      sets.push({ reps: null, kg: null });
      r.sets = sets;
    }, true);
  const skipToday = () =>
    edit((r) => {
      r.skipped = true;
      r.done = false;
    }, true);

  // Voice (Settings, Log sets by voice): a phrase heard for this lift, done through the same changes as typing, + Set,
  // the tick and Skip today, so the carried-over weight, PR badge, tick and sync all follow as they would. It reads the
  // lift as saved now, since the answer comes after this render, and returns the line to show under the sets.
  const voiceOn = useVoicePref() && speechSupported();
  const hear = (said: VoiceResult, heard: string): string => {
    const now = () => setsOf(store.entry(sel).exercises[name]);
    const lastLogged = () => now().findLastIndex((s) => (s.reps ?? 0) > 0);
    const at = `Heard “${heard}”`, logged = (j: number) => `${at}: set\u00a0${j + 1}, ${setsSummary([now()[j]])}.`;
    if (store.entry(sel).exercises[name]?.skipped) return "";
    if (said.kind === "unknown") return `${at}. Say it like “10\u00a0at\u00a045”.`;
    if (said.kind === "set") {
      // The first row with no reps, after adding one when every row is filled.
      const sets = now(), rows = Math.max(min, sets.length);
      let j = 0;
      while (j < rows && (sets[j]?.reps ?? 0) > 0) j++;
      if (j === rows) addSet();
      setField(j, "reps", String(said.reps));
      if (said.kg != null) setField(j, "kg", String(said.kg));
      return logged(j);
    }
    if (said.command === "again") {
      const sets = now(), last = lastLogged();
      if (last < 0) return `${at}. There’s no set to repeat yet.`;
      const j = last + 1, s = sets[last];
      if (j >= Math.max(min, sets.length)) addSet();
      setField(j, "reps", String(s.reps));
      setField(j, "kg", s.kg == null ? "" : String(s.kg));
      return logged(j);
    }
    if (said.command === "undo") {
      const last = lastLogged();
      if (last < 0) return `${at}. There’s no set to undo.`;
      const ticked = autoTick.current;
      setField(last, "reps", "");
      setField(last, "kg", "");
      // Logging this set is what ticked the lift off, so the tick goes with it. A tick given by hand stays.
      if (ticked && ticked.day === sel && ticked.set === last) {
        autoTick.current = null;
        edit((r) => {
          r.done = false;
        }, false);
      }
      return `${at}: set\u00a0${last + 1} cleared.`;
    }
    if (said.command === "done") {
      autoTick.current = null;
      edit((r) => {
        r.done = true;
      }, true);
      return `${at}: marked done.`;
    }
    skipToday();
    // A skipped lift has no microphone: if it had focus, focus moves to ···, which holds Undo skip.
    if ((document.activeElement as HTMLElement | null)?.dataset.voice === String(i)) focusNext(`[data-more="${i}"]`);
    return `${at}: skipped today.`;
  };
  const voice = useVoice(voiceOn && !r.skipped, hear);

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
                placeholder="e.g. machine busy…"
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
                skipToday();
                // The reason is optional, so a phone keeps its keyboard closed: focus stays by the change.
                focusNext(matchMedia("(pointer: fine)").matches ? `#reason${i}` : `[data-unskip="${i}"]`);
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
            <input id={`swap${i}`} list="swapList" placeholder="e.g. Smith machine squat…" autoComplete="off" required />
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
        <div className={cx("prog callout", next.held ? "hold warn" : "good")}>
          {next.held ? (
            `Hold ${next.from}\u00a0kg: your knee was sore after ${dayMonth(next.day)}.`
          ) : (
            <>
              Go up to <b>{next.to}&nbsp;kg</b>: every set hit {next.top} reps last time.
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
          <button className="ghost tiny" data-addset={i} onClick={addSet}>
            + Set
          </button>
          {sets.length > min ? (
            <button
              className="ghost tiny"
              data-rmset={i}
              onClick={() => {
                const gone = sets[sets.length - 1], said = setsSummary([gone]);
                if (said && !confirm(`Remove set ${sets.length} (${said})?`)) return;
                edit((r) => {
                  r.sets = setsOf(r).slice(0, -1);
                  r.kg = topKg(r.sets);
                }, true);
              }}
            >
              − Set
            </button>
          ) : null}
          {cue ? (
            <button type="button" className="ghost tiny howto" aria-expanded={howOpen} aria-controls={`cue${i}`} onClick={() => setHowOpen(!howOpen)}>
              How to
              <CaretDown size={14} weight="bold" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      {cue && howOpen ? (
        <p className="nt cue" id={`cue${i}`}>
          {cue}
        </p>
      ) : null}
    </>
  );

  return (
    <li className={cx("lift", r.done && "checked", r.skipped && "skipped", r.swap && "swapped")}>
      <div className="lift-head">
        <label htmlFor={`ex${i}`} className="lift-name">
          <input
            type="checkbox"
            className="tick"
            id={`ex${i}`}
            data-i={i}
            checked={!!r.done}
            disabled={!!r.skipped}
            onChange={(ev) => {
              const on = ev.target.checked;
              autoTick.current = null;
              edit((r) => {
                r.done = on;
              }, true);
            }}
          />
          <span className="nm">
            {did}
            {r.swap ? (
              <>
                {" "}
                <span className="was">instead of {name}</span>
              </>
            ) : null}
          </span>
        </label>
        {voiceOn && !r.skipped ? (
          <button
            type="button"
            className="ghost icon mic"
            data-voice={i}
            aria-pressed={voice.listening}
            aria-label={`Log a set of ${did} by voice`}
            onClick={() => void voice.listen()}
          >
            <Microphone size={22} weight={voice.listening ? "fill" : "bold"} aria-hidden="true" />
          </button>
        ) : null}
        <button
          className="ghost icon more"
          data-more={i}
          aria-expanded={menu ? "true" : "false"}
          aria-label={`More for ${did}`}
          onClick={() => setMenu(menu ? null : { day: sel, name, mode: "menu" })}
        >
          <DotsThree size={22} weight="bold" aria-hidden="true" />
        </button>
      </div>
      <div className="lift-meta">
        {x.sets || x.reps ? (
          <span className="sr">
            {x.sets}&nbsp;×&nbsp;{x.reps}
          </span>
        ) : null}
        {r.skipped ? null : (
          <span className="hint">
            <LastHint last={last} cur={r.kg ?? null} />
          </span>
        )}
      </div>
      {x.flag && !r.skipped && !r.swap ? <div className="ch">{x.flag}</div> : null}
      {extra ? <div className="ch">Not in this workout</div> : null}
      {actions}
      {body}
      {voiceOn ? (
        <p className="said" aria-live="polite">
          {voice.line}
        </p>
      ) : null}
    </li>
  );
}
