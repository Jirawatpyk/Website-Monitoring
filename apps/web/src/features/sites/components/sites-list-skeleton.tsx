import { Skeleton } from '@jirawatpyk/aura-react';

const ROWS = 6;
const CHIPS = [56, 80, 96, 120, 64, 80, 80] as const;

/**
 * `/sites` while it loads (EmptyStates board: shape first, never green): the chip row, search and
 * filters, Needs attention, the count line and 72 px table rows from md; on phones the search, the
 * chips and 60 px rows — the same boxes SitesList draws, so nothing jumps when it arrives.
 */
export function SitesListSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      {/* desktop and tablet */}
      <div className="hidden flex-col gap-3 md:flex">
        <div className="flex flex-wrap gap-2">
          {CHIPS.map((w, i) => (
            <Skeleton key={i} variant="rect" height={36} width={w} className="rounded-full" />
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <Skeleton variant="rect" height={44} width={320} />
          <Skeleton variant="rect" height={44} width={88} />
          <Skeleton variant="rect" height={44} width={104} />
          <Skeleton variant="rect" height={44} width={104} />
        </div>
        <Skeleton variant="text" width={240} />
        <div className="flex items-center justify-between">
          <Skeleton variant="text" width={260} />
          <Skeleton variant="rect" height={44} width={140} />
        </div>
        <div className="overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface">
          <div className="h-11 border-b border-border-subtle" />
          {Array.from({ length: ROWS }, (_, i) => (
            <div
              key={i}
              className="flex h-18 items-center gap-6 border-b border-border-subtle px-6 last:border-b-0"
            >
              <Skeleton variant="badge" />
              <div className="flex w-48 flex-col gap-1.5">
                <Skeleton variant="text" width="80%" />
                <Skeleton variant="text" width="55%" />
              </div>
              <Skeleton variant="text" width={24} />
              <Skeleton variant="text" width={80} />
              <Skeleton variant="text" width={64} />
              <span className="grow" />
              <Skeleton variant="rect" height={32} width={96} />
            </div>
          ))}
        </div>
      </div>

      {/* phones */}
      <div className="flex flex-col gap-3 md:hidden">
        <Skeleton variant="rect" height={44} />
        <div className="flex gap-2 overflow-hidden">
          {CHIPS.slice(0, 4).map((w, i) => (
            <Skeleton key={i} variant="rect" height={44} width={w + 8} className="shrink-0 rounded-full" />
          ))}
        </div>
        <Skeleton variant="text" width={96} />
        <div className="overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface">
          {Array.from({ length: ROWS }, (_, i) => (
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
    </div>
  );
}
