"use client";
import { Bike, BookOpen, Check, Dumbbell, GripVertical, MapPin, Play, Plus } from "lucide-react";
import { Fragment, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { useLibrary } from "@/components/library/LibraryContext";
import { Button, InsightCallout, LinkButton, PainScale, TabHead } from "@/components/ds/parts";
import { DayChips } from "@/components/ds/WeekStrip";
import { SyncedInput } from "@/components/ui/SyncedField";
import { ViewLink } from "@/components/ui/ViewLink";
import type { FocusNext } from "@/hooks/useFocusNext";
import { useGym } from "@/hooks/useGym";
import { ExerciseSheet, type SheetLift } from "@/components/exercise/ExerciseSheet";
import { ExerciseThumb } from "@/components/exercise/ExerciseThumb";
import { cx } from "@/lib/cx";
import { addDays, DOW, todayKey, wdIndex } from "@/lib/dates";
import { num } from "@/lib/format";
import { liftLine, sessionDone, sessionSummary, tintOf, weekPosition } from "@/lib/session";
import { performed } from "@/lib/store";
import type { DayKey, DayLog, KneeField, MeasureField, NumField } from "@/lib/types";
import { DayFields } from "@/components/today/DayFields";
import { Measurements } from "@/components/today/Measurements";
import { WarmUp } from "@/components/today/WarmUp";

interface Props {
  sel: DayKey;
  onSelect: (k: DayKey) => void;
  /** Opens the workout for the selected day, at a block (a lift tapped here) or where it left off. */
  onStart: (at: number | null) => void;
  onOpenPlan: () => void;
  onOpenGym: () => void;
  onOpenSettings: () => void;
  warmOpen: boolean;
  onToggleWarm: () => void;
  focusNext: FocusNext;
}

/** Train: the selected day's session (Train board). Day chips for the week, the session with a row per lift (tap one
 *  to start there; drag the handle to reorder), Add exercise, the library and My gym, then the day's log: warm-ups,
 *  knee scores, steps, weight, notes and measurements. */
export function TrainView({ sel, onSelect, onStart, onOpenPlan, onOpenGym, onOpenSettings, warmOpen, onToggleWarm, focusNext }: Props) {
  const store = useGym();
  const pos = weekPosition(store, todayKey());
  const trainDays = store.plan.days.filter((d) => d.exercises.length).length;
  return (
    <>
      <TabHead
        eyebrow={[`${trainDays}-day plan`, pos ? `Week ${pos.week}` : ""].filter(Boolean).join(" · ")}
        title="Train"
        onProfile={onOpenSettings}
        action={
          <LinkButton variant="raised" id="changePlan" href="#plan" onOpen={onOpenPlan}>
            Change plan
          </LinkButton>
        }
      />
      <div className="screen">
        <DayChips sel={sel} onSelect={onSelect} />
        <Session key={sel} sel={sel} onStart={onStart} focusNext={focusNext} />
        <div className="grid2">
          <LibraryTile sel={sel} focusNext={focusNext} />
          <ViewLink className="card link-tile" id="gymTile" href="#gym" onOpen={onOpenGym}>
            <span className="ico-tile t-brand" aria-hidden="true">
              <MapPin size={22} />
            </span>
            <span className="lt-t">My gym</span>
            <span className="lt-s">{gymWords(store)}</span>
          </ViewLink>
        </div>
        <DayLog sel={sel} warmOpen={warmOpen} onToggleWarm={onToggleWarm} />
      </div>
    </>
  );
}

const gymWords = (store: ReturnType<typeof useGym>) => {
  const all = store.library(), can = all.filter((x) => store.canDo(x)).length;
  return can === all.length ? "Every lift" : `${can} of ${all.length} lifts`;
};

function LibraryTile({ sel, focusNext }: { sel: DayKey; focusNext: FocusNext }) {
  const store = useGym();
  const add = useAddLifts(sel, focusNext);
  return (
    <button type="button" className="card link-tile" id="libTile" onClick={add}>
      <span className="ico-tile t-brand" aria-hidden="true">
        <BookOpen size={22} />
      </span>
      <span className="lt-t">Exercise library</span>
      <span className="lt-s">{store.library().length} lifts</span>
    </button>
  );
}

/** Opens the library to add lifts to the day: to its free-form workout when it has one, otherwise to the plan's
 *  session for that weekday (as the plan editor's Add from library does). */
function useAddLifts(sel: DayKey, focusNext: FocusNext) {
  const store = useGym();
  const library = useLibrary();
  return () => {
    const free = store.entry(sel).free;
    if (free) {
      library({
        title: `Add to ${free.name.trim() || "this workout"}`,
        many: true,
        have: free.lifts.flatMap((n) => [n, store.exerciseOf(n)?.name ?? n]),
        onPick: (xs) => {
          store.addFreeLifts(sel, xs.map((x) => x.name));
          focusNext("#addExercise");
        },
      });
      return;
    }
    const slot = store.slotFor(sel), d = store.plan.days[slot];
    library({
      title: `Add to ${d.name}`,
      many: true,
      have: d.exercises.flatMap((x) => [x.name, store.exerciseOf(x.name, x)?.name ?? x.name]),
      onPick: (xs) => {
        store.addLibraryLifts(slot, xs);
        store.closePlan();
        focusNext("#addExercise");
      },
    });
  };
}

/* ---------- the session ---------- */

function Session({ sel, onStart, focusNext }: { sel: DayKey; onStart: (at: number | null) => void; focusNext: FocusNext }) {
  const store = useGym();
  const plan = store.plan, p = store.planFor(sel), e = store.entry(sel);
  const blocks = store.liftBlocks(sel);
  const slot = store.slotFor(sel), own = wdIndex(sel), t = todayKey();
  const free = e.free ?? null;
  const rest = !p.exercises.length && !free;
  const missed = rest && sel >= t ? store.missedThisWeek(sel) : [];
  const sum = sessionSummary(store, sel);
  const addLifts = useAddLifts(sel, focusNext);
  const items = blocks.flat();
  const done = sessionDone(store, sel);
  const skipped = e.skip != null;
  const editDay = (fn: (n: DayLog) => void) => store.editDay(sel, fn, true);
  const switchTo = (v: number) =>
    editDay((n) => {
      if (v === own) delete n.session;
      else n.session = v;
    });
  const addLift = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const box = ev.currentTarget.elements.namedItem("addLift") as HTMLInputElement;
    if (store.addFreeLift(sel, box.value)) box.value = "";
    box.focus();
  };
  const cardio = p.cardio.name && !free ? p.cardio : null;
  return (
    <section className="card session" id="session" aria-labelledby="sessName">
      <div className="sess-h">
        <div className="sess-t">
          {free ? (
            <label className="field" htmlFor="freeName">
              <span>Workout name</span>
              <SyncedInput id="freeName" value={free.name} placeholder="e.g. Hotel gym…" autoComplete="off" onChange={(ev) => store.setFreeName(sel, ev.target.value)} />
            </label>
          ) : (
            <h2 className="title-md sess-name" id="sessName">
              {rest ? "Rest day" : p.name}
            </h2>
          )}
          <p className="sub" id="liftPill">
            {rest ? p.focus || "Nothing planned" : skipped ? ["Skipped", e.skip?.trim()].filter(Boolean).join(" · ") : items.length ? [`${sum.lifts} lift${sum.lifts === 1 ? "" : "s"}`, sum.min ? `about ${sum.min} min` : "", done ? "done" : ""].filter(Boolean).join(" · ") : "No lifts yet"}
          </p>
        </div>
        {items.length && skipped ? (
          <Button className="start-sm" id="unskipBtn" onClick={() => store.unskipDay(sel)}>
            Undo skip
          </Button>
        ) : items.length ? (
          <Button variant="primary" className="start-sm" id="startBtn" onClick={() => onStart(null)}>
            {done ? <Check size={16} aria-hidden="true" /> : <Play size={13} fill="currentColor" aria-hidden="true" />}
            {done ? "Review" : store.worked(sel) ? "Continue" : "Start"}
          </Button>
        ) : null}
      </div>

      {missed.length ? (
        <div className="catchup">
          <InsightCallout>
            Missed this week:{" "}
            {missed.map((i, n) => (
              <Fragment key={i}>
                {n ? ", " : ""}
                <b>{plan.days[i].name}</b> ({DOW[i]})
              </Fragment>
            ))}
            . Do {missed.length > 1 ? "one" : "it"} {sel === t ? "today" : "on " + DOW[own]}?
          </InsightCallout>
          <div className="btn-row">
            {missed.map((i) => (
              <Button key={i} data-catch={i} onClick={() => switchTo(i)}>
                Do {plan.days[i].name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {items.length || cardio ? (
        <LiftRows sel={sel} onOpen={onStart} focusNext={focusNext} cardio={cardio} cardioDone={!!e.cardio} />
      ) : null}

      {free ? (
        <form className="addlift" onSubmit={addLift}>
          <label className="field" htmlFor="addLift">
            <span>Add a lift by name</span>
            <input id="addLift" name="addLift" list="addLiftList" placeholder="e.g. Goblet squat…" autoComplete="off" />
          </label>
          <Button type="submit">Add</Button>
          <datalist id="addLiftList">
            {store.liftSuggestions(free.lifts).map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </form>
      ) : null}
      {!rest || free ? (
        <Button id="addExercise" className="add-ex" onClick={addLifts}>
          <Plus size={18} aria-hidden="true" />
          Add exercise
        </Button>
      ) : null}

      <div className="sess-pick">
        {free ? (
          <Button
            size="sm"
            id="freeEnd"
            onClick={() => {
              store.endFree(sel);
            }}
          >
            Back to {plan.days[slot].name}
          </Button>
        ) : (
          <>
            <select id="sessionSel" className="ghost" aria-label="Workout for this day" value={slot} onChange={(ev) => switchTo(+ev.target.value)}>
              {plan.days.map((x, i) => (
                <option key={i} value={i}>{`${x.name} (${DOW[i]}${i === own ? ", usual" : ""})`}</option>
              ))}
            </select>
            <Button
              size="sm"
              id="freeStart"
              onClick={() => {
                store.startFree(sel);
                focusNext("#freeName");
              }}
            >
              Empty workout
            </Button>
            {items.length && !skipped && !done && !store.worked(sel) ? (
              <Button size="sm" id="skipDay" onClick={() => store.skipDay(sel)}>
                Skip day
              </Button>
            ) : null}
          </>
        )}
      </div>
      {skipped ? (
        <label className="field" htmlFor="skipReason">
          <span>Why it was skipped (optional)</span>
          <SyncedInput id="skipReason" value={e.skip ?? ""} placeholder="e.g. travelling, knee sore…" autoComplete="off" onChange={(ev) => store.skipDay(sel, ev.target.value)} />
        </label>
      ) : null}
      {!free && slot !== own ? <p className="note moved">Usually {plan.days[own].name} · changed for this day</p> : null}
    </section>
  );
}

/** The session's lifts, a row per block (a superset is one row), and its cardio. Tapping a row opens the workout
 *  there; its handle drags it up or down the day's order (or, focused, arrow keys move it). */
function LiftRows({ sel, onOpen, focusNext, cardio, cardioDone }: { sel: DayKey; onOpen: (at: number) => void; focusNext: FocusNext; cardio: { name: string; detail: string } | null; cardioDone: boolean }) {
  const store = useGym();
  const e = store.entry(sel), blocks = store.liftBlocks(sel);
  const [drag, setDrag] = useState<{ b: number; dy: number; h: number } | null>(null);
  const [about, setAbout] = useState<SheetLift | null>(null);
  const start = useRef(0);
  const shift = drag ? Math.max(-drag.b, Math.min(blocks.length - 1 - drag.b, Math.round(drag.dy / drag.h))) : 0;
  const moveTo = (b: number, by: number) => {
    const dir = by < 0 ? -1 : 1;
    for (let n = 0; n < Math.abs(by); n++) store.moveBlock(sel, b + n * dir, dir);
  };
  const down = (ev: PointerEvent<HTMLButtonElement>, b: number) => {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    start.current = ev.clientY;
    setDrag({ b, dy: 0, h: (ev.currentTarget.closest("li") as HTMLElement).getBoundingClientRect().height });
  };
  const move = (ev: PointerEvent<HTMLButtonElement>) => {
    if (drag) setDrag({ ...drag, dy: ev.clientY - start.current });
  };
  const up = () => {
    if (drag && shift) moveTo(drag.b, shift);
    setDrag(null);
  };
  const key = (ev: KeyboardEvent<HTMLButtonElement>, b: number) => {
    const dir = ev.key === "ArrowUp" ? -1 : ev.key === "ArrowDown" ? 1 : 0;
    if (!dir || b + dir < 0 || b + dir >= blocks.length) return;
    ev.preventDefault();
    store.moveBlock(sel, b, dir as -1 | 1);
    focusNext(`[data-drag="${b + dir}"]`);
  };
  return (
    <>
      <ul className="lrows" id="liftRows">
        {blocks.map((b, bi) => {
          const it = b[0], r = e.exercises[it.name];
          const names = b.map((x) => performed(x.name, e.exercises[x.name]));
          const allDone = b.every((x) => e.exercises[x.name]?.done), skipped = b.every((x) => e.exercises[x.name]?.skipped);
          const offset = drag ? (bi === drag.b ? drag.dy : bi > drag.b && bi <= drag.b + shift ? -drag.h : bi < drag.b && bi >= drag.b + shift ? drag.h : 0) : 0;
          return (
            <li key={names.join("|") + bi} className={cx("lrow", allDone && "done", skipped && "skipped", drag?.b === bi && "dragging")} style={offset ? { transform: `translateY(${offset}px)` } : undefined}>
              {/* The photo: everything about the lift, pulled up from the bottom (ExerciseSheet). The rest of the row
                  opens the workout there. */}
              <button
                type="button"
                className="lrow-pic"
                data-about={bi}
                aria-label={`About ${names[0]}: photos, muscles and how to do it`}
                onClick={() => setAbout({ name: names[0], line: liftLine(store, sel, it), mediaId: store.mediaIdOf(names[0], r?.swap ? null : it.x), ex: store.exerciseOf(names[0], r?.swap ? null : it.x) })}
              >
                {allDone ? (
                  <span className={cx("ico-tile", tintOf(store, it.name, it.x))} aria-hidden="true">
                    <Check size={20} strokeWidth={3} />
                  </span>
                ) : (
                  <ExerciseThumb
                    id={store.mediaIdOf(names[0], r?.swap ? null : it.x)}
                    fallback={
                      <span className={cx("ico-tile", tintOf(store, it.name, it.x))} aria-hidden="true">
                        <Dumbbell size={20} />
                      </span>
                    }
                  />
                )}
              </button>
              <button type="button" className="lrow-main" data-lift={bi} onClick={() => onOpen(bi)}>
                <span className="row-t">
                  <span className="row-tt lift-t">{b.length > 1 ? names.join(" + ") : names[0]}</span>
                  <span className="row-d">{b.length > 1 ? `Superset · ${b.map((x) => liftLine(store, sel, x).split(" · ")[0]).join(", ")}` : liftLine(store, sel, it)}</span>
                </span>
                <span className="sr-only">{allDone ? ", done" : skipped ? ", skipped" : r && store.worked(sel) ? "" : ""}</span>
              </button>
              {blocks.length > 1 ? (
                <button
                  type="button"
                  className="drag"
                  data-drag={bi}
                  aria-label={`Move ${names.join(" and ")}: drag, or use the arrow keys`}
                  onPointerDown={(ev) => down(ev, bi)}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(ev) => key(ev, bi)}
                >
                  <GripVertical size={18} aria-hidden="true" />
                </button>
              ) : null}
            </li>
          );
        })}
        {cardio ? (
          <li className={cx("lrow", cardioDone && "done")}>
            <button type="button" className="lrow-main" data-lift={blocks.length} id="cardioRow" onClick={() => onOpen(blocks.length)}>
              <span className="ico-tile t-steps" aria-hidden="true">
                {cardioDone ? <Check size={20} strokeWidth={3} /> : <Bike size={20} />}
              </span>
              <span className="row-t">
                <span className="row-tt">{cardio.name}</span>
                <span className="row-d">{["Cardio", cardio.detail].filter(Boolean).join(" · ")}</span>
              </span>
            </button>
          </li>
        ) : null}
      </ul>
      <ExerciseSheet lift={about} onClose={() => setAbout(null)} />
    </>
  );
}

/* ---------- the day's log ---------- */

function DayLog({ sel, warmOpen, onToggleWarm }: { sel: DayKey; warmOpen: boolean; onToggleWarm: () => void }) {
  const store = useGym();
  const plan = store.plan, p = store.planFor(sel), e = store.entry(sel);
  const wus = plan.warmups.concat(e.warmup.filter((w) => !plan.warmups.includes(w)));
  const knee = store.kneeDay(sel), yest = addDays(sel, -1);
  const wake = store.kneeDay(yest) && (store.worked(yest) || store.entry(yest).kneeAfter != null);
  const editDay = (fn: (n: DayLog) => void, immediate: boolean) => store.editDay(sel, fn, immediate);
  const score = (f: KneeField, v: number) =>
    editDay((n) => {
      if (n[f] === v) delete n[f];
      else n[f] = v;
    }, true);
  const tickWarmUp = (w: string, on: boolean) =>
    editDay((n) => {
      n.warmup = n.warmup.filter((x) => x !== w);
      if (on) n.warmup.push(w);
      n.warmup.sort((a, b) => wus.indexOf(a) - wus.indexOf(b));
    }, true);
  const setNumber = (f: NumField, value: string) =>
    editDay((n) => {
      const v = num(value);
      if (v == null || v < 0) delete n[f];
      else n[f] = Math.round(v * 10) / 10;
      if (f === "cardioMin" && v != null && v > 0) n.cardio = true;
    }, false);
  const setMeasure = (f: MeasureField, value: string) =>
    editDay((n) => {
      if (value === "") delete n[f];
      else n[f] = Math.round((num(value) as number) * 10) / 10;
    }, false);
  const afterMsg = e.kneeAfter != null && e.kneeAfter > plan.kneeLimit ? "Above your limit: knee lifts will hold their weight next time." : "";
  const wakeMsg = e.kneeWake == null ? "" : store.kneeBad(yest) ? "Not settled since yesterday: knee lifts will hold their weight next time." : "Settled since yesterday.";
  return (
    <>
      <h2 className="group-h day-h" id="dayLogH">
        Day log
      </h2>
      {wus.length && (p.exercises.length || e.warmup.length) ? <WarmUp all={wus} done={e.warmup} open={warmOpen} onToggle={onToggleWarm} onTick={tickWarmUp} /> : null}
      {knee || wake ? (
        <section className="card" id="kneeCard" aria-label="Knee">
          {wake ? (
            <>
              <PainScale name="kneeWake" value={e.kneeWake} limit={plan.kneeLimit} title="Knee on waking" aside={`after ${store.planFor(yest).name}`} label="Knee pain on waking, from 0 to 10" onPick={(v) => score("kneeWake", v)} />
              {wakeMsg ? <p className="note">{wakeMsg}</p> : null}
            </>
          ) : null}
          {knee ? (
            <>
              <PainScale name="kneeBefore" value={e.kneeBefore} limit={plan.kneeLimit} title="Knee before" aside={`limit ${plan.kneeLimit}`} label="Knee pain before the session, from 0 to 10" onPick={(v) => score("kneeBefore", v)} />
              <PainScale name="kneeAfter" value={e.kneeAfter} limit={plan.kneeLimit} title="Knee after" aside={e.kneeBefore != null ? `before: ${e.kneeBefore}` : undefined} label="Knee pain after the session, from 0 to 10" onPick={(v) => score("kneeAfter", v)} />
              {afterMsg ? <p className="note">{afterMsg}</p> : null}
            </>
          ) : null}
        </section>
      ) : null}
      <DayFields
        entry={e}
        health={store.healthOf(sel)}
        stepGoal={plan.stepGoal}
        onSteps={(v) =>
          editDay((n) => {
            n.steps = v === "" ? null : Math.max(0, Math.round(+v));
          }, false)
        }
        onWeight={(v) =>
          editDay((n) => {
            n.weight = v === "" ? null : Math.round(+v * 10) / 10;
          }, false)
        }
        onNumber={setNumber}
        onNote={(v) =>
          editDay((n) => {
            n.note = v;
          }, false)
        }
      />
      <Measurements entry={e} onMeasure={setMeasure} />
      {plan.tempo ? (
        <p className="note" id="tempoNote">
          Tempo on every lift: {plan.tempo} (seconds down, pause, up, pause).
        </p>
      ) : null}
    </>
  );
}
