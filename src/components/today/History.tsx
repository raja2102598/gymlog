"use client";
import { useGym } from "@/hooks/useGym";
import { addDays, DOW, todayKey, wdIndex } from "@/lib/dates";
import { fmt } from "@/lib/format";

/** The last two weeks at a glance, from the day logging started. */
export function History() {
  const store = useGym();
  const t = todayKey(), start = store.firstDay(), rows = [];
  for (let i = 0; i < 14; i++) {
    const k = addDays(t, -i), p = store.planFor(k), e = store.entry(k);
    if (k < start) break;
    const done = p.exercises.filter((x) => e.exercises[x.name]?.done).length;
    rows.push(
      <tr key={k}>
        <td>
          <span className="num">
            {DOW[wdIndex(k)]} {+k.slice(8)}
          </span>
          <div className="hs">{p.name}</div>
        </td>
        <td className="r num">{p.exercises.length ? `${done}/${p.exercises.length}` : "-"}</td>
        <td className="c">{e.cardio ? "✓" : "-"}</td>
        <td className="r num">{fmt(e.steps)}</td>
        <td className="r num">{e.weight ?? "-"}</td>
      </tr>,
    );
  }
  return (
    <section className="panel">
      <h2 id="histTitle" className="panel-h">
        {rows.length === 1 ? "Today" : `Last ${rows.length} days`}
      </h2>
      <div className="hist" id="hist">
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th className="r">Lifts</th>
              <th className="c">Cardio</th>
              <th className="r">Steps</th>
              <th className="r">kg</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </section>
  );
}
