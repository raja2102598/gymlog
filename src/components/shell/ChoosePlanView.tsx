"use client";
import { TemplateList } from "@/components/plan/TemplateList";
import { useGym } from "@/hooks/useGym";

/** A new account's first screen, instead of Today: the plan to start from, blank or a template. The choice is saved
 *  as the account's plan, like an edit in the plan editor, where all of it can be changed later. */
export function ChoosePlanView({ hidden, onChosen }: { hidden: boolean; onChosen: () => void }) {
  const store = useGym();
  return (
    <section className="panel" id="chooseView" hidden={hidden}>
      <h2 className="display">Choose a plan</h2>
      <p className="sub">Pick a week to start from. You can change every session and lift later in Settings → Edit plan.</p>
      <TemplateList
        onPick={(t) => {
          store.startFrom(t.plan);
          onChosen();
        }}
      />
      <div className="choose-foot">
        <p className="sub">
          Signed in as <span id="chooseWho">{store.user?.email || "you"}</span>
        </p>
        <button type="button" className="ghost" id="chooseSignOut" onClick={() => void store.signOut()}>
          Sign out
        </button>
      </div>
    </section>
  );
}
