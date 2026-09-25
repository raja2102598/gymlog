"use client";
import { ViewLink } from "@/components/ui/ViewLink";
import { useGym } from "@/hooks/useGym";

/** The first name an account gives, for Home's greeting and the avatar: Google's given name, else the first word
 *  of the full name. */
export function firstName(meta: Record<string, unknown> | undefined): string {
  const n = [meta?.given_name, meta?.full_name, meta?.name].find((v): v is string => typeof v === "string" && !!v.trim());
  return n ? n.trim().split(/\s+/)[0] : "";
}

/** Settings' way in: the account's initial in a circle, top right on every tab, in the same place each time. */
export function ProfileButton({ onOpen }: { onOpen: () => void }) {
  const store = useGym();
  const name = firstName(store.user?.user_metadata);
  return (
    <ViewLink className="avatar" id="settingsBtn" href="#settings" aria-label="Profile and settings" onOpen={onOpen}>
      <span aria-hidden="true">{(name || store.user?.email || "?").slice(0, 1).toUpperCase()}</span>
    </ViewLink>
  );
}
