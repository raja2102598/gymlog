"use client";
import { useGym } from "@/hooks/useGym";

/** Shown for as long as the demo runs: it's sample data, kept only in memory, with a way back to the real sign-in
 *  screen. A reload leaves the demo too, since nothing here survives one. */
export function DemoBar() {
  const store = useGym();
  return (
    <div className="syncbar info" id="demoBar" role="status" hidden={!store.demo}>
      <span id="demoMsg">Sample data. Nothing you do here is saved.</span>
      <button type="button" className="ghost tiny" id="demoSignIn" onClick={() => store.exitDemo()}>
        Sign in
      </button>
    </div>
  );
}
