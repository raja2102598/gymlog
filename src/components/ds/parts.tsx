"use client";
/* The design system's small parts: Button, Chip, SegmentedControl, InsightCallout, ListRow, PainScale, screen
   headers, and the mini charts that sit in metric tiles. Each follows its spec in the Gym Log design system. */
import { ChevronLeft, ChevronRight, Lightbulb, TriangleAlert } from "lucide-react";
import { useRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@/lib/cx";

/* ---------- Button ---------- */

type Variant = "primary" | "secondary" | "raised" | "outline" | "quiet" | "danger";
const VARIANT: Record<Variant, string> = { primary: "btn-primary", secondary: "", raised: "btn-raised", outline: "btn-outline", quiet: "btn-quiet", danger: "btn-danger" };

/** A pill button. One primary per screen (54px, brand); secondary on surface-sunken inside cards, raised (surface)
 *  on the page; outline for signing in with someone else's account. */
export function Button({ variant = "secondary", size, block, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "lg"; block?: boolean }) {
  return <button type="button" className={cx("btn", VARIANT[variant], size === "sm" && "btn-sm", size === "lg" && "btn-lg", block && "btn-block", className)} {...rest} />;
}

/** A link to another screen that switches in place on a plain tap and opens a new tab otherwise (ViewLink). */
export function LinkButton({ variant = "secondary", size, block, className, onOpen, ...rest }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "onClick"> & { href: string; onOpen: () => void; variant?: Variant; size?: "sm" | "lg"; block?: boolean }) {
  return (
    <a
      className={cx("btn", VARIANT[variant], size === "sm" && "btn-sm", size === "lg" && "btn-lg", block && "btn-block", className)}
      {...rest}
      onClick={(ev) => {
        if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        onOpen();
      }}
    />
  );
}

/* ---------- Chip ---------- */

/** A filter or choice chip: 38px, a pressed chip in brand-tint. */
export function Chip({ on, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean }) {
  return <button type="button" className={cx("chip-b", className)} aria-pressed={on} {...rest} />;
}

/* ---------- SegmentedControl ---------- */

/** Two to four peer views (Day / Week / Month / Year, Progress's sections). A tablist: arrow keys move along it, and
 *  a change never leaves the screen. */
export function SegmentedControl<T extends string>({ value, options, onChange, label, id }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string; id?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const key = (ev: KeyboardEvent, i: number) => {
    const to = ev.key === "ArrowRight" ? i + 1 : ev.key === "ArrowLeft" ? i - 1 : ev.key === "Home" ? 0 : ev.key === "End" ? options.length - 1 : null;
    if (to == null || to < 0 || to >= options.length) return;
    ev.preventDefault();
    onChange(options[to][0]);
    refs.current[to]?.focus();
  };
  return (
    <div className="seg" role="tablist" aria-label={label} id={id}>
      {options.map(([v, text], i) => (
        <button
          key={v}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          className={cx("seg-b", v === value && "on")}
          aria-selected={v === value}
          tabIndex={v === value ? 0 : -1}
          data-seg={v}
          onClick={() => onChange(v)}
          onKeyDown={(ev) => key(ev, i)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/* ---------- InsightCallout ---------- */

/** One coach line: an insight (lightbulb) under the chart it explains, or a caution (triangle) inside the card it
 *  concerns. */
export function InsightCallout({ kind = "insight", children, id, onClick, label }: { kind?: "insight" | "caution"; children: ReactNode; id?: string; onClick?: () => void; label?: string }) {
  const Icon = kind === "caution" ? TriangleAlert : Lightbulb;
  const body = (
    <>
      <Icon size={kind === "caution" ? 16 : 20} aria-hidden="true" />
      <span>{children}</span>
    </>
  );
  return onClick ? (
    <button type="button" className={cx("callout", kind === "caution" && "caution")} id={id} onClick={onClick} aria-label={label}>
      {body}
    </button>
  ) : (
    <div className={cx("callout", kind === "caution" && "caution")} id={id}>
      {body}
    </div>
  );
}

/* ---------- ListRow ---------- */

/** A settings-style row: a label, a value, a chevron. Rendered as a link, a button or a plain row. */
export function ListRow({
  title,
  sub,
  value,
  valueOk,
  chevron = true,
  lead,
  trail,
  className,
  ...rest
}: {
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  valueOk?: boolean;
  chevron?: boolean;
  lead?: ReactNode;
  trail?: ReactNode;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cx("row", "set-row", className)} {...rest}>
      {lead}
      <span className="row-t">
        <span className="row-tt">{title}</span>
        {sub ? <span className="row-d">{sub}</span> : null}
      </span>
      {value != null && value !== "" ? <span className={cx("row-v", valueOk && "ok")}>{value}</span> : null}
      {trail}
      {chevron ? <ChevronRight className="chev" size={16} aria-hidden="true" /> : null}
    </button>
  );
}

/* ---------- PainScale ---------- */

/**
 * A one-tap 0–10 pain check: 11 cells, the picked one filled warn with dark ink. A radiogroup: arrow keys move the
 * pick. `name` goes in each cell's data-knee ("kneeBefore:3"), which the app uses to put focus back on it.
 */
export function PainScale({
  name,
  value,
  onPick,
  title,
  aside,
  limit,
  label,
}: {
  name: string;
  value: number | undefined;
  onPick: (n: number) => void;
  title: ReactNode;
  aside?: ReactNode;
  limit?: number;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const key = (ev: KeyboardEvent, n: number) => {
    const to = ev.key === "ArrowRight" || ev.key === "ArrowUp" ? n + 1 : ev.key === "ArrowLeft" || ev.key === "ArrowDown" ? n - 1 : ev.key === "Home" ? 0 : ev.key === "End" ? 10 : null;
    if (to == null || to < 0 || to > 10) return;
    ev.preventDefault();
    onPick(to);
    refs.current[to]?.focus();
  };
  const focusable = value ?? 0;
  return (
    <div className="pain">
      <div className="pain-h">
        <span className="pain-t">{title}</span>
        {aside ? <span className="label">{aside}</span> : null}
      </div>
      <div className="pain-row" role="radiogroup" aria-label={label}>
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            ref={(el) => {
              refs.current[n] = el;
            }}
            type="button"
            role="radio"
            className={cx("pain-b", limit != null && n > limit && "hi")}
            aria-checked={value === n}
            tabIndex={n === focusable ? 0 : -1}
            data-knee={`${name}:${n}`}
            onClick={() => onPick(n)}
            onKeyDown={(ev) => key(ev, n)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- screen headers ---------- */

/** A tab screen's header: an eyebrow (label) over a title-lg, and an optional action at the right. */
export function TabHead({ eyebrow, title, action, eyebrowId }: { eyebrow?: ReactNode; title: ReactNode; action?: ReactNode; eyebrowId?: string }) {
  return (
    <header className="head">
      <div className="head-t">
        {eyebrow ? (
          <span className="eyebrow" id={eyebrowId}>
            {eyebrow}
          </span>
        ) : null}
        <h1 id="screenTitle">{title}</h1>
      </div>
      {action ? <div className="head-a">{action}</div> : null}
    </header>
  );
}

/** A pushed screen's header: a 44px back chevron and a title-md. */
export function PushHead({ title, backHref, onBack, backLabel = "Back", action }: { title: ReactNode; backHref: string; onBack: () => void; backLabel?: string; action?: ReactNode }) {
  return (
    <header className="push">
      <a
        className="back"
        id="backBtn"
        href={backHref}
        aria-label={backLabel}
        onClick={(ev) => {
          if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
          ev.preventDefault();
          onBack();
        }}
      >
        <ChevronLeft size={22} aria-hidden="true" />
      </a>
      <h1 id="screenTitle">{title}</h1>
      {action ? <div className="head-a">{action}</div> : null}
    </header>
  );
}

/* ---------- mini charts for metric tiles ---------- */

/** Min–max heart rate a day as faint capsules, with the resting rate as a dot (Heart tile). */
export function MiniRange({ days }: { days: { lo: number | null; hi: number | null; rest: number | null }[] }) {
  const W = 140, H = 34, n = days.length, slot = W / n;
  const all = days.flatMap((d) => [d.lo, d.hi, d.rest]).filter((v): v is number => v != null);
  if (!all.length) return null;
  const lo = Math.min(...all) - 2, hi = Math.max(...all) + 2, y = (v: number) => 4 + ((hi - v) * (H - 8)) / (hi - lo || 1);
  return (
    <svg className="mini range" width="100%" height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {days.map((d, i) => {
        const cx0 = slot * i + slot / 2;
        return (
          <g key={i}>
            {d.lo != null && d.hi != null ? <line className="rg" x1={cx0} x2={cx0} y1={y(d.hi)} y2={y(d.lo)} /> : null}
            {d.rest != null ? <circle className="rd" cx={cx0} cy={y(d.rest)} r="3" /> : null}
          </g>
        );
      })}
    </svg>
  );
}

const LANES = [
  ["awake", "Awake"],
  ["rem", "REM"],
  ["light", "Light"],
  ["deep", "Deep"],
] as const;

/** A night's sleep in four lanes (awake, REM, light, deep): each stage's minutes as a 6px capsule, fully rounded.
 *  Health Connect gives each stage's total, so a lane shows how long, not when. */
export function StageLanes({ stages, full = false }: { stages: Partial<Record<"deep" | "rem" | "light" | "awake", number>>; full?: boolean }) {
  const total = LANES.reduce((m, [k]) => m + (stages[k] ?? 0), 0);
  if (!total) return null;
  const max = Math.max(...LANES.map(([k]) => stages[k] ?? 0));
  if (!full)
    return (
      <svg className="mini lanes" width="100%" height="34" viewBox="0 0 140 34" preserveAspectRatio="none" aria-hidden="true">
        {LANES.map(([k], i) => (stages[k] ? <rect key={k} className={`ln-${k}`} x="0" y={2 + i * 8} width={Math.max(3, (140 * stages[k]!) / max)} height="6" rx="3" /> : null))}
      </svg>
    );
  return (
    <div className="lanes-full">
      {LANES.map(([k, name]) => (
        <div className="lane" key={k}>
          <span className="label">{name}</span>
          <span className="lane-track">
            <i className={`ln-${k}`} style={{ width: `${((stages[k] ?? 0) * 100) / max}%` }} />
          </span>
          <span className="lane-v">{Math.round(stages[k] ?? 0)} min</span>
        </div>
      ))}
    </div>
  );
}
