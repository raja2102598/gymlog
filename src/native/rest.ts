/* What the lock screen shows while Gym Log is backgrounded or closed, through the app's own RestTimer plugin
 * (RestTimerPlugin.kt): a rest timer's countdown, with an Android alarm for when it ends, or else the workout under
 * way, its clock counting up. One notification either way, which counts on its own and which Android 16 shows as a
 * Live Update: in Samsung's Now Bar, on the lock screen and in the status bar's chip. It goes up as the app goes to
 * the background and comes down on coming back. Settings asks for POST_NOTIFICATIONS (13+) before this can do
 * anything; older versions grant it on install (see the "Rest timer notifications" row, SettingsView.tsx). */
import { App } from "@capacitor/app";
import { registerPlugin, type PermissionState } from "@capacitor/core";
import { todayKey } from "@/lib/dates";
import { liveWorkout, type LiveWorkout } from "@/lib/session";
import type { GymStore } from "@/lib/store";

interface RestTimerPlugin {
  schedule(o: { lift: string; endAt: number }): Promise<void>;
  workout(o: LiveWorkout): Promise<void>;
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

/** Follows store.rest and today's workout clock while the app is out of sight. Going to the background, a running
 *  rest timer gets its countdown and alarm; with none, a workout under way (lib/session.ts, liveWorkout) gets its
 *  clock. Coming back cancels both, since in front the page counts down and says "Rest over" itself (an alarm as
 *  well would sound a second alert just before the page took it down). Nothing is kept from while it was in front,
 *  so going to the background always sends afresh: a timer started before notifications were allowed gets its alert
 *  too. A timer that ends in the background is left to the alarm, which fires at the same moment and says "Rest
 *  over" there, since that's where you'll see it; coming back takes it down. */
export function syncOngoingNotifications(store: GymStore): () => void {
  let active = true;
  // Keyed on what should be showing, so an unrelated store change (sync finishing, say) doesn't send again what's
  // already exactly right. The first pass always sends, so opening the app takes down whatever an earlier run left
  // scheduled or showing.
  let last: string | null = null;
  const apply = () => {
    const r = store.rest, w = active ? null : liveWorkout(store, todayKey());
    // Resting, in the background: the countdown, or, once it's over, the alarm's "Rest over", left as it is.
    const resting = !active && !!r && r.pausedAt == null && (!r.ended || !!last?.startsWith("rest|"));
    const want = resting ? (r.ended ? last! : `rest|${r.lift}|${r.endAt}`) : w ? `workout|${w.title}|${w.text}|${w.since}` : "";
    if (want === last) return;
    last = want;
    if (resting) void RestTimer.schedule({ lift: r.lift, endAt: r.endAt });
    else if (w) void RestTimer.workout(w);
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
