'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  buttonClass,
  Card,
  IconButton,
  Popover,
  SegmentedControl,
  Sparkline,
  Stat,
  StatusTile,
  Table,
  TBody,
  Td,
  Th,
  THead,
  TileGrid,
  Tr,
} from '@jirawatpyk/aura-react';
import {
  IconArrowRight,
  IconBell,
  IconChartColumn,
  IconCheck,
  IconCircleAlert,
  IconCircleCheck,
  IconClock,
  IconEyeOff,
  IconInfo,
  IconShieldAlert,
  IconTrendingDown,
  IconUser,
  IconUsers,
} from '@jirawatpyk/aura-react/icons';
import {
  formatDuration,
  formatDurationSeconds,
  formatIncidentId,
  formatMs,
  formatPercent,
  formatTier,
  formatTime,
  formatTimeWithSeconds,
} from '@dxt/shared';
import {
  GLYPH_LEGEND,
  GLYPHS,
  GlyphRow,
  IncidentLink,
  MutedOverlay,
  TOUCH_HIT,
} from '@/components/site-cells';
import { SiteStatusBadge, WorkflowBadge } from '@/components/status-badges';
import {
  attnMeta,
  canAck,
  chipOf,
  allOkLine,
  durationText,
  monitoredSites,
  nextStep,
  openCaption,
  reasonLine,
  sinceText,
  sitesOkCaption,
  tileState,
  type Banner,
  type Chip,
  type Counts,
  type LiveIssue,
} from '../model';
import type { OverviewKpis, OverviewSite, OverviewViewer } from '../types';

export const LIVE_ISSUES_ID = 'live-issues';

type Acknowledge = (incidentId: string, number: number) => void;

/** One banner per unacknowledged DOWN (§21.1, §14.13): Acknowledge is the page's primary button. */
export function DesktopBanners({
  shown,
  more,
  viewer,
  onAck,
}: {
  shown: Banner[];
  more: number;
  viewer: OverviewViewer;
  onAck: Acknowledge;
}) {
  if (!shown.length) return null;
  return (
    <section aria-label="Unacknowledged DOWN incidents" className="flex flex-col gap-2">
      {shown.map((b) => (
        // The buttons sit at the end of the banner's row, as on Main3 (Alert's `action` would put them
        // underneath); they wrap under the text only when the row runs out of room.
        <Alert key={b.incidentId} tone="danger" icon={<IconCircleAlert />}>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-semibold text-fg-danger">
                <span>{`${b.site.name} is DOWN — ${durationText(b.downMinutes)}`}</span>
                {b.escalated && <WorkflowBadge state="escalated" level={b.level} />}
                <span className="text-sm font-medium">{durationText(b.unackedMinutes, 'unacked')}</span>
              </p>
              <p className="m-0">{b.cause ?? 'Hard fail'}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link href={`/incidents/${b.incidentId}`} className={buttonClass({ variant: 'secondary' })}>
                {`Open ${formatIncidentId(b.number)}`}
              </Link>
              {canAck(viewer, b.site) && (
                <Button variant="primary" icon={<IconCheck />} onClick={() => onAck(b.incidentId, b.number)}>
                  Acknowledge
                </Button>
              )}
            </div>
          </div>
        </Alert>
      ))}
      {more > 0 && (
        <a
          href={`#${LIVE_ISSUES_ID}`}
          className={`self-start px-aura-5 text-sm font-semibold text-fg-danger underline underline-offset-2 ${TOUCH_HIT}`}
        >
          {`and ${more} more → Live issues`}
        </a>
      )}
    </section>
  );
}

const changeOf = (c: OverviewKpis['mttaChange']) =>
  c
    ? {
        value: formatDurationSeconds(c.seconds),
        direction: c.direction,
        // lower is better for both
        tone:
          c.direction === 'down'
            ? ('positive' as const)
            : c.direction === 'up'
              ? ('negative' as const)
              : ('neutral' as const),
        label: 'vs last 30d',
      }
    : undefined;

