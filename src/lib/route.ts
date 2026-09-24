/* Where the app is: one of four tabs, a metric's page under Health, or the plan editor. Each has an address
 * (#health/sleep), so any screen opens from a link and the phone's Back button walks back the way you came:
 * a page to its tab, a tab to Today, Today out of the app. */

export const TABS = ["today", "health", "progress", "settings"] as const;
export type Tab = (typeof TABS)[number];

/** The Health tab's pages, one per kind of data. */
export const METRICS = ["steps", "sleep", "heart", "energy", "exercise", "body", "water"] as const;
export type Metric = (typeof METRICS)[number];

export interface Route {
  view: Tab | "plan";
  metric?: Metric;
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
  return { view: "today" };
}

export const hashOf = (r: Route): string => (r.view === "today" ? "" : r.metric ? `#health/${r.metric}` : `#${r.view}`);
export const sameRoute = (a: Route, b: Route) => a.view === b.view && a.metric === b.metric;

/** How deep a route sits: Today 0, the other tabs 1, a metric's page or the plan editor 2. */
export const depthOf = (r: Route): number => (r.view === "today" ? 0 : r.metric || r.view === "plan" ? 2 : 1);

/** The tab a route belongs to, lit in the tab bar. The plan editor opens from Settings. */
export const tabOf = (r: Route): Tab => (r.view === "plan" ? "settings" : r.view);

/** Where a page's back arrow goes when there's no history to go back through (it was opened from a link). */
export const parentOf = (r: Route): Route => (r.metric ? { view: "health" } : r.view === "plan" ? { view: "settings" } : { view: "today" });
