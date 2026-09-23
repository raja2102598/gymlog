"use client";
import { cx } from "@/lib/cx";
import type { KneeModel } from "@/lib/dashboard";
import { dm } from "@/lib/dates";

/** How is the knee responding? */
export function KneeCard({ m }: { m: KneeModel }) {
  let body;
  if (m.kind === "none") body = <p className="empty">No lifts are marked knee-sensitive. Mark them in Edit plan to track knee pain around them.</p>;
  else if (m.kind === "prompt")
    body = (
      <p className="empty">
        Tap your knee pain (0 to 10) before and after {m.dayNames.join(" and ")} sessions, and on waking the next morning. Scores above {m.limit} are flagged, and knee lifts hold their
        weight after a bad day.
      </p>
    );
  else {
    const hi = (v: number | null, unsettled = false) => v != null && (v > m.limit || unsettled) && "hi";
    body = (
      <>
        {m.now != null ? (
          <p className="sub">
            This week, after sessions and on waking: <span className="num">{m.now.toFixed(1)}</span> on average{m.prev != null ? ` (last week ${m.prev.toFixed(1)})` : ""}
          </p>
        ) : null}
        <table className="knee-t">
          <thead>
            <tr>
              <th>Session</th>
              <th className="r">Before</th>
              <th className="r">After</th>
              <th className="r">Next morning</th>
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={r.day}>
                <td>
                  {dm(r.day)} {r.name}
                  {r.loads.length ? <div className="loads">{r.loads.join(" · ")}</div> : null}
                </td>
                <td className="r num">{r.before ?? "-"}</td>
                <td className={cx("r num", hi(r.after))}>{r.after ?? "-"}</td>
                <td className={cx("r num", hi(r.wake, r.unsettled))}>{r.wake ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">
          Your limit is {m.limit}/10 (change it in Edit plan). Pain above it, or not settled by the next morning, holds the weight on knee lifts. Worth agreeing the limit with a physio.
        </p>
      </>
    );
  }
  return (
    <section className="panel" id="dashKnee">
      <h2>Knee</h2>
      {body}
    </section>
  );
}
