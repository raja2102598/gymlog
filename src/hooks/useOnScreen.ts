"use client";
import { useEffect, useRef, useState } from "react";

/** Whether an element has come on screen yet (it stays true after): a chart starts drawing then, not while its
 *  screen is still being built or while it's further down the page, so fewer things animate at once. Where there's
 *  no IntersectionObserver to ask, straight away. False on the first render either way, so the prerendered page
 *  and the app's first render agree. */
export function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (on || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setOn(true), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setOn(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [on]);
  return [ref, on] as const;
}
