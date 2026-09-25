/* The home-screen widget (android/.../GymWidgetProvider.kt): a small JSON of today's session and lift progress,
 * written through this plugin whenever they change, so the widget can show them without opening the app. Taps on
 * it open the app the same way a sign-in link does (native.ts's NATIVE_GO, app.ts's appUrlOpen listener).
 * restEndsAt is for the rest timer, a later issue: always null until it exists, so its JSON won't need to change
 * shape when it does. */
import { registerPlugin } from "@capacitor/core";
import { todayKey } from "@/lib/dates";
import type { GymStore } from "@/lib/store";
import { onAppResume } from "./update";

interface WidgetSnapshot {
  date: string;
  session: string;
  done: number;
  planned: number;
  restEndsAt: string | null;
}

interface WidgetPlugin {
  update(snapshot: WidgetSnapshot): Promise<void>;
  clear(): Promise<void>;
}

const Widget = registerPlugin<WidgetPlugin>("GymWidget");

let lastWritten = "";

// Today's session and lift progress, counted the way Today counts a lift done (SessionCard.tsx's LiftPill).
function snapshotOf(store: GymStore): WidgetSnapshot {
  const date = todayKey(), p = store.planFor(date), e = store.entry(date);
  const done = p.exercises.filter((x) => e.exercises[x.name]?.done).length;
  return { date, session: p.name, done, planned: p.exercises.length, restEndsAt: null };
}

/** Writes today's session and progress, if they've changed since the last write. */
function writeWidget(store: GymStore): void {
  if (store.auth !== "signedIn") return;
  const snapshot = snapshotOf(store), key = JSON.stringify(snapshot);
  if (key === lastWritten) return;
  lastWritten = key;
  void Widget.update(snapshot).catch(() => {});
}

/** Keeps the widget current: right away, on every change to the store (a set logged, a lift ticked, health data
 *  arriving), coming back to the app, and every few minutes so a new day shows up even with the app merely open. */
export function startWidget(store: GymStore): void {
  writeWidget(store);
  store.subscribe(() => writeWidget(store));
  onAppResume(() => writeWidget(store));
  setInterval(() => writeWidget(store), 5 * 60_000);
}

/** Signing out: nothing left to show until someone signs in again. */
export function clearWidget(): void {
  lastWritten = "";
  void Widget.clear().catch(() => {});
}
