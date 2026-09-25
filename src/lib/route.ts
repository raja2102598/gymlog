/* Where the app is: one of four tabs, a metric's page under Health, a lift's page under Progress, or the plan
 * editor. Each has an address (#health/sleep, #progress/lift/Leg Press), so any screen opens from a link and the
 * phone's Back button walks back the way you came: a page to its tab, a tab to Today, Today out of the app. */

export const TABS = ["today", "health", "progress", "settings"] as const;
export type Tab = (typeof TABS)[number];

/** The Health tab's pages, one per kind of data. */
export const METRICS = ["steps", "sleep", "heart", "energy", "exercise", "body", "water"] as const;
export type Metric = (typeof METRICS)[number];

export interface Route {
  view: Tab | "plan";
  metric?: Metric;
  /** A lift's own page, under Progress; its name, as logged or planned. */
  lift?: string;
}

export function routeOf(hash: string): Route {
  const h = hash.replace(/^#/, "");
  if (h === "plan") return { view: "plan" };
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
  return { view: "today" };
}

export const hashOf = (r: Route): string =>
  r.view === "today" ? "" : r.metric ? `#health/${r.metric}` : r.lift ? `#progress/lift/${encodeURIComponent(r.lift)}` : `#${r.view}`;
export const sameRoute = (a: Route, b: Route) => a.view === b.view && a.metric === b.metric && a.lift === b.lift;

/** How deep a route sits: Today 0, the other tabs 1, a metric's or lift's page or the plan editor 2. */
export const depthOf = (r: Route): number => (r.view === "today" ? 0 : r.metric || r.lift || r.view === "plan" ? 2 : 1);

/** The tab a route belongs to, lit in the tab bar. The plan editor opens from Settings. */
export const tabOf = (r: Route): Tab => (r.view === "plan" ? "settings" : r.view);

/** Where a page's back arrow goes when there's no history to go back through (it was opened from a link). */
export const parentOf = (r: Route): Route => (r.metric ? { view: "health" } : r.lift ? { view: "progress" } : r.view === "plan" ? { view: "settings" } : { view: "today" });
