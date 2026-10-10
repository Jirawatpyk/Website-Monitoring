'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buttonClass, PageHeader } from '@jirawatpyk/aura-react';
import { IconPlus } from '@jirawatpyk/aura-react/icons';
import { formatDay, formatTime, formatTimeWithSeconds } from '@dxt/shared';
import { bannersOf, countsOf, liveIssues, recentEvents, withAck } from '../model';
import type { OverviewData, ProbeHealth } from '../types';
import { DesktopBanners, Kpis, LIVE_ISSUES_ID, LiveIssuesTable, RecentEvents, SiteTiles } from './desktop';
import { PhoneAllSites, PhoneBanners, PhoneCounts, PhoneLiveIssues } from './phone';
import { useLiveRefresh } from '@/components/use-live-refresh';
import { useAckToast, type AckAction, type UndoAction } from '@/components/use-ack-toast';

/** "Probes 3/3 | BKK · SIN · TYO | Verifier idle" (D-032: no heartbeat age until S12). */
function ProbePill({ probes, compact = false }: { probes: ProbeHealth; compact?: boolean }) {
  const allUp = probes.total > 0 && probes.beating.length === probes.total;
  const dot = (
    <span
      aria-hidden
      className={`size-2 shrink-0 rounded-aura-full ${allUp ? 'bg-fg-positive' : probes.beating.length === 0 ? 'bg-fg-danger' : 'bg-alert-warning-fg'}`}
    />
  );
  const count = `Probes ${probes.beating.length}/${probes.total}`;
  if (compact) {
    return (
      <span className="flex items-center gap-2 text-xs text-fg-secondary">
        {dot}
        {count}
      </span>
    );
  }
  return (
    <span className="inline-flex min-h-11 flex-wrap items-center gap-2 rounded-aura-full border border-border-default bg-bg-surface px-aura-4 text-sm">
      {dot}
      <span>{count}</span>
      {probes.beating.length > 0 && (
        <>
          <span aria-hidden className="text-fg-tertiary">
            |
          </span>
          <span className="text-fg-secondary">{probes.beating.join(' · ')}</span>
        </>
      )}
      <span aria-hidden className="text-fg-tertiary">
        |
      </span>
      <span className="text-fg-secondary">{`Verifier ${probes.verifier}`}</span>
    </span>
  );
}

/**
 * The Overview (spec §21, boards Main3 / MainDark3 / MOverview4): banners, KPIs, Live issues, tiles
 * and Recent events from md up; the phone layout below md (D-032). Realtime keeps it current;
 * Acknowledge shows at once with a 10 s Undo.
 */
export function OverviewView({
  data,
  ackAction,
  undoAction,
}: {
  data: OverviewData;
  ackAction: AckAction;
  undoAction: UndoAction;
}) {
  const live = useLiveRefresh();
  const { acked, acknowledge } = useAckToast({ ack: ackAction, undo: undoAction });
  // Acknowledge removes the button that had focus (its banner or row changes): put focus on the Live
  // issues heading once React has drawn the page without it (WCAG 2.4.3, apps/web/CLAUDE.md → Testing)
  const [ackFocus, setAckFocus] = useState(0);
  useEffect(() => {
    if (ackFocus) document.getElementById(`${LIVE_ISSUES_ID}-title`)?.focus();
  }, [ackFocus]);
  const onAck = useCallback(
    (incidentId: string, number: number) => {
      acknowledge(incidentId, number);
      setAckFocus((n) => n + 1);
    },
    [acknowledge],
  );
  const now = useMemo(() => new Date(data.nowIso), [data.nowIso]);
  const sites = useMemo(() => {
    let out = data.sites;
    for (const id of acked) out = withAck(out, id, data.viewer.name);
    return out;
  }, [data.sites, data.viewer.name, acked]);

  const counts = countsOf(sites);
  const issues = liveIssues(sites, now);
  const banners = bannersOf(sites, now);
  const events = recentEvents(data.events, now);
  const isAdmin = data.viewer.kind === 'admin';
  const meta = `${formatDay(now, { weekday: true, year: true })} · ${formatTimeWithSeconds(now)} (UTC+7)${live ? ' · live' : ''}`;

  return (
    <div className="flex flex-col gap-3 md:gap-6">
      {/* What Realtime changed, said once (it updates without a reload); one polite line, not every row */}
      <p className="sr-only" aria-live="polite">
        {`${counts.ok} of ${counts.monitored} sites OK · ${issues.length} live ${issues.length === 1 ? 'issue' : 'issues'}${counts.unacked ? ` · ${counts.unacked} unacknowledged DOWN` : ''}`}
      </p>
      {/* One page header (one h1) whose parts switch at md: Main3 above, MOverview4 below. */}
      <PageHeader
        eyebrow={
          <>
            <span className="max-md:hidden">OVERVIEW</span>
            <span className="uppercase md:hidden">{`${formatDay(now, { weekday: true })} ${formatTime(now)} · UTC+7`}</span>
          </>
        }
        title={
          <>
            <span className="max-md:hidden">Overview</span>
            <span className="md:hidden">{`${counts.ok}/${counts.monitored} OK`}</span>
          </>
        }
        meta={<span className="max-md:hidden">{meta}</span>}
        actions={
          <span className="flex flex-wrap items-center gap-3">
            <span className="max-md:hidden">
              <ProbePill probes={data.probes} />
            </span>
            <span className="md:hidden">
              <ProbePill probes={data.probes} compact />
            </span>
            {isAdmin && (
              <Link href="/sites/new" className={`max-md:hidden ${buttonClass({ variant: 'secondary' })}`}>
                <IconPlus />
                Add site
              </Link>
            )}
          </span>
        }
      />

      {/* desktop and tablet (md up): Main3 / MainDark3 */}
      <div className="flex flex-col gap-6 max-md:hidden">
        <DesktopBanners {...banners} viewer={data.viewer} onAck={onAck} />
        <Kpis counts={counts} kpis={data.kpis} />
        <LiveIssuesTable
          issues={issues}
          counts={counts}
          viewer={data.viewer}
          now={now}
          lastRoundAt={data.lastRoundAt}
          onAck={onAck}
        />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_calc(var(--spacing)*90)]">
          <SiteTiles sites={sites} drafts={data.drafts} now={now} />
          <RecentEvents events={events} />
        </div>
      </div>

      {/* phones (below md): MOverview4 */}
      <div className="flex flex-col gap-3 md:hidden">
        <PhoneBanners {...banners} />
        <PhoneCounts counts={counts} viewer={data.viewer} issues={issues} uptime30d={data.kpis.uptime30d} />
        <PhoneLiveIssues
          issues={issues}
          monitored={counts.monitored}
          viewer={data.viewer}
          now={now}
          lastRoundAt={data.lastRoundAt}
        />
        <PhoneAllSites monitored={counts.monitored} ok={counts.ok} />
      </div>
    </div>
  );
}
