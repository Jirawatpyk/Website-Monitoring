import Link from 'next/link';
import {
  Badge,
  Breadcrumb,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Stat,
  StatusPill,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@jirawatpyk/aura-react';
import {
  IconBell,
  IconChartColumn,
  IconChevronRight,
  IconCircleDotDashed,
  IconClock,
  IconDownload,
  IconExternalLink,
  IconPencil,
  IconTrendingUp,
} from '@jirawatpyk/aura-react/icons';
import {
  formatCount,
  formatDay,
  formatDuration,
  formatIncidentId,
  formatPercent,
  formatTier,
  formatTime,
  formatTimeWithSeconds,
  formatWhen,
  isSameBangkokDay,
  isTlsChainError,
  TIER_CONFIG,
  type Role,
} from '@dxt/shared';
import { LineChart, SeriesKey, type ChartSeries } from '@/components/charts/line-chart';
import { SeverityBadge, WorkflowBadge } from '@/components/status-badges';
import {
  axisLabels,
  intervalLabel,
  responseHoursLabel,
  severityLine,
  SITE_RANGES,
  triggerWord,
  type SiteRange,
} from '../../detail';
import {
  LIST_LOCATIONS,
  type CheckLogRow,
  type DetailIncident,
  type RoundCheck,
  type SiteDetail,
} from '../../types';
import { GLYPHS, IncidentLink, MutedBadge, RowStatusBadge, TOUCH_HIT } from '../site-cells';
import { RangeControl, RangeDependent, RangeProvider } from './range-control';
import { PauseActions } from '@/features/maintenance';

const WHERE: Record<string, string> = { BKK: 'Thai VPS', SIN: 'sin1', TYO: 'hnd1' };
const COLORS: Record<string, ChartSeries['color']> = {
  BKK: '--aura-chart-1',
  SIN: '--aura-chart-2',
  TYO: '--aura-chart-4',
};
/** Rows the phone's "Incidents in range" shows before "+ N more". */
const PHONE_INCIDENTS = 5;
/** Rows Incident history shows — as many as the Check log beside it; Export has every one (the full list
 * of the incidents is on the Incidents page, filtered by site). */
const HISTORY_ROWS = 6;

const ms = (v: number | null) => (v === null ? '—' : String(v));

function series(detail: SiteDetail): ChartSeries[] {
  return LIST_LOCATIONS.map((loc) => ({
    label: `${loc} · ${WHERE[loc]}`,
    shortLabel: loc,
    color: COLORS[loc]!,
    points: detail.chart[loc].map((p) => ({ t: p.t, v: p.ms })),
  }));
}

function statusLine(detail: SiteDetail, now: Date): string | null {
  if (!detail.live) return 'Draft · not monitored';
  if (!detail.status)
    return `No data yet — the first round runs within ${TIER_CONFIG[detail.tier].intervalSec / 60} min`;
  if (!detail.statusSince) return null;
  const since = formatDuration((now.getTime() - Date.parse(detail.statusSince)) / 60_000);
  const word = { ok: 'OK', problem: 'Problem', down: 'Down', maintenance: 'In maintenance' }[detail.status];
  return `${word} since ${formatWhen(new Date(detail.statusSince), now, { midSentence: true })} · ${since}`;
}

/** Who sees Mute / maintenance (spec §11, D-012, D-036): an Admin, or a Responder on a site they own or back up. */
function canMute(detail: SiteDetail, role: Role | null, meId: string): boolean {
  return role === 'admin' || (role === 'responder' && detail.ownerIds.includes(meId));
}

/** `/sites/[siteId]` — boards SiteDetail (md and up) and MSite (phones), one data load. */
export function SiteDetailView({
  detail,
  range,
  role,
  meId,
  viewer = { name: '', email: '' },
  nowIso,
}: {
  detail: SiteDetail;
  range: SiteRange;
  role: Role | null;
  meId: string;
  /** The signed-in person: the mute dialog's "recorded as" and phone "Signed in as" lines. */
  viewer?: { name: string; email: string };
  nowIso: string;
}) {
  const now = new Date(nowIso);
  const isAdmin = role === 'admin';
  const muting = detail.live && canMute(detail, role, meId);
  const line = statusLine(detail, now);
  const lines = series(detail);
  const xLabels = axisLabels(range, detail.chartFrom, detail.chartTo);
  const chartLabel = `Response time in ms over ${SITE_RANGES[range].label} from Bangkok, Singapore and Tokyo${
    detail.stats.p50 === null ? ', no data yet' : `; p50 ${detail.stats.p50} ms`
  }`;

  return (
    <RangeProvider value={range}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <PageHeader
            // Phones: AURA's actions box hugs its content, so the Mute / Maintenance / Edit grid would
            // stop short of the edge — let it take the row (MSite: the buttons span the page).
            className="max-md:[&>:last-child]:w-full"
            breadcrumb={<Breadcrumb items={[{ label: 'Sites', href: '/sites' }, { label: detail.name }]} />}
            title={detail.name}
            meta={
              <span className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <RowStatusBadge row={detail} />
                  <MutedBadge row={detail} now={now} />
                  {line && <span className="text-sm text-fg-secondary">{line}</span>}
                  <span className="contents max-md:hidden">
                    <Badge tone="neutral" variant="outline">
                      {formatTier(detail.tier)}
                    </Badge>
                    <Badge tone="neutral" variant="outline">
                      {intervalLabel(detail.tier)}
                    </Badge>
                    <Badge tone="neutral" variant="outline">
                      {responseHoursLabel(detail.tier)}
                    </Badge>
                  </span>
                </span>
                <span className="text-sm text-fg-secondary md:hidden">
                  {[
                    formatTier(detail.tier),
                    intervalLabel(detail.tier).toLowerCase(),
                    responseHoursLabel(detail.tier),
                    detail.owner && `owner ${detail.owner}`,
                    detail.backup && `backup ${detail.backup}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            }
            actions={
              muting || isAdmin ? (
                <span className="flex flex-wrap items-center gap-3 max-md:grid max-md:w-full max-md:grid-cols-2">
                  {muting && (
                    <PauseActions
                      site={{
                        id: detail.id,
                        name: detail.name,
                        tier: detail.tier,
                        owner: detail.owner,
                        status: detail.status,
                        mutedUntil: detail.mutedUntil,
                        openIncident: detail.openIncident,
                      }}
                      isAdmin={isAdmin}
                      viewerName={viewer.name}
                      viewerEmail={viewer.email}
                    />
                  )}
                  {isAdmin && (
                    <Button
                      variant="primary"
                      icon={<IconPencil />}
                      href={detail.live ? `/sites/${detail.id}/monitors` : `/sites/${detail.id}/edit`}
                      className="max-md:col-span-2"
                    >
                      {detail.live ? 'Edit monitors' : 'Finish setup'}
                    </Button>
                  )}
                </span>
              ) : undefined
            }
          />
          {detail.openIncident && (
            <span className="flex">
              <IncidentLink incident={detail.openIncident} now={now} />
            </span>
          )}
        </div>

        {!detail.live ? (
          <Card>
            <EmptyState
              icon={<IconCircleDotDashed />}
              title="Not monitored yet"
              description={
                isAdmin
                  ? 'This site is a draft. Finish the registration checklist and start monitoring.'
                  : 'This site is a draft. Only an Admin can finish setup.'
              }
            />
          </Card>
        ) : (
          <>
            <InfoStrip detail={detail} />

            <section className="flex flex-col gap-4" aria-labelledby="availability">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="availability" className="m-0 text-2xl font-semibold max-md:sr-only">
                  Availability
                </h2>
                <div className="max-md:w-full">
                  <RangeControl fullWidth />
                </div>
              </div>
              <RangeDependent>
                {/* desktop: four stats */}
                <div className="grid grid-cols-2 gap-4 max-md:hidden xl:grid-cols-4">
                  <Stat
                    label={`Uptime · ${SITE_RANGES[range].label}`}
                    value={detail.stats.uptime === null ? '—' : formatPercent(detail.stats.uptime)}
                    icon={<IconChartColumn />}
                    caption="DOWN minutes only · maintenance excluded"
                  />
                  <Stat
                    label="Response p50"
                    value={ms(detail.stats.p50)}
                    unit={detail.stats.p50 === null ? undefined : 'ms'}
                    icon={<IconClock />}
                    caption="Median across 3 locations"
                  />
                  <Stat
                    label="Response p95"
                    value={ms(detail.stats.p95)}
                    unit={detail.stats.p95 === null ? undefined : 'ms'}
                    icon={<IconTrendingUp />}
                    caption={`Slow rule uses p50: PROBLEM when p50 > ${detail.slowMs / 1000} s for 3 rounds`}
                  />
                  <Stat
                    label="Incidents"
                    value={String(detail.stats.incidents)}
                    icon={<IconBell />}
                    caption={detail.stats.caption}
                  />
                </div>
                {/* phone: three compact cards (MSite) */}
                <div className="grid grid-cols-3 gap-2 md:hidden">
                  <PhoneStat
                    value={detail.stats.uptime === null ? '—' : formatPercent(detail.stats.uptime)}
                    label="Uptime"
                  />
                  <PhoneStat value={detail.stats.p50 === null ? '—' : `${detail.stats.p50} ms`} label="p50" />
                  <PhoneStat value={String(detail.stats.incidents)} label="Incidents" />
                </div>
              </RangeDependent>
            </section>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Card
                className="xl:col-span-2"
                headingLevel={2}
                title={
                  <>
                    <span className="md:hidden">Response time</span>
                    <span className="max-md:hidden">{`Response time by location · ms · ${SITE_RANGES[range].label}`}</span>
                  </>
                }
              >
                <RangeDependent className="flex flex-col gap-3">
                  <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
                    {lines.map((s) => (
                      <SeriesKey key={s.label} series={s} />
                    ))}
                  </span>
                  <LineChart
                    series={lines}
                    from={detail.chartFrom}
                    to={detail.chartTo}
                    xLabels={xLabels}
                    label={chartLabel}
                    empty="No checks in this range yet."
                  />
                </RangeDependent>
              </Card>
              <IncidentsInRange incidents={detail.rangeIncidents} now={now} />
              <LatestRound detail={detail} now={now} />
            </div>

            <MonitorsTable detail={detail} />

            <div className="grid grid-cols-1 gap-4 max-md:hidden xl:grid-cols-2">
              <IncidentHistory detail={detail} />
              <CheckLog detail={detail} now={now} />
            </div>
          </>
        )}
      </div>
    </RangeProvider>
  );
}

function PhoneStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col rounded-aura-md border border-border-default bg-bg-surface px-3 py-2.5 leading-tight">
      <span className="text-xl font-semibold">{value}</span>
      <span className="text-xs text-fg-secondary">{label}</span>
    </div>
  );
}

function InfoStrip({ detail }: { detail: SiteDetail }) {
  const items: [string, React.ReactNode][] = [
    [
      'URL',
      detail.url ? (
        <a
          href={detail.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 [overflow-wrap:anywhere] ${TOUCH_HIT}`}
        >
          {detail.url.replace(/^https?:\/\//, '')}
          <IconExternalLink aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : (
        '—'
      ),
    ],
    [
      'CLIENT · AM',
      detail.client.internal ? 'Internal' : `${detail.client.name} · ${detail.client.amName ?? '—'}`,
    ],
    ['PRIMARY · BACKUP', `${detail.owner ?? '—'} · ${detail.backup ?? '—'}`],
    ['HOSTING', detail.hosting ?? '—'],
    ['CREDENTIALS', detail.credentialRef ? `Reference only — ${detail.credentialRef}` : '—'],
  ];
  return (
    <Card className="max-md:hidden">
      <dl className="m-0 grid grid-cols-3 gap-x-6 gap-y-4 xl:grid-cols-5">
        {items.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col leading-normal">
            <dt className="font-mono text-xs text-fg-tertiary">{k}</dt>
            <dd className="m-0 text-sm font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function LatestRound({ detail, now }: { detail: SiteDetail; now: Date }) {
  const round = detail.round;
  const passing = round.filter((r) => r.outcome === 'pass').length;
  const times = round.map((r) => Date.parse(r.checkedAt)).sort((a, b) => a - b);
  const first = times[0];
  const last = times.at(-1);
  const interval = TIER_CONFIG[detail.tier].intervalSec * 1000;
  const next = last !== undefined ? new Date((Math.floor(last / interval) + 1) * interval) : null;
  return (
    <Card
      headingLevel={2}
      title="Latest round"
      actions={
        last !== undefined && next ? (
          <span className="font-mono text-xs leading-6 text-fg-secondary">
            {`${formatTimeWithSeconds(new Date(last))} · next ${formatTimeWithSeconds(next)}`}
          </span>
        ) : undefined
      }
    >
      {round.length === 0 || first === undefined || last === undefined ? (
        <p className="m-0 text-sm text-fg-secondary">No checks in the last 15 minutes.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {round.map((r) => (
            <RoundRow key={r.location} r={r} />
          ))}
          {/* The round's own vote; the site status is the worst of every monitor, so it isn't an arrow
              from this vote (spec-checker H2) */}
          <dl className="m-0 mt-1 flex flex-col gap-1 border-t border-border-default pt-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-secondary">Vote</dt>
              <dd className="m-0 font-semibold">{`${passing}/${round.length} pass`}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-secondary">Round window</dt>
              <dd className="m-0">{`${TIER_CONFIG[detail.tier].roundWindowSec} s (${formatTier(detail.tier)})`}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-secondary">Checked at</dt>
              <dd className="m-0">
                {first === last
                  ? formatTimeWithSeconds(new Date(first))
                  : `${formatTimeWithSeconds(new Date(first))}–${formatTimeWithSeconds(new Date(last))}`}
                {isSameBangkokDay(new Date(first), now) ? '' : ` · ${formatDay(new Date(first))}`}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </Card>
  );
}

function RoundRow({ r }: { r: RoundCheck }) {
  const g = GLYPHS[r.glyph];
  return (
    <div className="flex items-center gap-3 rounded-aura-md border border-border-default px-3 py-2.5 leading-snug">
      <span className={`flex ${g.tone}`} role="img" aria-label={`${r.location}: ${g.label}`}>
        {g.icon}
      </span>
      <span className="flex min-w-0 grow flex-col">
        <span className="truncate text-sm font-semibold">
          {r.location} <span className="font-normal text-fg-secondary">{WHERE[r.location]}</span>
        </span>
        <span className="font-mono text-xs text-fg-tertiary">
          {formatTimeWithSeconds(new Date(r.checkedAt))}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="text-sm tabular-nums">{r.responseMs === null ? '—' : `${r.responseMs} ms`}</span>
        <span className="font-mono text-xs text-fg-tertiary">
          {r.statusCode ? `HTTP ${r.statusCode}` : g.label}
        </span>
      </span>
    </div>
  );
}

/** "+ 2 more: Slow 18 Aug (14 min), SSL expiring 11 Aug" — at most three named, then a count (MSite 90 d). */
function moreLine(rest: DetailIncident[]): string {
  const named = rest
    .slice(0, 3)
    .map(
      (i) =>
        `${triggerWord(i.trigger)} ${formatDay(new Date(i.startedAt))}${i.minutes !== null && !i.open ? ` (${formatDuration(i.minutes)})` : ''}`,
    )
    .join(', ');
  const others = rest.length - 3;
  return `+ ${rest.length} more: ${named}${others > 0 ? ` and ${others} earlier` : ''}`;
}

/** Phone only (MSite "Incidents in range"); desktop shows the 90-day history table instead. */
function IncidentsInRange({ incidents, now }: { incidents: DetailIncident[]; now: Date }) {
  const shown = incidents.slice(0, PHONE_INCIDENTS);
  const more = incidents.length - shown.length;
  return (
    <Card className="overflow-hidden md:hidden" title="Incidents in range" headingLevel={2}>
      {incidents.length === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">No incidents in this range.</p>
      ) : (
        <>
          {/* the rows and their hover reach the card's edges (out by AURA's card padding), as on the Sites list */}
          <ul
            className="m-0 flex list-none flex-col p-0"
            style={{ marginInline: 'calc(-1 * var(--aura-card-padding))' }}
          >
            {shown.map((i) => (
              <li key={i.id} className="border-b border-border-subtle last:border-b-0">
                <Link
                  href={`/incidents/${i.id}`}
                  className="flex min-h-11 items-center gap-2 py-1 text-fg-primary no-underline hover:bg-bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
                  style={{ paddingInline: 'var(--aura-card-padding)' }}
                >
                  <span className="flex w-28 shrink-0">
                    {i.open ? (
                      <WorkflowBadge state={i.state} level={i.level} />
                    ) : (
                      <SeverityBadge severity={i.severity} recovered />
                    )}
                  </span>
                  <span className="flex min-w-0 grow flex-col leading-tight">
                    <span className="truncate text-sm">
                      {i.cause ? `${triggerWord(i.trigger)} · ${i.cause}` : triggerWord(i.trigger)}
                    </span>
                    <span className="text-xs text-fg-secondary">
                      {formatWhen(new Date(i.startedAt), now)}
                    </span>
                  </span>
                  <span className="text-sm whitespace-nowrap tabular-nums">
                    {i.open ? 'Open' : i.minutes === null ? '—' : formatDuration(i.minutes)}
                  </span>
                  <span className="flex text-fg-tertiary">
                    <IconChevronRight />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {more > 0 && (
            <p className="m-0 pt-2 text-xs text-fg-secondary">{moreLine(incidents.slice(PHONE_INCIDENTS))}</p>
          )}
        </>
      )}
    </Card>
  );
}

function MonitorsTable({ detail }: { detail: SiteDetail }) {
  return (
    <section className="flex flex-col gap-3 max-md:hidden" aria-labelledby="monitors">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="monitors" className="m-0 text-2xl font-semibold">
          Monitors
        </h2>
        <span className="text-sm text-fg-secondary">
          Site status = worst of these. Only the primary monitor can make the site DOWN.
        </span>
      </div>
      <Table caption="Monitors" captionHidden stackBelow="md" rowHeight="density" align="middle">
        <THead>
          <Tr>
            <Th>Type</Th>
            <Th>Target</Th>
            <Th>Assertions</Th>
            <Th>Max severity</Th>
            <Th>Status</Th>
            <Th align="end">Last result</Th>
          </Tr>
        </THead>
        <TBody>
          {detail.monitors.map((m) => (
            <Tr key={m.id}>
              <Td>
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span className="font-medium">{m.isPrimary ? 'HTTP' : 'Key page'}</span>
                  {m.isPrimary && (
                    <Badge tone="neutral" variant="outline">
                      Primary
                    </Badge>
                  )}
                </span>
              </Td>
              <Td mono>{m.target}</Td>
              <Td className="text-fg-secondary">{m.assertions}</Td>
              <Td mono>{m.isPrimary ? 'DOWN' : 'PROBLEM'}</Td>
              <Td>
                {m.status ? (
                  <RowStatusBadge row={{ live: true, status: m.status }} />
                ) : (
                  <span className="text-fg-secondary">—</span>
                )}
              </Td>
              <Td numeric>{m.lastMs === null ? '—' : `${m.lastMs} ms`}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </section>
  );
}

function IncidentHistory({ detail }: { detail: SiteDetail }) {
  const n = detail.history.length;
  const shown = detail.history.slice(0, HISTORY_ROWS);
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="history">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 id="history" className="m-0 text-2xl font-semibold">
          Incident history
        </h2>
        {n > 0 && (
          <Button
            variant="ghost"
            size="sm"
            icon={<IconDownload />}
            href={`/sites/${detail.id}/incidents.csv`}
          >
            Export
          </Button>
        )}
      </div>
      {n === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">No incidents in the last 90 days.</p>
      ) : (
        <Table caption="Incident history, last 90 days" captionHidden rowHeight="density" align="middle">
          <THead>
            <Tr>
              <Th>ID</Th>
              <Th>Started</Th>
              <Th align="end">Dur.</Th>
              <Th>Trigger</Th>
              <Th>State</Th>
            </Tr>
          </THead>
          <TBody>
            {shown.map((h) => (
              <Tr key={h.id}>
                <Td mono className="whitespace-nowrap">
                  <Link
                    href={`/incidents/${h.id}`}
                    className={`underline underline-offset-2 hover:decoration-2 ${TOUCH_HIT}`}
                  >
                    {formatIncidentId(h.number)}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap tabular-nums">{`${formatDay(new Date(h.startedAt))} ${formatTime(new Date(h.startedAt))}`}</Td>
                <Td numeric className="whitespace-nowrap">
                  {h.open ? 'Open' : h.minutes === null ? '—' : formatDuration(h.minutes)}
                </Td>
                <Td>
                  <span className="flex flex-col leading-tight">
                    <span>{triggerWord(h.trigger)}</span>
                    <span className="text-xs text-fg-secondary">{severityLine(h.severity, h.trigger)}</span>
                  </span>
                </Td>
                <Td>
                  <WorkflowBadge state={h.state} level={h.level} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {/* same row as the Check log footer, pinned to the bottom so both line up side by side */}
      <p className="m-0 mt-auto flex min-h-8 items-center text-sm text-fg-secondary">
        {`${detail.historyCount} in 90 days${detail.historyMttr === null ? '' : ` · MTTR ${formatDuration(detail.historyMttr)} (DOWN only · median)`}`}
        {detail.historyCount > shown.length && ` · showing the latest ${shown.length}, Export has all`}
      </p>
    </section>
  );
}

/** A check's outcome as a pill: a TLS chain error is a warning, never a hard fail (D-029). */
function OutcomePill({ c }: { c: CheckLogRow }) {
  if (c.outcome === 'pass') return <StatusPill tone="ready">Pass</StatusPill>;
  if (c.outcome === 'blocked') return <StatusPill tone="neutral">Blocked</StatusPill>;
  if (isTlsChainError(c.error)) return <StatusPill tone="warning">TLS chain</StatusPill>;
  return <StatusPill tone="blocked">Fail</StatusPill>;
}

function CheckLog({ detail, now }: { detail: SiteDetail; now: Date }) {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="checklog">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 id="checklog" className="m-0 text-2xl font-semibold">
          Check log
        </h2>
        <span className="text-sm text-fg-secondary">Raw results kept 90 days</span>
      </div>
      {detail.log.length === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">No checks in the last 24 hours.</p>
      ) : (
        <Table
          caption="Latest checks of the primary monitor"
          captionHidden
          rowHeight="density"
          align="middle"
        >
          <THead>
            <Tr>
              <Th>Time</Th>
              <Th>Loc</Th>
              <Th>Outcome</Th>
              <Th align="end">HTTP</Th>
              <Th align="end">Response</Th>
              <Th align="end">TTFB</Th>
            </Tr>
          </THead>
          <TBody>
            {detail.log.map((c) => (
              <Tr key={c.id}>
                <Td mono>
                  {formatTimeWithSeconds(new Date(c.checkedAt))}
                  {isSameBangkokDay(new Date(c.checkedAt), now)
                    ? ''
                    : ` · ${formatDay(new Date(c.checkedAt))}`}
                </Td>
                <Td mono>{c.location}</Td>
                <Td>
                  <OutcomePill c={c} />
                </Td>
                <Td numeric>{c.statusCode ?? '—'}</Td>
                <Td numeric>{c.responseMs === null ? '—' : `${c.responseMs} ms`}</Td>
                <Td numeric>{c.ttfbMs === null ? '—' : `${c.ttfbMs} ms`}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      <div className="mt-auto flex min-h-8 flex-wrap items-center justify-between gap-3 text-sm text-fg-secondary">
        <span>{`Latest ${detail.log.length} of ${formatCount(detail.checksToday)} checks today`}</span>
        {detail.checksToday > 0 && (
          <Button variant="ghost" size="sm" icon={<IconDownload />} href={`/sites/${detail.id}/checks.csv`}>
            Download today’s log
          </Button>
        )}
      </div>
    </section>
  );
}
