/* Small SVG charts, drawn at the width they're shown at. */
export function Sparkline({ vals }: { vals: number[] }) {
  if (vals.length < 2) return <svg className="spark" viewBox="0 0 120 32" aria-hidden="true" />;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pts = vals.map((v, i) => `${((i * 116) / (vals.length - 1) + 2).toFixed(1)},${(28 - ((v - lo) * 24) / span).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 120 32" aria-hidden="true">
      <polyline points={pts} />
    </svg>
  );
}

