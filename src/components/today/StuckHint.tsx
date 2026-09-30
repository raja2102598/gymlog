"use client";
import { useGym } from "@/hooks/useGym";
import type { FocusNext } from "@/hooks/useFocusNext";
import type { LiftModel } from "@/lib/lift";
import { stuckWords } from "@/lib/plateau";
import type { LiftMenu } from "./types";

/** A stuck lift's hint (lib/plateau.ts), where the next-weight hint goes: what to try, then Swap, which opens the ···
 *  menu's swap (its suggestions and Library… start with lifts for the same muscles), and Not now, which puts it off on
 *  this phone until the lift beats its best. Calm, like the insight notes: nothing is wrong, it's a suggestion. */
export function StuckHint({ m, setMenu, focusNext }: { m: LiftModel; setMenu: (m: LiftMenu | null) => void; focusNext: FocusNext }) {
  const store = useGym();
  const s = m.stuck;
  if (!s) return null;
  return (
    <div className="prog callout stuck" data-rule="stuck">
      <span>{stuckWords(s)}</span>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-sm btn-raised"
          data-stuckswap={m.i}
          aria-label={`Swap ${m.did} for a variation`}
          onClick={() => {
            setMenu({ day: m.day, name: m.name, mode: "swap" });
            focusNext(`#swap${m.i}`);
          }}
        >
          Swap
        </button>
        <button type="button" className="btn btn-sm btn-quiet" data-notnow={m.i} aria-label={`Not now: hide this until ${m.did} makes progress`} onClick={() => store.putOffStuck(m.name, s.best)}>
          Not now
        </button>
      </div>
    </div>
  );
}
