"use client";
import { useState } from "react";
import { useGym } from "@/hooks/useGym";
import { dm } from "@/lib/dates";

/** Stays in view while edits wait on a failed save or on the phone being offline, while the phone won't keep its
 *  copy (storage full or blocked), and while a day or the plan changed here and on another device waits for you to
 *  choose a version (one at a time, days first). */
export function SyncBar() {
  const store = useGym();
  // While a choice syncs, so a double tap can't also answer for the next day, which shows in the same place.
  const [choosing, setChoosing] = useState(false);
  const w = store.syncWaiting();
  const local = !!store.user && store.localSaveFailed;
  const later = w?.offline ? "they’ll sync when you’re back online" : "retrying every 15 seconds";
  const day = Object.keys(store.conflicts).sort()[0], plan = !day && !!store.planConflict;
  const keep = (which: "mine" | "theirs") => {
    setChoosing(true);
    void (day ? store.keepDay(day, which) : store.keepPlan(which)).finally(() => setChoosing(false));
  };
  return (
    <div className="syncbar" id="syncBar" role="status" hidden={!w && !local && !day && !plan}>
      <span id="syncMsg" hidden={!w}>
        {/* With no copy on the phone, it doesn't say they're saved there. */}
        {w ? `${w.days} day${w.days === 1 ? "" : "s"} not synced yet. ${local ? later[0].toUpperCase() + later.slice(1) : `Saved on this phone; ${later}`}.` : ""}
      </span>
      <button className="ghost tiny" id="syncRetry" hidden={!w || w.offline} onClick={() => store.retrySync()}>
        Retry now
      </button>
      <p id="syncLocal" hidden={!local}>
        Couldn’t save on this phone: storage is full or blocked. Free up space, or export your data from Settings.
      </p>
      {day || plan ? (
        <div className="conflict" id="syncConflict">
          <p id="conflictMsg">{day ? `${dm(day)} was changed on another device.` : "The plan was changed on another device."}</p>
          <button className="ghost tiny" id="keepMine" disabled={choosing} onClick={() => keep("mine")}>
            Keep this phone’s version
          </button>
          <button className="ghost tiny" id="keepTheirs" disabled={choosing} onClick={() => keep("theirs")}>
            Keep the other version
          </button>
        </div>
      ) : null}
    </div>
  );
}
