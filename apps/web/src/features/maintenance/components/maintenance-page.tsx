'use client';

import type { WindowKind } from '@dxt/engine';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  type DataTableColumn,
} from '@jirawatpyk/aura-react';
import {
  IconCalendar,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconEyeOff,
  IconFileText,
  IconPencil,
  IconPlus,
} from '@jirawatpyk/aura-react/icons';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { SiteStatusBadge } from '@/components/status-badges';
import type { PausableSite } from '../model';
import { sectionsOf, metaOf, type PageRow, type Section, type Viewer, type WindowRow } from '../page-model';
import { MaintenanceDialog } from './maintenance-dialog';
import { ApproveDialog, DeclineDialog, EditDialog, EndDialog } from './window-dialogs';

const ICONS = { calendar: <IconCalendar />, 'eye-off': <IconEyeOff />, clock: <IconClock /> };

/** The dialog open on a row; `shown` false while it closes (kept mounted so focus goes back). */
type Open = {
  kind: 'end' | 'edit' | 'approve' | 'decline' | 'view';
  p: PageRow;
  n: number;
  shown: boolean;
} | null;

function StatusCell({ p }: { p: PageRow }) {
  return (
    <span className="flex flex-col items-start gap-1">
      {p.badge ? (
        <Badge tone={p.badge.tone} variant={p.badge.variant} icon={ICONS[p.badge.icon]}>
          {p.badge.label}
        </Badge>
      ) : p.row.siteStatus ? (
        <SiteStatusBadge status={p.row.siteStatus} />
      ) : null}
      {p.mutedLabel && (
        <Badge tone="neutral" variant="outline" icon={<IconEyeOff />}>
          {p.mutedLabel}
        </Badge>
      )}
    </span>
  );
}

function Logs({ lines }: { lines: string[] }) {
  return lines.map((t) => (
    <span key={t} className="flex items-start gap-1.5 pt-0.5 text-xs text-fg-secondary">
      <span className="flex pt-0.5">
        <IconFileText size="sm" />
      </span>
      <span>{t}</span>
    </span>
  ));
}

function Actions({ p, open }: { p: PageRow; open: (kind: NonNullable<Open>['kind'], p: PageRow) => void }) {
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {p.canApprove && (
        <>
          <Button variant="secondary" size="sm" icon={<IconCheck />} onClick={() => open('approve', p)}>
            Approve
          </Button>
          <Button variant="secondary" size="sm" onClick={() => open('decline', p)}>
            Decline
          </Button>
        </>
      )}
      {p.canEnd && (
        <Button variant="secondary" size="sm" onClick={() => open('end', p)}>
          End now
        </Button>
      )}
      {p.editLabel && (
        <Button variant="ghost" size="sm" icon={<IconPencil />} onClick={() => open('edit', p)}>
          {p.editLabel}
        </Button>
      )}
      {p.note && <span className="text-right text-xs text-fg-secondary">{p.note}</span>}
    </span>
  );
}

function columns(
  recent: boolean,
  open: (kind: NonNullable<Open>['kind'], p: PageRow) => void,
): DataTableColumn<PageRow & { id: string }>[] {
  return [
    { key: 'status', label: 'Status', width: 170, render: (p) => <StatusCell p={p} /> },
    {
      key: 'site',
      label: 'Site',
      render: (p) => (
        <span className="flex min-w-0 flex-col py-1 leading-snug">
          <Link href={`/sites/${p.row.siteId}`} className="font-medium text-fg-primary no-underline">
            {p.row.siteName}
          </Link>
          <span className="text-xs text-fg-secondary">{p.siteSub}</span>
        </span>
      ),
    },
    {
      key: 'when',
      label: 'When',
      width: 250,
      render: (p) => (
        <span className="flex flex-col py-1 leading-snug">
          <span className="tabular-nums">{p.when}</span>
          <span className="text-xs text-fg-secondary">{p.whenSub}</span>
        </span>
      ),
    },
    {
      key: 'why',
      label: 'Reason',
      render: (p) => (
        <span className="flex min-w-0 flex-col py-1 leading-snug">
          <span>{p.why}</span>
          <span className="text-xs text-fg-secondary">{p.whySub}</span>
          {!recent && <Logs lines={p.logs} />}
        </span>
      ),
    },
    recent
      ? {
          key: 'what',
          label: 'What happened',
          width: 260,
          render: (p) => (
            <span className="flex flex-col gap-0.5 py-1">
              <Logs lines={p.logs} />
            </span>
          ),
        }
      : {
          key: 'actions',
          label: '',
          width: 260,
          actions: true,
          render: (p) => <Actions p={p} open={open} />,
        },
  ];
}

