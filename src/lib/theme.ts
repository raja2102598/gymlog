/* Light or dark: the phone's setting, or one picked in Settings. Kept on this device only, and applied before the
 * first paint by the script in app/layout.tsx, so the page never flashes the other theme. */
import { BG } from "@/design/tokens.gen";
import { lsGet, lsSet } from "./storage";

export type Theme = "system" | "light" | "dark";
export const THEME_KEY = "gymlog.theme.v1";


export function savedTheme(): Theme {
  const t = lsGet<string>(THEME_KEY, "system");
  return t === "light" || t === "dark" ? t : "system";
}

/** Whether the page is dark right now. */
export const isDark = (t: Theme) => t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
  // The browser's bar follows: the metas carry one colour per system theme, so a picked theme sets both.
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    m.dataset.system ??= m.content;
    m.content = t === "system" ? m.dataset.system : BG[t];
  }
}

export function setTheme(t: Theme) {
  lsSet(THEME_KEY, t);
  applyTheme(t);
}

/** The script in <head>: sets data-theme from storage before anything is drawn. */
export const THEME_SCRIPT = `(function(){try{var t=JSON.parse(localStorage.getItem(${JSON.stringify(THEME_KEY)})||"null");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