/** The KPI row (§21.3): organisation-wide for every role. */
export function Kpis({ counts, kpis }: { counts: Counts; kpis: OverviewKpis }) {
  const notEnough = 'Not enough incidents yet';
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      <Stat
        label="Sites OK"
        value={counts.ok}
        unit={`/ ${counts.monitored}`}
        caption={sitesOkCaption(counts)}
        icon={<IconCircleCheck />}
      />
      <Stat label="Open incidents" value={counts.open} caption={openCaption(counts)} icon={<IconBell />} />
      <Stat
        label="MTTA · 30d"
        value={kpis.enough && kpis.mttaSeconds !== null ? formatDurationSeconds(kpis.mttaSeconds) : '—'}
        caption={kpis.enough ? 'DOWN, all tiers · target ≤ 15 min' : notEnough}
        change={kpis.enough ? changeOf(kpis.mttaChange) : undefined}
        icon={<IconClock />}
      />
      <Stat
        label="MTTD · 30d"
        value={kpis.enough && kpis.mttdSeconds !== null ? formatDurationSeconds(kpis.mttdSeconds) : '—'}
        caption={kpis.enough ? 'DOWN, Tier 1 · target ≤ 3 min' : notEnough}
        change={kpis.enough ? changeOf(kpis.mttdChange) : undefined}
        icon={<IconTrendingDown />}
      />
      <Stat
        label="Uptime · 30d"
        value={formatPercent(kpis.uptime30d)}
        caption="All sites · only DOWN time counts"
        icon={<IconChartColumn />}
      />
    </div>
  );
}

export function ChipBadge({ chip }: { chip: Chip }) {
  return (
    <Badge tone="neutral" variant="outline" icon={chip.icon === 'user' ? <IconUser /> : <IconUsers />}>
      {chip.label}
    </Badge>
  );
}

