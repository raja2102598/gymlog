/* Where the app is: one of four tabs (Home, Train, Progress, Health), or a screen pushed over them: Settings (from
 * the avatar on Home), a metric's page under Health, a lift's page under Progress, the plan editor, My gym, and the
 * active workout with its Workout complete screen. Each has an address (#health/sleep, #progress/lift/Leg Press,
 * #workout), so any screen opens from a link and the phone's Back button walks back the way you came. */

export const TABS = ["home", "train", "progress", "health"] as const;
export type Tab = (typeof TABS)[number];

/** The Health tab's pages, one per kind of data. */
export const METRICS = ["steps", "sleep", "heart", "energy", "exercise", "body", "water"] as const;
export type Metric = (typeof METRICS)[number];

export interface Route {
  view: Tab | "settings" | "plan" | "gym" | "workout";
  metric?: Metric;
  /** A lift's own page, under Progress; its name, as logged or planned. */
  lift?: string;
  /** The workout's summary, once it's finished. */
  done?: boolean;
}

export function routeOf(hash: string): Route {
  const h = hash.replace(/^#/, "");
  if (h === "plan") return { view: "plan" };
  if (h === "gym") return { view: "gym" };
  if (h === "train" || h === "today") return { view: "train" };
  if (h === "workout") return { view: "workout" };
  if (h === "workout/done") return { view: "workout", done: true };
  // #dashboard is the address Progress had before it was a tab.
  if (h === "progress" || h === "dashboard") return { view: "progress" };
  if (h === "settings") return { view: "settings" };
  if (h === "health") return { view: "health" };
  const m = /^health\/([a-z]+)$/.exec(h);
  if (m && (METRICS as readonly string[]).includes(m[1])) return { view: "health", metric: m[1] as Metric };
  const l = /^progress\/lift\/(.+)$/.exec(h);
  if (l) {
    // A link mangled by hand (a stray "%") can't be decoded: open Progress rather than fail to start.
    try {
      return { view: "progress", lift: decodeURIComponent(l[1]) };
    } catch {
      return { view: "progress" };
    }
  }
  return { view: "home" };
}

export const hashOf = (r: Route): string =>
  r.view === "home"
    ? ""
    : r.metric
      ? `#health/${r.metric}`
      : r.lift
        ? `#progress/lift/${encodeURIComponent(r.lift)}`
        : r.done
          ? "#workout/done"
          : `#${r.view}`;
export const sameRoute = (a: Route, b: Route) => a.view === b.view && a.metric === b.metric && a.lift === b.lift && !!a.done === !!b.done;

/** How deep a route sits: Home 0, the other tabs and Settings 1, a metric's or lift's page, the plan editor, My gym
 *  and the workout 2. */
export const depthOf = (r: Route): number =>
  r.view === "home" ? 0 : r.metric || r.lift || r.view === "plan" || r.view === "gym" || r.view === "workout" ? 2 : 1;

/** A screen pushed over the tabs: a back chevron, and no tab bar. */
export const isPushed = (r: Route): boolean => r.view === "settings" || depthOf(r) === 2;

/** The tab a route belongs to, lit in the tab bar. The plan editor, My gym and the workout open from Train;
 *  Settings from Home. */
export const tabOf = (r: Route): Tab => (r.view === "plan" || r.view === "gym" || r.view === "workout" ? "train" : r.view === "settings" ? "home" : r.view);

/** Where a page's back chevron goes when there's no history to go back through (it was opened from a link). */
export const parentOf = (r: Route): Route =>
  r.metric
    ? { view: "health" }
    : r.lift
      ? { view: "progress" }
      : r.view === "plan" || r.view === "gym" || r.view === "workout"
        ? { view: "train" }
        : { view: "home" };
