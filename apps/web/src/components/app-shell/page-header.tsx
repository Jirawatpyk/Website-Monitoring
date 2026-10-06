import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** CAPS section name (spec §14.15): OVERVIEW, INCIDENTS, SITES, OPERATIONS, REPORTS, SYSTEM, SETTINGS, ACCOUNT. */
  eyebrow: string;
  title: string;
  /** Timestamps and context go here, never in the eyebrow (spec §14.15). */
  meta?: ReactNode;
  /** Page actions, bottom-aligned on the right (Main board). */
  actions?: ReactNode;
}

/**
 * Page header as on the canvas boards: eyebrow, h1, optional meta line, 4 px apart. No outer padding —
 * AURA AppShell already pads the page (32 px on desktop, as the boards' `main`), so adding more here
 * would push the header down.
 */
export function PageHeader({ eyebrow, title, meta, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-6">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs leading-5 text-fg-secondary">{eyebrow}</span>
        <h1 className="m-0 font-display text-4xl font-semibold">{title}</h1>
        {meta && <p className="m-0 text-sm text-fg-secondary">{meta}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </header>
  );
}
