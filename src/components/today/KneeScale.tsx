"use client";
import { cx } from "@/lib/cx";
import type { KneeField } from "@/lib/types";

interface Props {
  field: KneeField;
  value: number | undefined;
  limit: number;
  title: string;
  sub?: string;
  msg?: string;
  /** Show the scale even though a score is in (after "Change"). */
  reopened: boolean;
  onScore: (n: number) => void;
  onChange: () => void;
}

/** A 0-10 knee pain scale in two rows of big buttons. Once scored it folds to one line with a Change button. */
export function KneeScale({ field, value: v, limit, title, sub, msg, reopened, onScore, onChange }: Props) {
  const head = (
    <>
      <b>{title}</b>
      {sub ? (
        <>
          {" "}
          <span className="sub">{sub}</span>
        </>
      ) : null}
    </>
  );
  if (v != null && !reopened) {
    return (
      <div className="knee scored">
        <div className="kn-head">
          {head} <span className={cx("kn-val num", v > limit && "hi")}>{v}/10</span>{" "}
          <button type="button" className="ghost tiny" data-kneeedit={field} aria-label={`Change ${title.toLowerCase()}`} onClick={onChange}>
            Change
          </button>
        </div>
        {msg ? <p className="kn-msg">{msg}</p> : null}
      </div>
    );
  }
  return (
    <div className="knee">
      <div className="kn-head">
        {head}
        <span className="kn-lim">0 = none, 10 = worst · limit {limit}</span>
      </div>
      <div className="kn-scale" role="group" aria-label={`${title}, 0 to 10`}>
        {Array.from({ length: 11 }, (_, n) => (
          <button key={n} type="button" className={cx("kn", v === n && "on", n > limit && "hi")} data-knee={`${field}:${n}`} aria-pressed={v === n} onClick={() => onScore(n)}>
            {n}
          </button>
        ))}
      </div>
      {msg ? <p className="kn-msg">{msg}</p> : null}
    </div>
  );
}
