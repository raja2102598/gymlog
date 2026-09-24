"use client";
import { useRef, useState, type ChangeEvent } from "react";
import { useGym } from "@/hooks/useGym";
import { todayKey } from "@/lib/dates";

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
    if (f) setMsg(await store.importFile(f));
  };

  return (
    <div className="menu panel" id="menu" hidden={!open}>
      <div className="menu-row">
        <span id="whoami" className="sub">
          {store.user ? `Signed in as ${store.user.email || "you"}` : ""}
        </span>
      </div>
      <div className="menu-row">
        <button className="ghost" id="planBtn" onClick={onEditPlan}>
          Edit plan
        </button>
        <button className="ghost" id="exportBtn" onClick={exportData}>
          Export my data (.json)
        </button>
        <button className="ghost" id="importBtn" onClick={() => file.current?.click()}>
          Import data (.json)
        </button>
        <input type="file" id="importFile" accept="application/json,.json" hidden ref={file} onChange={importData} />
        <button className="ghost" id="signOutBtn" onClick={() => void store.signOut()}>
          Sign out
        </button>
      </div>
      <p className="note" id="menuMsg">
        {msg}
      </p>
    </div>
  );
}
