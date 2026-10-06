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

/**
 * Sidebar header, as on the canvas: logo 20 px from the left and top, a full-width divider at 72 px,
 * menu from 88 px. AURA SideNav's header slot pads 20 / 8 / 16 / 16 px, so this stretches back to the
 * nav's edges (-ml-4, -mr-2) to draw the divider across the whole sidebar.
 */
export function Brand() {
  return (
    <div className="-mr-2 -ml-4 flex h-13 items-start border-b border-border-default px-5">
      <BrandMark />
    </div>
  );
}