function Legend() {
  return (
    <div className="grid gap-x-8 gap-y-4 text-xs leading-normal text-fg-secondary md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <h3 className="m-0 font-mono text-xs font-normal text-fg-tertiary">STATUS</h3>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(
            [
              ['down', 'hard fail at 2 of 3 locations, twice'],
              ['problem', 'slow, key page, keyword, regional, SSL or domain expiry'],
              ['maintenance', 'planned window'],
              ['ok', 'all checks pass'],
            ] as const
          ).map(([status, text]) => (
            <li key={status} className="flex items-center gap-2">
              <span className="flex w-28 shrink-0">
                <SiteStatusBadge status={status} />
              </span>
              <span>{text}</span>
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className="flex w-28 shrink-0">
              <Badge tone="neutral" variant="outline" icon={<IconEyeOff />}>
                Muted
              </Badge>
            </span>
            <span>alerts off, status unchanged</span>
          </li>
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="m-0 font-mono text-xs font-normal text-fg-tertiary">LOCATIONS</h3>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {GLYPH_LEGEND.map((g) => (
            <li key={g} className="flex min-h-5 items-center gap-2">
              <span className={`flex ${GLYPHS[g].tone}`}>{GLYPHS[g].icon}</span>
              <span>{g === 'chain' ? 'TLS chain error (warning, status unchanged)' : GLYPHS[g].label}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="m-0 border-t border-border-subtle pt-3 md:col-span-2">
        Response 24h: line = p50 per 15 min · gap = no response (site down)
      </p>
    </div>
  );
}

function ResponseCell({ site }: { site: OverviewSite }) {
  const down = site.status === 'down';
  const since = site.incident?.startedAt ?? site.statusSince;
  const label = down
    ? `Response last 24 h, failing since ${since ? formatTime(new Date(since)) : 'now'}`
    : `Response last 24 h, p50 ${site.p50Ms === null ? 'no data' : formatMs(site.p50Ms)}`;
  if (site.series.every((v) => v === null)) {
    return <span className="text-xs text-fg-secondary">{down ? 'No response in 24 h' : 'No data'}</span>;
  }
  return (
    <span className="flex items-center gap-2">
      <Sparkline
        data={site.series}
        failed={site.failed}
        failures="none"
        tone={down ? 'danger' : site.status === 'problem' ? 'warning' : 'accent'}
        label={label}
      />
      <span
        className={`text-xs tabular-nums ${site.status === 'problem' ? 'text-alert-warning-fg' : 'text-fg-secondary'}`}
      >
        {site.p50Ms === null ? '—' : formatMs(site.p50Ms)}
      </span>
    </span>
  );
}

function NextStepCell({
  viewer,
  issue,
  onAck,
}: {
  viewer: OverviewViewer;
  issue: LiveIssue;
  onAck: Acknowledge;
}) {
  const step = nextStep(viewer, issue);
  if (step.kind === 'ack') {
    return (
      <Button
        variant="secondary"
        size="sm"
        icon={<IconCheck />}
        className="relative z-10"
        onClick={() => onAck(step.incidentId, step.number)}
      >
        Acknowledge
      </Button>
    );
  }
  const href = step.kind === 'incident' ? `/incidents/${step.incidentId}` : `/sites/${issue.site.id}`;
  return (
    <Link href={href} className={`relative z-10 ${buttonClass({ variant: 'ghost', size: 'sm' })}`}>
      {step.label}
      <IconArrowRight />
    </Link>
  );
}

/** Live issues (§21.4): one row per site with a reason; the whole row opens Site detail. */
export function LiveIssuesTable({
  issues,
  counts,
  viewer,
  now,
  lastRoundAt,
  onAck,
}: {
  issues: LiveIssue[];
  counts: Counts;
  viewer: OverviewViewer;
  now: Date;
  lastRoundAt: string | null;
  onAck: Acknowledge;
}) {
  return (
    <section
      aria-labelledby={`${LIVE_ISSUES_ID}-title`}
      id={LIVE_ISSUES_ID}
      className="flex scroll-mt-4 flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2
            id={`${LIVE_ISSUES_ID}-title`}
            tabIndex={-1}
            className="m-0 rounded-aura-sm text-2xl font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Live issues
          </h2>
          {issues.length > 0 && (
            <span className="text-sm text-fg-secondary">{attnMeta(viewer, issues, counts)}</span>
          )}
        </div>
        <Popover
          label="Legend"
          placement="bottom-end"
          width={600}
          trigger={<IconButton icon={<IconInfo />} label="Show legend" />}
        >
          <Legend />
        </Popover>
      </div>
      {issues.length === 0 ? (
        <AllOk monitored={counts.monitored} lastRoundAt={lastRoundAt} />
      ) : (
        <Table caption="Live issues" captionHidden rowHeight="density" align="middle">
          <THead>
            <Tr>
              <Th>Status</Th>
              <Th>Site · why</Th>
              <Th>Since</Th>
              <Th className="max-xl:hidden">Owner</Th>
              <Th>BKK SIN TYO</Th>
              <Th className="max-xl:hidden">Response 24h</Th>
              <Th align="end">Next step</Th>
            </Tr>
          </THead>
          <TBody>
            {issues.map((issue) => {
              const { site, reason } = issue;
              const since = sinceText(reason.since, now);
              const chip = chipOf(viewer, site);
              const down = reason.kind === 'down';
              return (
                <Tr
                  key={site.id}
                  className="relative hover:bg-bg-surface-hover has-[a.overview-row:focus-visible]:outline-2 has-[a.overview-row:focus-visible]:-outline-offset-2 has-[a.overview-row:focus-visible]:outline-focus-ring"
                >
                  <Td className="min-w-56">
                    <span className="flex flex-col items-start gap-1">
                      {site.status ? (
                        <SiteStatusBadge status={site.status} />
                      ) : (
                        <span className="text-sm text-fg-secondary">No data yet</span>
                      )}
                      <MutedOverlay mutedUntil={site.mutedUntil} now={now} />
                      {site.incident && (
                        <IncidentLink incident={site.incident} now={now} className="relative z-10" />
                      )}
                    </span>
                  </Td>
                  {/* takes the room left and truncates, so 820 never scrolls sideways (D-032) */}
                  <Td className="w-full max-w-0">
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex min-w-0 items-center gap-2">
                        {/* the row's link: its ::after covers the row (the incident link and Next step sit above) */}
                        <Link
                          href={`/sites/${site.id}`}
                          className="overview-row truncate font-medium text-fg-primary no-underline outline-none after:absolute after:inset-0 after:content-['']"
                        >
                          {site.name}
                        </Link>
                        <span className="font-mono text-xs text-fg-tertiary">
                          {formatTier(site.tier, { short: true })}
                        </span>
                        {chip && <ChipBadge chip={chip} />}
                      </span>
                      <span
                        className={`line-clamp-2 text-xs ${down ? 'font-medium text-fg-danger' : reason.kind === 'problem' ? 'text-alert-warning-fg' : 'text-fg-secondary'}`}
                      >
                        {reasonLine(issue)}
                      </span>
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {since ? (
                      <span className="flex flex-col">
                        <span
                          className={`text-sm tabular-nums ${down ? 'font-semibold text-fg-danger' : ''}`}
                        >
                          {since.duration}
                        </span>
                        <span className="text-xs text-fg-secondary">{since.at}</span>
                      </span>
                    ) : (
                      <span className="text-fg-secondary">—</span>
                    )}
                  </Td>
                  <Td className="w-44 min-w-44 max-xl:hidden">
                    {site.ownerName ? (
                      <span className="flex items-center gap-2">
                        <Avatar name={site.ownerName} size="sm" />
                        {/* wraps between words only, never mid-word (the 1440 "Ar / m" of round 1) */}
                        <span className="min-w-0 text-sm wrap-normal break-normal">{site.ownerName}</span>
                      </span>
                    ) : (
                      <span className="text-fg-secondary">—</span>
                    )}
                  </Td>
                  <Td>
                    <GlyphRow locations={site.locations} />
                  </Td>
                  <Td className="max-xl:hidden">
                    <ResponseCell site={site} />
                  </Td>
                  <Td align="end">
                    <NextStepCell viewer={viewer} issue={issue} onAck={onAck} />
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </section>
  );
}

/** Nothing listed (§21.4): one line with the time of the last full round. */
export function AllOk({
  monitored,
  lastRoundAt,
  phone = false,
  viewerKind,
}: {
  monitored: number;
  lastRoundAt: string | null;
  phone?: boolean;
  viewerKind?: OverviewViewer['kind'];
}) {
  const round = lastRoundAt
    ? `last full round ${phone ? formatTime(new Date(lastRoundAt)) : formatTimeWithSeconds(new Date(lastRoundAt))}`
    : 'no round yet';
  const sub = phone
    ? `${viewerKind === 'viewer' || viewerKind === 'ceo' ? 'Nothing is wrong' : 'Nothing needs you'} · ${round}`
    : `No open incidents, nothing muted, no location warnings · ${round}`;
  return (
    <div className="flex items-center gap-4 rounded-aura-lg border border-border-default bg-bg-surface p-aura-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-aura-full bg-bg-surface-hover text-fg-positive">
        <IconCircleCheck />
      </span>
      <span className="flex flex-col">
        <span className="font-semibold">{allOkLine(monitored)}</span>
        <span className="text-sm text-fg-secondary">{sub}</span>
      </span>
    </div>
  );
}

const TIERS = ['All', 'Tier 1', 'Tier 2', 'Tier 3'] as const;

/** All sites tiles (§21.6): a glance for the NOC wall; the Tier control filters the tiles only. */
export function SiteTiles({ sites, drafts, now }: { sites: OverviewSite[]; drafts: number; now: Date }) {
  const [tier, setTier] = useState<(typeof TIERS)[number]>('All');
  const shown = tier === 'All' ? sites : sites.filter((s) => `Tier ${s.tier}` === tier);
  const ok = sites.filter((s) => s.status === 'ok').length;
  const draftLine = drafts ? ` · ${drafts} ${drafts === 1 ? 'draft' : 'drafts'} not monitored yet` : '';
  return (
    <section aria-labelledby="all-sites-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 id="all-sites-title" className="m-0 text-xl font-semibold">
            All sites
          </h2>
          <span className="text-sm text-fg-secondary">{`${ok}/${sites.length} OK`}</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <SegmentedControl
            label="Filter tiles by tier"
            size="sm"
            options={[...TIERS]}
            value={tier}
            onChange={(v) => setTier(v as (typeof TIERS)[number])}
          />
          <Link href="/sites" className={`text-sm font-medium ${TOUCH_HIT}`}>
            Manage on Sites →
          </Link>
        </div>
      </div>
      <TileGrid columns={{ base: 2, xl: 3 }} aria-label="All monitored sites">
        {shown.map((s) => {
          const t = tileState(s, now);
          const downFor = s.status === 'down' ? (s.incident?.startedAt ?? s.statusSince) : null;
          return (
            <StatusTile
              key={s.id}
              status={s.status ?? 'ok'}
              statusLabel={s.status === null ? 'No data yet' : undefined}
              title={s.name}
              value={
                downFor
                  ? formatDuration(Math.floor((now.getTime() - new Date(downFor).getTime()) / 60_000))
                  : s.p50Ms === null
                    ? '—'
                    : formatMs(s.p50Ms)
              }
              meta={`${formatTier(s.tier, { short: true })}${t.state ? ` · ${t.state}` : ''}`}
              markers={t.markers.map((m) => ({
                icon:
                  m.icon === 'shield-alert' ? (
                    <IconShieldAlert />
                  ) : m.icon === 'bell' ? (
                    <IconBell />
                  ) : (
                    <IconEyeOff />
                  ),
                label: m.label,
                tone: m.icon === 'eye-off' ? 'neutral' : 'warning',
              }))}
              href={`/sites/${s.id}`}
            />
          );
        })}
      </TileGrid>
      <p className="m-0 text-sm text-fg-secondary">
        {tier === 'All'
          ? `${monitoredSites(sites.length)}${draftLine}`
          : `${shown.length} of ${monitoredSites(sites.length)} (${tier})${draftLine}`}
      </p>
    </section>
  );
}

/** Recent events (§21.6, §16.11): newest first; the All incidents link waits for S07 (D-032). */
export function RecentEvents({ events }: { events: { id: string; time: string; text: string }[] }) {
  return (
    <Card title="Recent events" headingLevel={3} className="self-start">
      {events.length === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">No incidents yet.</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="shrink-0 font-mono text-xs leading-5 whitespace-nowrap text-fg-secondary">
                {e.time}
              </span>
              <span>{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
