"use client";
import { useCallback, useEffect, useState } from "react";
import { dismissedUpdateCode, lastCheckedAt, setLastCheckedAt, shouldCheckNow, shouldShowUpdateNotice } from "@/lib/update";
import type { DownloadProgress, InstallResult, LatestUpdate } from "@/native/update";

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
  // step "install": the download is on the phone and only Android's installer failed, so trying again opens the
  // installer rather than downloading the whole build again.
  | { kind: "error"; message: string; latest?: LatestUpdate; step?: "install" };

/** What trying again after an error does: the installer again when only it failed, else the download. */
export const retryWith = (s: AndroidUpdate): "install" | "download" => (s.kind === "error" && s.step === "install" ? "install" : "download");
/** A download's "progress", into the state while it's still downloading. */
export const withProgress = (p: DownloadProgress) => (cur: AndroidUpdate): AndroidUpdate => (cur.kind === "downloading" ? { ...cur, received: p.received, total: p.total || cur.total } : cur);
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\.$/, "");
export const downloadFailed = (e: unknown, latest?: LatestUpdate): AndroidUpdate => ({ kind: "error", message: `Couldn’t download the update: ${reason(e)}.`, latest });

type Native = Pick<typeof import("@/native/app"), "downloadUpdate" | "downloadUnderway" | "followDownload" | "installUpdate" | "openInstallSettings" | "onAppResume">;
type Checks = Pick<typeof import("@/native/app"), "checkUpdate" | "onAppResume">;
type SetUpdate = (next: AndroidUpdate | ((cur: AndroidUpdate) => AndroidUpdate)) => void;

/** The installer being asked for, if it is: shared by every place that offers the update (the banner and Settings
 *  can both be waiting to try again on the way back from Android's settings), so it opens once. */
let installing: Promise<InstallResult> | null = null;
const installOnce = (m: Native): Promise<InstallResult> => (installing ??= m.installUpdate().finally(() => (installing = null)));

/** The steps, apart from React so they can be tested on their own: `load` is the Android app's native module. */
export function updateSteps(set: SetUpdate, load: () => Promise<Native> = native) {
  const install = (latest: LatestUpdate): Promise<void> =>
    load()
      .then((m) => installOnce(m))
      // { started: true }: Android's installer has taken over. Back to readyToInstall either way, not needsPermission
      // again once it's started, so coming back from the installer (cancelled, say) doesn't retry it on a loop.
      .then((r) => set("needsPermission" in r ? { kind: "needsPermission", latest } : { kind: "readyToInstall", latest }))
      .catch((e: unknown) => set({ kind: "error", message: `Couldn’t start the installer: ${reason(e)}.`, latest, step: "install" }));
  /** "Download and install": once the download checks out, straight on to the installer, without a second tap. A
   *  download already under way (started from Settings, say, while the banner still offered it) is followed, not
   *  started again, and ends at Install: the place that started it opens the installer, so it opens once. */
  const download = (latest: LatestUpdate): Promise<void> => {
    set({ kind: "downloading", latest, received: 0, total: latest.size });
    return load().then(async (m) => {
      if (m.downloadUnderway()) {
        await m.followDownload((p) => set(withProgress(p)))?.then(
          () => set({ kind: "readyToInstall", latest }),
          (e: unknown) => set(downloadFailed(e, latest)),
        );
        return;
      }
      await m.downloadUpdate((p) => set(withProgress(p))).then(
        () => install(latest),
        (e: unknown) => set(downloadFailed(e, latest)),
      );
    });
  };
  return { install, download };
}

/**
 * The update notice's checks for a newer build: as the app starts, and each time it comes back to the front (Android
 * keeps it running in the background, so that's how it's opened most often) once RECHECK_MS has gone by since the
 * last. Only a build newer than the one dismissed is offered. A check never takes over a download or install under way,
 * nor an installer that failed on a build already downloaded; a failed download it does, so a newer build found after
 * that error was dismissed still shows. Quiet when it can't check: Settings → About says why, with a retry. Returns
 * the stop.
 */
export function watchForUpdate(set: SetUpdate, load: () => Promise<Checks> = native, now: () => number = Date.now): () => void {
  let live = true;
  let unsub: (() => void) | undefined;
  const check = (starting: boolean) => {
    if (!starting && !shouldCheckNow(lastCheckedAt(), now())) return;
    setLastCheckedAt(now());
    void load()
      .then((m) => m.checkUpdate())
      .then((r) => {
        const latest = r.latest;
        if (!live || !r.enabled || !r.available || !latest || !shouldShowUpdateNotice(latest.code, dismissedUpdateCode())) return;
        set((cur) => (cur.kind === "hidden" || cur.kind === "available" || (cur.kind === "error" && cur.step !== "install") ? { kind: "available", latest } : cur));
      })
      .catch(() => {});
  };
  check(true);
  void load().then((m) => {
    if (live) unsub = m.onAppResume(() => check(false));
  });
  return () => {
    live = false;
    unsub?.();
  };
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
