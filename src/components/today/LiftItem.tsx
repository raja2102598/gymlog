"use client";
import { Check, CircleHelp, Ellipsis, Mic, Trophy } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useLibrary } from "@/components/library/LibraryContext";
import { SyncedInput } from "@/components/ui/SyncedField";
import { ViewLink } from "@/components/ui/ViewLink";
import { useGym } from "@/hooks/useGym";
import type { FocusNext } from "@/hooks/useFocusNext";
import { useVoice, useVoiceOn } from "@/hooks/useVoice";
import { cx } from "@/lib/cx";
import { dayMonth } from "@/lib/dates";
import { mmss, num, setsSummary } from "@/lib/format";
import { hashOf } from "@/lib/route";
import { isWorkingSet, type RecordKind } from "@/lib/stats";
import {
  minSets,
  performed,
  prTitle,
  progWords,
  restSecFor,
  setsComplete,
  setsOf,
  targetOf,
  topKg,
  type GymStore,
  type LastDone,
  type LiftItem as Item,
  type NextWeight,
} from "@/lib/store";
import type { DayKey, DayLog, LiftLog, PlanExercise, SetLog } from "@/lib/types";
import type { VoiceResult } from "@/lib/voice";
import { PlatesInfo } from "./PlateCalc";
import { SetMenu, SetNumber } from "./SetMenu";
import { InsightCallout } from "@/components/ds/parts";
import { targetWords } from "@/lib/session";
import type { LiftMenu } from "./types";
import { WarmupCalc } from "./WarmupCalc";

/** Moving a card in the day's order, from a lift's ··· menu: null where it can't go further. Each takes the position
 *  of the lift whose menu was used, so focus can follow it. In a superset, the whole superset moves. */
export interface Moves {
  up: ((i: number) => void) | null;
  down: ((i: number) => void) | null;
  /** The superset's letter, when the card is one. */
  superset?: string;
}

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
  /** Opens a lift's own page, under Progress. */
  onOpenLift: (name: string) => void;
  moves: Moves;
  /** Takes the lift out of the day's free-form workout, for a lift that's in one. */
  onRemove?: () => void;
}

/** One lift on one day, as a card shows it, and the changes a card makes to it: shared by a lift's own card and a
 *  superset's (SupersetItem.tsx), and plain values and functions rather than hooks, so a superset has one for each
 *  of its lifts. */
export interface LiftModel {
  item: Item;
  i: number;
  name: string;
  x: PlanExercise;
  r: Partial<LiftLog>;
  /** What was done: the planned name, or what it was swapped for. */
  did: string;
  last: LastDone | null;
  next: NextWeight | null;
  target: { sets: string; reps: string };
  warmSets: SetLog[];
  /** Working sets, numbered as on the card. */
  sets: SetLog[];
  /** The planned number of sets, and how many rows the card shows. */
  min: number;
  rows: number;
  /** The warm-up calculator's working weight to start from: the progression hint, or last time's top set. */
  defaultWorkingKg: number | null;
  /** The bar what was done goes on, for its plates and warm-up sets (null: it takes no plates), and what its
   *  warm-up sets round to: My gym's weights for what it's loaded with. */
  bar: number | null;
  inc: number;
  /** How to do the lift, when there's anything to say and it's done as planned. */
  cue: string;
  edit: (fn: (r: LiftLog) => void, immediate: boolean) => void;
  setField: (j: number, f: "reps" | "kg", value: string) => void;
  setInfo: (j: number, patch: Partial<SetLog>) => void;
  /** Adds a set: one more than it has, or up to `upTo` sets. */
  addSet: (upTo?: number) => void;
  /** Removes the last working set, without asking. */
  dropSet: () => void;
  logWarmups: (steps: { reps: number; kg: number }[]) => void;
  removeWarmups: () => void;
  skipToday: () => void;
}

