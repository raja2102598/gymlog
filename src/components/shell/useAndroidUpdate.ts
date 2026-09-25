"use client";
import { useCallback, useEffect, useState } from "react";
import type { DownloadProgress, LatestUpdate } from "@/native/update";

// Loaded only in the Android app, so the website doesn't carry the plugin.
const native = () => import("@/native/app");

export type AndroidUpdate =
  | { kind: "checking" }
  | { kind: "hidden" } // no repo to check (a local build), or nothing to offer yet
  | { kind: "upToDate" }
  | { kind: "available"; latest: LatestUpdate }
  | { kind: "downloading"; latest: LatestUpdate; received: number; total: number }
  | { kind: "readyToInstall"; latest: LatestUpdate }
  | { kind: "needsPermission"; latest: LatestUpdate }
  | { kind: "error"; message: string; latest?: LatestUpdate };

/** A download's "progress", into the state while it's still downloading. */
export const withProgress = (p: DownloadProgress) => (cur: AndroidUpdate): AndroidUpdate => (cur.kind === "downloading" ? { ...cur, received: p.received, total: p.total || cur.total } : cur);
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\.$/, "");
export const downloadFailed = (e: unknown, latest?: LatestUpdate): AndroidUpdate => ({ kind: "error", message: `Couldn’t download the update: ${reason(e)}.`, latest });

type Native = Pick<typeof import("@/native/app"), "downloadUpdate" | "installUpdate" | "openInstallSettings" | "onAppResume">;
type SetUpdate = (next: AndroidUpdate | ((cur: AndroidUpdate) => AndroidUpdate)) => void;

/** The steps, apart from React so they can be tested on their own: `load` is the Android app's native module. */
export function updateSteps(set: SetUpdate, load: () => Promise<Native> = native) {
  const install = (latest: LatestUpdate): Promise<void> =>
    load()
      .then((m) => m.installUpdate())
      // { started: true }: Android's installer has taken over. Back to readyToInstall either way, not needsPermission
      // again once it's started, so coming back from the installer (cancelled, say) doesn't retry it on a loop.
      .then((r) => set("needsPermission" in r ? { kind: "needsPermission", latest } : { kind: "readyToInstall", latest }))
      .catch((e: unknown) => set({ kind: "error", message: `Couldn’t start the installer: ${reason(e)}.`, latest }));
  /** "Download and install": once the download checks out, straight on to the installer, without a second tap. */
  const download = (latest: LatestUpdate): Promise<void> => {
    set({ kind: "downloading", latest, received: 0, total: latest.size });
    return load()
      .then((m) => m.downloadUpdate((p) => set(withProgress(p))))
      .then(
        () => install(latest),
        (e: unknown) => set(downloadFailed(e, latest)),
      );
  };
  return { install, download };
}

/**
 * Downloading and installing a newer build of the Android app (AppUpdatePlugin.kt), wherever it's offered: Settings →
 * About, and the update notice at the top of every screen. Both run the same steps: download (joining one already
 * under way), then straight on to Android's installer, or first to the one-time "allow installs from Gym Log"
 * permission, trying again when the app comes back from it.
 */
export function useAndroidUpdate(initial: AndroidUpdate) {
  const [s, setS] = useState<AndroidUpdate>(initial);
  const [steps] = useState(() => updateSteps(setS));
  const install = useCallback((latest: LatestUpdate) => void steps.install(latest), [steps]);
  const download = useCallback((latest: LatestUpdate) => void steps.download(latest), [steps]);
  const openInstallSettings = useCallback(() => void native().then((m) => m.openInstallSettings()), []);

  // Back from Android's "allow installs from Gym Log" screen: try installing again, now that it may be allowed.
  useEffect(() => {
    if (s.kind !== "needsPermission") return;
    const latest = s.latest;
    let live = true;
    let unsub: (() => void) | undefined;
    void native().then((m) => {
      if (live) unsub = m.onAppResume(() => install(latest));
    });
    return () => {
      live = false;
      unsub?.();
    };
  }, [s, install]);

  return { s, setS, download, install, openInstallSettings };
}
