"use client";
import { useLayoutEffect, useRef } from "react";

// The sync bar and the notices stick under the top bar, and can grow to several lines (a two-device conflict on a
// phone, say); the top bar itself grows when the rest timer shows in it. Each one's measured height goes into its
// own CSS custom property, so the scroll padding and the sticky offsets that follow (base.css, shell.css) keep a
// field reached with Tab, or scrolled to by the app, below all of it, whatever it's actually rendering this time.
export function useBarsHeight<T extends HTMLElement>(cssVar = "--bars-h") {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty(cssVar, `${Math.ceil(el.getBoundingClientRect().height)}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty(cssVar);
    };
  }, [cssVar]);
  return ref;
}