/** A tick that came from logging the planned working sets (autoDone, saved with the day) follows them: on once
 *  they're all logged, and off again when one is cleared, taken off or made a drop set. Warm-ups never count, and a
 *  tick given by hand, with the box or "done", stays. */
function tickFollows(r: LiftLog, work: SetLog[], min: number) {
  if (r.done && r.autoDone && !setsComplete(work, min)) {
    r.done = false;
    delete r.autoDone;
  } else if (!r.done && !r.skipped && setsComplete(work, min)) {
    r.done = true;
    r.autoDone = true;
  }
}

/** A lift's model on a day. `onReps` hears of a set just given its first reps with no later set of the lift logged:
 *  when a rest can start. A lift's own card starts it then; a superset waits for the round. */
export function liftModel(store: GymStore, sel: DayKey, item: Item, i: number, entry: DayLog, onReps: (m: LiftModel, j: number) => void): LiftModel {
  const { x, name, extra } = item, r: Partial<LiftLog> = entry.exercises[name] || {};
  const did = performed(name, r as LiftLog), last = store.lastDone(did, sel), next = r.skipped ? null : store.nextWeight(x, did, sel);
  const load = store.loadDone(x, did);
  // What this lift was actually asked for on this day: its own stored target once logged, so its row count and
  // "sets done" reading don't drift under it if the plan's sets or reps change later; today's plan otherwise.
  const target = targetOf(r, x);
  // Warm-up sets (WU-marked) are kept apart from the numbered grid: they never count toward the planned sets, a
  // record or the heaviest set, whatever position they hold in the stored array.
  const allSets = setsOf(r as LiftLog), warmSets = allSets.filter((s) => !isWorkingSet(s));
  const sets = allSets.filter(isWorkingSet), min = extra ? 1 : minSets(target);
  const edit = (fn: (r: LiftLog) => void, immediate: boolean) => void store.editLift(sel, name, fn, immediate);
  const m: LiftModel = {
    item,
    i,
    name,
    x,
    r,
    did,
    last,
    next,
    target,
    warmSets,
    sets,
    min,
    rows: Math.max(min, sets.length),
    defaultWorkingKg: next && !next.held ? next.to : last ? topKg(setsOf(last.r)) : null,
    bar: store.barFor(load),
    inc: store.gridFor(load)?.inc ?? 2.5,
    // How to do the lift: folded, since it's the same every week. Warnings (e.g. a KNEE NOTE) always show.
    cue: r.skipped || r.swap ? "" : x.cue,
    edit,
    setField(j, f, value) {
      // Whether these reps can start a rest: set once inside edit(), against the state just before this change.
      let first = false;
      edit((r) => {
        const warm = setsOf(r).filter((s) => !isWorkingSet(s));
        const work = setsOf(r).filter(isWorkingSet).map((s): SetLog => ({ ...s, reps: s.reps ?? null, kg: s.kg ?? null }));
        while (work.length <= j) work.push({ reps: null, kg: null });
        const v = num(value), hadReps = work[j].reps != null;
        work[j][f] = v == null ? null : f === "kg" ? Math.round(v * 2) / 2 : Math.max(0, Math.round(v));
        // A new set usually uses the same weight as the one before it.
        if (f === "reps" && v != null && j > 0 && work[j].kg == null && work[j - 1].kg != null) work[j].kg = work[j - 1].kg;
        // When a set gets its reps, whether its kg came first or not: not again as more digits go in ("1", then
        // "12"), and not for a correction to a set with a later one already logged.
        if (f === "reps" && v != null && !hadReps && !work.slice(j + 1).some((s) => s.reps != null)) first = true;
        r.sets = [...warm, ...work];
        r.kg = topKg(r.sets);
        tickFollows(r, work, min);
      }, false);
      if (first) onReps(m, j);
    },
    // A set's kind or effort, from its menu. Making a set a drop set, or a working set again, changes how many
    // count toward the planned sets.
    setInfo(j, patch) {
      edit((r) => {
        const warm = setsOf(r).filter((s) => !isWorkingSet(s));
        const work = setsOf(r).filter(isWorkingSet).map((s) => ({ ...s }));
        while (work.length <= j) work.push({ reps: null, kg: null });
        const next: SetLog = { ...work[j], ...patch };
        for (const k of ["type", "rpe", "rir"] as const) if (next[k] == null) delete next[k];
        work[j] = next;
        r.sets = [...warm, ...work];
        tickFollows(r, work, min);
      }, true);
    },
    addSet(upTo) {
      edit((r) => {
        const warm = setsOf(r).filter((s) => !isWorkingSet(s));
        const work = setsOf(r).filter(isWorkingSet).map((s) => ({ ...s }));
        const want = upTo ?? Math.max(min, work.length) + 1;
        while (work.length < want) work.push({ reps: null, kg: null });
        r.sets = [...warm, ...work];
      }, true);
    },
    dropSet() {
      edit((r) => {
        const warm = setsOf(r).filter((s) => !isWorkingSet(s)), work = setsOf(r).filter(isWorkingSet).slice(0, -1);
        r.sets = [...warm, ...work];
        r.kg = topKg(r.sets);
        tickFollows(r, work, min);
      }, true);
    },
    logWarmups(steps) {
      edit((r) => {
        const work = setsOf(r).filter(isWorkingSet);
        r.sets = [...steps.map((s) => ({ reps: s.reps, kg: s.kg, type: "warmup" as const })), ...work];
        r.kg = topKg(r.sets);
      }, true);
    },
    removeWarmups() {
      edit((r) => {
        r.sets = setsOf(r).filter(isWorkingSet);
        r.kg = topKg(r.sets);
      }, true);
    },
    skipToday() {
      edit((r) => {
        r.skipped = true;
        r.done = false;
        delete r.autoDone;
      }, true);
    },
  };
  return m;
}

