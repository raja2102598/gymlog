/* Updating the Android app from inside itself: the app's own AppUpdate plugin (android/app/.../AppUpdatePlugin.kt)
 * checks this build's GitHub repo for a newer release, downloads it and hands it to Android's installer. See
 * docs/android.md, "Updates and the signing key". The plugin builds every address itself from the build's own
 * repo (empty in a local build, so it never checks), so nothing here can point it at another file or site. */
import { App } from "@capacitor/app";
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/** A build, as little as there is to say about one before it's downloaded. */
export interface UpdateVersion {
  code: number;
  name: string;
}
/** The latest release's version.json (.github/workflows/android.yml writes it next to the APK). */
export interface LatestUpdate extends UpdateVersion {
  commit: string;
  size: number;
  sha256: string;
}
export interface UpdateCheck {
  /** False in a build with no repo to check (a local build): Settings then shows no update controls at all. */
  enabled: boolean;
  current: UpdateVersion;
  /** Missing when nothing's published yet, or the release is briefly missing while CI replaces it (a 404). */
  latest?: LatestUpdate;
  available: boolean;
}
export interface DownloadProgress {
  received: number;
  total: number;
}
/** install()'s answer: either Android's installer took over, or it needs the one-time permission first. */
export type InstallResult = { started: true } | { needsPermission: true };

interface AppUpdatePlugin {
  check(): Promise<UpdateCheck>;
  /** Re-reads version.json, downloads and verifies the APK, emitting "progress" as it goes. Rejects, with the file
   *  removed, if the download doesn't check out (see AppUpdatePlugin.kt for every reason). */
  download(): Promise<void>;
  install(): Promise<InstallResult>;
  openInstallSettings(): Promise<void>;
  addListener(eventName: "progress", listenerFunc: (data: DownloadProgress) => void): Promise<PluginListenerHandle>;
}

const AppUpdate = registerPlugin<AppUpdatePlugin>("AppUpdate");

export const checkUpdate = (): Promise<UpdateCheck> => AppUpdate.check();

interface Underway {
  done: Promise<void>;
  /** The latest "progress", for someone who starts following partway. */
  progress: DownloadProgress | null;
  following: Set<(p: DownloadProgress) => void>;
}
/** The download under way, if any. It outlives the Settings screen that started it: opened again mid-download,
 *  Settings follows this one (followDownload) rather than offering a second. */
let underway: Underway | null = null;

/** Downloads the update, calling `onProgress` as bytes arrive. Resolves once it's verified and ready to install.
 *  One already under way is joined, not started again (the plugin would join it too: AppUpdatePlugin.download). */
export const downloadUpdate = (onProgress: (p: DownloadProgress) => void): Promise<void> => follow(underway ?? startDownload(), onProgress);

function startDownload(): Underway {
  const d: Underway = { done: Promise.resolve(), progress: null, following: new Set() };
  underway = d;
  d.done = (async () => {
    let handle: PluginListenerHandle | undefined;
    try {
      handle = await AppUpdate.addListener("progress", (p) => {
        d.progress = p;
        for (const f of d.following) f(p);
      });
      await AppUpdate.download();
    } finally {
      if (underway === d) underway = null;
      await handle?.remove();
    }
  })();
  return d;
}

/** Whether a download is under way: Settings, opened again mid-download, follows it rather than offer another. */
export const downloadUnderway = (): boolean => underway !== null;

/** The download under way, followed to its end: `onProgress` as bytes arrive, starting with where it's got to.
 *  Null when none is. */
export const followDownload = (onProgress: (p: DownloadProgress) => void): Promise<void> | null => (underway ? follow(underway, onProgress) : null);

async function follow(d: Underway, onProgress: (p: DownloadProgress) => void): Promise<void> {
  if (d.progress) onProgress(d.progress);
  d.following.add(onProgress);
  try {
    await d.done;
  } finally {
    d.following.delete(onProgress);
  }
}

export const installUpdate = (): Promise<InstallResult> => AppUpdate.install();

export const openInstallSettings = (): Promise<void> => AppUpdate.openInstallSettings();

/** Calls `fn` each time the app comes back to the front (Android's onResume), e.g. back from allowing installs in
 *  Android's settings. Returns the unsubscribe. */
export function onAppResume(fn: () => void): () => void {
  let live = true;
  const p = App.addListener("resume", () => {
    if (live) fn();
  });
  return () => {
    live = false;
    void p.then((h) => h.remove());
  };
}
