"use client";
import { useRef, useState, type ChangeEvent } from "react";
import { TemplateList } from "@/components/plan/TemplateList";
import { useGym } from "@/hooks/useGym";

interface Props {
  hidden: boolean;
  onChosen: () => void;
  /** A backup is being restored: the picker stays up until it's done, instead of giving way to Today half-way. */
  onRestoring: (busy: boolean) => void;
  /** A backup took the account out of the first run, with the words saying what came in. */
  onRestored: (msg: string) => void;
}

/** A new account's first screen, instead of Today: the plan to start from, blank or a template, or a backup from
 *  another copy of Gym Log. A choice is saved as the account's plan, like an edit in the plan editor, where all of it
 *  can be changed later. */
export function ChoosePlanView({ hidden, onChosen, onRestoring, onRestored }: Props) {
  const store = useGym();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const restore = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.currentTarget.files?.[0];
    ev.currentTarget.value = "";
    if (!f) return;
    const who = store.user;
    setBusy(true);
    setMsg("Restoring…");
    onRestoring(true);
    let words: string;
    try {
      // Nothing to ask about: a new account has no logged days and only the default plan, so nothing of its own is
      // replaced. The file's days, plan and Health Connect days go straight in.
      words = await store.importFile(f, () => true);
    } catch (err) {
      words = `Couldn’t restore that file: ${(err as Error).message.replace(/\.$/, "")}. Try again.`;
    }
    setBusy(false);
    onRestoring(false);
    if (store.user !== who) return; // signed out meanwhile: nothing to show, and nowhere to go
    // Still a new account: the file couldn't be read, or held no days and no plan. Say so here, where it was chosen.
    if (store.planStep() === "choose") setMsg(words);
    else {
      setMsg("");
      onRestored(words);
    }
  };
  return (
    <section className="choose" id="chooseView" hidden={hidden}>
      <header className="head">
        <div className="head-t">
          <span className="eyebrow">Welcome to Gym Log</span>
          <h1>Choose a plan</h1>
        </div>
      </header>
      <div className="screen">
      <div className="card">
      <p className="sub">Pick a week to start from. You can change every session and lift later in Train → Change plan.</p>
      <TemplateList
        disabled={busy}
        onPick={(t) => {
          store.startFrom(t.plan);
          onChosen();
        }}
      />
      <div className="choose-row">
        <p className="sub">Moving from another copy of Gym Log?</p>
        <button type="button" className="btn btn-sm" id="chooseRestore" disabled={busy} onClick={() => file.current?.click()}>
          Restore a backup
        </button>
      </div>
      <input type="file" id="restoreFile" accept="application/json,.json" hidden ref={file} onChange={restore} />
      <p className="note" id="chooseMsg" role="status">
        {msg}
      </p>
      <div className="choose-row">
        <p className="sub">
          Signed in as <span id="chooseWho">{store.user?.email || "you"}</span>
        </p>
        <button type="button" className="btn btn-sm" id="chooseSignOut" disabled={busy} onClick={() => void store.signOut()}>
          Sign out
        </button>
      </div>
      </div>
      </div>
    </section>
  );
}