/** Voice (Settings, Log sets by voice): a phrase heard for this lift, done through the same changes as typing, + Set,
 *  the tick and Skip today, so the carried-over weight, PR badge, tick, rest timer and sync all follow as they
 *  would. It reads the lift as saved now, since the answer comes after this render, and returns the line to show
 *  under the lift. */
export function voiceHandler(store: GymStore, sel: DayKey, m: LiftModel, focusNext: FocusNext) {
  const { name, min, i } = m;
  return (said: VoiceResult, heard: string): string => {
    const now = () => setsOf(store.entry(sel).exercises[name]).filter(isWorkingSet);
    const lastLogged = () => now().findLastIndex((s) => (s.reps ?? 0) > 0);
    const at = `Heard “${heard}”`, logged = (j: number) => `${at}: set ${j + 1}, ${setsSummary([now()[j]])}.`;
    if (store.entry(sel).exercises[name]?.skipped) return "";
    if (said.kind === "unknown") return `${at}. Say it like “10 at 45”.`;
    if (said.kind === "set") {
      // The first row with no reps, after adding one when every row is filled.
      const sets = now(), rows = Math.max(min, sets.length);
      let j = 0;
      while (j < rows && (sets[j]?.reps ?? 0) > 0) j++;
      if (j === rows) m.addSet();
      m.setField(j, "reps", String(said.reps));
      if (said.kg != null) m.setField(j, "kg", String(said.kg));
      return logged(j);
    }
    if (said.command === "again") {
      const sets = now(), last = lastLogged();
      if (last < 0) return `${at}. There’s no set to repeat yet.`;
      const j = last + 1, s = sets[last];
      if (j >= Math.max(min, sets.length)) m.addSet();
      m.setField(j, "reps", String(s.reps));
      m.setField(j, "kg", s.kg == null ? "" : String(s.kg));
      return logged(j);
    }
    if (said.command === "undo") {
      const last = lastLogged();
      if (last < 0) return `${at}. There’s no set to undo.`;
      // A tick the set gave goes with it, as when it's cleared by hand.
      m.setField(last, "reps", "");
      m.setField(last, "kg", "");
      return `${at}: set ${last + 1} cleared.`;
    }
    if (said.command === "done") {
      m.edit((r) => {
        delete r.autoDone;
        r.done = true;
      }, true);
      return `${at}: marked done.`;
    }
    m.skipToday();
    // A skipped lift has no microphone: if it had focus, focus moves to ···, which holds Undo skip.
    if ((document.activeElement as HTMLElement | null)?.dataset.voice === String(i)) focusNext(`[data-more="${i}"]`);
    return `${at}: skipped today.`;
  };
}

