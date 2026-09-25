"use client";
import { platesFor } from "@/lib/stats";

const NB = " ";
/** "25 kg", or "25 kg × 2" for more than one. */
const plateText = (p: { kg: number; count: number }) => `${p.kg}${NB}kg${p.count > 1 ? `${NB}×${NB}${p.count}` : ""}`;

/** What the plates line says for one target weight: the plates for one side, or why there are none. A bar of 0 kg
 *  is a machine's plates, or a Smith machine's bar counted as nothing, so no bar is named. */
export function plateLine(kg: number, barKg: number, plateKgs: number[]): string {
  const r = platesFor(kg, barKg, plateKgs);
  if (r.underBar) return `The bar alone is ${barKg}${NB}kg, more than ${kg}${NB}kg.`;
  const each = r.perSide.length ? `${r.perSide.map(plateText).join(", ")} per side` : "";
  const made = barKg > 0 ? `${each || "No plates: just the bar"}, ${barKg}${NB}kg bar: ${r.loaded}${NB}kg` : `${each || "No plates"}: ${r.loaded}${NB}kg`;
  return r.shortBy > 0.001 ? `${made}. ${r.shortBy}${NB}kg left over.` : `${made}.`;
}

/** A set's plate breakdown, in its menu: per-side plates for `kg`, on the lift's bar and the gym's plates. */
export function PlatesInfo({ id, kg, barKg, plateKgs }: { id: string; kg: number; barKg: number; plateKgs: number[] }) {
  return (
    <div className="plates-info" id={id} role="status">
      {plateLine(kg, barKg, plateKgs)}
    </div>
  );
}
