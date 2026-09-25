"use client";
import { ChartColumn, Dumbbell, Heart, House, type LucideIcon } from "lucide-react";
import { ViewLink } from "@/components/ui/ViewLink";
import { hashOf, type Tab } from "@/lib/route";

const ITEMS: { tab: Tab; id: string; label: string; Icon: LucideIcon }[] = [
  { tab: "home", id: "tabHome", label: "Home", Icon: House },
  { tab: "train", id: "tabTrain", label: "Train", Icon: Dumbbell },
  { tab: "progress", id: "tabProgress", label: "Progress", Icon: ChartColumn },
  { tab: "health", id: "tabHealth", label: "Health", Icon: Heart },
];

/** The bottom navigation (TabBar spec): Home · Train · Progress · Health. Each whole column is a link with its own
 *  address; the current tab has a brand-tint pill behind its icon. Hidden in the workout and on pushed screens. */
export function TabBar({ tab, hidden, onOpen }: { tab: Tab; hidden: boolean; onOpen: (t: Tab) => void }) {
  return (
    <nav className="tabbar" aria-label="Main" hidden={hidden}>
      <div className="tabbar-in">
        {ITEMS.map(({ tab: t, id, label, Icon }) => (
          <ViewLink key={t} id={id} className="tab" href={hashOf({ view: t }) || "./"} aria-current={t === tab ? "page" : undefined} onOpen={() => onOpen(t)}>
            <span className="tab-pill" aria-hidden="true">
              <Icon size={22} strokeWidth={2} />
            </span>
            <span className="tab-label">{label}</span>
          </ViewLink>
        ))}
      </div>
    </nav>
  );
}
