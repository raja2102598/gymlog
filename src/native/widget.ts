/* The home-screen widget (android/.../GymWidgetProvider.kt): a small JSON of today's session and lift progress, or
 * while a workout is under way that workout's, whatever day it's for, written through this plugin whenever they
 * change, so the widget can show them without opening the app. Taps on it open the app the same way a sign-in link
 * does (native.ts's NATIVE_GO, app.ts's appUrlOpen listener). restEndsAt is when a running rest timer ends
 * (store.ts's rest), and workoutSince when the workout under way would have started with no pauses (lib/session.ts's
 * workoutUnderWay), or null: the widget's clock ticks from them on its own, counting the rest down, or else the
 * workout up. */
import { registerPlugin } from "@capacitor/core";
import { todayKey } from "@/lib/dates";
import { workoutUnderWay } from "@/lib/session";
import type { GymStore } from "@/lib/store";
import { currentRun, onRunChange } from "@/lib/workout";
import { onAppResume } from "./update";

interface WidgetSnapshot {
  /** The day it's of: today, or the workout under way's, which can be a day gone by. The widget shows another day's
   *  only while workoutSince says its workout is still counting, and "Open Gym Log" after (GymWidgetLogic.isCurrent),
   *  so it never takes a day that's passed for today, even with the app no longer running to write today's. */
  date: string;
  session: string;
  done: number;
  planned: number;
  restEndsAt: string | null;
  workoutSince: string | null;
  /** Today's workout skipped (Skip day), which the widget says instead of "0/5 lifts". */
  skipped: boolean;
}

interface WidgetPlugin {
  update(snapshot: WidgetSnapshot): Promise<void>;
  clear(): Promise<void>;
}

const Widget = registerPlugin<WidgetPlugin>("GymWidget");

/** What the widget was last given: a snapshot's JSON, "" once cleared, or null when unknown (before either, this
 *  run, or after a call to the plugin failed, so the next change, resume or tick tries again). */
let lastWritten: string | null = null;

// A day's session and lift progress, counted the way Today counts a lift done (SessionCard.tsx's LiftPill): the
// workout under way's day, whichever it is, as the lock screen follows it (native/rest.ts), so one started at 23:40
// keeps its session, progress and clock past midnight, as does one opened for a day gone by. Otherwise today's: a
// clock paused, finished or left behind isn't under way (liveWorkout has the rules).
function snapshotOf(store: GymStore): WidgetSnapshot {
  const w = workoutUnderWay(store), run = currentRun(), date = w && run ? run.day : todayKey();
  const p = store.planFor(date), e = store.entry(date);
  const done = p.exercises.filter((x) => e.exercises[x.name]?.done).length;
  // A running rest timer's end, and a workout under way's start: the widget's clock counts down to the one, or up
  // from the other. Not a paused clock of either kind, which isn't counting.
  const r = store.rest, resting = r && r.pausedAt == null && !r.ended;
  return {
    date,
    session: p.name,
    done,
    planned: p.exercises.length,
    restEndsAt: resting ? new Date(r.endAt).toISOString() : null,
    workoutSince: w ? new Date(w.since).toISOString() : null,
    skipped: e.skip != null,
  };
}

/** Writes the day's session and progress (snapshotOf), if they've changed since the last write. Signed out, however
 *  that came about (Sign out, or a session that expired or was revoked), it clears the widget instead. */
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
 *  arriving, signing out) or to the workout's clock, coming back to the app, and every few minutes so a new day, or
 *  today's session once a workout from another day is left behind, shows up even with the app merely open. */
export function startWidget(store: GymStore): void {
  writeWidget(store);
  store.subscribe(() => writeWidget(store));
  onRunChange(() => writeWidget(store));
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
