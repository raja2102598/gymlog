"use client";
import { LogoMark } from "@/components/brand/Logo";
import { useGym } from "@/hooks/useGym";

/** Shown when this copy has no Supabase project configured. The demo needs no database, so it works here too:
 *  a good way to look around a fresh deploy before setting one up. Its own id for the button: this screen and
 *  LoginView are both always mounted (only `hidden` toggles which shows), so the two can't share one. */
export function SetupView({ hidden }: { hidden: boolean }) {
  const store = useGym();
  return (
    <section className="signin" id="setupView" hidden={hidden}>
      <div className="signin-top">
        <LogoMark size={96} />
        <h1 className="wordmark" translate="no">
          Gym Log
        </h1>
        <p className="tagline">Almost ready.</p>
      </div>
      <div className="sheet">
        <p className="sub">
          This copy isn’t connected to a database yet. Set <code translate="no">NEXT_PUBLIC_SUPABASE_URL</code> and <code translate="no">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> (see{" "}
          <code translate="no">.env.example</code>) and build it again.
        </p>
        <button type="button" className="btn btn-primary btn-block" id="setupDemoBtn" onClick={() => store.startDemo()}>
          Try it with sample data
        </button>
        <p className="note sheet-note">Sample mode saves nothing. Reloading ends it.</p>
      </div>
    </section>
  );
}
