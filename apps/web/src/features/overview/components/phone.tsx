'use client';

import Link from 'next/link';
import { Badge, Card } from '@jirawatpyk/aura-react';
import { IconChevronRight, IconCircleAlert, IconEyeOff, IconMonitor } from '@jirawatpyk/aura-react/icons';
import { formatDuration, formatIncidentId } from '@dxt/shared';
import { TOUCH_HIT } from '@/components/site-cells';
import { SiteStatusBadge } from '@/components/status-badges';
import {
  chipOf,
  isMuted,
  phoneHref,
  reasonLine,
  sinceText,
  thirdCard,
  type Banner,
  type Counts,
  type LiveIssue,
} from '../model';
import type { OverviewViewer } from '../types';
import { AllOk, ChipBadge, LIVE_ISSUES_ID } from './desktop';

const PHONE_LIVE_ID = `${LIVE_ISSUES_ID}-phone`;

/** Phone banners (§21.1, §21.7): tappable cards → that incident; no Acknowledge on phones (MOverview4). */
export function PhoneBanners({ shown, more }: { shown: Banner[]; more: number }) {
  if (!shown.length) return null;
  return (
    <section aria-label="Unacknowledged DOWN incidents" className="flex flex-col gap-2">
      {shown.map((b) => {
        const sub = b.escalated
          ? `Escalated · L${b.level} · ${formatDuration(b.unackedMinutes)} unacked`
          : `${formatDuration(b.unackedMinutes)} unacked · ${b.cause ?? 'Hard fail'}`;
        return (
          <Link
            key={b.incidentId}
            href={`/incidents/${b.incidentId}`}
            aria-label={`${b.site.name} is DOWN, ${b.downMinutes} minutes. ${sub}. Open ${formatIncidentId(b.number)}`}
            className="flex min-h-11 items-center gap-3 rounded-aura-lg border border-alert-danger-border bg-alert-danger-bg p-aura-4 text-fg-primary no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <span className="flex text-fg-danger">
              <IconCircleAlert />
            </span>
            <span className="flex min-w-0 grow flex-col">
              <span className="font-semibold text-fg-danger">{`${b.site.name} is DOWN — ${formatDuration(b.downMinutes)}`}</span>
              <span className="text-sm">{sub}</span>
            </span>
            <span className="flex">
              <IconChevronRight />
            </span>
          </Link>
        );
      })}
      {more > 0 && (
        <a
          href={`#${PHONE_LIVE_ID}`}
          className="flex min-h-11 items-center justify-center rounded-aura-md border border-alert-danger-border bg-bg-surface text-sm font-semibold text-fg-danger no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {`and ${more} more → Live issues`}
        </a>
      )}
    </section>
  );
}

/** Open · Unacked · the third card by role (§21.7–8); counts, not links, until the Incidents list (S07, D-032). */
export function PhoneCounts({
  counts,
  viewer,
  issues,
  uptime30d,
}: {
  counts: Counts;
  viewer: OverviewViewer;
  issues: LiveIssue[];
  uptime30d: number;
}) {
  const third = thirdCard(viewer, issues, uptime30d);
  const cards = [
    { label: 'Open', value: String(counts.open), danger: false },
    { label: 'Unacked', value: String(counts.unacked), danger: counts.unacked > 0 },
    { label: third.label, value: third.value, danger: false },
  ];
  return (
    <dl className="m-0 grid grid-cols-3 gap-2">
      {cards.map((c) => (
        <div
          key={c.label}
          className="flex flex-col-reverse rounded-aura-md border border-border-default bg-bg-surface px-aura-3 py-aura-2"
        >
          <dt className="text-xs text-fg-secondary">{c.label}</dt>
          <dd className={`m-0 text-xl font-semibold tabular-nums ${c.danger ? 'text-fg-danger' : ''}`}>
            {c.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Live issues on a phone (§21.7): badge, one reason, Since and the ownership chip; no owner, glyphs or line. */
export function PhoneLiveIssues({
  issues,
  monitored,
  viewer,
  now,
  lastRoundAt,
}: {
  issues: LiveIssue[];
  monitored: number;
  viewer: OverviewViewer;
  now: Date;
  lastRoundAt: string | null;
}) {
  return (
    <section
      aria-labelledby={`${PHONE_LIVE_ID}-title`}
      id={PHONE_LIVE_ID}
      className="flex scroll-mt-4 flex-col gap-2"
    >
      <div className="flex items-baseline gap-2">
        <h2 id={`${PHONE_LIVE_ID}-title`} className="m-0 text-lg font-semibold">
          Live issues
        </h2>
        {issues.length > 0 && (
          <span className="text-xs text-fg-secondary">{`${issues.length} of ${monitored} sites`}</span>
        )}
      </div>
      {issues.length === 0 ? (
        <AllOk monitored={monitored} lastRoundAt={lastRoundAt} phone viewerKind={viewer.kind} />
      ) : (
        <Card className="overflow-hidden">
          <ul
            className="m-0 flex list-none flex-col p-0"
            style={{ margin: 'calc(-1 * var(--aura-card-padding))' }}
          >
            {issues.map((issue) => {
              const { site, reason } = issue;
              const since = sinceText(reason.since, now);
              const chip = chipOf(viewer, site);
              const down = reason.kind === 'down';
              return (
                <li key={site.id} className="border-b border-border-subtle last:border-b-0">
                  <Link
                    href={phoneHref(issue)}
                    className="flex min-h-15 items-center gap-2.5 py-2 pr-2 pl-3.5 text-fg-primary no-underline hover:bg-bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    <span className="flex w-22 shrink-0 flex-col items-start gap-1">
                      {site.status ? <SiteStatusBadge status={site.status} /> : null}
                      {isMuted(site, now) && (
                        <Badge tone="neutral" variant="outline" icon={<IconEyeOff />}>
                          Muted
                        </Badge>
                      )}
                    </span>
                    <span className="flex min-w-0 grow flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">{site.name}</span>
                        {chip && <ChipBadge chip={chip} />}
                      </span>
                      <span
                        className={`line-clamp-2 text-xs ${down ? 'font-medium text-fg-danger' : reason.kind === 'problem' || reason.kind === 'root_cause' ? 'text-alert-warning-fg' : 'text-fg-secondary'}`}
                      >
                        {reasonLine(issue, { phone: true })}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end">
                      <span className={`text-sm tabular-nums ${down ? 'font-semibold text-fg-danger' : ''}`}>
                        {since?.duration ?? '—'}
                      </span>
                      {since && <span className="text-xs text-fg-secondary">{since.at}</span>}
                    </span>
                    <span className="flex text-fg-tertiary">
                      <IconChevronRight />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}

/** "All N sites · N OK ›" → Sites (§21.7). */
export function PhoneAllSites({ monitored, ok }: { monitored: number; ok: number }) {
  return (
    <Link
      href="/sites"
      className={`flex min-h-12 items-center gap-3 rounded-aura-lg border border-border-default bg-bg-surface px-aura-4 text-fg-primary no-underline hover:bg-bg-surface-hover ${TOUCH_HIT}`}
    >
      <span className="flex text-fg-secondary">
        <IconMonitor />
      </span>
      <span className="grow text-sm">
        {`All ${monitored} sites`}
        <span className="text-fg-secondary">{` · ${ok} OK`}</span>
      </span>
      <span className="flex text-fg-tertiary">
        <IconChevronRight />
      </span>
    </Link>
  );
}
