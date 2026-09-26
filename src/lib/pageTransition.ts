/* Moving between screens, animated the way Android apps do it: a page opened deeper (Settings, a metric, a lift, the
 * workout) slides in from the right, Back slides it out to the right again, and switching tabs crossfades. It uses the
 * browser's view transitions, which animate snapshots of the two screens on the GPU, so the new screen is built once,
 * off to the side, rather than animated while React builds it. Where the browser has none, or Reduce motion is on,
 * the screen just changes (the styles are in shell.css). */
import { flushSync } from "react-dom";
import { depthOf, type Route } from "./route";

export type NavDirection = "forward" | "back" | "across";

/** Which way a move goes: deeper, back out, or across the tabs (Home one of them, though it sits under the rest). */
export const directionOf = (from: Route, to: Route): NavDirection => {
  const a = depthOf(from), b = depthOf(to);
  return a <= 1 && b <= 1 ? "across" : b > a ? "forward" : b < a ? "back" : "across";
};

type WithTransitions = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };
/** The latest move: a quick second tap starts its own transition (the browser skips the first), and only the
 *  latest takes data-nav off when it's done. */
let latest = 0;

/** Whether the browser can run the transitions; says so on <html> as data-vt, where screens then change by these
 *  alone and not also by their own fade-in (shell.css). */
export function canMoveScreens(doc: WithTransitions | undefined = typeof document === "undefined" ? undefined : document): boolean {
  const can = !!doc && typeof doc.startViewTransition === "function";
  if (can) doc.documentElement.dataset.vt = "";
  return can;
}

/** Runs `update` (the state change that shows the new screen) inside a view transition going `dir`, or straight
 *  away with none (null: a change that doesn't start from one of the app's screens, the plan picker's, say), where
 *  the browser has none, or with Reduce motion on. The direction goes on <html> as data-nav for the styles, and
 *  comes off after. */
export function moveScreens(dir: NavDirection | null, update: () => void, doc: WithTransitions | undefined = typeof document === "undefined" ? undefined : document): void {
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!dir || !doc || typeof doc.startViewTransition !== "function" || reduce) {
    update();
    return;
  }
  const root = doc.documentElement, n = ++latest;
  root.dataset.nav = dir;
  const t = doc.startViewTransition(() => flushSync(update));
  void t.finished.finally(() => {
    if (n === latest) delete root.dataset.nav;
  });
}
