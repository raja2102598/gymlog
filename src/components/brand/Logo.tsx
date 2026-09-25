/** The app mark: an angled dumbbell, on-brand on a brand rounded square (radius 24% of the side). Logos/gymlog-mark.svg
 *  in the design system; public/icons/gymlog-mark.svg is the same drawing. */
export function LogoMark({ size = 120, label }: { size?: number; label?: string }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 100 100" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect width="100" height="100" rx="24" className="lm-bg" />
      <g transform="rotate(-45 50 50)" className="lm-fg">
        <rect x="24" y="46" width="52" height="8" rx="4" />
        <rect x="22" y="30" width="12" height="40" rx="6" />
        <rect x="66" y="30" width="12" height="40" rx="6" />
        <rect x="13" y="38" width="8" height="24" rx="4" />
        <rect x="79" y="38" width="8" height="24" rx="4" />
      </g>
    </svg>
  );
}
