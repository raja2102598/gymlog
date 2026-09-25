/* The rest timer's alert while Gym Log is backgrounded or closed: the app's own RestTimer plugin (RestTimerPlugin.kt)
 * schedules an Android alarm and a notification that counts down on its own for whenever the timer in store.ts ends,
 * and takes both down whenever the timer stops meaning that (paused, skipped, restarted, given more time). Settings
 * asks for POST_NOTIFICATIONS (13+) before this can do anything; older versions grant it on install (see the "Rest
 * timer notifications" row, SettingsView.tsx). */
import { App } from "@capacitor/app";
import { registerPlugin, type PermissionState } from "@capacitor/core";
import type { GymStore } from "@/lib/store";

interface RestTimerPlugin {
  schedule(o: { lift: string; endAt: number }): Promise<void>;
  cancel(): Promise<void>;
  checkPermissions(): Promise<{ notifications: PermissionState }>;
  requestPermissions(): Promise<{ notifications: PermissionState }>;
}

const RestTimer = registerPlugin<RestTimerPlugin>("RestTimer");

/** Whether Gym Log can post one right now: "prompt" or "prompt-with-rationale" while asking would show Android's
 *  dialog, "denied" once it won't (only the phone's own settings can turn it back on from there), "granted" once
 *  it's on. */
export const notificationPermission = async (): Promise<PermissionState> => (await RestTimer.checkPermissions()).notifications;

/** Asks Android's notification permission sheet. Settings only offers this while it would actually help: see
 *  notificationPermission's states above. */
export const requestNotificationPermission = async (): Promise<PermissionState> => (await RestTimer.requestPermissions()).notifications;

/** Follows store.rest: schedules the native alert while it's running, and cancels it the moment it isn't, so the
 *  alarm and notification never say something the page itself no longer does. One exception: a timer that ends
 *  while the app is in the background is left to the alarm, which fires at the same moment and says "Rest over"
 *  there, since that's where you'll see it. Coming back to the app takes that notification down. */
export function syncRestNotifications(store: GymStore): () => void {
  let active = true;
  // Keyed on what should be scheduled, so an unrelated store change (a set logged on another lift, sync finishing)
  // doesn't re-arm an alarm that's already exactly right.
  let last = "";
  const apply = () => {
    const r = store.rest;
    const want = r && r.pausedAt == null && !r.ended ? `${r.lift}|${r.endAt}` : r?.ended && !active ? last : "";
    if (want === last) return;
    last = want;
    if (want && r) void RestTimer.schedule({ lift: r.lift, endAt: r.endAt });
    else void RestTimer.cancel();
  };
  const stop = store.subscribe(apply);
  const state = App.addListener("appStateChange", ({ isActive }) => {
    active = isActive;
    apply();
  });
  apply();
  return () => {
    stop();
    void state.then((h) => h.remove());
  };
}
