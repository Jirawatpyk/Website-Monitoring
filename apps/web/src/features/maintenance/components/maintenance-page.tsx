'use client';

import type { WindowKind } from '@dxt/engine';
import { formatDay, formatTime, type SiteStatus } from '@dxt/shared';
import {
  Badge,
  Button,
  Card,
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
import { useEffect, useRef, useState } from 'react';
import { useLiveRefresh } from '@/components/use-live-refresh';
import { useNow } from '@/components/use-now';
import { SiteStatusBadge } from '@/components/status-badges';
import type { PausableSite } from '../model';
import { metaOf, sectionsOf, type PageRow, type Section, type Viewer, type WindowRow } from '../page-model';
import { MaintenanceDialog } from './maintenance-dialog';
import { ApproveDialog, DeclineDialog, EditDialog, EndDialog, postPendingNow } from './window-dialogs';
import { phoneHeader } from '@/components/phone-header';

const ICONS = { calendar: <IconCalendar />, 'eye-off': <IconEyeOff />, clock: <IconClock /> };
const STATUS_WORD: Record<SiteStatus, string> = {
  ok: 'OK',
  problem: 'Problem',
  down: 'Down',
  maintenance: 'Maintenance',
};
const FOCUS = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring';

type Kind = 'end' | 'edit' | 'approve' | 'decline' | 'view';
/**
 * The dialog open on a row. `shown` false while it closes (kept mounted so focus goes back); `fromSheet`:
 * opened from the phone sheet, so Back / Keep it returns to the sheet (MMaintenanceList "Back").
 */
type Open = { kind: Kind; p: PageRow; n: number; shown: boolean; fromSheet: boolean } | null;
type Show = (kind: Kind, p: PageRow, fromSheet?: boolean) => void;

function StatusCell({ p, short = false }: { p: PageRow; short?: boolean }) {
  const muted = short ? p.mutedShort : p.mutedLabel;
  return (
    <span className="flex flex-col items-start gap-1">
      {p.badge ? (
        <Badge tone={p.badge.tone} variant={p.badge.variant} icon={ICONS[p.badge.icon]}>
          {p.badge.label}
        </Badge>
      ) : p.row.siteStatus ? (
        <SiteStatusBadge status={p.row.siteStatus} />
      ) : null}
      {muted && (
        <Badge tone="neutral" variant="outline" icon={<IconEyeOff />}>
          {muted}
        </Badge>
      )}
    </span>
  );
}

function Logs({ lines }: { lines: string[] }) {
  return lines.map((t, i) => (
    <span key={`${i}:${t}`} className="flex items-start gap-1.5 pt-0.5 text-xs text-fg-secondary">
      <span className="flex pt-0.5">
        <IconFileText size="sm" />
      </span>
      <span>{t}</span>
    </span>
  ));
}

/** "Sat 26 Sep 22:00 → Tue 29 Sep 22:00", broken only after the arrow. */
function When({ text }: { text: string }) {
  const [a, b] = text.split(' → ');
  return (
    <span className="tabular-nums">
      <span className="whitespace-nowrap">{a}</span>
      {b !== undefined && (
        <>
          {' → '}
          <span className="whitespace-nowrap">{b}</span>
        </>
      )}
    </span>
  );
}

function Actions({ p, open }: { p: PageRow; open: Show }) {
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

function columns(recent: boolean, open: Show): DataTableColumn<PageRow & { id: string }>[] {
  return [
    { key: 'status', label: 'Status', width: 170, render: (p) => <StatusCell p={p} short /> },
    {
      key: 'site',
      label: 'Site',
      render: (p) => (
        <span className="flex min-w-0 flex-col py-1 leading-snug">
          <Link
            href={`/sites/${p.row.siteId}`}
            className={`rounded-aura-sm font-medium text-fg-primary no-underline ${FOCUS}`}
          >
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
          <When text={p.when} />
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
 * `/maintenance` — boards MaintenancePage (xl up) and MMaintenanceList (row cards + a sheet below xl, where
 * the table's fixed columns would crowd or scroll), spec §23, D-036. Sections Active now · Waiting for
 * approval · Scheduled · Recent; row actions by state and role; the dialogs.
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
  // Rows move between sections, "37 min in" and "starts in" count on while the page stays open, and
  // the dialogs' end choices start from now (spec-check). A window starting or ending changes
  // site_status, so a round re-renders the page; other people's edits show on the next one.
  const now = useNow(nowIso, 60_000);
  // Other people's actions show at once (maintenance_windows joins Realtime with S09b).
  useLiveRefresh(['site_status', 'maintenance_windows']);
  const sections = sectionsOf(rows, viewer, now);
  const notEmpty = sections.some((s) => s.key !== 'recent');
  const canSchedule = viewer.role !== 'readonly' && sites.length > 0;
  const [open, setOpen] = useState<Open>(null);
  const [n, setN] = useState(0);
  const [schedule, setSchedule] = useState({ open: false, n: 0 });
  const show: Show = (kind, p, fromSheet = false) => {
    // Opening a row or a dialog posts a pending action at once (§24.12).
    void postPendingNow();
    setN((x) => x + 1);
    setOpen({ kind, p, n: n + 1, shown: true, fromSheet });
  };
  /** Back / Keep it / Close: to the sheet it came from, else closed. */
  const back = () =>
    setOpen((o) =>
      o
        ? o.fromSheet && o.kind !== 'view'
          ? { ...o, kind: 'view', fromSheet: false }
          : { ...o, shown: false }
        : o,
    );
  /**
   * After an action went through: everything closes and the page refreshes. The row moves (Recent, or
   * Scheduled once approved) and its button with it, so focus goes to that section's heading once the
   * new rows arrive, not to the page body (spec-check).
   */
  const landing = useRef<{ key: Section['key']; before: WindowRow[] } | null>(null);
  const done = (landed?: 'recent') => {
    const key = landed ?? (open?.kind === 'approve' ? 'scheduled' : open?.kind === 'edit' ? null : 'recent');
    landing.current = key ? { key, before: rows } : null;
    setOpen((o) => (o ? { ...o, shown: false } : o));
  };
  // An Undo puts the row back where it was: focus goes to that section once it is there (spec-check).
  const latest = useRef(rows);
  useEffect(() => {
    latest.current = rows;
  }, [rows]);
  const undone = (p: PageRow) => {
    const key: Section['key'] =
      p.state === 'active' ? 'active' : p.state === 'waiting' ? 'waiting' : 'scheduled';
    landing.current = { key, before: latest.current };
  };
  useEffect(() => {
    // Only once the refreshed rows are in (the closing dialog has handed focus back by then).
    const l = landing.current;
    if (!l || rows === l.before) return;
    landing.current = null;
    document.getElementById(`mt-${l.key}`)?.focus();
  }, [rows]);
  const shown = (k: Kind) => !!open?.shown && open.kind === k;
  const openSchedule = () => {
    void postPendingNow();
    setSchedule((s) => ({ open: true, n: s.n + 1 }));
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className={phoneHeader.title}
        // Phones: the time in Bangkok as on the Overview (MMaintenanceList, §23.10 UTC+7); desktop OPERATIONS.
        eyebrow={
          <>
            <span className="max-md:hidden">OPERATIONS</span>
            <span className="uppercase md:hidden">{`${formatDay(now, { weekday: true })} ${formatTime(now)} · UTC+7`}</span>
          </>
        }
        title="Maintenance & mutes"
        meta={metaOf(sections)}
        actions={
          notEmpty && canSchedule ? (
            <span className="max-md:hidden">
              <Button variant="primary" icon={<IconPlus />} onClick={openSchedule}>
                Schedule maintenance or mute
              </Button>
            </span>
          ) : undefined
        }
      />
      {canSchedule && (
        <span className="md:hidden">
          <Button variant="primary" icon={<IconPlus />} fullWidth onClick={openSchedule}>
            Schedule maintenance or mute
          </Button>
        </span>
      )}

      {!notEmpty && (
        <Card>
          <EmptyState
            icon={<IconCalendar />}
            title="Nothing active or scheduled"
            description="Maintenance windows and mutes show here while they run, before they start and while they wait for approval. Finished ones stay under Recent for 30 days."
            action={
              canSchedule ? (
                <span className="max-md:hidden">
                  <Button variant="primary" icon={<IconPlus />} onClick={openSchedule}>
                    Schedule maintenance or mute
                  </Button>
                </span>
              ) : undefined
            }
          />
        </Card>
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
          fromPage
        />
      )}
      {open && (
        <>
          <EndDialog
            key={`e${open.n}`}
            p={open.p}
            viewer={viewer.name}
            now={now}
            open={shown('end')}
            onClose={back}
            onDone={done}
            onUndone={undone}
          />
          <EditDialog
            key={`d${open.n}`}
            p={open.p}
            viewer={viewer.name}
            now={now}
            open={shown('edit')}
            onClose={back}
            onDone={done}
            onUndone={undone}
          />
          <ApproveDialog
            key={`a${open.n}`}
            p={open.p}
            viewer={viewer.name}
            now={now}
            open={shown('approve')}
            onClose={back}
            onDone={done}
            onUndone={undone}
          />
          <DeclineDialog
            key={`x${open.n}`}
            p={open.p}
            viewer={viewer.name}
            now={now}
            open={shown('decline')}
            onClose={back}
            onDone={done}
            onUndone={undone}
          />
          <RowSheet p={open.p} open={shown('view')} onClose={back} act={(k, p) => show(k, p, true)} />
        </>
      )}
    </div>
  );
}

function SectionView({ s, open }: { s: Section; open: Show }) {
  const recent = s.key === 'recent';
  const rows = s.rows.map((p) => ({ ...p, id: p.row.id }));
  return (
    <section className="flex flex-col gap-2.5" aria-labelledby={`mt-${s.key}`}>
      <div className="flex flex-wrap items-baseline gap-3">
        <h2
          id={`mt-${s.key}`}
          tabIndex={-1}
          className="m-0 text-xl font-semibold max-md:font-mono max-md:text-xs max-md:font-normal max-md:uppercase max-md:text-fg-tertiary"
        >
          {s.title}
          <span className="md:hidden" aria-hidden="true">{` · ${rows.length}`}</span>
        </h2>
        <span className="text-sm text-fg-secondary max-md:hidden">{s.hint}</span>
      </div>
      <div className="max-xl:hidden">
        <DataTable label={s.title} rowKey="id" columns={columns(recent, open)} rows={rows} rowHeight="auto" />
      </div>
      {/* below xl: MMaintenanceList row cards, a tap opens the row's sheet */}
      <div className="overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface xl:hidden">
        {rows.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => open('view', p)}
            aria-label={`${p.row.siteName}, ${p.badge?.label ?? (p.row.siteStatus ? STATUS_WORD[p.row.siteStatus] : '')}${p.mutedLabel ? `, ${p.mutedLabel}` : ''}, ${p.line}`}
            className={`flex min-h-16 w-full items-center gap-2.5 border-0 border-b border-border-subtle bg-transparent py-2.5 pr-2 pl-3.5 text-left last:border-b-0 hover:bg-bg-surface-hover ${FOCUS}`}
          >
            <span className="w-30 shrink-0">
              <StatusCell p={p} short />
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
  act: (kind: Kind, p: PageRow) => void;
}) {
  const r = p.row;
  const facts: [string, string][] = [
    ['When', p.when],
    ['Length', p.whenSub],
    ['Reason', r.reason],
    [p.by.label, p.by.value],
    ['Uptime', p.uptime],
    ['Site', p.siteSub],
  ];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"

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
