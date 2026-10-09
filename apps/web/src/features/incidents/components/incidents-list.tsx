'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  FilterSelect,
  SegmentedControl,
  Stat,
  type DataTableColumn,
} from '@jirawatpyk/aura-react';
import {
  IconArrowUpRight,
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
import { formatDuration, formatDurationSeconds, formatIncidentId, formatWhen } from '@dxt/shared';
import { SeverityBadge, WorkflowBadge } from '@/components/status-badges';
import {
  countLabel,
  DEFAULT_FILTERS,
  desktopViewCounts,
  durationMinutes,
  filterIncidents,
  hiddenNote,
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

/** The phone's Past view shows the latest few until "Show all" (MIncidents). */
const PAST_SHOWN = 4;

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
  warning: 'text-fg-warning',
  secondary: 'text-fg-secondary',
};

const hrefOf = (i: Pick<ListIncident, 'id'>) => `/incidents/${i.id}`;

export interface IncidentsListProps {
  incidents: ListIncident[];
  sites: { id: string; name: string }[];
  nowIso: string;
  /** The view a link asked for (`?view=unacked` from the Overview's phone card). */
  initialView?: DesktopView | PhoneView;
}

/**
 * Incidents (desktop) and MIncidents (phone) — spec §4, §11, §16.1, D-033. The server reads the last
 * 30 days plus anything still open; views, filters and counts are worked out here (`model.ts`).
 */
export function IncidentsList({ incidents, sites, nowIso, initialView }: IncidentsListProps) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
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

  const columns: DataTableColumn<ListIncident>[] = [
    {
      key: 'id',
      label: 'ID',
      width: 96,
      // The row is the link (getRowHref): no link of its own inside it.
      render: (i) => <span className="font-mono text-sm">{formatIncidentId(i.number)}</span>,
    },
    {
      key: 'site',
      label: 'Site',
      render: (i) => <span className="block truncate font-medium">{i.siteName}</span>,
    },
    {
      key: 'severity',
      label: 'Severity',
      width: 144,
      render: (i) => <SeverityBadge severity={i.severity} recovered={!!i.recoveredAt || !isOpen(i)} />,
    },
    { key: 'trigger', label: 'Trigger', render: (i) => <span className="text-sm">{triggerWords(i)}</span> },
    {
      key: 'state',
      label: 'State',
      width: 176,
      render: (i) => <WorkflowBadge state={i.state} level={i.escalationLevel} />,
    },
    {
      key: 'started',
      label: 'Started',
      render: (i) => <span className="text-sm tabular-nums">{formatWhen(new Date(i.startedAt), now)}</span>,
    },
    {
      key: 'duration',
      label: 'Duration',
      render: (i) => (
        <span className="text-sm whitespace-nowrap tabular-nums">
          {formatDuration(durationMinutes(i, now))}
        </span>
      ),
    },
    { key: 'owner', label: 'Owner', render: (i) => <span className="text-sm">{i.ownerName ?? '—'}</span> },
    {
      key: 'next',
      label: 'Next / ack',
      render: (i) => {
        const n = nextLine(i, now);
        return <span className={`text-sm ${TONE[n.tone]}`}>{n.text}</span>;
      },
    },
  ];

  const phoneRows = filterIncidents(incidents, { ...DEFAULT_FILTERS, view: phoneView }, now).rows;
  const phoneCounts = phoneViewCounts(incidents, now);
  const phoneShown = phoneView === 'past' && !showAllPast ? phoneRows.slice(0, PAST_SHOWN) : phoneRows;
  const phoneCount =
    phoneView === 'past' && !showAllPast && phoneRows.length > PAST_SHOWN
      ? `Last 30 days · latest ${PAST_SHOWN} of ${phoneRows.length} resolved, in review or closed`
      : countLabel(incidents, { ...DEFAULT_FILTERS, view: phoneView }, now);

  return (
    <>
      {/* ── desktop and tablets (Incidents) ── */}
      <div className="hidden flex-col gap-6 md:flex">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
          <Stat label="Open" value={kpis.open} caption={kpis.openCaption} icon={<IconBell />} />
          {/* "Escalated, not acked" counts nothing until escalation exists (S08, D-033). */}
          <Stat
            label="Unacked"
            value={kpis.unacked}
            caption={kpis.unackedCaption}
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
              kpis.mttrMinutes !== null
                ? 'DOWN only · median · first failed check → recovered'
                : 'Not enough incidents yet'
            }
            icon={<IconRotateCcw />}
          />
        </div>

        <div className="flex flex-col gap-3">
          <FilterBar>
            <SegmentedControl
              label="State"
              size="sm"
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
            <span className="ml-auto">
              <Button variant="secondary" size="sm" href={exportHref} download>
                Export CSV
              </Button>
            </span>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={<IconCircleCheck />}
              title={f.view === 'needs_action' ? 'Nothing needs action' : 'No incidents'}
              description={
                f.view === 'needs_action'
                  ? 'Every incident in this period is resolved.'
                  : 'No incident matches these filters in this period.'
              }
            />
          ) : (
            <DataTable
              label="Incidents"
              rowKey="id"
              columns={columns}
              rows={rows}
              rowHeight="auto"
              getRowHref={hrefOf}
              linkComponent={Link}
            />
          )}
        </div>

        <p className="m-0 flex items-start gap-2 text-sm text-fg-secondary">
          <span className="flex pt-0.5">
            <IconInfo aria-hidden className="size-4" />
          </span>
          <span>
            {note ? `${note} ` : ''}
            Unacknowledged DOWN incidents sort first, then the other open ones, then those waiting for a root
            cause. Downtime with no root cause stays in “Needs action”. A PROBLEM ends at Resolved.
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
            icon={<IconCircleCheck />}
            title={phoneView === 'past' ? 'No past incidents' : 'Nothing open'}
            description={
              phoneView === 'past' ? 'Nothing resolved in the last 30 days.' : 'Every site is quiet.'
            }
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {phoneShown.map((i) => (
              <li key={i.id}>
                <PhoneCard incident={i} now={now} />
              </li>
            ))}
          </ul>
        )}
        {phoneView === 'past' && phoneRows.length > PAST_SHOWN && (
          <Button
            variant="secondary"
            fullWidth
            icon={showAllPast ? <IconChevronUp /> : <IconChevronDown />}
            onClick={() => setShowAllPast(!showAllPast)}
          >
            {showAllPast ? `Show latest ${PAST_SHOWN} only` : `Show all ${phoneRows.length}`}
          </Button>
        )}
      </div>
    </>
  );
}

/** One MIncidents card: the whole card opens the incident; an unacked DOWN adds its Acknowledge row. */
function PhoneCard({ incident: i, now }: { incident: ListIncident; now: Date }) {
  const next = nextLine(i, now);
  const unacked = isUnackedDown(i);
  return (
    <Link
      href={hrefOf(i)}
      className={`flex flex-col gap-1 rounded-aura-lg border px-3.5 py-3 text-fg-primary no-underline hover:bg-bg-surface-hover ${
        unacked ? 'border-border-danger bg-bg-danger-subtle' : 'border-border-default bg-bg-surface'
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
        <span className={`grow ${TONE[next.tone]}`}>{next.text}</span>
        <span className="flex items-center gap-0.5 text-fg-secondary">
          Details <IconChevronRight aria-hidden className="size-4" />
        </span>
      </span>
      {unacked && (
        <span className="mt-1 flex items-center gap-2 border-t border-border-danger pt-2 text-sm font-medium">
          <IconCheck aria-hidden className="size-4" />
          <span className="grow">Acknowledge</span>
          <IconChevronRight aria-hidden className="size-4" />
        </span>
      )}
    </Link>
  );
}
