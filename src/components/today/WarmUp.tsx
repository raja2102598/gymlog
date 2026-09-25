"use client";
import { ChevronDown } from "lucide-react";

interface Props {
  /** The plan's warm-ups, then any others ticked that day. */
  all: string[];
  done: string[];
  open: boolean;
  onToggle: () => void;
  onTick: (name: string, on: boolean) => void;
}

/** The warm-up checklist: a card that folds to one row until it's opened, each warm-up a chip to tick. */
export function WarmUp({ all, done, open, onToggle, onTick }: Props) {
  return (
    <section className="card wu">
      <button type="button" className="wu-toggle" id="wuToggle" aria-expanded={open} aria-controls="wuChips" onClick={onToggle}>
        <span className="row-t">
          <span className="row-tt">Warm-up</span>
          <span className="row-d">
            {done.length} of {all.length} done
          </span>
        </span>
        <ChevronDown className="chev" size={18} aria-hidden="true" />
      </button>
      <div className="chips" id="wuChips" hidden={!open}>
        {all.map((w, i) => (
          <label key={`${i}|${w}`} className="chip" htmlFor={`wu${i}`}>
            <input type="checkbox" id={`wu${i}`} data-w={w} checked={done.includes(w)} onChange={(ev) => onTick(w, ev.target.checked)} />
            <span>{w}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
