import Link from 'next/link';
import { IconChartColumn, IconChevronRight } from '@jirawatpyk/aura-react/icons';

export interface ReportsSummary {
  /** "October 2026": the last complete month. */
  month: string;
  /** Clients with a report that month. */
  count: number;
}

/**
 * The "Uptime reports" row at the foot of the phone Sites list (MSites, spec §42 item 1), under SSL &
 * domains: the phone's way to /reports, which isn't a bottom-nav tab. The whole row is a 52 px link.
 */
export function ReportsLink({ summary }: { summary: ReportsSummary }) {
  return (
    <Link
      href="/reports"
      className="flex min-h-13 items-center gap-2.5 rounded-aura-lg border border-border-default bg-bg-surface py-2 pr-2 pl-3.5 text-fg-primary no-underline hover:bg-bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <span className="flex text-fg-secondary" aria-hidden>
        <IconChartColumn size="sm" />
      </span>
      <span className="flex min-w-0 grow flex-col leading-snug">
        <span className="text-sm font-medium">Uptime reports</span>
        <span className="text-xs text-fg-secondary">
          {`${summary.month} · ${summary.count} client report${summary.count === 1 ? '' : 's'}`}
        </span>
      </span>
      <span className="flex text-fg-tertiary" aria-hidden>
        <IconChevronRight size="sm" />
      </span>
    </Link>
  );
}
