"use client";
import { ArrowLeft } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { ViewLink } from "@/components/ui/ViewLink";

interface Props {
  title: ReactNode;
  sub?: ReactNode;
  /** A page under a tab: a back arrow to `backHref`. */
  backHref?: string;
  onBack?: () => void;
  /** Sync state, e.g. "Synced" or "Offline. Changes stay on this phone". */
  status: string;
}

/** The bar at the top of each screen: its title, a back arrow on pages under a tab, and the sync state. */
export function AppBar({ title, sub, backHref, onBack, status }: Props) {
  return (
    <header className="appbar">
      {backHref != null && onBack ? (
        <ViewLink className="ghost icon back" id="backBtn" href={backHref} onOpen={onBack}>
          <ArrowLeft size={22} aria-hidden="true" />
          <span className="sr-only">Back</span>
        </ViewLink>
      ) : null}
      <div className="appbar-t">
        <h1 id="screenTitle">{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      <div className="status" id="status" aria-live="polite">
        {status}
      </div>
    </header>
  );
}
