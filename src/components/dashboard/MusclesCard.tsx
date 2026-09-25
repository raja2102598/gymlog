"use client";
import { cx } from "@/lib/cx";
import type { MusclesModel } from "@/lib/dashboard";
import { dm } from "@/lib/dates";
import { plural } from "@/lib/format";
import { MUSCLES } from "@/lib/library";

/** "10.5", or "12". */
const sets = (n: number) => (n % 1 ? n.toFixed(1) : String(n));

/** Is each muscle getting enough? Working sets per muscle in each of the last four weeks, from the muscles the
 *  exercise library gives each lift. */
export function MusclesCard({ m }: { m: MusclesModel }) {
  const last = m.weeks.length - 1;
  return (
    <section className="panel" id="dashMuscles">
      <h2>Sets per muscle</h2>
      {m.rows.length ? (
        <>
          <table className="musc-t">
            <thead>
              <tr>
                <th scope="col">Muscle</th>
                {m.weeks.map((w, i) => (
                  <th key={w} scope="col" className="r">
                    {i === last ? "This week" : dm(w)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.muscle} data-muscle={r.muscle}>
                  <th scope="row">
                    {MUSCLES[r.muscle]}
                    {r.note ? <div className={cx("musc-n", r.note)}>{r.note === "under" ? "Under 10 last week" : "Over 20 last week"}</div> : null}
                  </th>
                  {r.sets.map((n, i) => (
                    <td key={m.weeks[i]} className="r num">
                      {n ? sets(n) : "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            Working sets a week, from the Monday shown: a set counts 1 for a lift’s main muscles and a half for the
            others it works, leaving out warm-ups and drop sets. Most advice puts a muscle at 10 to 20 sets a week.
          </p>
        </>
      ) : (
        <p className="empty">Log a session to see how many sets each muscle gets a week.</p>
      )}
      {m.untagged.length ? (
        <p className="note" id="muscUntagged">
          Untagged, so not counted: {m.untagged.map((u) => `${u.name} (${plural(u.sets, "set")})`).join(", ")}. Point a lift at the library, or give
          one of your own its muscles, in the plan editor.
        </p>
      ) : null}
    </section>
  );
}
