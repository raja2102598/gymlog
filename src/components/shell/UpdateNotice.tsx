"use client";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { availableMessage, dismissedUpdateCode, lastCheckedAt, setDismissedUpdateCode, setLastCheckedAt, shouldCheckNow, shouldShowUpdateNotice } from "@/lib/update";
import type { LatestUpdate } from "@/native/update";
import { ViewLink } from "../ui/ViewLink";

// Loaded only in the Android app (see GymLog), so the website doesn't carry the plugin.
const native = () => import("@/native/app");

/**
 * A quiet check for a newer build, at most every 12 hours (the website's service worker updates itself instead;
 * see GymLog's controllerchange notice). Says so with a small banner, like SyncBar's, linking to Settings → About
 * where Check for updates can download and install it. Dismissing it remembers the build dismissed, so it stays
 * hidden until a newer one shows up.
 */
export function UpdateNotice({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [latest, setLatest] = useState<LatestUpdate | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!shouldCheckNow(lastCheckedAt(), Date.now())) return;
    let live = true;
    void native()
      .then((m) => m.checkUpdate())
      .then((r) => {
        if (live && r.enabled && r.available && r.latest) setLatest(r.latest);
      })
      // Quiet: Settings → About has the error text and a retry, so an open app never nags about it.
      .catch(() => {})
      .finally(() => setLastCheckedAt(Date.now()));
    return () => {
      live = false;
    };
  }, []);

  const show = !!latest && !dismissed && shouldShowUpdateNotice(latest.code, dismissedUpdateCode());
  return (
    <div className="syncbar info" id="updateBar" role="status" hidden={!show}>
      <span id="updateMsg">{latest ? availableMessage(latest.name, latest.size) : ""}</span>
      <ViewLink className="btn btn-sm" id="updateOpen" href="#settings" onOpen={onOpenSettings}>
        Update
      </ViewLink>
      <button
        type="button"
        className="btn btn-icon"
        id="updateDismiss"
        aria-label="Dismiss"
        onClick={() => {
          if (!latest) return;
          setDismissedUpdateCode(latest.code);
          setDismissed(true);
        }}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
