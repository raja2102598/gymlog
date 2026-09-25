"use client";
import { Fragment } from "react";
import { useGym } from "@/hooks/useGym";
import type { FocusNext } from "@/hooks/useFocusNext";
import { cx } from "@/lib/cx";
import { addDays, DOW, dm, todayKey, wdIndex } from "@/lib/dates";
import { num } from "@/lib/format";
import type { DayKey, DayLog, KneeField, MeasureField, NumField, PlanDay } from "@/lib/types";
import { CardioFinisher } from "./CardioFinisher";
import { DayFields } from "./DayFields";
import { HealthToday } from "./HealthToday";
import { KneeScale } from "./KneeScale";
import { LiftItem, type Moves } from "./LiftItem";
import { Measurements } from "./Measurements";
import { SupersetItem } from "./SupersetItem";
import type { LiftMenu } from "./types";
import { WarmUp } from "./WarmUp";

export interface SessionProps {
  sel: DayKey;
  menu: LiftMenu | null;
  setMenu: (m: LiftMenu | null) => void;
  warmOpen: boolean;
  onToggleWarm: () => void;
  /** Knee scores reopened with "Change" on this day. */
  kneeOpen: KneeField[];
  onKneeChange: (f: KneeField) => void;
  onKneeScored: (f: KneeField) => void;
  focusNext: FocusNext;
  /** Opens the Health tab at this day. */
  onOpenHealth: () => void;
  /** Opens a lift's own page, under Progress. */
  onOpenLift: (name: string) => void;
}

function LiftPill({ p, e }: { p: PlanDay; e: DayLog }) {
  if (!p.exercises.length) return <span className="pill">Rest day</span>;
  const done = p.exercises.filter((x) => e.exercises[x.name]?.done).length;
  const skipped = p.exercises.filter((x) => e.exercises[x.name]?.skipped).length;
  return (
    <span className={cx("pill", done === p.exercises.length ? "good" : done > 0 && "part")}>
      {done}/{p.exercises.length} lifts{skipped ? ` · ${skipped} skipped` : ""}
    </span>
  );
}

/** The selected day: its workout (which can be switched for another weekday's), knee scores, warm-up,
 *  lifts, cardio finisher, steps, weight, note and other measurements. Keyed by the day, so a new day starts fresh. */