/** Last time's set `j`, as "30 × 15" (kg × reps), for the set table's Last column. */
function lastSet(last: LastDone | null, j: number): string {
  if (!last) return "–";
  const s = setsOf(last.r).filter(isWorkingSet)[j];
  if (!s) return "–";
  return s.kg != null && s.reps != null ? `${s.kg} × ${s.reps}` : s.reps != null ? `${s.reps} reps` : s.kg != null ? `${s.kg} kg` : "–";
}

/** Logs set `j` as it stands: whatever is typed, and for what isn't, the suggestion showing in its box (the next
 *  weight, the target reps). The reps go in last, so the rest timer starts on the finished set. */
export function logSet(store: GymStore, m: LiftModel, j: number) {
  const s: Partial<SetLog> = m.sets[j] || {}, [phR, phK] = store.placeholders(m.x, m.last, j, m.next);
  if (s.kg == null && num(phK) != null) m.setField(j, "kg", phK);
  if (!((s.reps ?? 0) > 0)) {
    const reps = num(s.reps ?? phR) ?? num(phR) ?? 0;
    m.setField(j, "reps", String(reps > 0 ? reps : 1));
  }
}

/** The first working set with no reps yet: the one the workout is on. */
export const nextSet = (m: LiftModel) => {
  for (let j = 0; j < m.rows; j++) if (!((m.sets[j]?.reps ?? 0) > 0)) return j;
  return -1;
};

/** The next-weight hint, by the lift's progression rule: go up, work at a percentage, deload, or hold for the knee. */
export function ProgHint({ next }: { next: NextWeight | null }) {
  if (!next) return null;
  const w = progWords(next);
  return (
    <div className={cx("prog callout", next.held || next.rule === "deload" ? "hold warn" : "good")} data-rule={next.held ? "hold" : next.rule}>
      <span>
        {w.lead}
        {w.kg ? <b>{w.kg}&nbsp;kg</b> : null}
        {w.why}
      </span>
    </div>
  );
}

/** A lift's heading in the workout: where it is ("Exercise 3 of 5"), its name, what it's asked for (sets × reps, rest,
 *  tempo) and what was done last time; how-to, voice and ··· buttons; its caution; and, with ··· open, the day's
 *  choices for it: done, skip, swap, its chart and moving it in the day's order. In a superset, `tag` (A1) names
 *  its place there. */
