'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  FilterSelect,
  PageHeader,
  SegmentedControl,
  Stat,
  type DataTableColumn,
} from '@jirawatpyk/aura-react';
import {
  IconArrowUpRight,
  IconDownload,
  IconSearch,
  IconX,
  IconBell,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconCircleCheck,
  IconInfo,
  IconPencil,
  IconRotateCcw,
} from '@jirawatpyk/aura-react/icons';
import { formatDuration, formatDurationSeconds, formatIncidentId, formatWhen, type Role } from '@dxt/shared';
import { SeverityBadge, WorkflowBadge } from '@/components/status-badges';
import { useLiveRefresh } from '@/components/use-live-refresh';
import { useNow } from '@/components/use-now';
import {
  countLabel,
  DEFAULT_FILTERS,
  desktopViewCounts,
  durationMinutes,
  filterIncidents,
  hiddenNote,
  isDefaultFilter,
  lastOneLine,
  isOpen,
  isUnackedDown,
  listKpis,
  nextLine,
  phoneViewCounts,
  triggerWords,
  type DesktopView,
  type ListFilters,
  type ListIncident,
  type PhoneView,
} from '../model';
import { mayAcknowledge } from '../ack-rule';
import { INCIDENT_COLUMNS } from './incident-columns';

/** The phone's Past view shows the latest few until "Show all" (MIncidents). */
const PAST_SHOWN = 4;
const LIST_TABLES = ['incidents'] as const;
/** Rows per page (desktop) and cards before "Show all" (phone): the list stays light. */
const PAGE_SIZE = 50;
/** How often the waits and durations of open incidents move on screen. */
const AGE_EVERY_MS = 60_000;

const SEVERITY_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'down', label: 'Down' },
  { value: 'problem', label: 'Problem' },
];
const PERIOD_OPTIONS = [
  { value: '30', label: 'Last 30 days' },
  { value: '7', label: 'Last 7 days' },
];

const TONE: Record<'danger' | 'warning' | 'secondary', string> = {
  danger: 'text-fg-danger',
  warning: 'text-alert-warning-fg',
  secondary: 'text-fg-secondary',
};

const hrefOf = (i: Pick<ListIncident, 'id'>) => `/incidents/${i.id}`;

export interface IncidentsListProps {
  /** The header's date line, from the server's clock. */
  meta: string;
  incidents: ListIncident[];
  sites: { id: string; name: string }[];
  nowIso: string;
  /** The signed-in person: only someone who may acknowledge sees a card's Acknowledge row (D-016). */
  viewer: { id: string; role: Role };
  /** The view a link asked for (`?view=unacked` from the Overview's phone card). */
  initialView?: DesktopView | PhoneView;
}

/**
 * Incidents (desktop) and MIncidents (phone) — spec §4, §11, §16.1, D-033. The server reads the last
 * 30 days plus anything still open; views, filters and counts are worked out here (`model.ts`).
 */
