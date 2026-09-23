"use client";
import { useCallback, useLayoutEffect, useReducer, useRef } from "react";

export type FocusNext = (selector: string, scroll?: boolean) => void;

/** Focuses an element once the next render has put it on the page, e.g. a field that a tap just opened.
 *  With `scroll`, the element is first scrolled to the middle of the screen. */
export function useFocusNext(): FocusNext {
  const target = useRef<{ selector: string; scroll: boolean; at: number } | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useLayoutEffect(() => {
    const t = target.current;
    if (!t) return;
    const el = document.querySelector<HTMLElement>(t.selector);
    if (!el) {
      if (Date.now() - t.at > 1000) target.current = null; // it never appeared
      return;
    }
    target.current = null;
    if (t.scroll) el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: t.scroll });
  });
  return useCallback((selector, scroll = false) => {
    target.current = { selector, scroll, at: Date.now() };
    rerender();
  }, []);
}
