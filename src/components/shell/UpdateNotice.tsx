"use client";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { availableMessage, dismissedUpdateCode, downloadingMessage, lastCheckedAt, setDismissedUpdateCode, setLastCheckedAt, shouldCheckNow, shouldShowUpdateNotice } from "@/lib/update";
import { useAndroidUpdate } from "./useAndroidUpdate";

// Loaded only in the Android app (see GymLog), so the website doesn't carry the plugin.
const native = () => import("@/native/app");

/**
 * A quiet check for a newer build, at most every 12 hours (the website's service worker updates itself instead;
 * see GymLog's controllerchange notice), said with a small banner like SyncBar's. Its Update downloads the build
 * right there and hands it to Android's installer, the same steps as Settings → About (useAndroidUpdate), saying
 * how far the download has got; it used to only open Settings, which did nothing when Settings was already open.
 * Dismissing it remembers the build dismissed, so it stays hidden until a newer one shows up.
 */
export function UpdateNotice() {
  const { s, setS, download, install, openInstallSettings } = useAndroidUpdate({ kind: "hidden" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!shouldCheckNow(lastCheckedAt(), Date.now())) return;
    let live = true;
    void native()
      .then((m) => m.checkUpdate())
      .then((r) => {
        if (live && r.enabled && r.available && r.latest && shouldShowUpdateNotice(r.latest.code, dismissedUpdateCode())) setS({ kind: "available", latest: r.latest });
      })
      // Quiet: Settings → About has the error text and a retry, so an open app never nags about it.
      .catch(() => {})
      .finally(() => setLastCheckedAt(Date.now()));
    return () => {
      live = false;
    };
  }, [setS]);

  const latest = "latest" in s ? s.latest : undefined;
  const show = !dismissed && !!latest;
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
        <button type="button" className="btn btn-sm" id="updateGo" onClick={() => download(latest)}>
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
          setDismissed(true);
        }}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
