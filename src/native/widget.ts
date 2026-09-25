/* The home-screen widget (android/.../GymWidgetProvider.kt): a small JSON of today's session and lift progress,
 * written through this plugin whenever they change, so the widget can show them without opening the app. Taps on
 * it open the app the same way a sign-in link does (native.ts's NATIVE_GO, app.ts's appUrlOpen listener).
 * restEndsAt is when a running rest timer ends (store.ts's rest), or null. */
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

/** What the widget was last given: a snapshot's JSON, "" once cleared, or null when unknown (before either, this
 *  run, or after a call to the plugin failed, so the next change, resume or tick tries again). */
let lastWritten: string | null = null;

// Today's session and lift progress, counted the way Today counts a lift done (SessionCard.tsx's LiftPill).
function snapshotOf(store: GymStore): WidgetSnapshot {
  const date = todayKey(), p = store.planFor(date), e = store.entry(date);
  const done = p.exercises.filter((x) => e.exercises[x.name]?.done).length;
  // A running rest timer's end, which the widget shows as "rest until 10:32", since it can't tick every second.
  const r = store.rest, resting = r && r.pausedAt == null && !r.ended;
  return { date, session: p.name, done, planned: p.exercises.length, restEndsAt: resting ? new Date(r.endAt).toISOString() : null };
}

/** Writes today's session and progress, if they've changed since the last write. Signed out, however that came
 *  about (Sign out, or a session that expired or was revoked), it clears the widget instead. */
function writeWidget(store: GymStore): void {
  if (store.auth === "signedOut") {
    if (lastWritten !== "") clearWidget();
    return;
  }
  // Not the demo's sample data: the widget is for a real account's day.
  if (store.auth !== "signedIn" || store.demo) return;
  const snapshot = snapshotOf(store), key = JSON.stringify(snapshot);
  if (key === lastWritten) return;
  lastWritten = key;
  void Widget.update(snapshot).catch(() => {
    if (lastWritten === key) lastWritten = null;
  });
}

/** Keeps the widget current: right away, on every change to the store (a set logged, a lift ticked, health data
 *  arriving, signing out), coming back to the app, and every few minutes so a new day shows up even with the app
 *  merely open. */
export function startWidget(store: GymStore): void {
  writeWidget(store);
  store.subscribe(() => writeWidget(store));
  onAppResume(() => writeWidget(store));
  setInterval(() => writeWidget(store), 5 * 60_000);
}

/** Signed out: nothing left to show until someone signs in again. */
function clearWidget(): void {
  lastWritten = "";
  void Widget.clear().catch(() => {
    if (lastWritten === "") lastWritten = null;
  });
}
