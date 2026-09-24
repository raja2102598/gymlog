"use client";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ViewLink } from "@/components/ui/ViewLink";
import { useGym } from "@/hooks/useGym";
import { todayKey } from "@/lib/dates";
import { plural, syncedWhen } from "@/lib/format";
import { isNative } from "@/lib/native";

/** The menu: edit the plan, export or import data, a password, Health Connect, sign out. */
export function AppMenu({ open, onEditPlan }: { open: boolean; onEditPlan: () => void }) {
  const store = useGym();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");

  const exportData = () => {
    const rows = store.exportRows();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 1)], { type: "application/json" }));
    a.download = `gym-log-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setMsg(`Exported ${rows.length} days.`);
  };
  const importData = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.currentTarget.files?.[0];
    ev.currentTarget.value = "";
    // Days already logged are only replaced once you say so.
    if (f) setMsg(await store.importFile(f, (n) => confirm(`The file has different entries for ${plural(n, "day")} you’ve already logged. Replace them with the file’s version?`)));
  };

  return (
    <nav className="menu panel" id="menu" aria-label="Menu" hidden={!open}>
      <div className="menu-row">
        <span id="whoami" className="sub">
          {store.user ? `Signed in as ${store.user.email || "you"}` : ""}
        </span>
      </div>
      <div className="menu-row">
        <ViewLink className="ghost" id="planBtn" href="#plan" onOpen={onEditPlan}>
          Edit plan
        </ViewLink>
        <button className="ghost" id="exportBtn" onClick={exportData}>
          Export data (.json)
        </button>
        <button className="ghost" id="importBtn" onClick={() => file.current?.click()}>
          Import data (.json)
        </button>
        <input type="file" id="importFile" accept="application/json,.json" hidden ref={file} onChange={importData} />
        <button className="ghost" id="signOutBtn" onClick={() => void store.signOut()}>
          Sign out
        </button>
      </div>
      <PasswordRow />
      <HealthRow />
      <p className="note" id="menuMsg" role="status">
        {msg}
      </p>
    </nav>
  );
}

/** Health Connect: in the Android app, its status and Connect or Sync now; on the web, when it last synced. */
function HealthRow() {
  const store = useGym();
  const link = store.healthLink, at = store.healthSyncedAt;
  if (!isNative()) {
    return at ? (
      <div className="menu-row">
        <span className="sub" id="hcStatus">
          Health Connect data comes from the Gym Log Android app, last synced {syncedWhen(at)}.
        </span>
      </div>
    ) : null;
  }
  // Loaded only here, so the website doesn't carry the Health Connect plugin.
  const connect = () => void import("@/native/app").then((m) => m.connectHealth(store));
  const sync = () => void import("@/native/app").then((m) => m.syncHealth(store, true));
  const status =
    link.state === "web" ? "Checking Health Connect…" : link.state === "ok" && at ? `Synced ${syncedWhen(at)}. ${link.msg}` : link.msg;
  return (
    <div className="menu-row">
      <span className="sub" id="hcStatus" role="status">
        <b>Health Connect</b> {status}
      </span>
      {link.state === "off" ? (
        <button className="ghost" id="hcConnect" onClick={connect}>
          Connect Health Connect
        </button>
      ) : link.state !== "unavailable" && link.state !== "web" ? (
        <button className="ghost" id="hcSync" onClick={sync} disabled={link.state === "syncing"}>
          Sync now
        </button>
      ) : null}
    </div>
  );
}

/** A password, for signing in without waiting for an email (Supabase sends only a few an hour). */
function PasswordRow() {
  const store = useGym();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const input = ev.currentTarget.elements.namedItem("newPassword") as HTMLInputElement;
    setBusy(true);
    const r = await store.setPassword(input.value);
    setBusy(false);
    setMsg(r.msg);
    if (r.ok) setOpen(false);
  };
  return (
    <div className="menu-row">
      {open ? (
        <form id="pwForm" className="pw-form" onSubmit={save}>
          {/* Lets a password manager save the password under the right account. */}
          <input type="email" name="username" autoComplete="username" value={store.user?.email ?? ""} readOnly hidden />
          <label className="field" htmlFor="newPassword">
            <span>New password, 8 or more characters</span>
            <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
          </label>
          <div className="menu-row">
            <button className="primary" type="submit" id="pwSave" disabled={busy}>
              {busy ? "Saving…" : "Save password"}
            </button>
            <button className="ghost" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          className="ghost"
          id="pwBtn"
          onClick={() => {
            setOpen(true);
            setMsg("");
          }}
        >
          Set a password
        </button>
      )}
      {msg ? (
        <span className="sub" id="pwMsg" role="status">
          {msg}
        </span>
      ) : null}
    </div>
  );
}
