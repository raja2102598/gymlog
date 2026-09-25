"use client";
import { useLayoutEffect, useRef } from "react";

// The sync bar and the notices stick under the top bar, and can grow to several lines (a two-device conflict on a
// phone, say). Their stack's height goes into --bars-h on the page, so the scroll padding (base.css) keeps a field
// reached with Tab, or scrolled to by the app, below all of it.
export function useBarsHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty("--bars-h", `${Math.ceil(el.getBoundingClientRect().height)}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--bars-h");
    };
  }, []);
  return ref;
}
