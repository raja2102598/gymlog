/* The Android app's extras, loaded only inside the app (see GymLog): sign-in links that open the app, and
 * Health Connect, read once you're signed in and again whenever the app comes back to the front. */
import { App } from "@capacitor/app";
import { NATIVE_SIGN_IN } from "@/lib/native";
import type { GymStore } from "@/lib/store";
import { syncHealth } from "./health";

export { connectHealth, syncHealth } from "./health";

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
  // The first read, as soon as the account is known.
  const first = () => {
    if (store.auth !== "signedIn") return;
    stop();
    void syncHealth(store, true);
  };
  const stop = store.subscribe(first);
  first();
}
