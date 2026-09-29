/* Settings → Rest timer & effort, in the Android app: the "Rest timer notifications" row, and under it, once
 * notifications are on, whether "Rest over" will be on time and whether Live Updates are allowed. What they say, and
 * reading Android's answers again whenever the app comes back to the front, apart from React so they're tested on
 * their own (tests/unit/rest.test.ts). The rows themselves are RestNotifications, in SettingsView.tsx. */
import type { PermissionState } from "@capacitor/core";
import type { AlarmChecks } from "@/native/rest";

// Loaded only in the Android app, so the website doesn't carry the plugin.
const native = () => import("@/native/app");
type Checks = Pick<typeof import("@/native/app"), "notificationPermission" | "checkAlarms" | "onAppResume">;

/** What Android says: whether Gym Log may notify at all (notificationPermission), and the rest (checkAlarms), null
 *  when the phone couldn't say. */
export interface RestNotifs {
  permission: PermissionState;
  alarms: AlarmChecks | null;
}

/**
 * Reads what Android allows as the rows open, and again each time the app comes back to the front: from Android's
 * own settings, where each of these is changed, and where the rows' buttons go. Only the newest reading shows, so one
 * that answers late never puts back what was true before. `load` is the Android app's native module. Returns the stop.
 */
export function watchRestNotifs(set: (s: RestNotifs) => void, load: () => Promise<Checks> = native): () => void {
  let live = true, asked = 0;
  let unsub: (() => void) | undefined;
  const check = () => {
    const n = ++asked;
    void load()
      .then((m) => Promise.all([m.notificationPermission(), m.checkAlarms().catch(() => null)]))
      .then(([permission, alarms]) => {
        if (live && n === asked) set({ permission, alarms });
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

/** A row under "Rest timer notifications": whether what it's about is on, and what it says. Off, it offers Android's
 *  page to turn it on. */
export interface AlarmRow {
  on: boolean;
  text: string;
}

const EXACT_ON = "On. “Rest over” comes the moment a rest ends, even with the phone locked.";
const EXACT_OFF = "Off, so “Rest over” can come a few minutes late while the phone is idle. Turn it on to get it on time.";
const LIVE_ON = "On. Your workout’s clock and rest countdown stay at the top of the lock screen.";
const LIVE_OFF = "Off. Turn them on to keep your workout’s clock and rest countdown at the top of the lock screen.";
const NOW_BAR = "Samsung’s Now Bar shows them only with Developer options → Live notifications for all apps on.";

/**
 * The rows under "Rest timer notifications": Alarms & reminders, which says whether "Rest over" will be on time
 * (Android 12 and later), and Live Updates (Android 16 and later), with a line about Samsung's Now Bar on a Samsung
 * phone. Each only where the phone's Android has the setting, and neither while notifications are off: the row above
 * asks for those first, and without them there's no "Rest over" or Live Update to speak of.
 */
export function alarmRows({ permission, alarms }: RestNotifs): { exact: AlarmRow | null; live: AlarmRow | null } {
  if (permission !== "granted" || !alarms) return { exact: null, live: null };
  const { exact, liveUpdates, samsung } = alarms;
  return {
    exact: exact == null ? null : { on: exact, text: exact ? EXACT_ON : EXACT_OFF },
    live: liveUpdates == null ? null : { on: liveUpdates, text: [liveUpdates ? LIVE_ON : LIVE_OFF, samsung ? NOW_BAR : ""].filter(Boolean).join(" ") },
  };
}
