/* The Android app's extras, loaded only inside the app (see GymLog): sign-in links that open the app, and
 * Health Connect, read once you're signed in, whenever the app comes back to the front, and every 15 minutes while
 * it's open. Background sync (sync.ts) covers the time it's closed. Voice logging asks the phone, once, whether it
 * can listen (speech.ts). */
import { App } from "@capacitor/app";
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { GO_EVENT, NATIVE_GO, NATIVE_SIGN_IN } from "@/lib/native";
import { checkPhoneSpeech } from "@/lib/speech";
import type { GymStore } from "@/lib/store";
import { syncHealth } from "./health";
import { backgroundStatus, checkBackgroundOwner, turnOffBackground } from "./sync";
import { startWidget } from "./widget";

export { signInWithGoogle } from "./google";
export { connectHealth, healthAccess, openHealthSettings, syncHealth } from "./health";
export { backgroundStatus, runBackgroundNow, turnOffBackground, turnOnBackground, type SyncStatus } from "./sync";
export {
  checkUpdate,
  downloadUnderway,
  downloadUpdate,
  followDownload,
  installUpdate,
  onAppResume,
  openInstallSettings,
  type DownloadProgress,
  type InstallResult,
  type LatestUpdate,
  type UpdateCheck,
} from "./update";

/** The phone's status and navigation bars follow the theme picked in Settings: light icons on the dark theme. */
export const setBarStyle = (theme: "system" | "light" | "dark"): Promise<void> =>
  SystemBars.setStyle({ style: theme === "dark" ? SystemBarsStyle.Dark : theme === "light" ? SystemBarsStyle.Light : SystemBarsStyle.Default });

/** "1.0.42 (42)": the version CI stamped on this build of the app, for Settings. */
export const appVersion = async (): Promise<string> => {
  const i = await App.getInfo();
  return `${i.version} (${i.build})`;
};

let started = false;

export async function startNative(store: GymStore): Promise<void> {
  if (started) return;
  started = true;
  // Voice logging: Settings and Today offer it once the phone says it can turn speech into text.
  void checkPhoneSpeech();
  // A sign-in link opens the app with ...://login?code=…, either starting it or bringing it back. The widget's
  // taps arrive the same way, as .../go/today, weight or steps; GymLog.tsx switches tabs on the window event.
  const open = (url?: string | null) => {
    if (url?.startsWith(NATIVE_SIGN_IN)) void store.finishSignIn(url);
    else if (url?.startsWith(NATIVE_GO)) window.dispatchEvent(new CustomEvent(GO_EVENT, { detail: url.slice(NATIVE_GO.length) }));
  };
  await App.addListener("appUrlOpen", ({ url }) => open(url));
  open((await App.getLaunchUrl())?.url);
  await App.addListener("resume", () => void syncHealth(store));
  // Signing out stops background sync, so this phone's data stops going to the account.
  store.onSignOut(async () => {
    if ((await backgroundStatus()).on) await turnOffBackground(store);
  });
  // The widget follows the store, clearing itself on any sign-out.
  startWidget(store);
  // While open, too: a watch's numbers keep arriving through the day. syncHealth skips runs under 5 minutes apart.
  setInterval(() => void syncHealth(store), 15 * 60_000);
  // The first read, as soon as the account is known. Not for the demo: it isn't a real account, and Health
  // Connect and background sync both need one (GymLog's Settings says so and hides the controls).
  const first = () => {
    if (store.auth !== "signedIn" || store.demo) return;
    stop();
    void syncHealth(store, true);
    void checkBackgroundOwner(store).catch(() => {});
  };
  const stop = store.subscribe(first);
  first();
}
