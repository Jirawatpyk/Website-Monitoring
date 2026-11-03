import Link from 'next/link';
import { Alert, buttonClass } from '@jirawatpyk/aura-react';
import { IconTriangleAlert } from '@jirawatpyk/aura-react/icons';
import type { FaultBanner as FaultBannerWords } from '../model';

/**
 * "Monitoring is degraded" (S12a, spec §14.4, MainFault): above every other banner while the engine
 * cron's sweep is stale, desktop and phone (§22.7). The hand check and the manual incident are S12b.
 */
export function FaultBanner({ banner }: { banner: FaultBannerWords }) {
  return (
    <Alert tone="danger" icon={<IconTriangleAlert />}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="m-0 text-base font-semibold text-fg-danger">{banner.title}</p>
          <p className="m-0">{banner.cause}</p>
          <p className="m-0 text-sm text-fg-secondary">{banner.alerted}</p>
        </div>
        <Link href="/probes" className={`max-md:w-full ${buttonClass({ variant: 'secondary' })}`}>
          Open probes &amp; heartbeat
        </Link>
      </div>
    </Alert>
  );
}