/**
 * `/maintenance` — boards MaintenancePage (md up) and MMaintenanceList (phones), spec §23, D-036. Sections
 * Active now · Waiting for approval · Scheduled · Recent; row actions by state and role; the dialogs.
 */
export function MaintenancePageView({
  rows,
  sites,
  viewer,
  viewerEmail,
  nowIso,
}: {
  rows: WindowRow[];
  /** The sites this person may mute or schedule maintenance on (Responders: their own). */
  sites: PausableSite[];
  viewer: Viewer;
  viewerEmail: string;
  nowIso: string;
}) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const sections = sectionsOf(rows, viewer, now);
  const notEmpty = sections.some((s) => s.key !== 'recent');
  const canSchedule = viewer.role !== 'readonly' && sites.length > 0;
  const [open, setOpen] = useState<Open>(null);
  const [n, setN] = useState(0);
  const [schedule, setSchedule] = useState({ open: false, n: 0 });
  const show = (kind: NonNullable<Open>['kind'], p: PageRow) => {
    setN((x) => x + 1);
    setOpen({ kind, p, n: n + 1, shown: true });
  };
  const close = () => setOpen((o) => (o ? { ...o, shown: false } : o));
  const closed = !open?.shown;
  const scheduleButton = (
    <Button
      variant="primary"
      icon={<IconPlus />}
      onClick={() => setSchedule((s) => ({ open: true, n: s.n + 1 }))}
    >
      Schedule maintenance or mute
    </Button>
  );

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow="OPERATIONS"
        title="Maintenance & mutes"
        meta={metaOf(sections)}
        actions={
          notEmpty && canSchedule ? <span className="max-md:hidden">{scheduleButton}</span> : undefined
        }
      />
      {canSchedule && <span className="md:hidden">{scheduleButton}</span>}

      {!notEmpty && (
        <EmptyState
          icon={<IconCalendar />}
          title="Nothing active or scheduled"
          description="Maintenance windows and mutes show here while they run, before they start and while they wait for approval. Finished ones stay under Recent for 30 days."
          action={canSchedule ? <span className="max-md:hidden">{scheduleButton}</span> : undefined}
        />
      )}

      {sections.map((s) => (
        <SectionView key={s.key} s={s} open={show} />
      ))}

      {canSchedule && (
        <MaintenanceDialog
          key={`s${schedule.n}`}
          open={schedule.open}
          onClose={() => setSchedule((x) => ({ ...x, open: false }))}
          sites={sites}
          siteId=""
          kind="maintenance"
          isAdmin={viewer.role === 'admin'}
          viewerName={viewer.name}
          viewerEmail={viewerEmail}
        />
      )}
      {open && (
        <>
          <EndDialog
            key={`e${open.n}`}
            p={open.p}
            viewer={viewer.name}
            now={now}
            open={open.kind === 'end' && !closed}
            onClose={close}
          />
          <EditDialog
            key={`d${open.n}`}
            p={open.p}
            viewer={viewer.name}
            now={now}
            open={open.kind === 'edit' && !closed}
            onClose={close}
          />
          <ApproveDialog
            key={`a${open.n}`}
            p={open.p}
            viewer={viewer.name}
            now={now}
            open={open.kind === 'approve' && !closed}
            onClose={close}
          />
          <DeclineDialog
            key={`x${open.n}`}
            p={open.p}
            now={now}
            open={open.kind === 'decline' && !closed}
            onClose={close}
          />
          <RowSheet p={open.p} open={open.kind === 'view' && !closed} onClose={close} act={show} />
        </>
      )}
    </div>
  );
}

