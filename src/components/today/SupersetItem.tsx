"use client";
import { useState } from "react";
import { ask } from "@/components/ds/Ask";
import { useGym } from "@/hooks/useGym";
import type { FocusNext } from "@/hooks/useFocusNext";
import { useVoice, useVoiceOn } from "@/hooks/useVoice";
import { cx } from "@/lib/cx";
import { setsSummary } from "@/lib/format";
import { isWorkingSet, type RecordKind } from "@/lib/stats";
import { minSets, restSecFor, setsOf, targetOf, type GymStore, type LiftItem as Item } from "@/lib/store";
import type { DayKey, DayLog } from "@/lib/types";
import { LiftHead, liftModel, ProgHint, SetHead, SetRow, voiceHandler, type LiftModel, type Moves } from "./LiftItem";
import type { LiftMenu } from "./types";
import { WarmupCalc } from "./WarmupCalc";

interface Props {
  /** The superset's lifts in order, each with its position in the day's list (the element ids use it). */
  lifts: { item: Item; i: number }[];
  /** A, B, …: the day's supersets in order. */
  letter: string;
  sel: DayKey;
  entry: DayLog;
  /** Records set on this day, as "exercise|set index" -> kinds. */
  marks: Map<string, RecordKind[]>;
  menu: LiftMenu | null;
  setMenu: (m: LiftMenu | null) => void;
  focusNext: FocusNext;
  /** Opens a lift's own page, under Progress. */
  onOpenLift: (name: string) => void;
  moves: Moves;
}

/** A superset's lifts as models, with the rest timer starting once a round is complete rather than after each set,
 *  for the longest rest any of its lifts has. Shared by the card and the workout's Complete button. */
export function supersetModels(store: GymStore, sel: DayKey, lifts: { item: Item; i: number }[], entry: DayLog): LiftModel[] {
  // Each lift as saved now, not as of this render: voice changes a set after it.
  const now = () =>
    lifts.map(({ item }) => {
      const r = store.entry(sel).exercises[item.name];
      const sets = setsOf(r).filter(isWorkingSet), min = item.extra ? 1 : minSets(targetOf(r, item.x));
      return { sets, rows: r?.skipped ? 0 : Math.max(min, sets.length), rest: r?.skipped ? 0 : restSecFor(store.plan, item.x) };
    });
  const onReps = (m: LiftModel, j: number) => {
    const all = now();
    const complete = all.every((l) => j >= l.rows || l.sets[j]?.reps != null);
    const later = all.some((l) => l.sets.slice(j + 1).some((s) => s.reps != null));
    if (complete && !later) store.startRest(sel, m.did, Math.max(...all.map((l) => l.rest)));
  };
  return lifts.map(({ item, i }) => liftModel(store, sel, item, i, entry, onReps));
}

/** The next set to do in a superset, round by round: [lift, set], or null once every round is logged. */
export function nextInRounds(ms: LiftModel[]): [number, number] | null {
  const rounds = Math.max(0, ...ms.map((m) => (m.r.skipped ? 0 : m.rows)));
  for (let j = 0; j < rounds; j++)
    for (let n = 0; n < ms.length; n++) if (!ms[n].r.skipped && j < ms[n].rows && !((ms[n].sets[j]?.reps ?? 0) > 0)) return [n, j];
  return null;
}

/** One of a superset's lifts: its name, tick, microphone and menu, its hint and warm-up sets. Its sets are the
 *  superset's rounds. */
function SupersetLift({ m, tag, sel, menu, setMenu, focusNext, onOpenLift, moves }: Omit<Props, "lifts" | "letter" | "entry" | "marks" | "menu"> & { m: LiftModel; tag: string; menu: LiftMenu["mode"] | null }) {
  const store = useGym();
  const r = m.r;
  const voiceOn = useVoiceOn();
  const voice = useVoice(voiceOn && !r.skipped, voiceHandler(store, sel, m, focusNext));
  return (
    <div className={cx("ss-lift", r.done && "checked", r.skipped && "skipped", r.swap && "swapped")}>
      <LiftHead m={m} sel={sel} tag={tag} menu={menu} setMenu={setMenu} focusNext={focusNext} onOpenLift={onOpenLift} voice={{ on: voiceOn && !r.skipped, ...voice }} moves={moves} />
      {r.skipped ? (
        <div className="skipnote">Skipped{r.reason ? ` · ${r.reason}` : ""}</div>
      ) : (
        <>
          <ProgHint next={m.next} />
          <WarmupCalc id={`wset${m.i}`} barKg={m.bar ?? 0} inc={m.inc} defaultKg={m.defaultWorkingKg} warmSets={m.warmSets} onLog={m.logWarmups} onRemove={m.removeWarmups} />
        </>
      )}
      {voiceOn ? (
        <p className="said" aria-live="polite">
          {voice.line}
        </p>
      ) : null}
    </div>
  );
}

