'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Skeleton } from '@jirawatpyk/aura-react';
import { IconLoaderCircle } from '@jirawatpyk/aura-react/icons';
import { formatTime } from '@dxt/shared';

/** After this long a load says so and offers Retry (EmptyStates board, panel 4). */
export const STILL_LOADING_AFTER_MS = 10_000;

const ROW_WIDTHS = ['w-9/12', 'w-7/12', 'w-10/12', 'w-8/12', 'w-9/12', 'w-6/12', 'w-8/12'] as const;

interface LoadingListProps {
  /** What is loading, e.g. "Loading 17 sites". */
  label: string;
  rows?: number;
  /** When the last real data arrived, if any — shown once the load is slow. */
  lastDataAt?: Date | null;
  /** Default: refresh the route. */
  onRetry?: () => void;
}

/**
 * Loading — shape first, never green. Grey skeleton rows (status pills stay grey until real data
 * arrives); after 10 s "Still loading — last data 10:06" with Retry.
 */
export function LoadingList({ label, rows = 7, lastDataAt = null, onRetry }: LoadingListProps) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), STILL_LOADING_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  const retry = () => {
    setSlow(false);
    (onRetry ?? router.refresh)();
  };

  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <div role="status" className="flex items-center gap-2 text-sm text-fg-secondary">
        <IconLoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
        {slow ? (
          <span>Still loading{lastDataAt ? ` — last data ${formatTime(lastDataAt)}` : ''}</span>
        ) : (
          <span>{label}</span>
        )}
        {slow && (
          <Button size="sm" variant="secondary" touchHeight onClick={retry}>
            Retry
          </Button>
        )}
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center gap-3">
            <Skeleton variant="rect" className="h-5 w-18 rounded-aura-full" />
            <div className={ROW_WIDTHS[i % ROW_WIDTHS.length]}>
              <Skeleton variant="text" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
