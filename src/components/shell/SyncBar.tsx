"use client";
import { useGym } from "@/hooks/useGym";

/** Stays in view while edits wait on a failed save or on the phone being offline. */
export function SyncBar() {
  const store = useGym();
  const w = store.syncWaiting();
  return (
    <div className="syncbar" id="syncBar" role="status" hidden={!w}>
      <span id="syncMsg">
        {w ? `${w.days} day${w.days === 1 ? "" : "s"} not synced yet. Saved on this phone; ${w.offline ? "they’ll sync when you’re back online" : "retrying every 15 seconds"}.` : ""}
      </span>
      <button className="ghost tiny" id="syncRetry" hidden={!w || w.offline} onClick={() => store.retrySync()}>
        Retry now
      </button>
    </div>
  );
}
