import { Skeleton } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/` loads: the Overview's shape — header, KPIs, Live issues, tiles + events; phones a short list. */
export function OverviewSkeleton() {
  return (
    <PageSkeleton label="Loading overview">
      <PageHeaderSkeleton actions={1} />
      <div className="grid grid-cols-3 gap-2 md:hidden" aria-hidden>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} variant="rect" height={60} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 max-md:hidden md:grid-cols-3 xl:grid-cols-5" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} variant="rect" height={144} />
        ))}
      </div>
      <CardSkeleton lines={6} />
      {/* the phone's "All N sites" row */}
      <div className="md:hidden" aria-hidden>
        <Skeleton variant="rect" height={48} />
      </div>
      <div
        className="grid grid-cols-1 gap-4 max-md:hidden xl:grid-cols-[minmax(0,1fr)_calc(var(--spacing)*90)]"
        aria-hidden
      >
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} variant="rect" height={60} />
          ))}
        </div>
        <CardSkeleton lines={7} />
      </div>
    </PageSkeleton>
  );
}
