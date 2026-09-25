"use client";
import { useGym } from "@/hooks/useGym";

/** Shown when this copy has no Supabase project configured. The demo needs no database, so it works here too:
 *  a good way to look around a fresh deploy before setting one up. Its own id for the button: this screen and
 *  LoginView are both always mounted (only `hidden` toggles which shows), so the two can't share one. */
export function SetupView({ hidden }: { hidden: boolean }) {
  const store = useGym();
  return (
    <section className="panel" id="setupView" hidden={hidden}>
      <h2 className="display">Almost ready</h2>
      <p>
        This copy of Gym Log isn’t connected to a database yet: it was built without a Supabase project. Set <code translate="no">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code translate="no">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> (see <code translate="no">.env.example</code>) and build it again. The README has the steps.
      </p>
      <p className="or" aria-hidden="true">
        <span>or</span>
      </p>
      <div className="login">
        <button type="button" className="ghost" id="setupDemoBtn" onClick={() => store.startDemo()}>
          Try it with sample data
        </button>
        <p className="sub">No account needed. Nothing you enter is saved, and reloading ends it.</p>
      </div>
    </section>
  );
}
