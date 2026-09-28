/** "DxT" wordmark tile + lime dot + "Monitor", as on the canvas sidebar header. */
export function Brand() {
  return (
    <div className="flex h-18 items-center gap-2.5 px-5">
      <div
        className="flex h-8 items-center gap-1.5 px-2.5"
        style={{
          background: 'var(--aura-bg-surface-strong)',
          color: 'var(--aura-fg-inverted)',
          borderRadius: 'var(--aura-radius-sm)',
        }}
      >
        <span className="font-display text-base font-semibold tracking-tight">DxT</span>
        <span
          aria-hidden
          className="size-1.5 rounded-full"
          style={{ background: 'var(--aura-accent-dot)' }}
        />
      </div>
      <span className="text-sm font-semibold">Monitor</span>
    </div>
  );
}
