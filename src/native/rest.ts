/* What the lock screen shows while Gym Log is backgrounded or closed, through the app's own RestTimer plugin
 * (RestTimerPlugin.kt): the workout under way, its clock counting up, and over it while you rest, a rest timer's
 * countdown, with an Android alarm for when it ends. Each is a notification of its own that counts on its own and asks
 * to be an Android 16 Live Update: on the lock screen and in the status bar's chip (Samsung's Now Bar only for apps
 * Samsung approves, or with Live notifications for all apps on; docs/android.md). They go up as the app goes to the
 * background and come down on coming back. Settings asks for POST_NOTIFICATIONS (13+) before this can do
 * anything; older versions grant it on install (see the "Rest timer notifications" row, SettingsView.tsx). Under that
 * row, Settings says whether "Rest over" will be on time and whether Live Updates are allowed (checkAlarms). */
import { App } from "@capacitor/app";
import { registerPlugin, type PermissionState } from "@capacitor/core";
import { afterRest, workoutUnderWay, type LiveRest, type LiveWorkout } from "@/lib/session";
import { lsGet, lsSet } from "@/lib/storage";
import type { GymStore } from "@/lib/store";
import { onRunChange } from "@/lib/workout";

/** Whether Settings' "Samsung timer card (experimental)" is on, sent with each running notification. */
type Card = { samsungCard: boolean };

interface RestTimerPlugin {
  /** The rest's countdown and its alarm, which says "Rest over" at `endAt`. */
  schedule(o: LiveRest & Card): Promise<void>;
  /** Takes down the countdown, its alarm, and a "Rest over" already said. */
  cancelRest(): Promise<void>;
  workout(o: LiveWorkout & Card): Promise<void>;
  cancelWorkout(): Promise<void>;
  /** All of it: coming back to the app. */
  cancel(): Promise<void>;
  isSamsung(): Promise<{ samsung: boolean }>;
  checkPermissions(): Promise<{ notifications: PermissionState }>;
  requestPermissions(): Promise<{ notifications: PermissionState }>;
  checkAlarms(): Promise<AlarmChecks>;
  openExactAlarmSettings(): Promise<void>;
  openLiveUpdateSettings(): Promise<void>;
}

/** What else Android allows the rest timer's alerts, once notifications are on (RestTimerPlugin.checkAlarms). Each is
 *  null where the phone's Android has no such setting, so there's nothing to show or change. */
export interface AlarmChecks {
  /** Whether "Rest over" gets an exact alarm, on time, rather than one Android can deliver minutes late: Alarms &
   *  reminders in Android's settings for Gym Log (Android 12 and later, and off until you allow it from 14). */
  exact: boolean | null;
  /** Whether Android may show the workout's clock and the rest countdown as Live Updates (Android 16 and later). One
   *  UI says false even while its Now Bar shows them, so Settings doesn't go by it on a Samsung. */
  liveUpdates: boolean | null;
}

const RestTimer = registerPlugin<RestTimerPlugin>("RestTimer");

/* ---------- Samsung's timer card, an experiment in Settings ---------- */

export const SAMSUNG_CARD_KEY = "gymlog.samsungCard.v1";

/** Whether this is a Samsung phone, the only kind Settings offers the Samsung timer card on, and where it speaks of
 *  the Now Bar rather than Live Updates (restNotifications.ts). */
export const isSamsungPhone = async (): Promise<boolean> => (await RestTimer.isSamsung()).samsung;

/** Whether "Samsung timer card (experimental)" is on, on this phone: off until it's switched on. With it on, the
 *  workout's clock and the rest countdown also carry the fields of Samsung's own Now Bar card, which One UI honours
 *  only for apps Samsung approves, so it may do nothing (RestTimerLogic.samsungExtras, docs/android.md). */
export const samsungCardPref = (): boolean => lsGet<unknown>(SAMSUNG_CARD_KEY, false) === true;

/** The switch, as Settings flips it: kept on this phone, like Voice. The notifications only show once Gym Log is out
 *  of sight, and going there sends them afresh (syncOngoingNotifications), so they carry it from then on. */
export function setSamsungCard(on: boolean): void {
  lsSet(SAMSUNG_CARD_KEY, on);
}

