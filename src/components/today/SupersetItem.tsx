"use client";
import { CaretDown } from "@phosphor-icons/react";
import { useState } from "react";
import { useGym } from "@/hooks/useGym";
import type { FocusNext } from "@/hooks/useFocusNext";
import { useVoice, useVoiceOn } from "@/hooks/useVoice";
import { cx } from "@/lib/cx";
import { setsSummary } from "@/lib/format";
import { isWorkingSet, type RecordKind } from "@/lib/stats";
import { minSets, restSecFor, setsOf, targetOf, type LiftItem as Item } from "@/lib/store";
import type { DayKey, DayLog } from "@/lib/types";
import { LiftHead, liftModel, ProgHint, SetRow, voiceHandler, type LiftModel, type Moves } from "./LiftItem";
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
          <WarmupCalc id={`wset${m.i}`} barKg={store.plan.barKg} defaultKg={m.defaultWorkingKg} warmSets={m.warmSets} onLog={m.logWarmups} onRemove={m.removeWarmups} />
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
export function SupersetItem({ lifts, letter, sel, entry, marks, menu, setMenu, focusNext, onOpenLift, moves }: Props) {
  const store = useGym();
  const [menuAt, setMenuAt] = useState("");
  const [platesAt, setPlatesAt] = useState("");
  const [howOpen, setHowOpen] = useState<number[]>([]);

  // Each lift as saved now, not as of this render: voice changes a set after it.
  const now = () =>
    lifts.map(({ item }) => {
      const r = store.entry(sel).exercises[item.name];
      const sets = setsOf(r).filter(isWorkingSet), min = item.extra ? 1 : minSets(targetOf(r, item.x));
      return { sets, rows: r?.skipped ? 0 : Math.max(min, sets.length), rest: r?.skipped ? 0 : restSecFor(store.plan, item.x) };
    });
  // A set's first reps: a rest once they complete the round, and no later round has any yet (a correction then).
  const onReps = (m: LiftModel, j: number) => {
    const all = now();
    const complete = all.every((l) => j >= l.rows || l.sets[j]?.reps != null);
    const later = all.some((l) => l.sets.slice(j + 1).some((s) => s.reps != null));
    if (complete && !later) store.startRest(sel, m.did, Math.max(...all.map((l) => l.rest)));
  };
  const ms = lifts.map(({ item, i }) => liftModel(store, sel, item, i, entry, onReps));
  const tags = ms.map((_, n) => `${letter}${n + 1}`), first = ms[0].i;
  const rounds = Math.max(0, ...ms.map((m) => (m.r.skipped ? 0 : m.rows)));
  // − Round takes the last round's sets that are more than their lift's planned number.
  const extra = ms.filter((m) => !m.r.skipped && m.sets.length === rounds && rounds > m.min);
  const dropRound = () => {
    const said = extra.map((m) => [tags[ms.indexOf(m)], setsSummary([m.sets[rounds - 1]])]).filter(([, s]) => s);
    if (said.length && !confirm(`Remove round ${rounds} (${said.map(([t, s]) => `${t} ${s}`).join(", ")})?`)) return;
    for (const m of extra) m.dropSet();
  };

  return (
    <li className="lift superset" data-superset={letter}>
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
        <div className="sets rounds">
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
                    menuOpen={menuAt === at}
                    onMenu={() => setMenuAt(menuAt === at ? "" : at)}
                    platesOpen={platesAt === at}
                    onPlates={() => setPlatesAt(platesAt === at ? "" : at)}
                  />
                );
              })}
            </div>
          ))}
          <div className="setbtns">
            <button className="ghost tiny" data-addround={first} onClick={() => ms.forEach((m) => !m.r.skipped && m.addSet(rounds + 1))}>
              + Round
            </button>
            {extra.length ? (
              <button className="ghost tiny" data-rmround={first} onClick={dropRound}>
                − Round
              </button>
            ) : null}
            {ms.map((m, n) =>
              m.cue ? (
                <button
                  key={m.i}
                  type="button"
                  className="ghost tiny howto"
                  aria-expanded={howOpen.includes(m.i)}
                  aria-controls={`cue${m.i}`}
                  aria-label={`How to: ${tags[n]}, ${m.did}`}
                  onClick={() => setHowOpen(howOpen.includes(m.i) ? howOpen.filter((k) => k !== m.i) : [...howOpen, m.i])}
                >
                  How to: {tags[n]}
                  <CaretDown size={14} weight="bold" aria-hidden="true" />
                </button>
              ) : null,
            )}
          </div>
        </div>
      ) : null}
      {ms.map((m, n) =>
        m.cue && howOpen.includes(m.i) ? (
          <p key={m.i} className="nt cue" id={`cue${m.i}`}>
            <b>{tags[n]}</b> {m.cue}
          </p>
        ) : null,
      )}
    </li>
  );
}
