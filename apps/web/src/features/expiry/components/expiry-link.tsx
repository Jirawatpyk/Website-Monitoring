import Link from 'next/link';
import { IconChevronRight, IconLock } from '@jirawatpyk/aura-react/icons';
import { expirySummaryLine, type ExpiryData } from '../model';

/**
 * The "SSL & domains" row at the foot of the phone Sites list (MSites, §39.6): the phone's way to
 * the Expiry page, which isn't a bottom-nav tab. The whole row is a 52 px link.
 */
export function ExpiryLink({ summary }: { summary: ExpiryData['summary'] }) {
  const line = expirySummaryLine(summary);
  return (
    <Link
      href="/expiry"
      className="flex min-h-13 items-center gap-2.5 rounded-aura-lg border border-border-default bg-bg-surface py-2 pr-2 pl-3.5 text-fg-primary no-underline hover:bg-bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <span className="flex text-fg-secondary" aria-hidden>
        <IconLock size="sm" />
      </span>
      <span className="flex min-w-0 grow flex-col leading-snug">
        <span className="text-sm font-medium">SSL &amp; domains</span>
        <span className="text-xs text-fg-secondary">
          {line.due && <span className="font-medium text-alert-warning-fg">{line.due}</span>}
          {line.rest}
        </span>
      </span>
      <span className="flex text-fg-tertiary" aria-hidden>
        <IconChevronRight size="sm" />
      </span>
    </Link>
  );
}
