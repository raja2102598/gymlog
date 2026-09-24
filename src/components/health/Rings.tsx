/** One ring: a value against its goal, in the metric's colour on a pale track of the same colour. */
export interface Ring {
  value: number;
  goal: number;
  color: string;
}

/**
 * The day's activity as concentric rings (steps, exercise, active calories), each filling as it nears its goal.
 * The numbers sit beside it (HealthView), so the rings never carry a value alone.
 */
export function Rings({ rings, label }: { rings: Ring[]; label: string }) {
  const S = 132, c = S / 2, w = 12, gap = 3;
  return (
    <svg className="rings" viewBox={`0 0 ${S} ${S}`} role="img" aria-label={label}>
      {rings.map((r, i) => {
        const rad = c - w / 2 - i * (w + gap), len = 2 * Math.PI * rad, frac = Math.max(0, Math.min(1, r.value / r.goal));
        return (
          <g key={i} style={{ ["--c" as string]: r.color }}>
            <circle cx={c} cy={c} r={rad} className="track" strokeWidth={w} />
            {frac > 0 ? (
              <circle
                cx={c}
                cy={c}
                r={rad}
                className="arc"
                strokeWidth={w}
                strokeDasharray={`${(len * frac).toFixed(2)} ${len.toFixed(2)}`}
                transform={`rotate(-90 ${c} ${c})`}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
