"use client";
import { useGym } from "@/hooks/useGym";

/** Stays in view while edits wait on a failed save or on the phone being offline, and while the phone won't keep
 *  its copy (storage full or blocked). */
export function SyncBar() {
  const store = useGym();
  const w = store.syncWaiting();
  const local = !!store.user && store.localSaveFailed;
  const later = w?.offline ? "they’ll sync when you’re back online" : "retrying every 15 seconds";
  return (
    <div className="syncbar" id="syncBar" role="status" hidden={!w && !local}>
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
    </div>
  );
}
