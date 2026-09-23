"use client";
import { useLayoutEffect, useRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

// Text boxes that belong to the browser while they have focus. The page re-renders on every keystroke
// (the week strip, totals and history follow what's typed), and a controlled input would rewrite a
// half-typed "5." or a blank line on each render. These take the saved value only while not focused:
// on first render, and when the day changes underneath them (another day's data, a sync, a set filled in).
type Value = string | number | null | undefined;
const text = (v: Value) => (v == null ? "" : String(v));

export function SyncedInput({ value, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue"> & { value: Value }) {
  const ref = useRef<HTMLInputElement>(null);
  const v = text(value);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.value !== v) el.value = v;
  });
  return <input ref={ref} defaultValue={v} {...rest} />;
}

// Where the browser can't size a text box to its content (field-sizing, Chrome 123+), the note grows here.
const growsByItself = () => typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content");
function grow(el: HTMLTextAreaElement) {
  if (growsByItself() || !el.offsetParent) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + 2 + "px";
}

export function SyncedTextarea({ value, autoGrow = false, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "defaultValue"> & { value: Value; autoGrow?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const v = text(value);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el && el.value !== v) el.value = v;
    if (autoGrow) grow(el);
  });
  return <textarea ref={ref} defaultValue={v} {...rest} />;
}