/** A superset: its lifts in one card, then their sets in rounds, A1's set 1 and A2's set 1, then round 2, and so on.
 *  The rest timer starts once a round is complete rather than after each set, for the longest rest any of its lifts
 *  has. A skipped lift drops out of the rounds; a lift with more sets than the others fills the last rounds alone. */
export function SupersetItem({ lifts, letter, sel, entry, marks, menu, setMenu, focusNext, onOpenLift, moves, step }: Props & { step?: string }) {
  const store = useGym();
  const [menuAt, setMenuAt] = useState("");

  const ms = supersetModels(store, sel, lifts, entry);
  const tags = ms.map((_, n) => `${letter}${n + 1}`), first = ms[0].i;
  const rounds = Math.max(0, ...ms.map((m) => (m.r.skipped ? 0 : m.rows)));
  const nxt = nextInRounds(ms);
  // − Round takes the last round's sets that are more than their lift's planned number.
  const extra = ms.filter((m) => !m.r.skipped && m.sets.length === rounds && rounds > m.min);
  const dropRound = async () => {
    const said = extra.map((m) => [tags[ms.indexOf(m)], setsSummary([m.sets[rounds - 1]])]).filter(([, s]) => s);
    if (said.length && !(await ask(`Remove round ${rounds} (${said.map(([t, s]) => `${t} ${s}`).join(", ")})?`, "Remove", { danger: true }))) return;
    // Only the round asked about: not one voice added to while the question was up.
    if (extra.every((m) => m.sameSets())) for (const m of extra) m.dropSet();
  };

  return (
    <section className="card ex-card lift superset" data-superset={letter} aria-label={`Superset ${letter}`}>
      {step ? <div className="ex-step">{step}</div> : null}
      <div className="ss-h">
        <b>Superset {letter}</b> · {ms.length} lifts in rounds
      </div>
      {ms.map((m, n) => (
        <SupersetLift
          key={m.name}
          m={m}
          tag={tags[n]}
          sel={sel}
          menu={menu && menu.day === sel && menu.name === m.name ? menu.mode : null}
          setMenu={setMenu}
          focusNext={focusNext}
          onOpenLift={onOpenLift}
          moves={moves}
        />
      ))}
      {rounds ? (
        <div className="sets rounds" role="group" aria-label={`Superset ${letter}, rounds`}>
          <SetHead tag />
          {Array.from({ length: rounds }, (_, j) => (
            <div key={j} className="round" role="group" aria-labelledby={`rd${first}_${j}`}>
              <div className="round-h" id={`rd${first}_${j}`}>
                Round {j + 1}
              </div>
              {ms.map((m, n) => {
                if (m.r.skipped || j >= m.rows) return null;
                const at = `${m.i}:${j}`;
                return (
                  <SetRow
                    key={m.i}
                    m={m}
                    j={j}
                    marks={marks}
                    tag={tags[n]}
                    active={!!nxt && nxt[0] === n && nxt[1] === j}
                    menuOpen={menuAt === at}
                    onMenu={() => setMenuAt(menuAt === at ? "" : at)}
                  />
                );
              })}
            </div>
          ))}
          <div className="setbtns">
            <button className="btn btn-sm" data-addround={first} onClick={() => ms.forEach((m) => !m.r.skipped && m.addSet(rounds + 1))}>
              + Round
            </button>
            {extra.length ? (
              <button className="btn btn-sm" data-rmround={first} onClick={dropRound}>
                − Round
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
