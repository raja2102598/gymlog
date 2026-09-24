import type { DayKey, KneeField } from "@/lib/types";

/** The open "···" menu of one lift on one day: skip/swap choices, or the swap form. */
export interface LiftMenu {
  day: DayKey;
  name: string;
  mode: "menu" | "swap";
}

/** Knee scores reopened with "Change" on a day. */
export interface KneeEdit {
  day: DayKey | null;
  fields: KneeField[];
}
