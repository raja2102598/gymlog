"use client";

interface Props {
  /** The plan's warm-ups, then any others ticked that day. */
  all: string[];
  done: string[];
  open: boolean;
  onToggle: () => void;
  onTick: (name: string, on: boolean) => void;
}

/** The warm-up checklist, folded to one line until it's opened. */
export function WarmUp({ all, done, open, onToggle, onTick }: Props) {
  return (
    <div className="wu">
      <button type="button" className="wu-toggle" id="wuToggle" aria-expanded={open} aria-controls="wuChips" onClick={onToggle}>
        <b>Warm-up</b> <span className="sub">{done.length} of {all.length} done</span> <span className="wu-act">{open ? "Hide" : "Show"}</span>
      </button>
      <div className="chips" id="wuChips" hidden={!open}>
        {all.map((w, i) => (
          <label key={`${i}|${w}`} className="chip" htmlFor={`wu${i}`}>
            <input type="checkbox" id={`wu${i}`} data-w={w} checked={done.includes(w)} onChange={(ev) => onTick(w, ev.target.checked)} />
            <span>{w}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
