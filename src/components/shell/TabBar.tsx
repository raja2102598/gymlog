"use client";
import { Barbell, ChartLineUp, Gear, Heartbeat, type Icon } from "@phosphor-icons/react";
import { ViewLink } from "@/components/ui/ViewLink";
import { cx } from "@/lib/cx";
import { hashOf, type Tab } from "@/lib/route";

const ITEMS: { tab: Tab; id: string; label: string; Icon: Icon }[] = [
  { tab: "today", id: "tabToday", label: "Today", Icon: Barbell },
  { tab: "health", id: "tabHealth", label: "Health", Icon: Heartbeat },
  { tab: "progress", id: "tabProgress", label: "Progress", Icon: ChartLineUp },
  { tab: "settings", id: "tabSettings", label: "Settings", Icon: Gear },
];

/** The four tabs along the bottom, as on a phone app. Each is a link, so it also opens in a new tab. */
export function TabBar({ tab, hidden, onOpen }: { tab: Tab; hidden: boolean; onOpen: (t: Tab) => void }) {
  return (
    <nav className="tabbar" aria-label="Sections" hidden={hidden}>
      {ITEMS.map(({ tab: t, id, label, Icon }) => (
        <ViewLink key={t} id={id} className={cx("tab", t === tab && "on")} href={hashOf({ view: t }) || "./"} aria-current={t === tab ? "page" : undefined} onOpen={() => onOpen(t)}>
          <span className="tab-pill" aria-hidden="true">
            <Icon size={24} weight={t === tab ? "fill" : "regular"} />
          </span>
          <span className="tab-label">{label}</span>
        </ViewLink>
      ))}
    </nav>
  );
}
