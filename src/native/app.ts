/* The Android app's extras, loaded only inside the app (see GymLog): sign-in links that open the app, and
 * Health Connect, read once you're signed in, whenever the app comes back to the front, and every 15 minutes while
 * it's open. Background sync (sync.ts) covers the time it's closed. */
import { App } from "@capacitor/app";
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { NATIVE_SIGN_IN } from "@/lib/native";
import type { GymStore } from "@/lib/store";
import { syncHealth } from "./health";
import { backgroundStatus, checkBackgroundOwner, turnOffBackground } from "./sync";

export { signInWithGoogle } from "./google";
export { connectHealth, healthAccess, openHealthSettings, syncHealth } from "./health";
export { backgroundStatus, runBackgroundNow, turnOffBackground, turnOnBackground, type SyncStatus } from "./sync";

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
  // A sign-in link opens the app with ...://login?code=…, either starting it or bringing it back.
  const open = (url?: string | null) => {
    if (url?.startsWith(NATIVE_SIGN_IN)) void store.finishSignIn(url);
  };
  await App.addListener("appUrlOpen", ({ url }) => open(url));
  open((await App.getLaunchUrl())?.url);
  await App.addListener("resume", () => void syncHealth(store));
  // Signing out stops background sync, so this phone's data stops going to the account.
  store.onSignOut(async () => {
    if ((await backgroundStatus()).on) await turnOffBackground(store);
  });
  // While open, too: a watch's numbers keep arriving through the day. syncHealth skips runs under 5 minutes apart.
  setInterval(() => void syncHealth(store), 15 * 60_000);
  // The first read, as soon as the account is known.
  const first = () => {
    if (store.auth !== "signedIn") return;
    stop();
    void syncHealth(store, true);
    void checkBackgroundOwner(store).catch(() => {});
  };
  const stop = store.subscribe(first);
  first();
}
