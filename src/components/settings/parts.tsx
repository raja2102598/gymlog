import type { ReactNode } from "react";

/** A titled card of rows, as in a phone's settings. */
export function Group({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section className="pref" id={id} aria-labelledby={`${id}H`}>
      <h2 className="pref-h" id={`${id}H`}>
        {title}
      </h2>
      <div className="panel pref-card">{children}</div>
    </section>
  );
}

/** A row's words: its title and, under it, what it does or how it stands. */
export function Text({ title, sub, id }: { title: ReactNode; sub?: ReactNode; id?: string }) {
  return (
    <span className="pref-t">
      <span className="pref-tt" id={id ? `${id}T` : undefined}>
        {title}
      </span>
      {sub ? (
        <span className="sub" id={id ? `${id}D` : undefined}>
          {sub}
        </span>
      ) : null}
    </span>
  );
}
