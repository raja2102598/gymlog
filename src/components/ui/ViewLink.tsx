"use client";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "onClick"> & { href: string; onOpen: () => void };

/** A link to another view (#dashboard, #plan, or "./" for Today). A plain tap switches views in place; a
 *  Ctrl, Cmd, Shift or middle click opens the view in a new tab, like any link. */
export function ViewLink({ onOpen, ...rest }: Props) {
  const click = (ev: MouseEvent<HTMLAnchorElement>) => {
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    onOpen();
  };
  return <a {...rest} onClick={click} />;
}
