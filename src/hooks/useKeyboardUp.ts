"use client";
import { useEffect, useState } from "react";

// Keys typed into these bring up the phone's keyboard.
const TYPED = new Set(["text", "number", "email", "password", "search", "tel", "url", ""]);
const typing = () => {
  const a = document.activeElement as HTMLInputElement | null;
  return !!a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && TYPED.has(a.type)));
};

/**
 * Whether the phone's keyboard is up: a text box has focus and the visible part of the page is well short of its
 * full height. Focus alone isn't enough: Android's Back closes the keyboard and leaves the box focused.
 */
export function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let full = { w: vv.width, h: vv.height };
    const check = () => {
      if (Math.abs(vv.width - full.w) > 1) full = { w: vv.width, h: vv.height }; // the phone was turned
      full.h = Math.max(full.h, vv.height);
      setUp(typing() && full.h - vv.height > 120);
    };
    const later = () => setTimeout(check, 0); // focus has moved on by then
    vv.addEventListener("resize", check);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", later);
    return () => {
      vv.removeEventListener("resize", check);
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", later);
    };
  }, []);
  return up;
}
