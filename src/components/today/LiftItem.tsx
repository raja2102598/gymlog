"use client";
import { CaretDown, DotsThree, Microphone } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { useLibrary } from "@/components/library/LibraryContext";
import { SyncedInput } from "@/components/ui/SyncedField";
import { ViewLink } from "@/components/ui/ViewLink";
import { useGym } from "@/hooks/useGym";
import type { FocusNext } from "@/hooks/useFocusNext";
import { useVoice, useVoiceOn } from "@/hooks/useVoice";
import { cx } from "@/lib/cx";
import { dayMonth } from "@/lib/dates";
import { num, setsSummary } from "@/lib/format";
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
import { PlatesButton, PlatesInfo } from "./PlateCalc";
import { SetMenu, SetNumber } from "./SetMenu";
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

/** A lift's model on a day. `onReps` hears of a set just given its first reps with no later set of the lift logged:
 *  when a rest can start. A lift's own card starts it then; a superset waits for the round. */
export function liftModel(store: GymStore, sel: DayKey, item: Item, i: number, entry: DayLog, onReps: (m: LiftModel, j: number) => void): LiftModel {
  const { x, name, extra } = item, r: Partial<LiftLog> = entry.exercises[name] || {};
  const did = performed(name, r as LiftLog), last = store.lastDone(did, sel), next = r.skipped ? null : store.nextWeight(x, did, sel);
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
        // Logging the planned number of working sets ticks the lift off; warm-ups never do.
        if (!r.done && !r.skipped && setsComplete(work, min)) {
          r.done = true;
          r.autoDone = true;
        }
      }, false);
      if (first) onReps(m, j);
    },
    // A set's kind or effort, from its menu. Making a set a drop set, or a working set again, changes how many
    // count toward the planned sets, so a tick that came from them follows.
    setInfo(j, patch) {
      edit((r) => {
        const warm = setsOf(r).filter((s) => !isWorkingSet(s));
        const work = setsOf(r).filter(isWorkingSet).map((s) => ({ ...s }));
        while (work.length <= j) work.push({ reps: null, kg: null });
        const next: SetLog = { ...work[j], ...patch };
        for (const k of ["type", "rpe", "rir"] as const) if (next[k] == null) delete next[k];
        work[j] = next;
        r.sets = [...warm, ...work];
        if (r.done && r.autoDone && !setsComplete(work, min)) {
          r.done = false;
          delete r.autoDone;
        } else if (!r.done && !r.skipped && setsComplete(work, min)) {
          r.done = true;
          r.autoDone = true;
        }
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
        const warm = setsOf(r).filter((s) => !isWorkingSet(s));
        r.sets = [...warm, ...setsOf(r).filter(isWorkingSet).slice(0, -1)];
        r.kg = topKg(r.sets);
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
      m.setField(last, "reps", "");
      m.setField(last, "kg", "");
      // Logging the planned sets ticked the lift off (autoDone, saved with the day), so with fewer the tick goes
      // too. A tick given by hand, with the box or "done", stays.
      m.edit((r) => {
        if (r.done && r.autoDone && !setsComplete(setsOf(r), min)) {
          r.done = false;
          delete r.autoDone;
        }
      }, false);
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

/** What was done last time, set by set, so there's something to beat; the arrow shows today's heaviest
 *  set is already heavier. */
function LastHint({ last, cur }: { last: LastDone | null; cur: number | null }) {
  if (!last) return <span className="last">First time</span>;
  const sets = setsOf(last.r).filter(isWorkingSet), top = topKg(sets), up = cur != null && top != null && cur > top;
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

/** The next-weight hint, by the lift's progression rule: go up, work at a percentage, deload, or hold for the knee. */
export function ProgHint({ next }: { next: NextWeight | null }) {
  if (!next) return null;
  const w = progWords(next);
  return (
    <div className={cx("prog callout", next.held || next.rule === "deload" ? "hold warn" : "good")} data-rule={next.held ? "hold" : next.rule}>
      {w.lead}
      {w.kg ? <b>{w.kg}&nbsp;kg</b> : null}
      {w.why}
    </div>
  );
}

/** A lift's name with its tick, microphone and ··· menu; what it's asked for and what was done last time; its warning;
 *  and, with the menu open, the day's choices for it: skip, swap, its chart and moving it in the day's order. In a
 *  superset, `tag` (A1, A2) names its place there. */
export function LiftHead({
  m,
  sel,
  tag,
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
  const moveButtons = (
    <>
      <button className="ghost tiny" data-lmove={`${i}:-1`} disabled={!moves.up} aria-label={`Move ${what} up`} onClick={() => moves.up?.(i)}>
        ↑ Move up
      </button>
      <button className="ghost tiny" data-lmove={`${i}:1`} disabled={!moves.down} aria-label={`Move ${what} down`} onClick={() => moves.down?.(i)}>
        ↓ Move down
      </button>
    </>
  );

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
                  m.edit((r) => {
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
            className="ghost tiny"
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
              className="ghost tiny"
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
        <ViewLink
          className="ghost tiny"
          data-chart={i}
          href={hashOf({ view: "progress", lift: did })}
          onOpen={() => {
            setMenu(null);
            onOpenLift(did);
          }}
        >
          See chart
        </ViewLink>
        {moves.up || moves.down ? moveButtons : null}
        {onRemove ? (
          <button
            className="ghost tiny danger"
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
          <button className="ghost tiny" type="submit">
            Swap
          </button>
          <button
            className="ghost tiny"
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

  return (
    <>
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
              m.edit((r) => {
                delete r.autoDone;
                r.done = on;
              }, true);
            }}
          />
          <span className="nm">
            {tag ? (
              <>
                <span className="sstag">{tag}</span>{" "}
              </>
            ) : null}
            {did}
            {r.swap ? (
              <>
                {" "}
                <span className="was">instead of {name}</span>
              </>
            ) : null}
          </span>
        </label>
        {voice.on ? (
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
        {target.sets || target.reps ? (
          <span className="sr">
            {target.sets}&nbsp;×&nbsp;{target.reps}
          </span>
        ) : null}
        {r.skipped ? null : (
          <span className="hint">
            <LastHint last={last} cur={r.kg ?? null} />
          </span>
        )}
      </div>
      {x.flag && !r.skipped && !r.swap ? <div className="ch">{x.flag}</div> : null}
      {m.item.extra ? <div className="ch">Not in this workout</div> : null}
      {actions}
    </>
  );
}

/** One set's row: its number (the button for its menu), reps × kg with last time's numbers as placeholders, the
 *  plates button and a PR badge; then its menu or plates, when open. In a superset, `tag` (A1) stands in the
 *  number's place, and the round it's in gives the set. */
export function SetRow({
  m,
  j,
  marks,
  tag,
  menuOpen,
  onMenu,
  platesOpen,
  onPlates,
}: {
  m: LiftModel;
  j: number;
  marks: Map<string, RecordKind[]>;
  tag?: string;
  menuOpen: boolean;
  onMenu: () => void;
  platesOpen: boolean;
  onPlates: () => void;
}) {
  const store = useGym();
  const { i, did, x, last, next } = m;
  const s: Partial<SetLog> = m.sets[j] || {}, [phR, phK] = store.placeholders(x, last, j, next), pr = marks.get(`${did}|${j}`);
  const platesId = `pl${i}_${j}`, menuId = `sm${i}_${j}`;
  return (
    <>
      <div className={cx("set", pr && "pr", (s.reps ?? 0) > 0 && "logged")}>
        <SetNumber n={j + 1} tag={tag} s={s} id={menuId} did={did} open={menuOpen} onToggle={onMenu} />
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
          onChange={(ev) => m.setField(j, "kg", ev.target.value)}
        />
        <span className="u">kg</span>
        <PlatesButton id={platesId} label={`Plates for ${did}, set ${j + 1}`} open={platesOpen} disabled={s.kg == null || s.kg <= 0} onToggle={onPlates} />
        <span className="prb" title={prTitle(pr)}>
          PR
        </span>
      </div>
      {menuOpen ? <SetMenu id={menuId} s={s} effort={store.plan.effort} onChange={(patch) => m.setInfo(j, patch)} /> : null}
      {platesOpen && s.kg != null && s.kg > 0 ? <PlatesInfo id={platesId} kg={s.kg} barKg={store.plan.barKg} plateKgs={store.plan.plateKgs} /> : null}
    </>
  );
}

/** One lift on the day: its sets (reps × kg), last time's numbers, the next-weight hint, and skip or swap. */
export function LiftItem({ item, i, sel, entry, marks, menu, setMenu, focusNext, onOpenLift, moves, onRemove }: Props) {
  const store = useGym();
  const m = liftModel(store, sel, item, i, entry, (m) => store.startRest(sel, m.did, restSecFor(store.plan, m.x)));
  const { r, sets, min, rows, cue } = m;
  const [howOpen, setHowOpen] = useState(false);
  const [plateRow, setPlateRow] = useState<number | null>(null);
  const [menuRow, setMenuRow] = useState<number | null>(null);
  const voiceOn = useVoiceOn();
  const voice = useVoice(voiceOn && !r.skipped, voiceHandler(store, sel, m, focusNext));

  const body = r.skipped ? (
    <div className="skipnote">Skipped{r.reason ? ` · ${r.reason}` : ""}</div>
  ) : (
    <>
      <ProgHint next={m.next} />
      <WarmupCalc id={`wset${i}`} barKg={store.plan.barKg} defaultKg={m.defaultWorkingKg} warmSets={m.warmSets} onLog={m.logWarmups} onRemove={m.removeWarmups} />
      <div className="sets">
        {Array.from({ length: rows }, (_, j) => (
          <SetRow
            key={j}
            m={m}
            j={j}
            marks={marks}
            menuOpen={menuRow === j}
            onMenu={() => setMenuRow(menuRow === j ? null : j)}
            platesOpen={plateRow === j}
            onPlates={() => setPlateRow(plateRow === j ? null : j)}
          />
        ))}
        <div className="setbtns">
          <button className="ghost tiny" data-addset={i} onClick={() => m.addSet()}>
            + Set
          </button>
          {sets.length > min ? (
            <button
              className="ghost tiny"
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
      <LiftHead
        m={m}
        sel={sel}
        menu={menu}
        setMenu={setMenu}
        focusNext={focusNext}
        onOpenLift={onOpenLift}
        voice={{ on: voiceOn && !r.skipped, ...voice }}
        moves={moves}
        onRemove={onRemove}
      />
      {body}
      {voiceOn ? (
        <p className="said" aria-live="polite">
          {voice.line}
        </p>
      ) : null}
    </li>
  );
}
