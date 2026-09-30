"use client";
import { useLayoutEffect, useRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

// Text boxes that belong to the browser while they're typed in. The page re-renders on every keystroke
// (the week strip, totals and history follow what's typed), and a controlled input would rewrite a
// half-typed "5." or a blank line on each render. A box without the cursor takes the saved value: on
// first render, and when the day changes underneath it (another day's data, a sync, a set filled in).
// An input with the cursor takes only a change that isn't its own typing (takesSaved); the note, a
// textarea, keeps what's typed in it until the cursor leaves. They also turn off the browser's list of
// past entries, which would cover the next set's boxes.
type Value = string | number | null | undefined;
const text = (v: Value) => (v == null ? "" : String(v));

/** Whether a box showing `shown` takes the saved value `now` (both as text), given the saved value at the last render
 *  (`was`), whether it has the cursor, and whether its own typing has reported a change since that render. A box
 *  without the cursor always does. One with it does only when the saved value changed, and not by its own typing: a
 *  set said by voice while the box is typed in (the microphone keeps listening), or a sync. What its own typing saved
 *  is never written back while the cursor's there, however it was saved: "5." saved as 5 stays "5.". */
export function takesSaved(now: string, was: string, shown: string, focused: boolean, typed: boolean): boolean {
  if (shown === now) return false;
  return !focused || (now !== was && !typed);
}

export function SyncedInput({ value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue"> & { value: Value }) {
  const ref = useRef<HTMLInputElement>(null);
  const v = text(value);
  // The saved value as of the last render, and whether this box's own typing has reported a change since: a
  // keystroke saves, which draws the page again, before anything else can.
  const was = useRef(v), typed = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && takesSaved(v, was.current, el.value, document.activeElement === el, typed.current)) el.value = v;
    was.current = v;
    typed.current = false;
  });
  return (
    <input
      ref={ref}
      defaultValue={v}
      autoComplete="off"
      onChange={(ev) => {
        typed.current = true;
        onChange?.(ev);
      }}
      {...rest}
    />
  );
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
  return <textarea ref={ref} defaultValue={v} autoComplete="off" {...rest} />;
}