export function IncidentsList({ meta, incidents, sites, nowIso, viewer, initialView }: IncidentsListProps) {
  // "18 min unacked" and running durations age while the page stays open (§14.3).
  const now = useNow(nowIso, AGE_EVERY_MS, incidents.some(isOpen));
  // New incidents, acks and resolves show without a reload (PRD §9).
  useLiveRefresh(LIST_TABLES);
  const phoneStart: PhoneView = initialView === 'unacked' || initialView === 'past' ? initialView : 'open';
  const desktopStart: DesktopView =
    initialView === 'done' || initialView === 'all' ? initialView : 'needs_action';
  const [f, setF] = useState<ListFilters>({ ...DEFAULT_FILTERS, view: desktopStart });
  const [phoneView, setPhoneView] = useState<PhoneView>(phoneStart);
  const [showAllPast, setShowAllPast] = useState(false);

  const kpis = listKpis(incidents, now);
  const counts = desktopViewCounts(incidents, f, now);
  const { rows } = filterIncidents(incidents, f, now);
  const note = hiddenNote(incidents, f, now);
  const exportHref = `/incidents/incidents.csv?${new URLSearchParams({
    view: f.view,
    severity: f.severity,
    period: String(f.period),
    ...(f.siteId ? { site: f.siteId } : {}),
  }).toString()}`;

  // Widths and the table widths each optional column appears from (`INCIDENT_COLUMNS`, tested to fit):
  // ID, Site, Severity and State always; Started, Duration, Trigger as the table grows. The owner reads
  // under the site and the next step under the state, as Sites stacks its cells (D-033; fits 820 px).
  const C = INCIDENT_COLUMNS;
  const columns: DataTableColumn<ListIncident>[] = [
    {
      key: 'id',
      label: 'ID',
      width: C.id.width,
      // The row is the link (getRowHref): no link of its own inside it.
      render: (i) => <span className="font-mono text-sm">{formatIncidentId(i.number)}</span>,
    },
    {
      key: 'site',
      label: 'Site',
      render: (i) => (
        <span className="flex min-w-0 flex-col py-1.5 leading-snug">
          <span className="truncate font-medium">{i.siteName}</span>
          <span className="truncate text-xs text-fg-secondary">
            {i.ownerName ? `Owner ${i.ownerName}` : 'No owner set'}
          </span>
        </span>
      ),
    },
    {
      key: 'severity',
      label: 'Severity',
      width: C.severity.width,
      render: (i) => <SeverityBadge severity={i.severity} recovered={!!i.recoveredAt || !isOpen(i)} />,
    },
    {
      key: 'trigger',
      label: 'Trigger',
      width: C.trigger.width,
      hideBelow: C.trigger.from,
      render: (i) => <span className="text-sm">{triggerWords(i)}</span>,
    },
    {
      key: 'state',
      label: 'State · next',
      width: C.state.width,
      render: (i) => {
        const n = nextLine(i, now);
        return (
          <span className="flex flex-col items-start gap-1 py-1.5 leading-snug">
            <WorkflowBadge state={i.state} level={i.escalationLevel} />
            <span className={`text-xs ${TONE[n.tone]}`}>{n.text}</span>
          </span>
        );
      },
    },
    {
      key: 'started',
      label: 'Started',
      width: C.started.width,
      hideBelow: C.started.from,
      render: (i) => <span className="text-sm tabular-nums">{formatWhen(new Date(i.startedAt), now)}</span>,
    },
    {
      key: 'duration',
      label: 'Duration',
      align: 'end',
      width: C.duration.width,
      hideBelow: C.duration.from,
      render: (i) => (
        <span className="text-sm whitespace-nowrap">{formatDuration(durationMinutes(i, now))}</span>
      ),
    },
  ];

  const phoneRows = filterIncidents(incidents, { ...DEFAULT_FILTERS, view: phoneView }, now).rows;
  const phoneCounts = phoneViewCounts(incidents, now);
  const phoneShown =
    phoneView === 'past' && !showAllPast
      ? phoneRows.slice(0, PAST_SHOWN)
      : showAllPast
        ? phoneRows
        : phoneRows.slice(0, PAGE_SIZE);
  const phoneCount =
    phoneView === 'past' && !showAllPast && phoneRows.length > PAST_SHOWN
      ? `Last 30 days · latest ${PAST_SHOWN} of ${phoneRows.length} resolved, in review or closed`
      : countLabel(incidents, { ...DEFAULT_FILTERS, view: phoneView }, now);

  return (
    <>
      {/* The header lives here, not in the route: Export CSV follows the filters (Incidents board: in the
          header's actions; MIncidents has no export). */}
      <PageHeader
        titleHideBelow="lg"
        eyebrow="INCIDENTS"
        title="Incidents"
        meta={meta}
        actions={
          <span className="hidden md:inline-flex">
            <Button variant="secondary" icon={<IconDownload />} href={exportHref} download>
              Export CSV
            </Button>
          </span>
        }
      />
      {/* ── desktop and tablets (Incidents) ── */}
      <div className="hidden flex-col gap-6 md:flex">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
          <Stat label="Open" value={kpis.open} caption={kpis.openCaption} icon={<IconBell />} />
          <Stat
            label="Escalated, not acked"
            value={kpis.escalated}
            caption={kpis.escalatedCaption}
            icon={<IconArrowUpRight />}
          />
          <Stat
            label="Needs root cause"
            value={kpis.needsRootCause}
            caption={kpis.needsRootCauseCaption}
            icon={<IconPencil />}
          />
          <Stat
            label="MTTA · 30d"
            value={
              kpis.mttaEnough && kpis.mttaSeconds !== null ? formatDurationSeconds(kpis.mttaSeconds) : '—'
            }
            caption={kpis.mttaEnough ? 'DOWN only · mean · target ≤ 15 min' : 'Not enough incidents yet'}
            icon={<IconCheck />}
          />
          <Stat
            label="MTTR · 30d"
            value={kpis.mttrMinutes !== null ? formatDuration(kpis.mttrMinutes) : '—'}
            caption={
              kpis.mttrMinutes !== null ? 'DOWN only · median · minutes down' : 'Not enough incidents yet'
            }
            icon={<IconRotateCcw />}
          />
        </div>

        <div className="flex flex-col gap-3">
          <FilterBar>
            {/* Default size, as tall as the FilterSelects beside it (the board draws both at 32 px; AURA's
                FilterSelect has no small size). */}
            <SegmentedControl
              label="State"
              value={f.view}
              onChange={(v) => setF({ ...f, view: v as DesktopView })}
              options={[
                { value: 'needs_action', label: `Needs action · ${counts.needs_action}` },
                { value: 'done', label: `Resolved & closed · ${counts.done}` },
                { value: 'all', label: `All · ${counts.all}` },
              ]}
            />
            <FilterSelect
              label="Severity"
              allLabel="all"
              options={SEVERITY_OPTIONS}
              value={f.severity}
              onChange={(v) => setF({ ...f, severity: v as ListFilters['severity'] })}
            />
            <FilterSelect
              label="Site"
              allLabel="all"
              options={[
                { value: 'all', label: 'All' },
                ...sites.map((s) => ({ value: s.id, label: s.name })),
              ]}
              value={f.siteId ?? 'all'}
              onChange={(v) => setF({ ...f, siteId: v === 'all' ? null : v })}
            />
            <FilterSelect
              label="Period"
              options={PERIOD_OPTIONS}
              value={String(f.period)}
              onChange={(v) => setF({ ...f, period: v === '7' ? 7 : 30 })}
            />
          </FilterBar>
          <div className="flex min-h-8 flex-wrap items-center gap-2 text-sm">
            <span className="font-medium" aria-live="polite">
              {countLabel(incidents, f, now)}
            </span>
          </div>

          {rows.length === 0 ? (
            isDefaultFilter(f) && f.view === 'needs_action' ? (
              <EmptyState
                bordered
                headingLevel={2}
                icon={<IconCircleCheck />}
                title="No open incidents"
                description={lastOneLine(incidents, now)}
              />
            ) : isDefaultFilter(f) ? (
              <EmptyState
                bordered
                headingLevel={2}
                icon={<IconCircleCheck />}
                title={f.view === 'done' ? 'No past incidents' : 'No incidents'}
                description={`Nothing ${f.view === 'done' ? 'resolved' : 'opened'} in the last ${f.period} days.`}
              />
            ) : (
              <EmptyState
                bordered
                headingLevel={2}
                icon={<IconSearch />}
                title={`No incidents match ${filterWords(f, sites)}`}
                description="Every incident is still there — only this list is filtered."
                action={
                  <Button
                    variant="secondary"
                    icon={<IconX />}
                    onClick={() => setF({ ...DEFAULT_FILTERS, view: f.view })}
                  >
                    Clear filters
                  </Button>
                }
              />
            )
          ) : (
            <DataTable
              label="Incidents"
              rowKey="id"
              columns={columns}
              rows={rows}
              rowHeight="auto"
              getRowHref={hrefOf}
              linkComponent={Link}
              pageSize={PAGE_SIZE}
            />
          )}
        </div>

        <p className="m-0 flex items-start gap-2 text-sm text-fg-secondary">
          <span className="flex pt-0.5">
            <IconInfo aria-hidden className="size-4" />
          </span>
          <span>
            {note ? `${note} ` : ''}
            Unacknowledged DOWN incidents sort first, escalated ones on top, then the other open ones, then
            those waiting for a root cause or review. Downtime with no root cause stays in “Needs action”. A
            PROBLEM ends at Resolved.
          </span>
        </p>
      </div>

      {/* ── phones (MIncidents) ── */}
      <div className="flex flex-col gap-3 md:hidden">
        <SegmentedControl
          label="State"
          size="sm"
          fullWidth
          value={phoneView}
          onChange={(v) => {
            setPhoneView(v as PhoneView);
            setShowAllPast(false);
          }}
          options={[
            { value: 'open', label: `Open ${phoneCounts.open}` },
            { value: 'unacked', label: `Unacked ${phoneCounts.unacked}` },
            { value: 'past', label: 'Past' },
          ]}
        />
        <span className="text-sm text-fg-secondary" aria-live="polite">
          {phoneCount}
        </span>
        {phoneShown.length === 0 ? (
          <EmptyState
            headingLevel={2}
            icon={<IconCircleCheck />}
            title={
              phoneView === 'past'
                ? 'No past incidents'
                : phoneView === 'unacked'
                  ? 'Nobody waiting for an ack'
                  : 'No open incidents'
            }
            description={
              phoneView === 'past'
                ? 'Nothing resolved in the last 30 days.'
                : phoneView === 'unacked'
                  ? 'Every open DOWN incident has been acknowledged.'
                  : lastOneLine(incidents, now)
            }
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {phoneShown.map((i) => (
              <li key={i.id}>
                <PhoneCard incident={i} now={now} canAck={mayAcknowledge(viewer, i)} />
              </li>
            ))}
          </ul>
        )}
        {phoneRows.length > (phoneView === 'past' ? PAST_SHOWN : PAGE_SIZE) && (
          <Button
            variant="secondary"
            fullWidth
            icon={showAllPast ? <IconChevronUp /> : <IconChevronDown />}
            onClick={() => setShowAllPast(!showAllPast)}
          >
            {showAllPast
              ? `Show latest ${phoneView === 'past' ? PAST_SHOWN : PAGE_SIZE} only`
              : `Show all ${phoneRows.length}`}
          </Button>
        )}
      </div>
    </>
  );
}

