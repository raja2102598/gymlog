/* The Android app's plugins, answering as the app would, for the tests of src/native. A test file mocks the modules
 * with them, before its imports:
 *
 *   vi.mock("@capacitor/core", async () => (await import("./nativeMocks")).capacitorCore);
 *   vi.mock("@capgo/capacitor-health", async () => ({ Health: (await import("./nativeMocks")).health }));
 *   vi.mock("@capacitor/app", async () => ({ App: (await import("./nativeMocks")).app }));
 *
 * and imports the ones it drives from here. Each test file gets its own copy. */
import { vi } from "vitest";

/** The Health plugin (Health Connect). */
export const health = {
  isAvailable: vi.fn(),
  checkAuthorization: vi.fn(),
  requestAuthorization: vi.fn(),
  queryAggregated: vi.fn(),
  readSamples: vi.fn(),
  queryWorkouts: vi.fn(),
};

type AppEvent = { url?: string; isActive?: boolean };
const listeners: Record<string, ((e: AppEvent) => void)[]> = {};
/** Capacitor's App plugin. `fire` tells every listener for an event (appUrlOpen, resume, appStateChange), as Android
 *  does. */
export const app = {
  fire: (name: string, e: AppEvent = {}) => (listeners[name] ?? []).forEach((f) => f(e)),
  /** Drops every listener, so a test's app starts afresh. */
  forget: () => Object.keys(listeners).forEach((k) => delete listeners[k]),
  getLaunchUrl: vi.fn(),
  addListener: vi.fn(async (name: string, fn: (e: AppEvent) => void) => {
    (listeners[name] ??= []).push(fn);
    return { remove: async () => void (listeners[name] = listeners[name].filter((f) => f !== fn)) };
  }),
};

/** GymSync, for background sync. */
export const gymSync = {
  status: vi.fn(),
  requestBackground: vi.fn(),
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
  runNow: vi.fn(async () => {}),
  running: vi.fn(async () => ({ running: false })),
};
/** GoogleSignIn: Android's account sheet, answering with Google's ID token. */
export const googleSignIn = { signIn: vi.fn() };
/** Speech, for voice logging: this phone can listen. */
export const speech = { available: vi.fn(async () => ({ available: true })) };
/** GymWidget, the home-screen widget. */
export const widget = { update: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
/** RestTimer: the rest timer's alarm and notification while the app is in the background. */
export const restTimer = { schedule: vi.fn(async () => {}), cancel: vi.fn(async () => {}) };

type Progress = { received: number; total: number };
const progressListeners = new Set<(p: Progress) => void>();
let end: { resolve: () => void; reject: (e: Error) => void } = { resolve: () => {}, reject: () => {} };
/** AppUpdate: a download that lasts until the test ends it with `finish` or `fail`, with `progress` on the way. */
export const appUpdate = {
  listeners: progressListeners,
  progress: (p: Progress) => progressListeners.forEach((f) => f(p)),
  finish: () => end.resolve(),
  fail: (e: Error) => end.reject(e),
  download: vi.fn(() => new Promise<void>((resolve, reject) => void (end = { resolve, reject }))),
  addListener: vi.fn(async (_: string, fn: (p: Progress) => void) => {
    progressListeners.add(fn);
    return { remove: async () => void progressListeners.delete(fn) };
  }),
};

const plugins: Record<string, unknown> = { GoogleSignIn: googleSignIn, Speech: speech, AppUpdate: appUpdate, GymWidget: widget, RestTimer: restTimer, GymSync: gymSync };
/** @capacitor/core: each plugin by its name. */
export const capacitorCore = {
  registerPlugin: (name: string) => plugins[name] ?? gymSync,
  SystemBars: { setStyle: vi.fn() },
  SystemBarsStyle: { Dark: "DARK", Light: "LIGHT", Default: "DEFAULT" },
};
