"use client";
import { useLayoutEffect, useRef, useState } from "react";

// Charts are drawn at their card's real content width, so their 12px labels stay readable on a phone.
// Measured before the first paint, and again when the card changes size (e.g. the phone is turned).
export function useChartWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setWidth(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, Math.max(260, width)] as const;
}