export function SessionCard({ sel, menu, setMenu, warmOpen, onToggleWarm, kneeOpen, onKneeChange, onKneeScored, focusNext, onOpenHealth, onOpenLift }: SessionProps) {
  const store = useGym();
  const plan = store.plan, p = store.planFor(sel), e = store.entry(sel);
  // The day's lifts in cards, in the order done: a superset is one card. Each lift keeps its position in the day's
  // list, which its element ids use.
  let n = 0;
  const blocks = store.liftBlocks(sel).map((b) => b.map((item) => ({ item, i: n++ })));
  const items = blocks.flat().map((l) => l.item);
  const wus = plan.warmups.concat(e.warmup.filter((w) => !plan.warmups.includes(w)));
  const slot = store.slotFor(sel), own = wdIndex(sel), t = todayKey();
  const missed = !p.exercises.length && sel >= t ? store.missedThisWeek(sel) : [];
  const marks = store.recordsOn(sel), kneeHere = store.kneeDay(sel), yest = addDays(sel, -1);
  const wake = store.kneeDay(yest) && (store.worked(yest) || store.entry(yest).kneeAfter != null);
  const wakeMsg = e.kneeWake == null ? "" : store.kneeBad(yest) ? "Not settled since yesterday: knee lifts will hold their weight next time." : "Settled since yesterday.";
  const afterMsg = e.kneeAfter != null && e.kneeAfter > plan.kneeLimit ? "Above your limit: knee lifts will hold their weight next time." : "";

  const editDay = (fn: (n: DayLog) => void, immediate: boolean) => store.editDay(sel, fn, immediate);
  const switchTo = (v: number) => {
    setMenu(null);
    editDay((n) => {
      if (v === own) delete n.session;
      else n.session = v;
    }, true);
  };
  const tickWarmUp = (w: string, on: boolean) =>
    editDay((n) => {
      n.warmup = n.warmup.filter((x) => x !== w);
      if (on) n.warmup.push(w);
      n.warmup.sort((a, b) => wus.indexOf(a) - wus.indexOf(b));
    }, true);
  const score = (f: KneeField, v: number) => {
    onKneeScored(f);
    editDay((n) => {
      if (n[f] === v) delete n[f];
      else n[f] = v;
    }, true);
  };
  const reopen = (f: KneeField) => {
    onKneeChange(f);
    focusNext(`button[data-knee^="${f}:"]`);
  };
  const setNumber = (f: NumField, value: string) =>
    editDay((n) => {
      const v = num(value);
      if (v == null || v < 0) delete n[f];
      else n[f] = Math.round(v * 10) / 10;
      // Entering cardio minutes ticks the finisher off.
      if (f === "cardioMin" && v != null && v > 0) n.cardio = true;
    }, false);
  // The Measurements card already refuses a value out of range, so this only rounds what it's given.
  const setMeasure = (f: MeasureField, value: string) =>
    editDay((n) => {
      if (value === "") delete n[f];
      else n[f] = Math.round((num(value) as number) * 10) / 10;
    }, false);
  // Moves card b up or down the day's order; focus follows the lift whose menu moved it, to its new position.
  const move = (b: number, dir: -1 | 1, i: number) => {
    const to = b + dir, at = i + dir * blocks[to].length, edge = dir < 0 ? to === 0 : to === blocks.length - 1;
    store.moveBlock(sel, b, dir);
    focusNext(`[data-lmove="${at}:${edge ? -dir : dir}"]`);
  };
  const movesFor = (b: number, superset?: string): Moves => ({
    up: b > 0 ? (i) => move(b, -1, i) : null,
    down: b < blocks.length - 1 ? (i) => move(b, 1, i) : null,
    superset,
  });
  let letters = 0;
  const knee = (field: KneeField, title: string, sub = "", msg = "") => (
    <KneeScale
      field={field}
      value={e[field]}
      limit={plan.kneeLimit}
      title={title}
      sub={sub}
      msg={msg}
      reopened={kneeOpen.includes(field)}
      onScore={(n) => score(field, n)}
      onChange={() => reopen(field)}
    />
  );

  return (
    <>
      <div className="sess-head">
        <div className="sess-title">
          <h2 className="display">{p.name}</h2>
          <span id="liftPill">
            <LiftPill p={p} e={e} />
          </span>
        </div>
        <div className="sub">{[p.focus, dm(sel)].filter(Boolean).join(" · ")}</div>
        {p.exercises.length ? (
          // One segment per planned lift: filled when done, hatched when skipped.
          <div className="segs" aria-hidden="true">
            {items
              .filter((it) => !it.extra)
              .map((it, n) => {
                const r = e.exercises[it.name];
                return <i key={n} className={cx(r?.done && "done", r?.skipped && "skip")} />;
              })}
          </div>
        ) : null}
        <div className="sess-pick">
          <select id="sessionSel" className="ghost tiny" aria-label="Workout for this day" value={slot} onChange={(ev) => switchTo(+ev.target.value)}>
            {plan.days.map((x, i) => (
              <option key={i} value={i}>{`${x.name} (${DOW[i]}${i === own ? ", usual" : ""})`}</option>
            ))}
          </select>
          {slot !== own ? <span className="moved">Usually {plan.days[own].name} · changed for this day</span> : null}
        </div>
      </div>
      {missed.length ? (
        <div className="catchup">
          <p>
            Missed this week:{" "}
            {missed.map((i, n) => (
              <Fragment key={i}>
                {n ? ", " : ""}
                <b>{plan.days[i].name}</b> ({DOW[i]})
              </Fragment>
            ))}
            . Do {missed.length > 1 ? "one" : "it"} {sel === t ? "today" : "on " + DOW[own]}?
          </p>
          <div className="catchup-btns">
            {missed.map((i) => (
              <button key={i} className="ghost" data-catch={i} onClick={() => switchTo(i)}>
                Do {plan.days[i].name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {wake ? knee("kneeWake", "Knee on waking", `after ${store.planFor(yest).name} yesterday`, wakeMsg) : null}
      {wus.length && (p.exercises.length || e.warmup.length) ? <WarmUp all={wus} done={e.warmup} open={warmOpen} onToggle={onToggleWarm} onTick={tickWarmUp} /> : null}
      {kneeHere ? knee("kneeBefore", "Knee pain before you start") : null}
      {blocks.length ? (
        <ul className="ex">
          {blocks.map((b, bi) => {
            if (b.length > 1) {
              const letter = String.fromCharCode(65 + letters++);
              return (
                <SupersetItem
                  key={`ss|${b.map((l) => l.item.name).join("|")}`}
                  lifts={b}
                  letter={letter}
                  sel={sel}
                  entry={e}
                  marks={marks}
                  menu={menu}
                  setMenu={setMenu}
                  focusNext={focusNext}
                  onOpenLift={onOpenLift}
                  moves={movesFor(bi, letter)}
                />
              );
            }
            const [{ item: it, i }] = b;
            return (
              <LiftItem
                key={`${i}|${it.name}`}
                item={it}
                i={i}
                sel={sel}
                entry={e}
                marks={marks}
                menu={menu && menu.day === sel && menu.name === it.name ? menu.mode : null}
                setMenu={setMenu}
                focusNext={focusNext}
                onOpenLift={onOpenLift}
                moves={movesFor(bi)}
              />
            );
          })}
        </ul>
      ) : null}
      {kneeHere ? knee("kneeAfter", "Knee pain after the session", "", afterMsg) : null}
      <CardioFinisher
        cardio={p.cardio}
        entry={e}
        onDone={(on) =>
          editDay((n) => {
            n.cardio = on;
          }, true)
        }
        onNumber={setNumber}
      />
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
      <HealthToday sel={sel} onOpenHealth={onOpenHealth} />
    </>
  );
}
