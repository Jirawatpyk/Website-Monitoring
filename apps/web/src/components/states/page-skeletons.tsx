import type { ReactNode } from 'react';
import { Skeleton } from '@jirawatpyk/aura-react';

/**
 * Loading shapes for one route: each page's `loading.tsx` draws its own layout from these parts, so
 * nothing jumps when the real page arrives (EmptyStates board: shape first, never green).
 */

interface PageSkeletonProps {
  /** Read by screen readers, e.g. "Loading sites". */
  label: string;
  /** `page` = the 24 px rhythm between page sections; `tight` = 12 px, for a single-column page. */
  gap?: 'page' | 'tight';
  children: ReactNode;
}

/** The wrapper every route skeleton uses: one live status, the page's rhythm. */
export function PageSkeleton({ label, gap = 'page', children }: PageSkeletonProps) {
  return (
    <div className={`flex flex-col ${gap === 'page' ? 'gap-6' : 'gap-3'}`} role="status" aria-busy="true">
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
  /** The buttons show only from md (a desktop-only action, e.g. Incidents' Export CSV). */
  actionsFromMd?: boolean;
  /** Below md the one action is a full-width button under the header (Sites' Add site, /maintenance). */
  actionFullOnPhone?: boolean;
  /**
   * What the phone top bar carries below lg, so the skeleton leaves it out there too (D-045): `all` the
   * breadcrumb / eyebrow line and the title, `crumb` the first line only (Incident), `title` the title only
   * (Maintenance keeps its day line). Unset: Overview, which keeps both.
   */
  phoneBar?: 'all' | 'crumb' | 'title';
}

/** The shape of AURA `PageHeader`: breadcrumb or eyebrow, h1, meta line, actions. */
export function PageHeaderSkeleton({
  breadcrumb = false,
  actions = 0,
  actionsFromMd = false,
  actionFullOnPhone = false,
  phoneBar,
}: PageHeaderSkeletonProps) {
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" aria-hidden>
        <div className="flex w-full max-w-xl flex-col gap-1">
          <div className={phoneBar === 'all' || phoneBar === 'crumb' ? 'max-lg:hidden' : undefined}>
            <Skeleton variant="text" width={breadcrumb ? '40%' : '15%'} />
          </div>
          {/* The h1's line box (display serif), so the meta line and cards don't shift on arrival. */}
          <div className={phoneBar === 'all' || phoneBar === 'title' ? 'max-lg:hidden' : undefined}>
            <Skeleton variant="rect" height={40} width="50%" />
          </div>
          <Skeleton variant="text" width="80%" />
        </div>
        {actions > 0 && (
          // Below md header actions span the row, side by side (layout-consistency `shortPhoneActions`).
          <div
            className={
              actionsFromMd || actionFullOnPhone
                ? 'hidden gap-3 md:flex'
                : `grid w-full gap-3 md:flex md:w-auto ${actions > 1 ? 'grid-cols-2' : 'grid-cols-1'}`
            }
          >
            {Array.from({ length: actions }, (_, i) => (
              <div key={i} className="md:w-30">
                <Skeleton variant="rect" height={44} width="100%" />
              </div>
            ))}
          </div>
        )}
      </div>
      {actionFullOnPhone && (
        <div className="md:hidden" aria-hidden>
          <Skeleton variant="rect" height={44} width="100%" />
        </div>
      )}
    </>
  );
}

/**
 * A phone list card: rows of a status badge and two lines (Sites, the Overview's Live issues), with an
 * optional heading line above it ("Live issues").
 */
export function PhoneRowsSkeleton({ rows = 5, heading = false }: { rows?: number; heading?: boolean }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {heading && <Skeleton variant="text" width="35%" />}
      <div className="overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex h-15 items-center gap-2.5 border-b border-border-subtle px-3.5 last:border-b-0"
          >
            <span className="flex w-30 shrink-0">
              <Skeleton variant="badge" />
            </span>
            <div className="flex grow flex-col gap-1.5">
              <Skeleton variant="text" width="70%" />
              <Skeleton variant="text" width="45%" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface CardSkeletonProps {
  /** Form fields (label + input) in the card body. */
  fields?: number;
  /** Fields per row once the card is wide enough: 2 from `@md`, 3 from `@xl` (container queries, as
   * the forms use — the card's width decides, not the viewport's). */
  columns?: 1 | 2 | 3;
  /** Plain text lines instead of fields (a list, a checklist, a note). */
  lines?: number;
}

const COLUMNS = { 1: '', 2: '@md:grid-cols-2', 3: '@xl:grid-cols-3' } as const;

/** The shape of an AURA `Card` with a title (24 px padding): fields in a grid, or text lines. */
export function CardSkeleton({ fields = 0, columns = 1, lines = 0 }: CardSkeletonProps) {
  return (
    <div
      className="@container flex flex-col gap-4 rounded-aura-lg border border-border-default bg-bg-surface p-6"
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
