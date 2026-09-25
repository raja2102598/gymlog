/* The rest timer's alert while Gym Log is backgrounded or closed: the app's own RestTimer plugin (RestTimerPlugin.kt)
 * schedules an Android alarm and a notification that counts down on its own for whenever the timer in store.ts ends,
 * as the app goes to the background, and takes both down on coming back or whenever the timer stops meaning that.
 * Settings asks for POST_NOTIFICATIONS (13+) before this can do anything; older versions grant it on install (see the
 * "Rest timer notifications" row, SettingsView.tsx). */
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

/** Follows store.rest while the app is out of sight: schedules the native alert for a running timer as Gym Log goes
 *  to the background, and cancels it on coming back, since in front the page counts down and says "Rest over"
 *  itself (an alarm as well would sound a second alert just before the page took it down). Nothing is kept from
 *  while it was in front, so going to the background always schedules afresh: a timer started before notifications
 *  were allowed gets its alert too. A timer that ends in the background is left to the alarm, which fires at the
 *  same moment and says "Rest over" there, since that's where you'll see it; coming back takes it down. */
export function syncRestNotifications(store: GymStore): () => void {
  let active = true;
  // Keyed on what should be scheduled, so an unrelated store change (a set logged on another lift, sync finishing)
  // doesn't re-arm an alarm that's already exactly right. The first pass always sends, so opening the app takes
  // down whatever an earlier run left scheduled or showing.
  let last: string | null = null;
  const apply = () => {
    const r = store.rest;
    const want = active || !r || r.pausedAt != null ? "" : r.ended ? (last ?? "") : `${r.lift}|${r.endAt}`;
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
