"use client";
import { useRef, useState, type ChangeEvent } from "react";
import { ViewLink } from "@/components/ui/ViewLink";
import { useGym } from "@/hooks/useGym";
import { todayKey } from "@/lib/dates";
import { plural } from "@/lib/format";

/** The menu: edit the plan, export or import data, sign out. */
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
      <p className="note" id="menuMsg" role="status">
        {msg}
      </p>
    </nav>
  );
}
