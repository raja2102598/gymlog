"use client";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ViewLink } from "@/components/ui/ViewLink";

/** Each metric's text colour: passes 4.5:1 on surface in both themes. */
export const METRIC_INK = {
  steps: "var(--steps-text)",
  sleep: "var(--sleep)",
  heart: "var(--heart)",
  energy: "var(--energy-text)",
  body: "var(--body)",
  water: "var(--water)",
  exercise: "var(--active)",
} as const;

/** A health metric tile (MetricTile spec): the icon and name in the metric's colour, a big value, one supporting line
 *  and a mini chart pinned to the bottom. The whole tile opens the metric's page, unless it acts in place (water),
 *  when `href` is left out. */
export function MetricTile({
  id,
  icon: Icon,
  name,
  ink,
  value,
  unit,
  support,
  chart,
  href,
  onOpen,
}: {
  id: string;
  icon: LucideIcon;
  name: string;
  ink: string;
  value: ReactNode;
  unit?: string;
  support?: ReactNode;
  chart?: ReactNode;
  href?: string;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span className="mt-l" style={{ color: ink }}>
        <Icon size={16} aria-hidden="true" />
        {name}
      </span>
      <span className="mt-v">
        {value}
        {unit ? <span className="u">{unit === "%" ? unit : ` ${unit}`}</span> : null}
      </span>
      {support ? <span className="mt-s">{support}</span> : null}
      {chart ? <span className="mt-c">{chart}</span> : null}
    </>
  );
  return href && onOpen ? (
    <ViewLink className="tile" id={id} href={href} onOpen={onOpen}>
      {body}
    </ViewLink>
  ) : (
    <div className="tile" id={id}>
      {body}
    </div>
  );
}
