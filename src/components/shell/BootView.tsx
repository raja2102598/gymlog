/** The shape of Today while the app starts. It's in the page's HTML, so even a first visit on weak
 *  signal shows something straight away. */
export function BootView({ hidden }: { hidden: boolean }) {
  return (
    <div id="bootView" aria-busy="true" hidden={hidden}>
      <p className="sr-only">Loading</p>
      <div className="week sk-week" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
      <section className="panel sk-panel" aria-hidden="true">
        <i />
        <i />
        <i />
      </section>
    </div>
  );
}
