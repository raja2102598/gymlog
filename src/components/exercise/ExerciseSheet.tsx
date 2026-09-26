"use client";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Chip } from "@/components/ds/parts";
import { equipText, muscleText, type Exercise } from "@/lib/library";
import { HowTo } from "./HowTo";

/** A lift to show in full: its name as the plan has it, what the plan asks of it today, the library lift whose
 *  photos and steps show (null for one of your own), and what it works and needs (null when unknown). */
export interface SheetLift {
  name: string;
  line?: string;
  mediaId: string | null;
  ex: Exercise | null;
}

/**
 * Everything about a lift, pulled up from the bottom when its photo is tapped (Train): the photos taking turns,
 * what it works and needs, what today asks of it, its steps and videos. A superset's lifts show one at a time, the
 * first to begin with, picked by name at the top. Closes with ×, Back, Escape or a tap outside it.
 */
export function ExerciseSheet({ lifts, onClose }: { lifts: SheetLift[] | null; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [at, setAt] = useState(0);
  // Opened again (a new list of lifts): from the first.
  const [opened, setOpened] = useState(lifts);
  if (lifts !== opened) {
    setOpened(lifts);
    setAt(0);
  }
  const lift = lifts?.[at] ?? null;
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (lifts && !d.open) d.showModal();
    else if (!lifts && d.open) d.close();
  }, [lifts]);
  const close = () => dlg.current?.close();
  return (
    <dialog ref={dlg} className="xsheet" id="exSheet" aria-labelledby="exSheetT" onClose={onClose} onClick={(ev) => ev.target === ev.currentTarget && close()}>
      {lift ? (
        <div className="xsheet-in">
          <div className="xsheet-head">
            <h2 id="exSheetT">{lift.name}</h2>
            <button type="button" className="btn btn-icon" id="exSheetClose" aria-label="Close" onClick={close}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <div className="xsheet-body">
            {lifts && lifts.length > 1 ? (
              <div className="xsheet-pick" role="group" aria-label="Lifts in this superset">
                {lifts.map((l, k) => (
                  <Chip key={l.name} on={k === at} data-pick={k} onClick={() => setAt(k)}>
                    {l.name}
                  </Chip>
                ))}
              </div>
            ) : null}
            <dl className="xsheet-facts">
              {lift.line ? (
                <div>
                  <dt>Today</dt>
                  <dd>{lift.line}</dd>
                </div>
              ) : null}
              {lift.ex ? (
                <>
                  <div>
                    <dt>Works</dt>
                    <dd>{muscleText(lift.ex)}</dd>
                  </div>
                  <div>
                    <dt>Needs</dt>
                    <dd>{equipText(lift.ex)}</dd>
                  </div>
                </>
              ) : null}
            </dl>
            {lift.mediaId ? (
              <HowTo id={lift.mediaId} name={lift.name} headingId="exSheetT" />
            ) : (
              <p className="sub">No photos or steps for this one: it isn’t in the exercise library. Your own form notes are in the plan editor.</p>
            )}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