/** One MIncidents card: the whole card opens the incident; an unacked DOWN adds its Acknowledge row. */
function PhoneCard({ incident: i, now, canAck }: { incident: ListIncident; now: Date; canAck: boolean }) {
  const next = nextLine(i, now, true);
  const unacked = isUnackedDown(i);
  return (
    <Link
      href={hrefOf(i)}
      className={`flex flex-col gap-2 rounded-aura-lg border px-4 py-3.5 text-fg-primary no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
        unacked
          ? 'border-alert-danger-border bg-alert-danger-bg hover:border-fg-danger'
          : 'border-border-default bg-bg-surface hover:bg-bg-surface-hover'
      }`}
    >
      <span className="flex items-center gap-2">
        <SeverityBadge severity={i.severity} recovered={!!i.recoveredAt || !isOpen(i)} />
        <WorkflowBadge state={i.state} level={i.escalationLevel} />
        <span className="ml-auto font-mono text-xs text-fg-secondary">{formatIncidentId(i.number)}</span>
      </span>
      <span className="text-base font-semibold">{i.siteName}</span>
      <span className="text-sm text-fg-secondary">
        {[formatWhen(new Date(i.startedAt), now), formatDuration(durationMinutes(i, now)), i.ownerName]
          .filter(Boolean)
          .join(' · ')}
      </span>
      <span className="flex items-center gap-2 text-sm">
        <span className={`grow ${TONE[next.tone]}`}>
          {isOpen(i) ? next.text : `${triggerWords(i)} · ${next.text}`}
        </span>
        <span className="flex items-center gap-0.5 text-fg-secondary">
          Details <IconChevronRight aria-hidden className="size-4" />
        </span>
      </span>
      {unacked && canAck && (
        <span className="mt-1 flex items-center gap-2 border-t border-alert-danger-border pt-2 text-sm font-medium">
          <IconCheck aria-hidden className="size-4" />
          <span className="grow">Acknowledge</span>
          <IconChevronRight aria-hidden className="size-4" />
        </span>
      )}
    </Link>
  );
}

/** "Severity: Down · Site: MuvMi · Last 7 days" — the filters a no-match names (EmptyStates panel 3). */
function filterWords(f: ListFilters, sites: { id: string; name: string }[]): string {
  return [
    f.severity !== 'all' ? `Severity: ${f.severity === 'down' ? 'Down' : 'Problem'}` : null,
    f.siteId ? `Site: ${sites.find((s) => s.id === f.siteId)?.name ?? 'that site'}` : null,
    `last ${f.period} days`,
  ]
    .filter(Boolean)
    .join(' · ');
}