function SectionView({
  s,
  open,
}: {
  s: Section;
  open: (kind: NonNullable<Open>['kind'], p: PageRow) => void;
}) {
  const recent = s.key === 'recent';
  const rows = s.rows.map((p) => ({ ...p, id: p.row.id }));
  return (
    <section className="flex flex-col gap-2.5" aria-labelledby={`mt-${s.key}`}>
      <div className="flex flex-wrap items-baseline gap-3">
        <h2
          id={`mt-${s.key}`}
          className="m-0 text-xl font-semibold max-md:font-mono max-md:text-xs max-md:font-normal max-md:uppercase max-md:text-fg-tertiary"
        >
          {s.title}
        </h2>
        <span className="text-sm text-fg-secondary max-md:hidden">{s.hint}</span>
      </div>
      <div className="max-lg:hidden">
        {rows.length ? (
          <DataTable
            label={s.title}
            rowKey="id"
            columns={columns(recent, open)}
            rows={rows}
            rowHeight="auto"
          />
        ) : (
          <p className="m-0 text-sm text-fg-secondary">{s.hint}</p>
        )}
      </div>
      {/* phones and tablets (below lg, where the table would scroll sideways): MMaintenanceList row cards, a tap opens the row’s sheet */}
      <div className="overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface lg:hidden">
        {rows.length === 0 && <p className="m-0 p-4 text-sm text-fg-secondary">{s.hint}</p>}
        {rows.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => open('view', p)}
            aria-label={`${p.row.siteName}, ${p.badge?.label ?? p.row.siteStatus ?? ''}${p.mutedLabel ? `, ${p.mutedLabel}` : ''}, ${p.line}`}
            className="flex min-h-16 w-full items-center gap-2.5 border-0 border-b border-border-subtle bg-transparent py-2.5 pr-2 pl-3.5 text-left last:border-b-0"
          >
            <span className="w-28 shrink-0">
              <StatusCell p={p} />
            </span>
            <span className="flex min-w-0 grow flex-col gap-0.5 leading-tight">
              <span className="text-sm font-medium">{p.row.siteName}</span>
              <span className="text-xs text-fg-secondary">{p.line}</span>
            </span>
            <span className="flex text-fg-tertiary">
              <IconChevronRight size="sm" />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

const kindWord = (k: WindowKind) => (k === 'mute' ? 'Mute' : 'Maintenance');

/** The phone row's sheet (MMaintenanceList): its facts, log lines and the allowed actions, full width. */
function RowSheet({
  p,
  open,
  onClose,
  act,
}: {
  p: PageRow;
  open: boolean;
  onClose: () => void;
  act: (kind: NonNullable<Open>['kind'], p: PageRow) => void;
}) {
  const r = p.row;
  const facts: [string, string][] = [
    ['When', p.when],
    ['Length', p.whenSub],
    ['Reason', r.reason],
    ['By', p.whySub],
    ['Uptime', r.kind === 'mute' ? 'Still counted' : 'Not counted'],
    ['Site', p.siteSub],
  ];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      autoFocus={false}
      title={r.siteName}
      description={`${kindWord(r.kind)} · Tier ${r.tier}`}
    >
      <div className="flex flex-col gap-3.5">
        <StatusCell p={p} />
        <dl className="m-0 flex flex-col gap-1.5 text-sm">
          {facts.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="shrink-0 text-fg-secondary">{k}</dt>
              <dd className="m-0 text-right">{v}</dd>
            </div>
          ))}
        </dl>
        <Logs lines={p.logs} />
        {p.canApprove && (
          <>
            <Button variant="primary" icon={<IconCheck />} fullWidth onClick={() => act('approve', p)}>
              Approve
            </Button>
            <Button variant="secondary" fullWidth onClick={() => act('decline', p)}>
              Decline
            </Button>
          </>
        )}
        {p.canEnd && (
          <Button variant="secondary" fullWidth onClick={() => act('end', p)}>
            {r.kind === 'mute' ? 'End mute now' : 'End maintenance now'}
          </Button>
        )}
        {p.editLabel && (
          <Button variant="secondary" icon={<IconPencil />} fullWidth onClick={() => act('edit', p)}>
            {p.editLabel}
          </Button>
        )}
        {p.note && <span className="text-center text-sm text-fg-secondary">{p.note}</span>}
      </div>
    </Dialog>
  );
}
