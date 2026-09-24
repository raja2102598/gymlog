/** Shown when this copy has no Supabase project configured. */
export function SetupView({ hidden }: { hidden: boolean }) {
  return (
    <section className="panel" id="setupView" hidden={hidden}>
      <h2 className="display">Almost ready</h2>
      <p>
        This copy of Gym Log isn&apos;t connected to a database yet. Add your Supabase project URL and anon key to <code>src/lib/config.ts</code> in the repo. The README has
        the steps.
      </p>
    </section>
  );
}
