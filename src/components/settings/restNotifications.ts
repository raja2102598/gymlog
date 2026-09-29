/* Settings → Rest timer & effort, in the Android app: the "Rest timer notifications" row, and under it, once
 * notifications are on, whether "Rest over" will be on time and whether Live Updates are allowed (on a Samsung, how
 * the Now Bar shows Gym Log instead). What they say, and reading Android's answers again whenever the app comes back to
 * the front, apart from React so they're tested on their own (tests/unit/rest.test.ts). The rows themselves are
 * RestNotifications, in SettingsView.tsx. */
import type { PermissionState } from "@capacitor/core";
import type { AlarmChecks } from "@/native/rest";

// Loaded only in the Android app, so the website doesn't carry the plugin.
const native = () => import("@/native/app");
type Checks = Pick<typeof import("@/native/app"), "notificationPermission" | "checkAlarms" | "isSamsungPhone" | "onAppResume">;

/** What Android says: whether Gym Log may notify at all (notificationPermission), the rest (checkAlarms), null when
 *  the phone couldn't say, and whether it's a Samsung (isSamsungPhone). */
export interface RestNotifs {
  permission: PermissionState;
  alarms: AlarmChecks | null;
  samsung: boolean;
}

/**
 * Reads what Android allows as the rows open, and again each time the app comes back to the front: from Android's
 * own settings, where each of these is changed, and where the rows' buttons go. Only the newest reading shows, so one
 * that answers late never puts back what was true before. Whether it's a Samsung never changes, so that's asked once.
 * `load` is the Android app's native module. Returns the stop.
 */
export function watchRestNotifs(set: (s: RestNotifs) => void, load: () => Promise<Checks> = native): () => void {
  let live = true, asked = 0;
  let unsub: (() => void) | undefined;
  const isSamsung = load()
    .then((m) => m.isSamsungPhone())
    .catch(() => false);
  const check = () => {
    const n = ++asked;
    void load()
      .then((m) => Promise.all([m.notificationPermission(), m.checkAlarms().catch(() => null), isSamsung]))
      .then(([permission, alarms, samsung]) => {
        if (live && n === asked) set({ permission, alarms, samsung });
      })
      .catch(() => {});
  };
  check();
  void load().then((m) => {
    if (live) unsub = m.onAppResume(check);
  });
  return () => {
    live = false;
    unsub?.();
  };
}

/** A row under "Rest timer notifications": its title, what it says, and whether it offers Android's page for it
 *  ("Open settings"). */
export interface AlarmRow {
  title: string;
  text: string;
  open: boolean;
}

const EXACT_ON = "On. “Rest over” comes the moment your rest ends.";
const EXACT_OFF = "Off, so “Rest over” can come a few minutes late while your phone is idle. Turn it on to get it on time.";
const LIVE_ON = "On. Your workout’s clock and rest countdown stay at the top of the lock screen.";
const LIVE_OFF = "Off. Turn them on to keep your workout’s clock and rest countdown at the top of the lock screen.";
const NOW_BAR = "Samsung shows your workout’s clock and rest countdown in the Now Bar with Developer options → Live notifications for all apps on.";

/**
 * The rows under "Rest timer notifications": Alarms & reminders, which says whether "Rest over" will be on time
 * (Android 12 and later), and Live Updates (Android 16 and later), each offering Android's page while it's off. Each
 * only where the phone's Android has the setting, and neither while notifications are off: the row above asks for
 * those first, and without them there's no "Rest over" or Live Update to speak of. On a Samsung, Android's answer on
 * Live Updates is "no" even while the Now Bar shows Gym Log, so there the row is the Now Bar's instead: the switch
 * that shows Gym Log there, whatever Android says, and always a way to Developer options, since Gym Log can't read
 * that switch.
 */
export function alarmRows({ permission, alarms, samsung }: RestNotifs): { exact: AlarmRow | null; live: AlarmRow | null } {
  if (permission !== "granted" || !alarms) return { exact: null, live: null };
  const { exact, liveUpdates } = alarms;
  return {
    exact: exact == null ? null : { title: "Alarms & reminders", text: exact ? EXACT_ON : EXACT_OFF, open: !exact },
    live:
      liveUpdates == null
        ? null
        : samsung
          ? { title: "Now Bar", text: NOW_BAR, open: true }
          : { title: "Live Updates", text: liveUpdates ? LIVE_ON : LIVE_OFF, open: !liveUpdates },
  };
}
