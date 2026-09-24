/* The Android app updating itself (src/native/update.ts talks to the app's own AppUpdate plugin, which checks
 * GitHub's releases). What's here doesn't need the plugin, the DOM or a network call, so it's plain to unit test
 * (tests/unit/update.test.ts): whether it's been long enough to check again, the words Settings and the quiet
 * notice both say, and remembering a check or a dismissed notice on this device, like the theme and the voice
 * switch (lib/storage.ts). */
import { lsGet, lsSet } from "./storage";

/** How often the app checks on its own, quietly, when it opens. Settings' "Check for updates" ignores this. */
export const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** Whether it's been long enough since `lastCheckedAt` (0: never) to check again, as of `now`. */
export const shouldCheckNow = (lastCheckedAt: number, now: number): boolean => now - lastCheckedAt >= CHECK_INTERVAL_MS;

/** "18.7 MB": a download's size in words, not bytes. */
export const formatMB = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** What Settings and the quiet notice both say once a newer build is found. */
export const availableMessage = (name: string, sizeBytes: number): string => `Version ${name} is available (${formatMB(sizeBytes)}).`;

/** How far a download has got, 0 to 100. 0 while the total isn't known yet, so it never divides by zero. */
export const downloadPercent = (received: number, total: number): number => (total > 0 ? Math.min(100, Math.max(0, Math.round((received / total) * 100))) : 0);

/** "Downloading… 45%" */
export const downloadingMessage = (received: number, total: number): string => `Downloading… ${downloadPercent(received, total)}%`;

/** Whether the quiet notice should show: a newer build than the one last dismissed (or nothing dismissed yet). */
export const shouldShowUpdateNotice = (latestCode: number | undefined, dismissedCode: number): boolean => latestCode != null && latestCode > dismissedCode;

/* ---------- remembered on this device ---------- */

const LAST_CHECK_KEY = "gymlog.update.lastcheck.v1";
const DISMISSED_KEY = "gymlog.update.dismissed.v1";

/** When the app last checked on its own (ms since the epoch, 0 if never). */
export const lastCheckedAt = (): number => lsGet<number>(LAST_CHECK_KEY, 0);
export const setLastCheckedAt = (at: number): void => void lsSet(LAST_CHECK_KEY, at);

/** The versionCode of the newest build the quiet notice was dismissed for (0: none dismissed yet). */
export const dismissedUpdateCode = (): number => lsGet<number>(DISMISSED_KEY, 0);
export const setDismissedUpdateCode = (code: number): void => void lsSet(DISMISSED_KEY, code);
