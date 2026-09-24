"use client";
import type { StrengthModel } from "@/lib/dashboard";
import { dayMonth } from "@/lib/dates";
import { PR_WORDS } from "@/lib/store";
import { Sparkline } from "./charts";

/** Is strength holding during the cut? */
export function StrengthCard({ m }: { m: StrengthModel }) {
  return (
    <section className="panel" id="dashStrength">
      <h2>Strength</h2>
      <p className="note">Estimated 1RM of each day’s first lift, from sets of 12 reps or fewer. Holding steady is a win during a cut.</p>
      {m.anyLogged ? (
        <ul className="lifts">
          {m.rows.map((r) => (
            <li key={`${r.day}|${r.name}`}>
              <span className="ln">
                {r.name} <span className="sub">{r.day}</span>
              </span>
              <Sparkline vals={r.points.map((p) => p[1])} />{" "}
              <span className="lv num">{r.points.length ? `${Math.round(r.points[r.points.length - 1][1])} kg` : "-"}</span> <span className="lc">{r.change}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Log a session to start tracking strength.</p>
      )}
      <h3 className="dh">Ready to add weight</h3>
      {m.ready.length || m.held.length ? (
        <ul className="plain">
          {m.ready.map((x) => (
            <li key={x.name}>
              <b>{x.name}</b> <span className="sub">{x.day}</span>: {x.from} → <b>{x.to}&nbsp;kg</b>
            </li>
          ))}
          {m.held.map((x) => (
            <li key={x.name}>
              <b>{x.name}</b> <span className="sub">{x.day}</span>: hold {x.from}&nbsp;kg (knee)
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Nothing yet. A lift is ready once every set reaches the top of its rep range.</p>
      )}
      <h3 className="dh">Records in the last 30 days</h3>
      {m.records.length ? (
        <ul className="plain">
          {m.records.map((r) => (
            <li key={`${r.day}|${r.name}|${r.set}`}>
              <span className="num">{dayMonth(r.day)}</span> <b>{r.name}</b> {r.reps != null ? `${r.reps}\u00a0×\u00a0` : ""}
              {r.kg}&nbsp;kg <span className="sub">{r.kinds.map((k) => PR_WORDS[k]).join(", ")}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">None yet. Records show up once a lift beats an earlier session.</p>
      )}
    </section>
  );
}
