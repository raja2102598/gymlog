"use client";
import { useEffect, useSyncExternalStore } from "react";
import { awakePref, keepScreenOn, onAwakePref } from "@/lib/awake";

/** Whether "Keep the screen on" is on, on this phone. Follows the switch in Settings as it changes. */
export const useAwakePref = (): boolean => useSyncExternalStore(onAwakePref, awakePref, () => true);

/** Holds the screen on while the calling screen is up and the switch is on. */
export function useKeepAwake() {
  const on = useAwakePref();
  useEffect(() => (on ? keepScreenOn() : undefined), [on]);
}
