"use client";
import { Check, ChevronRight, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ds/parts";
import { CardioFinisher } from "@/components/today/CardioFinisher";
import { LiftItem, logSet, nextSet, type Moves } from "@/components/today/LiftItem";
import { nextInRounds, SupersetItem, supersetModels } from "@/components/today/SupersetItem";
import type { LiftMenu } from "@/components/today/types";
import type { FocusNext } from "@/hooks/useFocusNext";
import { useGym } from "@/hooks/useGym";
import { cx } from "@/lib/cx";
import { wdIndex } from "@/lib/dates";
import { mmss, num } from "@/lib/format";
import { performed, restSecFor } from "@/lib/store";
import type { DayKey, NumField } from "@/lib/types";
import { clock, restartRun, runOf, runSeconds } from "@/lib/workout";

interface Props {
  day: DayKey;
  /** The block to open on: one tapped in Train, else the first not yet done. */
  startAt: number | null;
  /** Hears the exercise the workout moves to, so coming back to it (from a lift's chart, say) opens there again. */
  onStep: (at: number) => void;
  onClose: () => void;
  onFinish: () => void;
  onOpenLift: (name: string) => void;
  menu: LiftMenu | null;
  setMenu: (m: LiftMenu | null) => void;
  focusNext: FocusNext;
}

/** The active workout (Active workout board): one exercise at a time. A top bar (close, the session and time
 *  elapsed, Finish), a segment per exercise, the current exercise's card with its set table, the rest timer, and
 *  Complete set N pinned at the bottom with the next exercise under it. The day's cardio is the last step. */
export function WorkoutView({ day, startAt, onStep, onClose, onFinish, onOpenLift, menu, setMenu, focusNext }: Props) {
  const store = useGym();
  const p = store.planFor(day), e = store.entry(day), free = e.free ?? null;
  const blocks = store.liftBlocks(day);
  const cardio = p.cardio.name && !free ? p.cardio : null;
  const steps = blocks.length + (cardio ? 1 : 0);
  const blockDone = (b: number) => blocks[b]?.every((it) => e.exercises[it.name]?.done || e.exercises[it.name]?.skipped);
  const firstOpen = () => {
    for (let b = 0; b < blocks.length; b++) if (!blockDone(b)) return b;
    return cardio && !e.cardio ? blocks.length : 0;
  };
  const [at, setAt] = useState(() => (startAt != null && startAt < steps ? startAt : firstOpen()));
  const idx = Math.min(at, Math.max(0, steps - 1));
  const go = (n: number) => {
    setMenu(null);
    setAt(n);
    onStep(n);
    window.scrollTo(0, 0);
  };
  const name = free ? free.name.trim() || "Free workout" : p.name;

  // Positions in the day's flat list, which the lifts' element ids use.
  let n0 = 0;
  const indexed = blocks.map((b) => b.map((item) => ({ item, i: n0++ })));
  // Moving a block: the workout follows it, and focus follows the lift whose menu moved it (as Train's order did).
  const move = (b: number, dir: -1 | 1, i: number) => {
    const to = b + dir, at = i + dir * blocks[to].length, edge = dir < 0 ? to === 0 : to === blocks.length - 1;
    store.moveBlock(day, b, dir);
    setAt(to);
    onStep(to);
    focusNext(`[data-lmove="${at}:${edge ? -dir : dir}"]`);
  };
  const moves = (b: number, superset?: string): Moves => ({
    up: b > 0 ? (i) => move(b, -1, i) : null,
    down: b < blocks.length - 1 ? (i) => move(b, 1, i) : null,
    superset,
  });
  const marks = store.recordsOn(day);
  const letterOf = (b: number) => String.fromCharCode(65 + blocks.slice(0, b).filter((x) => x.length > 1).length);

  // The big button: the current step's next set, or on to the next step.
  let primary: { label: string; act: () => void; icon: "check" | "next" };
  const nextName = idx + 1 < blocks.length ? blocks[idx + 1].map((it) => performed(it.name, e.exercises[it.name])).join(" + ") : idx + 1 === blocks.length && cardio ? cardio.name : null;
  const onward = () => (idx + 1 < steps ? go(idx + 1) : onFinish());
  const onwardLabel = idx + 1 < steps ? "Next exercise" : "Finish workout";
  if (idx < blocks.length) {
    const b = indexed[idx];
    if (b.length > 1) {
      const ms = supersetModels(store, day, b, e), nx = nextInRounds(ms);
      primary = nx
        ? { label: `Complete ${letterOf(idx)}${nx[0] + 1} · set ${nx[1] + 1}`, icon: "check", act: () => logSet(store, ms[nx[0]], nx[1]) }
        : { label: onwardLabel, icon: "next", act: onward };
    } else {
      const m = supersetModels(store, day, b, e)[0];
      const j = m.r.skipped ? -1 : nextSet(m);
      primary = j >= 0 ? { label: `Complete set ${j + 1}`, icon: "check", act: () => logSet(store, m, j) } : { label: onwardLabel, icon: "next", act: onward };
    }
  } else {
    primary = e.cardio
      ? { label: "Finish workout", icon: "next", act: onFinish }
      : {
          label: `Done with ${cardio!.name.toLowerCase()}`,
          icon: "check",
          act: () =>
            store.editDay(
              day,
              (n) => {
                n.cardio = true;
              },
              true,
            ),
        };
  }

  return (
    <div className="workout">
      <TopBar name={name} day={day} onClose={onClose} onFinish={onFinish} />
      {steps ? (
        <ol className="wprog" aria-label={`Exercise ${idx + 1} of ${steps}`}>
          {Array.from({ length: steps }, (_, s) => {
            const done = s < blocks.length ? blockDone(s) : !!e.cardio;
            return (
              <li key={s} className={cx(done ? "done" : s === idx ? "now" : "")}>
                <button type="button" aria-label={`Go to exercise ${s + 1}${done ? ", done" : ""}`} aria-current={s === idx ? "step" : undefined} onClick={() => go(s)} />
              </li>
            );
          })}
        </ol>
      ) : null}
      <div className="screen wbody">
        {!steps ? (
          <section className="card">
            <h2 className="title-sm">No lifts yet</h2>
            <p className="sub">Add exercises in Train, then start again.</p>
          </section>
        ) : idx < blocks.length ? (
          indexed[idx].length > 1 ? (
            <SupersetItem
              key={`ss${idx}`}
              lifts={indexed[idx]}
              letter={letterOf(idx)}
              sel={day}
              entry={e}
              marks={marks}
              menu={menu}
              setMenu={setMenu}
              focusNext={focusNext}
              onOpenLift={onOpenLift}
              moves={moves(idx, letterOf(idx))}
              step={`Exercise ${idx + 1} of ${steps}`}
            />
          ) : (
            <LiftItem
              key={`${indexed[idx][0].i}|${indexed[idx][0].item.name}`}
              item={indexed[idx][0].item}
              i={indexed[idx][0].i}
              sel={day}
              entry={e}
              marks={marks}
              menu={menu && menu.day === day && menu.name === indexed[idx][0].item.name ? menu.mode : null}
              setMenu={setMenu}
              focusNext={focusNext}
              onOpenLift={onOpenLift}
              moves={moves(idx)}
              onRemove={free?.lifts.includes(indexed[idx][0].item.name) ? () => store.removeFreeLift(day, indexed[idx][0].item.name) : undefined}
              step={`Exercise ${idx + 1} of ${steps}`}
            />
          )
        ) : (
          <CardioFinisher
            cardio={cardio!}
            entry={e}
            step={`Exercise ${idx + 1} of ${steps}`}
            onDone={(on) =>
              store.editDay(
                day,
                (n) => {
                  n.cardio = on;
                },
                true,
              )
            }
            onNumber={(f: NumField, value: string) =>
              store.editDay(
                day,
                (n) => {
                  const v = num(value);
                  if (v == null || v < 0) delete n[f];
                  else n[f] = Math.round(v * 10) / 10;
                  if (f === "cardioMin" && v != null && v > 0) n.cardio = true;
                },
                false,
              )
            }
          />
        )}
        <RestCard />
      </div>
      {steps ? (
        <div className="wfoot">
          <Button variant="primary" block id="completeSet" onClick={primary.act}>
            {primary.icon === "check" ? <Check size={20} strokeWidth={3} aria-hidden="true" /> : null}
            {primary.label}
          </Button>
          {nextName ? (
            <button type="button" className="btn btn-quiet btn-block" id="nextEx" onClick={() => go(idx + 1)}>
              <span className="nx">Next: {nextName}</span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Close (the workout keeps running), the session and time elapsed, and Finish. */
function TopBar({ name, day, onClose, onFinish }: { name: string; day: DayKey; onClose: () => void; onFinish: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const run = runOf(day);
  return (
    <header className="wtop">
      <a
        className="btn btn-icon btn-raised"
        id="closeWorkout"
        href="#train"
        aria-label="Pause and close workout"
        onClick={(ev) => {
          ev.preventDefault();
          onClose();
        }}
      >
        <X size={18} aria-hidden="true" />
      </a>
      <div className="wtop-t">
        <h1 id="screenTitle">{name}</h1>
        {run ? (
          <button
            type="button"
            className="wclock"
            id="wclock"
            aria-label={`${Math.floor(runSeconds(run) / 60)} minutes in. Restart the clock`}
            onClick={() => {
              if (!confirm("Restart the workout clock from 0:00?")) return;
              restartRun(day);
              tick((n) => n + 1);
            }}
          >
            {clock(runSeconds(run))}
            <RotateCcw size={14} strokeWidth={2.5} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <button type="button" className="btn btn-raised" id="finishBtn" onClick={onFinish}>
        Finish
      </button>
    </header>
  );
}

/** The rest timer (Active workout board): a ring counting down, "Resting / of 1:30", +15s and Skip. The ring pauses
 *  and resumes. Only while a rest is running. */
function RestCard() {
  const store = useGym();
  const r = store.rest;
  const paused = r?.pausedAt != null, ended = r?.ended ?? false, running = !!r && !paused && !ended;
  const [, retick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => retick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  if (!r) return null;
  const left = store.restRemaining();
  const len = r.sec ?? restLength(r.lift, r.day, store);
  const pct = ended ? 0 : Math.min(100, (left / Math.max(len, left, 1)) * 100);
  return (
    <section className={cx("card restcard", ended && "over")} id="restCard" role="group" aria-label="Rest timer">
      <button type="button" className="rest-ring" id="restPause" aria-label={paused ? "Resume rest" : "Pause rest"} disabled={ended} onClick={() => (paused ? store.resumeRest() : store.pauseRest())}>
        <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden="true">
          <circle cx="30" cy="30" r="25" className="rest-track" />
          {pct > 0 ? <circle cx="30" cy="30" r="25" className="rest-arc" pathLength={100} strokeDasharray={`${pct.toFixed(1)} 100`} transform="rotate(-90 30 30)" /> : null}
        </svg>
        <span className="rest-time" aria-hidden="true">
          {ended ? <Check size={20} strokeWidth={3} /> : paused ? <Play size={16} fill="currentColor" /> : mmss(left)}
        </span>
      </button>
      <div className="rest-t">
        <div className="rest-h">{ended ? "Rest over" : paused ? "Paused" : "Resting"}</div>
        <div className="sub">{ended ? "On to the next set" : paused ? `${mmss(left)} left` : `of ${mmss(len)}`}</div>
      </div>
      <span className="sr-only" role="status">
        {ended ? "Rest over." : ""}
      </span>
      <button type="button" className="btn rest-b" id="restAdd" onClick={() => store.addRestTime(15)}>
        +15s
      </button>
      <button type="button" className="btn rest-b" id="restSkip" onClick={() => store.skipRest()}>
        Skip
      </button>
    </section>
  );
}

/** The rest's full length, for a timer saved without it: the lift's own rest on the timer's day, or the plan's. */
function restLength(lift: string, day: DayKey, store: ReturnType<typeof useGym>) {
  const x = store.plan.days[wdIndex(day)]?.exercises.find((e) => e.name === lift);
  return x ? restSecFor(store.plan, x) : store.plan.restSec;
}
