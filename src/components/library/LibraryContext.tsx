"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { LibraryPicker, type LibraryAsk } from "./LibraryPicker";

const Open = createContext<(ask: LibraryAsk) => void>(() => {});

/** One exercise library for the whole app: the plan editor, a lift's swap and a free-form workout open it. */
export function LibraryProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<LibraryAsk | null>(null);
  return (
    <Open.Provider value={setAsk}>
      {children}
      <LibraryPicker ask={ask} onClose={() => setAsk(null)} />
    </Open.Provider>
  );
}

/** Opens the exercise library for `ask`. */
export const useLibrary = () => useContext(Open);
