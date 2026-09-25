"use client";
import { ArrowLeft, Pause, Play, SkipForward } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ViewLink } from "@/components/ui/ViewLink";
import { useBarsHeight } from "@/hooks/useBarsHeight";
import { useGym } from "@/hooks/useGym";
import { mmss } from "@/lib/format";

interface Props {
  title: ReactNode;
  sub?: ReactNode;
  /** A page under a tab: a back arrow to `backHref`. */
  backHref?: string;
  onBack?: () => void;
  /** Sync state, e.g. "Synced" or "Offline. Changes stay on this phone". */
  status: string;
}

/** The bar at the top of each screen: its title, a back arrow on pages under a tab, the sync state, and, while a
 *  set's rest is counting down, RestBar below the title. Its own height feeds --appbar-h, so the rest row growing
 *  the bar doesn't creep over a focused field further down the page (base.css, shell.css, RAJ-60). */
export function AppBar({ title, sub, backHref, onBack, status }: Props) {
  const store = useGym();
  const barRef = useBarsHeight<HTMLElement>("--appbar-h");
  return (
    <header className="appbar" ref={barRef}>
      {backHref != null && onBack ? (
        <ViewLink className="ghost icon back" id="backBtn" href={backHref} onOpen={onBack}>
          <ArrowLeft size={22} aria-hidden="true" />
          <span className="sr-only">Back</span>
        </ViewLink>
      ) : null}
      <div className="appbar-t">
        <h1 id="screenTitle">{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      <div className="status" id="status" aria-live="polite">
        {status}
      </div>
      {store.rest ? <RestBar /> : null}
    </header>
  );
}

/** The rest timer's own row: the countdown, and pause/resume, +30 s and skip. Reads the store itself (rather than
 *  taking it as a prop) so AppBar can mount and drop it as a unit when a timer starts or ends. Ticks its own state
 *  once a second only to re-render the countdown; the store's end time, not this, is what actually keeps time, so a
 *  throttled or missed tick (a backgrounded tab) just means the number catches up next render, not that it drifts
 *  (store.ts's restRemaining). The visible countdown is aria-hidden and updates silently; a separate sr-only status
 *  says "Rest over" once, so screen readers hear that it ended without hearing a countdown every second. */
function RestBar() {
  const store = useGym();
  const r = store.rest;
  const paused = r?.pausedAt != null;
  const ended = r?.ended ?? false;
  const running = !!r && !paused && !ended;
  const [, retick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => retick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  if (!r) return null;
  return (
    <div className={`resttimer${ended ? " over" : ""}`} role="group" aria-label="Rest timer">
      <span className="rt-time" aria-hidden="true">
        {ended ? "Rest over" : mmss(store.restRemaining())}
      </span>
      <span className="sr-only" role="status">
        {ended ? "Rest over." : ""}
      </span>
      <div className="rt-btns">
        <button
          type="button"
          className="ghost tiny"
          id="restPause"
          disabled={ended}
          onClick={() => (paused ? store.resumeRest() : store.pauseRest())}
        >
          {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" className="ghost tiny" id="restAdd30" onClick={() => store.addRestTime(30)}>
          +30s
        </button>
        <button type="button" className="ghost tiny" id="restSkip" onClick={() => store.skipRest()}>
          <SkipForward size={16} aria-hidden="true" />
          Skip
        </button>
      </div>
    </div>
  );
}