/** Whether Gym Log can post one right now: "prompt" or "prompt-with-rationale" while asking would show Android's
 *  dialog, "denied" once it won't (only the phone's own settings can turn it back on from there), "granted" once
 *  it's on. */
export const notificationPermission = async (): Promise<PermissionState> => (await RestTimer.checkPermissions()).notifications;

/** Asks Android's notification permission sheet. Settings only offers this while it would actually help: see
 *  notificationPermission's states above. */
export const requestNotificationPermission = async (): Promise<PermissionState> => (await RestTimer.requestPermissions()).notifications;

/** Whether "Rest over" will be on time, and whether Live Updates are allowed: see AlarmChecks. */
export const checkAlarms = (): Promise<AlarmChecks> => RestTimer.checkAlarms();

/** Android's "Alarms & reminders" page for Gym Log, where "Rest over" is allowed to come on time (its app info, on a
 *  phone without that page). */
export const openExactAlarmSettings = (): Promise<void> => RestTimer.openExactAlarmSettings();

/** Android's Live Updates page for Gym Log, or on a Samsung, Developer options (its notification settings, or else
 *  its app info, on a phone without that page: RestTimerLogic.liveUpdatePages). */
export const openLiveUpdateSettings = (): Promise<void> => RestTimer.openLiveUpdateSettings();

/** Follows the workout's clock (lib/session.ts, workoutUnderWay) and store.rest while the app is out of sight.
 *  Going to the background, a workout under way gets its clock and a running rest timer its countdown and alarm, the
 *  two apart, so the rest ending never takes the workout down with it: Android takes the countdown down at zero by
 *  itself and the workout's clock is still there under it. Coming back cancels all of it, since in front the page
 *  shows both and says "Rest over" itself (an alarm as well would sound a second alert just before the page took it
 *  down). Nothing is kept from while it was in front, so going to the background always sends afresh: a timer
 *  started before notifications were allowed gets its alert too. A timer that ends in the background is left as it
 *  was sent, to the alarm, which fires at the same moment and says "Rest over" there, since that's where you'll see
 *  it; sending again would cancel that alarm before it rang. */
export function syncOngoingNotifications(store: GymStore): () => void {
  let active = true;
  // What was last sent of each, keyed on what should be showing, so an unrelated store change (sync finishing, say)
  // doesn't send again what's already exactly right: "" for nothing, null before the first pass, which always
  // cancels, so opening the app takes down whatever an earlier run left scheduled or showing.
  let workout: string | null = null, rest: string | null = null;
  const apply = () => {
    if (workout === null || rest === null || (active && (workout || rest))) {
      workout = rest = "";
      void RestTimer.cancel();
    }
    if (active) return;
    const w = workoutUnderWay(store), r = store.rest, samsungCard = samsungCardPref();
    const wantWorkout = w ? JSON.stringify([w.title, w.text, w.chip, w.since, samsungCard]) : "";
    const wantRest = !r || r.pausedAt != null ? "" : r.ended ? rest : `${r.lift}|${r.endAt}|${samsungCard}`;
    // The workout first: Android ranks the newer of two Live Updates first, and while resting that's the countdown.
    if (wantWorkout !== workout) {
      workout = wantWorkout;
      void (w ? RestTimer.workout({ ...w, samsungCard }) : RestTimer.cancelWorkout());
    }
    if (wantRest !== rest) {
      rest = wantRest;
      void (wantRest && r ? RestTimer.schedule({ lift: r.lift, endAt: r.endAt, next: afterRest(store, r), samsungCard }) : RestTimer.cancelRest());
    }
  };
  const stop = store.subscribe(apply);
  // The clock changes outside the store (started, paused, finished): workout.ts tells of those itself.
  const stopRun = onRunChange(apply);
  let heard = false;
  const state = App.addListener("appStateChange", ({ isActive }) => {
    heard = true;
    active = isActive;
    apply();
  });
  apply();
  // Already in the background by the time this runs (the app opened, then the phone locked straight away): Android's
  // word for that came before anything was listening for it. Any word heard since is newer than this answer.
  void App.getState().then(({ isActive }) => {
    if (isActive || heard) return;
    active = false;
    apply();
  });
  return () => {
    stop();
    stopRun();
    void state.then((h) => h.remove());
  };
}
