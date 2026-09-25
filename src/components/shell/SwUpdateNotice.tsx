"use client";

/** "Gym Log was updated": a new service worker has just taken over this open tab (GymLog notices the
 *  controllerchange). The tab is still running the old code, so a reload is the only way onto the new version. */
export function SwUpdateNotice({ show, onReload }: { show: boolean; onReload: () => void }) {
  return (
    <div className="syncbar info" id="swUpdateBar" role="status" hidden={!show}>
      <span id="swUpdateMsg">Gym Log was updated.</span>
      <button type="button" className="ghost tiny" id="swUpdateReload" onClick={onReload}>
        Reload
      </button>
    </div>
  );
}
