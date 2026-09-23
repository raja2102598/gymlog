"use client";
import { useSyncExternalStore } from "react";
import { getStore, type GymStore } from "@/lib/store";

/** The app's store, re-rendering the caller whenever its data changes. */
export function useGym(): GymStore {
  const store = getStore();
  useSyncExternalStore(store.subscribe, store.getVersion, () => 0);
  return store;
}
