/* Keep the screen on during a workout: on by default, switched off in Settings, and kept on this phone, like Voice.
 * In the Android app the window keeps the screen on (ScreenPlugin.kt); in a browser, the Screen Wake Lock API holds
 * it, asked for again each time the page comes back to the front, since the browser lets it go whenever it's hidden. */
import { registerPlugin } from "@capacitor/core";
import { isNative } from "./native";
import { lsGet, lsSet } from "./storage";

export const AWAKE_KEY = "gymlog.awake.v1";
const listeners = new Set<() => void>();

/** Whether "Keep the screen on" is on, on this phone: on until it's switched off. */
export const awakePref = (): boolean => lsGet<unknown>(AWAKE_KEY, true) !== false;

export function setAwakePref(on: boolean) {
  lsSet(AWAKE_KEY, on);
  for (const fn of listeners) fn();
}

/** Calls `fn` when the switch changes: for useSyncExternalStore. Returns the unsubscribe. */
export function onAwakePref(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

interface ScreenPlugin {
  keepOn(o: { on: boolean }): Promise<void>;
}
const Screen = registerPlugin<ScreenPlugin>("GymScreen");

interface Sentinel {
  released: boolean;
  release(): Promise<void>;
}
type WakeLockNav = Navigator & { wakeLock?: { request(type: "screen"): Promise<Sentinel> } };

/** Holds the screen on until the returned function is called. Nothing happens where neither way is there (an older
 *  browser): the screen goes off as it always did. */
export function keepScreenOn(): () => void {
  if (isNative()) {
    void Screen.keepOn({ on: true }).catch(() => {});
    return () => void Screen.keepOn({ on: false }).catch(() => {});
  }
  const nav = (typeof navigator !== "undefined" ? navigator : null) as WakeLockNav | null;
  if (!nav?.wakeLock) return () => {};
  let lock: Sentinel | null = null, done = false;
  const take = () => {
    if (done || (lock && !lock.released) || document.hidden) return;
    nav.wakeLock!.request("screen").then(
      (l) => {
        if (done) void l.release().catch(() => {});
        else lock = l;
      },
      () => {}, // refused (battery saver, say): the screen goes off as usual
    );
  };
  const onShow = () => {
    if (!document.hidden) take();
  };
  take();
  document.addEventListener("visibilitychange", onShow);
  return () => {
    done = true;
    document.removeEventListener("visibilitychange", onShow);
    if (lock && !lock.released) void lock.release().catch(() => {});
    lock = null;
  };
}
