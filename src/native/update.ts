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

/** Downloads the update, calling `onProgress` as bytes arrive. Resolves once it's verified and ready to install. */
export async function downloadUpdate(onProgress: (p: DownloadProgress) => void): Promise<void> {
  const handle = await AppUpdate.addListener("progress", onProgress);
  try {
    await AppUpdate.download();
  } finally {
    await handle.remove();
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
