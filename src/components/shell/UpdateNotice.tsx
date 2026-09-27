"use client";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { availableMessage, downloadingMessage, setDismissedUpdateCode } from "@/lib/update";
import { retryWith, useAndroidUpdate, watchForUpdate } from "./useAndroidUpdate";

/**
 * A newer build of the Android app, said with a small banner like SyncBar's on every screen, checked for as the app
 * opens and comes back to the front (watchForUpdate; the website's service worker updates itself instead, see
 * GymLog's controllerchange notice). Its Update downloads the build right there and hands it to Android's installer,
 * the same steps as Settings → About (useAndroidUpdate), saying how far the download has got. Dismissing it
 * remembers the build dismissed, so it stays hidden until a newer one shows up.
 */
export function UpdateNotice() {
  const { s, setS, download, install, openInstallSettings } = useAndroidUpdate({ kind: "hidden" });
  // The build whose banner was dismissed: a newer one found later, with the app still open, shows again.
  const [dismissed, setDismissed] = useState<number | null>(null);

  useEffect(() => watchForUpdate(setS), [setS]);

  const latest = "latest" in s ? s.latest : undefined;
  const show = !!latest && latest.code !== dismissed;
  const msg =
    s.kind === "available"
      ? availableMessage(s.latest.name, s.latest.size)
      : s.kind === "downloading"
        ? downloadingMessage(s.received, s.total)
        : s.kind === "readyToInstall"
          ? `Version ${s.latest.name} is ready to install.`
          : s.kind === "needsPermission"
            ? "Allow Gym Log to install updates, in Android’s settings."
            : s.kind === "error"
              ? s.message
              : "";
  return (
    <div className="syncbar info" id="updateBar" role="status" hidden={!show}>
      <span id="updateMsg">{msg}</span>
      {latest && (s.kind === "available" || s.kind === "error") ? (
        <button type="button" className="btn btn-sm" id="updateGo" onClick={() => (retryWith(s) === "install" ? install : download)(latest)}>
          {s.kind === "error" ? "Try again" : "Update"}
        </button>
      ) : null}
      {s.kind === "readyToInstall" ? (
        <button type="button" className="btn btn-sm" id="updateInstall" onClick={() => install(s.latest)}>
          Install
        </button>
      ) : null}
      {s.kind === "needsPermission" ? (
        <button type="button" className="btn btn-sm" id="updateAllow" onClick={openInstallSettings}>
          Open settings
        </button>
      ) : null}
      <button
        type="button"
        className="btn btn-icon"
        id="updateDismiss"
        aria-label="Dismiss"
        onClick={() => {
          // Dismissed before starting: this build isn't offered again. Once it's downloading, the download carries on
          // and Settings → About follows it.
          if (s.kind === "available") setDismissedUpdateCode(s.latest.code);
          if (latest) setDismissed(latest.code);
        }}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
