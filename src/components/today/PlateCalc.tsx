"use client";
import { Stack } from "@phosphor-icons/react";
import { platesFor } from "@/lib/stats";

const NB = " ";
/** "25 kg", or "25 kg × 2" for more than one. */
const plateText = (p: { kg: number; count: number }) => `${p.kg}${NB}kg${p.count > 1 ? `${NB}×${NB}${p.count}` : ""}`;

/** What the plates line says for one target weight: the plates for one side, or why there are none. */
export function plateLine(kg: number, barKg: number, plateKgs: number[]): string {
  const r = platesFor(kg, barKg, plateKgs);
  if (r.underBar) return `The bar alone is ${barKg}${NB}kg, more than ${kg}${NB}kg.`;
  const sides = r.perSide.length ? `${r.perSide.map(plateText).join(", ")} per side` : "No plates: just the bar";
  const made = `${sides}, ${barKg}${NB}kg bar: ${r.loaded}${NB}kg`;
  return r.shortBy > 0.001 ? `${made}. ${r.shortBy}${NB}kg left over.` : `${made}.`;
}

interface ButtonProps {
  id: string;
  label: string;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
}

/** The small button on a set's kg box that opens its plate breakdown (rendered separately by PlatesInfo, so a
 *  wide breakdown never stretches the sets either side of it in the grid). */
export function PlatesButton({ id, label, open, disabled, onToggle }: ButtonProps) {
  return (
    <button type="button" className="ghost icon plates-btn" aria-expanded={open} aria-controls={id} aria-label={label} disabled={disabled} onClick={onToggle}>
      <Stack size={20} weight="bold" aria-hidden="true" />
    </button>
  );
}

/** The breakdown a PlatesButton opens: per-side plates for `kg`, on the plan's bar and plates. */
export function PlatesInfo({ id, kg, barKg, plateKgs }: { id: string; kg: number; barKg: number; plateKgs: number[] }) {
  return (
    <div className="plates-info" id={id} role="status">
      {plateLine(kg, barKg, plateKgs)}
    </div>
  );
}
