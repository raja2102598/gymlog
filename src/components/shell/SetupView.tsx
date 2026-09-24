/** Shown when this copy has no Supabase project configured. */
export function SetupView({ hidden }: { hidden: boolean }) {
  return (
    <section className="panel" id="setupView" hidden={hidden}>
      <h2 className="display">Almost ready</h2>
      <p>
        This copy of Gym Log isn’t connected to a database yet: it was built without a Supabase project. Set <code translate="no">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code translate="no">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> (see <code translate="no">.env.example</code>) and build it again. The README has the steps.
      </p>
    </section>
  );
}
