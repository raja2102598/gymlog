/* Gym Log's Wear OS app, from the phone (docs/watch.md), through the app's own Watch plugin (WatchPlugin.kt): the
 * workout as lib/watch.ts builds it goes to the watch as the `/gymlog/state` data item whenever it changes, and what
 * was done on the watch comes back as commands, which the plugin's listener service keeps while the app is closed.
 * Each is applied here once, in the order it was done, whether or not the workout is on screen, and its id goes back
 * in `applied` so the watch stops showing it as its own. A real account's only, never the demo's. */
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { lsGet, lsSet } from "@/lib/storage";
import type { GymStore } from "@/lib/store";
import { applyWatchCommand, watchState, type WatchCommand } from "@/lib/watch";
import { onRunChange } from "@/lib/workout";
import { onAppResume } from "./update";

interface WatchPlugin {
  /** Replaces `/gymlog/state` with this JSON, urgently. */
  publish(o: { json: string }): Promise<void>;
  /** The watch's commands not yet acked, taking in first any the listener service missed. */
  pending(): Promise<{ commands: WatchCommand[] }>;
  /** Forgets these commands, and deletes their data items. */
  ack(o: { ids: string[] }): Promise<void>;
  /** "command": more arrived while the app is running, for pending(). */
  addListener(eventName: "command", fn: () => void): Promise<PluginListenerHandle>;
}

const Watch = registerPlugin<WatchPlugin>("Watch");

/** The ids of the watch's commands applied on this phone, the latest last: the watch's own list of what's been done
 *  (`applied`), and what keeps one from being applied twice. */
export const WATCH_KEY = "gymlog.watch.v1";
/** How many ids `applied` keeps (docs/watch.md): as many as the plugin's queue holds (WatchLogic.kt, QUEUE_MAX) and the
 *  watch keeps waiting (OverlayLogic.kt, KEPT), so every command taken from it is listed until the watch has seen it,
 *  however many were taken before the watch next heard from the phone. The state stays well within a data item's
 *  100 KB with all of them (the watch's ids are 18 characters). */
export const APPLIED_KEPT = 1000;
/** How long a change waits to be sent, so a burst of them (a set's digits going in, commands being applied) goes as one. */
export const PUBLISH_MS = 1500;
/** How long an applied command stays with the plugin before it's acked: the phone's storage keeps what was changed
 *  after a moment rather than at once, so were Android to kill the app straight after, the command is still there
 *  to apply next time, rather than gone with the change it made. */
export const ACK_MS = 10_000;

/** Keeps the watch current, and applies what's done on it: on start, on every change to the store or the workout's
 *  clock, coming back to the app, every few minutes so a new day shows, and whenever the plugin says commands have
 *  arrived. Returns a function that stops it. */
export function startWatch(store: GymStore): () => void {
  const kept = lsGet<{ applied?: unknown }>(WATCH_KEY, {}).applied;
  let applied = Array.isArray(kept) ? kept.filter((id): id is string => typeof id === "string").slice(-APPLIED_KEPT) : [];
  let live = true;
  /** What the watch was last sent, less its sentAt, or null when unknown (none yet, or the plugin failed to send it). */
  let sent: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const real = () => store.auth === "signedIn" && !store.demo;

  const publish = () => {
    clearTimeout(timer);
    timer = undefined;
    // Signed out, the watch is told to sign in on the phone. Not before the account is known, or for the demo.
    if (!live || (!real() && store.auth !== "signedOut")) return;
    const state = watchState(store, applied), key = JSON.stringify({ ...state, sentAt: 0 });
    if (key === sent) return;
    sent = key;
    void Watch.publish({ json: JSON.stringify(state) }).catch(() => {
      if (sent === key) sent = null;
    });
  };
  const soon = () => {
    if (live && timer === undefined) timer = setTimeout(publish, PUBLISH_MS);
  };

  // Commands wait for the account's days to load (a day finished on another phone counts), as the workout's own
  // clock does on reopening (GymLog.tsx).
  const ready = () => live && real() && !store.firstLoad;
  let applying = false, again = false;
  const apply = async () => {
    if (applying) {
      again = true;
      return;
    }
    applying = true;
    try {
      do {
        again = false;
        if (!ready()) return;
        const { commands } = await Watch.pending();
        if (!ready()) return;
        const done = new Set(applied), ids: string[] = [];
        // In the order they were done on the watch, each once: one applied already is only acked again (its ack
        // hadn't landed yet, or didn't).
        for (const c of [...commands].sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))) {
          if (typeof c?.id !== "string" || ids.includes(c.id)) continue;
          ids.push(c.id);
          if (done.has(c.id)) continue;
          applyWatchCommand(store, c);
          applied.push(c.id);
        }
        if (!ids.length) continue;
        applied = applied.slice(-APPLIED_KEPT);
        lsSet(WATCH_KEY, { applied });
        publish();
        setTimeout(() => void Watch.ack({ ids }).catch(() => {}), ACK_MS);
      } while (again);
    } catch {
      // The plugin failed to answer: the commands wait there for the next try.
    } finally {
      applying = false;
    }
  };

  let wasReady = false;
  const changed = () => {
    soon();
    const now = ready();
    if (now && !wasReady) void apply();
    wasReady = now;
  };
  const stopStore = store.subscribe(changed);
  const stopRun = onRunChange(soon);
  const stopResume = onAppResume(() => {
    soon();
    void apply();
  });
  const heard = Watch.addListener("command", () => void apply());
  const tick = setInterval(soon, 5 * 60_000);
  changed();
  return () => {
    live = false;
    stopStore();
    stopRun();
    stopResume();
    clearInterval(tick);
    clearTimeout(timer);
    void heard.then((h) => h.remove());
  };
}
