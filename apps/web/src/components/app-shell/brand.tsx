/**
 * The "DxT" wordmark tile + lime dot + "Monitor". `inverted` for dark surfaces (the sign-in panel):
 * a light tile on dark, as on the Login board.
 */
export function BrandMark({ inverted = false }: { inverted?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`flex h-8 items-center gap-1.5 rounded-aura-sm px-2.5 ${
          inverted ? 'bg-bg-surface text-fg-primary' : 'bg-bg-surface-strong text-fg-inverted'
        }`}
      >
        <span className="font-display text-base font-semibold tracking-tight">DxT</span>
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
