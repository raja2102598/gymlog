/** The shape of Home while the app starts. It's in the page's HTML, so even a first visit on weak signal shows
 *  something straight away. */
export function BootView({ hidden }: { hidden: boolean }) {
  return (
    <div id="bootView" aria-busy="true" hidden={hidden}>
      <p className="sr-only">Loading…</p>
      <div className="head" aria-hidden="true">
        <div className="head-t sk-head">
          <i className="sk-line" style={{ width: "46%" }} />
          <i className="sk-line big" style={{ width: "72%" }} />
        </div>
      </div>
      <div className="screen" aria-hidden="true">
        <i className="sk" style={{ height: 80 }} />
        <i className="sk" style={{ height: 260 }} />
        <i className="sk" style={{ height: 180 }} />
      </div>
    </div>
  );
}