export function LiftHead({
  m,
  sel,
  tag,
  step,
  menu,
  setMenu,
  focusNext,
  onOpenLift,
  voice,
  moves,
  onRemove,
}: {
  m: LiftModel;
  sel: DayKey;
  tag?: string;
  step?: string;
  menu: LiftMenu["mode"] | null;
  setMenu: (m: LiftMenu | null) => void;
  focusNext: FocusNext;
  onOpenLift: (name: string) => void;
  voice: { on: boolean; listening: boolean; listen: () => Promise<void> };
  moves: Moves;
  onRemove?: () => void;
}) {
  const store = useGym();
  const library = useLibrary();
  const { r, i, name, did, x, target, last } = m;
  const [howOpen, setHowOpen] = useState(false);

  const swap = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const v = (ev.currentTarget.elements.namedItem(`swap${i}`) as HTMLInputElement).value.trim();
    if (!v || v === name) return;
    setMenu(null);
    m.edit((r) => {
      r.swap = v;
    }, true);
  };
  const what = moves.superset ? `superset ${moves.superset}` : did;

  let actions = null;
  if (menu === "menu") {
    actions = (
      <div className="acts">
        <label className="acts-done" htmlFor={`ex${i}`}>
          <input
            type="checkbox"
            className="tick"
            id={`ex${i}`}
            data-i={i}
            checked={!!r.done}
            disabled={!!r.skipped}
            onChange={(ev) => {
              const on = ev.target.checked;
              m.edit((r) => {
                delete r.autoDone;
                r.done = on;
              }, true);
            }}
          />
          <span>Done</span>
        </label>
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
                  m.edit((r) => {
                    r.reason = v;
                  }, false);
                }}
              />
            </label>
            <button
              className="btn btn-sm"
              data-unskip={i}
              onClick={() => {
                setMenu(null);
                m.edit((r) => {
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
            className="btn btn-sm"
            data-unswap={i}
            onClick={() => {
              setMenu(null);
              m.edit((r) => {
                delete r.swap;
              }, true);
            }}
          >
            Back to {name}
          </button>
        ) : (
          <>
            <button
              className="btn btn-sm"
              data-skip={i}
              onClick={() => {
                m.skipToday();
                // The reason is optional, so a phone keeps its keyboard closed: focus stays by the change.
                focusNext(matchMedia("(pointer: fine)").matches ? `#reason${i}` : `[data-unskip="${i}"]`);
              }}
            >
              Skip today
            </button>
            <button
              className="btn btn-sm"
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
        <ViewLink
          className="btn btn-sm"
          data-chart={i}
          href={hashOf({ view: "progress", lift: did })}
          onOpen={() => {
            setMenu(null);
            onOpenLift(did);
          }}
        >
          See chart
        </ViewLink>
        {moves.up || moves.down ? (
          <>
            <button className="btn btn-sm" data-lmove={`${i}:-1`} disabled={!moves.up} aria-label={`Move ${what} up`} onClick={() => moves.up?.(i)}>
              Move earlier
            </button>
            <button className="btn btn-sm" data-lmove={`${i}:1`} disabled={!moves.down} aria-label={`Move ${what} down`} onClick={() => moves.down?.(i)}>
              Move later
            </button>
          </>
        ) : null}
        {onRemove ? (
          <button
            className="btn btn-sm btn-danger"
            data-freerm={i}
            onClick={() => {
              const n = m.sets.filter((s) => s.reps != null || s.kg != null).length;
              if (n && !confirm(`Remove ${did} and its ${n === 1 ? "set" : `${n} sets`} from this workout?`)) return;
              setMenu(null);
              onRemove();
            }}
          >
            Remove from this workout
          </button>
        ) : null}
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
          <button className="btn btn-sm" type="submit">
            Swap
          </button>
          <button
            className="btn btn-sm"
            type="button"
            data-swaplib={i}
            onClick={() =>
              library({
                title: `Swap ${did} for`,
                many: false,
                have: [name, store.exerciseOf(name, x)?.name ?? name],
                muscle: store.exerciseOf(name, x)?.primary[0],
                onPick: ([y]) => {
                  setMenu(null);
                  m.edit((r) => {
                    r.swap = y.name;
                  }, true);
                },
              })
            }
          >
            Library…
          </button>
          <button className="btn btn-sm btn-quiet" type="button" data-actsclose="" onClick={() => setMenu(null)}>
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

  const rest = restSecFor(store.plan, x), tempo = store.plan.tempo.replace(/[:/-]/g, "·");
  const meta = [target.sets || target.reps ? targetWords(target) : "", m.item.extra ? "" : `rest ${mmss(rest)}`, tempo && !m.item.extra ? `tempo ${tempo}` : ""].filter(Boolean).join(" · ");
  const lastTop = last ? topKg(setsOf(last.r).filter(isWorkingSet)) : null, cur = r.kg ?? null;
  return (
    <>
      <div className="ex-head">
        <div className="ex-t">
          {step ? <div className="ex-step">{step}</div> : null}
          <h2 className="ex-name">
            {tag ? <span className="sstag">{tag}</span> : null}
            <span className="nm">{did}</span>
          </h2>
          {r.swap ? <div className="ex-was">instead of {name}</div> : null}
          <div className="ex-meta">
            {meta ? <span className="sr">{meta}</span> : null}
            {r.skipped ? null : (
              <span className={cx("last", cur != null && lastTop != null && cur > lastTop && "up")}>
                {last ? `Last ${setsSummary(setsOf(last.r).filter(isWorkingSet))} · ${dayMonth(last.day)}` : "First time"}
                {cur != null && lastTop != null && cur > lastTop ? <span className="sr-only"> (heavier than last time)</span> : null}
              </span>
            )}
          </div>
        </div>
        <div className="ex-btns">
          {voice.on ? (
            <button type="button" className="btn btn-icon mic" data-voice={i} aria-pressed={voice.listening} aria-label={`Log a set of ${did} by voice`} onClick={() => void voice.listen()}>
              <Mic size={20} aria-hidden="true" />
            </button>
          ) : null}
          {m.cue ? (
            <button type="button" className="btn btn-icon howto" aria-expanded={howOpen} aria-controls={`cue${i}`} aria-label={`How to do ${did}`} onClick={() => setHowOpen(!howOpen)}>
              <CircleHelp size={22} aria-hidden="true" />
            </button>
          ) : null}
          <button className="btn btn-icon more" data-more={i} aria-expanded={menu ? "true" : "false"} aria-label={`More for ${did}`} onClick={() => setMenu(menu ? null : { day: sel, name, mode: "menu" })}>
            <Ellipsis size={22} aria-hidden="true" />
          </button>
        </div>
      </div>
      {m.cue && howOpen ? (
        <p className="nt cue" id={`cue${i}`}>
          {m.cue}
        </p>
      ) : null}
      {x.flag && !r.skipped && !r.swap ? (
        <div className="ch">
          <InsightCallout kind="caution">{x.flag}</InsightCallout>
        </div>
      ) : null}
      {m.item.extra ? <p className="note">Not in this workout</p> : null}
      {actions}
    </>
  );
}

/** The set table's header row. */
export function SetHead({ tag }: { tag?: boolean }) {
  return (
    <div className="srow shead" aria-hidden="true">
      <span>{tag ? "" : "Set"}</span>
      <span>Last</span>
      <span className="c">kg</span>
      <span className="c">Reps</span>
      <span />
    </div>
  );
}

/** One set's row (SetRow spec): its number (the button for its menu: kind, effort and plates), last time's set,
 *  kg and reps, and a 44px check. Done rows sit on brand-row with a filled check; the active row (the next set) has
 *  outlined boxes; later ones are muted. The boxes show the suggestion (next weight, target reps) until typed in, and
 *  the check logs it. In a superset, `tag` (A1) stands in the number's place, and the round it's in gives the set. */
export function SetRow({
  m,
  j,
  marks,
  tag,
  active,
  menuOpen,
  onMenu,
}: {
  m: LiftModel;
  j: number;
  marks: Map<string, RecordKind[]>;
  tag?: string;
  active: boolean;
  menuOpen: boolean;
  onMenu: () => void;
}) {
  const store = useGym();
  const { i, did, x, last, next } = m;
  const s: Partial<SetLog> = m.sets[j] || {}, [phR, phK] = store.placeholders(x, last, j, next), pr = marks.get(`${did}|${j}`);
  const menuId = `sm${i}_${j}`, done = (s.reps ?? 0) > 0;
  return (
    <>
      <div className={cx("srow set", done ? "done logged" : active ? "active" : "up", pr && "pr")}>
        <SetNumber n={j + 1} tag={tag} s={s} id={menuId} did={did} open={menuOpen} onToggle={onMenu} />
        <span className="last">{lastSet(last, j)}</span>
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
          onChange={(ev) => m.setField(j, "kg", ev.target.value)}
        />
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
          onChange={(ev) => m.setField(j, "reps", ev.target.value)}
        />
        <button
          type="button"
          className="chk"
          data-check={`${i}:${j}`}
          aria-pressed={done}
          aria-label={done ? `${did}, set ${j + 1} done. Undo` : `Mark ${did}, set ${j + 1} done`}
          onClick={() => (done ? m.setField(j, "reps", "") : logSet(store, m, j))}
        >
          {done ? <Check size={22} strokeWidth={3} aria-hidden="true" /> : null}
        </button>
        <span className="prb" title={prTitle(pr)}>
          <Trophy size={12} aria-hidden="true" />
          PR
        </span>
      </div>
      {menuOpen ? (
        <div className="setmenu-w">
          <SetMenu id={menuId} s={s} effort={store.plan.effort} onChange={(patch) => m.setInfo(j, patch)} />
          {m.bar != null && s.kg != null && s.kg > 0 ? <PlatesInfo id={`pl${i}_${j}`} kg={s.kg} barKg={m.bar} plateKgs={store.plan.plateKgs} /> : null}
        </div>
      ) : null}
    </>
  );
}

/** One lift in the workout (the Active workout board's exercise card): its heading, the next-weight hint, the set
 *  table, + Add set and Warm-up sets. */
export function LiftItem({ item, i, sel, entry, marks, menu, setMenu, focusNext, onOpenLift, moves, onRemove, step }: Props & { step?: string }) {
  const store = useGym();
  const m = liftModel(store, sel, item, i, entry, (m) => store.startRest(sel, m.did, restSecFor(store.plan, m.x)));
  const { r, sets, min, rows } = m;
  const [menuRow, setMenuRow] = useState<number | null>(null);
  const voiceOn = useVoiceOn();
  const voice = useVoice(voiceOn && !r.skipped, voiceHandler(store, sel, m, focusNext));
  const active = nextSet(m);

  const body = r.skipped ? (
    <div className="skipnote">Skipped{r.reason ? ` · ${r.reason}` : ""}</div>
  ) : (
    <>
      <ProgHint next={m.next} />
      <div className="sets" role="group" aria-label={`${m.did}, sets`}>
        <SetHead />
        {Array.from({ length: rows }, (_, j) => (
          <SetRow key={j} m={m} j={j} marks={marks} active={j === active} menuOpen={menuRow === j} onMenu={() => setMenuRow(menuRow === j ? null : j)} />
        ))}
      </div>
      <div className="setbtns">
        <button className="btn btn-sm" data-addset={i} onClick={() => m.addSet()}>
          + Add set
        </button>
        {sets.length > min ? (
          <button
            className="btn btn-sm"
            data-rmset={i}
            onClick={() => {
              const said = setsSummary([sets[sets.length - 1]]);
              if (said && !confirm(`Remove set ${sets.length} (${said})?`)) return;
              m.dropSet();
            }}
          >
            − Set
          </button>
        ) : null}
        <WarmupCalc id={`wset${i}`} barKg={m.bar ?? 0} inc={m.inc} defaultKg={m.defaultWorkingKg} warmSets={m.warmSets} onLog={m.logWarmups} onRemove={m.removeWarmups} />
      </div>
    </>
  );

  return (
    <section className={cx("card ex-card lift", r.done && "checked", r.skipped && "skipped", r.swap && "swapped")} aria-label={m.did}>
      <LiftHead m={m} sel={sel} step={step} menu={menu} setMenu={setMenu} focusNext={focusNext} onOpenLift={onOpenLift} voice={{ on: voiceOn && !r.skipped, ...voice }} moves={moves} onRemove={onRemove} />
      {body}
      {voiceOn ? (
        <p className="said" aria-live="polite">
          {voice.line}
        </p>
      ) : null}
    </section>
  );
}
