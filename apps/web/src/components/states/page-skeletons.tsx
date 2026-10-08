import type { ReactNode } from 'react';
import { Skeleton } from '@jirawatpyk/aura-react';

/**
 * Loading shapes for one route: each page's `loading.tsx` draws its own layout from these parts, so
 * nothing jumps when the real page arrives (EmptyStates board: shape first, never green).
 */

interface PageSkeletonProps {
  /** Read by screen readers, e.g. "Loading sites". */
  label: string;
  children: ReactNode;
}

/** The wrapper every route skeleton uses: one live status, the page's 24 px rhythm. */
export function PageSkeleton({ label, children }: PageSkeletonProps) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

interface PageHeaderSkeletonProps {
  /** A breadcrumb line above the title (detail pages) instead of the eyebrow. */
  breadcrumb?: boolean;
  /** How many header buttons sit on the right (0 = none). */
  actions?: number;
}

/** The shape of AURA `PageHeader`: breadcrumb or eyebrow, h1, meta line, actions. */
export function PageHeaderSkeleton({ breadcrumb = false, actions = 0 }: PageHeaderSkeletonProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" aria-hidden>
      <div className="flex w-full max-w-xl flex-col gap-1">
        <Skeleton variant="text" width={breadcrumb ? '40%' : '15%'} />
        <Skeleton variant="rect" height={36} width="50%" />
        <Skeleton variant="text" width="80%" />
      </div>
      {actions > 0 && (
        <div className="flex gap-3">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton key={i} variant="rect" height={44} width={120} />
          ))}
        </div>
      )}
    </div>
  );
}

interface CardSkeletonProps {
  /** Form fields (label + input) in the card body. */
  fields?: number;
  /** Fields per row from `md` up. */
  columns?: 1 | 2 | 3;
  /** Plain text lines instead of fields (a list, a checklist, a note). */
  lines?: number;
}

const COLUMNS = { 1: '', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3' } as const;

/** The shape of an AURA `Card` with a title: fields in a grid, or text lines. */
export function CardSkeleton({ fields = 0, columns = 1, lines = 0 }: CardSkeletonProps) {
  return (
    <div
      className="flex flex-col gap-4 rounded-aura-lg border border-border-default bg-bg-surface p-5"
      aria-hidden
    >
      <Skeleton variant="text" width="30%" />
      {fields > 0 && (
        <div className={`grid grid-cols-1 gap-4 ${COLUMNS[columns]}`}>
          {Array.from({ length: fields }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton variant="text" width="40%" />
              <Skeleton variant="rect" height={44} />
            </div>
          ))}
        </div>
      )}
      {lines > 0 && <Skeleton variant="text" lines={lines} />}
    </div>
  );
}
