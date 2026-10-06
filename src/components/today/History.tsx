"use client";
import { useGym } from "@/hooks/useGym";
import { addDays, DOW, todayKey, wdIndex } from "@/lib/dates";
import { fmt } from "@/lib/format";
import type { DayKey } from "@/lib/types";

/** The last two weeks at a glance, from the day logging started. A day opens in Train, to look at it or fix it. */
export function History({ onOpenDay }: { onOpenDay?: (k: DayKey) => void }) {
  const store = useGym();
  const t = todayKey(), start = store.firstDay(), rows = [];
  for (let i = 0; i < 14; i++) {
    const k = addDays(t, -i), p = store.planFor(k), e = store.entry(k);
    if (k < start) break;
    const done = p.exercises.filter((x) => e.exercises[x.name]?.done).length;
    rows.push(
      <tr key={k}>
        <td>
          {onOpenDay ? (
            <button type="button" className="hday" data-hday={k} aria-label={`Open ${DOW[wdIndex(k)]} ${+k.slice(8)}, ${p.name}, in Train`} onClick={() => onOpenDay(k)}>
              <span className="num">
                {DOW[wdIndex(k)]} {+k.slice(8)}
              </span>
              <span className="hs">{p.name}</span>
            </button>
          ) : (
            <>
              <span className="num">
                {DOW[wdIndex(k)]} {+k.slice(8)}
              </span>
              <div className="hs">{p.name}</div>
            </>
          )}
        </td>
        <td className="r num">{p.exercises.length ? `${done}/${p.exercises.length}` : "-"}</td>
        <td className="c">{e.cardio ? "Yes" : "–"}</td>
        <td className="r num">{fmt(store.stepsOf(k))}</td>
        <td className="r num">{store.weightOf(k) ?? "-"}</td>
      </tr>,
    );
  }
  return (
    <section className="card">
      <h2 id="histTitle" className="title-sm">
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
