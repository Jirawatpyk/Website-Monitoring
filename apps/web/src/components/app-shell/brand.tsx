/**
 * The "DxT" wordmark tile + lime dot + "Monitor". `inverted` for dark surfaces (the sign-in panel):
 * a light tile on dark, as on the Login board. `compact` is the phone top bar's smaller tile
 * (28 px, 14 px type — MOverview, MobileAck).
 */
export function BrandMark({ inverted = false, compact = false }: { inverted?: boolean; compact?: boolean }) {
  return (
    <div className={`flex items-center ${compact ? 'gap-2' : 'gap-2.5'}`}>
      <div
        className={`flex items-center rounded-aura-sm ${
          compact ? 'h-7 gap-1 px-2' : 'h-8 gap-1.5 px-2.5'
        } ${inverted ? 'bg-bg-surface text-fg-primary' : 'bg-bg-surface-strong text-fg-inverted'}`}
      >
        <span className={`font-display font-semibold tracking-tight ${compact ? 'text-sm' : 'text-base'}`}>
          DxT
        </span>
        <span aria-hidden className="size-1.5 rounded-full bg-accent-dot" />
      </div>
      <span className="text-sm font-semibold">Monitor</span>
    </div>
  );
}

/** Sidebar header: the brand mark. SideNav's `headerDivider` (AURA 5.32) gives the canvas metrics. */
export function Brand() {
  return <BrandMark />;
}
