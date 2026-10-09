'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  toast,
  Badge,
  Breadcrumb,
  Button,
  Card,
  Dialog,
  DropdownMenu,
  IconButton,
  PageHeader,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  type MenuItem,
} from '@jirawatpyk/aura-react';
import {
  IconBan,
  IconBell,
  IconCheck,
  IconCircleAlert,
  IconCircleCheck,
  IconClock,
  IconCopy,
  IconEllipsis,
  IconExternalLink,
  IconEye,
  IconImage,
  IconLock,
  IconPencil,
  IconRotateCcw,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import {
  formatDay,
  formatDuration,
  formatDurationSeconds,
  formatIncidentId,
  formatTier,
  formatTime,
  formatTimeWithSeconds,
} from '@dxt/shared';
import { SeverityBadge, WorkflowBadge } from '@/components/status-badges';
import { NoAccess } from '@/components/states';
import { useAckToast } from '@/components/use-ack-toast';
import { useLiveRefresh } from '@/components/use-live-refresh';
import { useSecondsLeft } from '@/components/use-seconds-left';
import { acknowledgeIncident, undoAcknowledge, undoResolve } from '../actions';
import { GLYPH_LEGEND, GLYPHS } from '@/components/site-cells';
import type { CheckCell, IncidentDetail } from '../detail-queries';
import type { TimelineItem } from '../model';
import { AckPanel } from './ack-panel';
import {
  AddNoteDialog,
  ConditionList,
  ResolveDialog,
  RootCauseDialog,
  type DialogIncident,
  type RootCauseValue,
} from './incident-dialogs';

const KIND_ICON: Record<TimelineItem['kind'], { icon: React.ReactNode; tone: string }> = {
  failed: { icon: <IconCircleAlert />, tone: 'text-fg-danger' },
  down: { icon: <IconBan />, tone: 'text-fg-danger' },
  problem: { icon: <IconTriangleAlert />, tone: 'text-fg-warning' },
  alert: { icon: <IconBell />, tone: 'text-fg-secondary' },
  ack: { icon: <IconCheck />, tone: 'text-fg-primary' },
  evidence: { icon: <IconImage />, tone: 'text-fg-secondary' },
  recovered: { icon: <IconEye />, tone: 'text-fg-positive' },
  ok: { icon: <IconCircleCheck />, tone: 'text-fg-positive' },
  note: { icon: <IconPencil />, tone: 'text-fg-secondary' },
  root_cause: { icon: <IconPencil />, tone: 'text-fg-warning' },
  resolved: { icon: <IconCircleCheck />, tone: 'text-fg-positive' },
  undone: { icon: <IconRotateCcw />, tone: 'text-fg-secondary' },
};

const LIVE = ['incidents'] as const;
/** Lines a phone shows before "Show all" (a long flapping incident has hundreds). */
const PHONE_LINES = 20;

function Timeline({ items, newestFirst }: { items: TimelineItem[]; newestFirst: boolean }) {
  const [all, setAll] = useState(!newestFirst);
  const ordered = newestFirst ? [...items].reverse() : items;
  const shown = all ? ordered : ordered.slice(0, PHONE_LINES);
  return (
    <>
      <ol className="m-0 flex list-none flex-col p-0">
        {shown.map((t, n) => (
          <li
            key={`${t.at}-${n}`}
            className="flex gap-3 border-b border-border-subtle py-2.5 last:border-b-0"
          >
            <span className="w-16 shrink-0 pt-px font-mono text-xs text-fg-secondary">{t.time}</span>
            <span className={`flex shrink-0 pt-0.5 [&_svg]:size-4 ${KIND_ICON[t.kind].tone}`} aria-hidden>
              {KIND_ICON[t.kind].icon}
            </span>
            <span className="flex min-w-0 flex-col leading-snug">
              <span className="text-sm font-medium">{t.title}</span>
              {t.detail && <span className="text-sm break-words text-fg-secondary">{t.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {!all && ordered.length > PHONE_LINES && (
        <Button variant="secondary" fullWidth className="mt-3" onClick={() => setAll(true)}>
          {`Show all ${ordered.length}`}
        </Button>
      )}
    </>
  );
}

export interface IncidentDetailViewProps {
  detail: IncidentDetail;
  viewerName: string;
  viewerEmail: string;
  nowIso: string;
}

/**
 * Incident (desktop, from md) and MIncident (phone) — spec §8, §9, §14.3, §15.4, §15.6, §16.1–5,
 * D-033. One page at the incident URL (D-016): the phone keeps MobileAck's acknowledge parts while the
 * viewer can acknowledge. Escalation, client update and review cards join with S08 / S11 / S22.
 */
export function IncidentDetailView({ detail: d, viewerName, viewerEmail, nowIso }: IncidentDetailViewProps) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const v = d.view;
  // Someone else's ack, a recovery, a resolve: on screen without a reload (PRD §9).
  useLiveRefresh(LIVE);
  const incidentLabel = formatIncidentId(Number(v.id.replace('INC-', '')));
  const [noteOpen, setNoteOpen] = useState(false);
  const [rcOpen, setRcOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  // A fresh form each time a dialog opens; the dialogs stay mounted so AURA can return focus on close.
  const [dialogKey, setDialogKey] = useState(0);
  const openResolve = () => {
    setDialogKey((k) => k + 1);
    setResolveOpen(true);
  };
  const openRootCause = () => {
    setDialogKey((k) => k + 1);
    setRcOpen(true);
  };
  const [shotOpen, setShotOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // The Resolve card is drawn twice (desktop column, phone stack): focus returns to the one showing.
  const resolveDesktop = useRef<HTMLButtonElement>(null);
  const resolvePhone = useRef<HTMLButtonElement>(null);
  const resolvedDesktop = useRef<HTMLHeadingElement>(null);
  const resolvedPhone = useRef<HTMLHeadingElement>(null);
  const shown = <T extends HTMLElement>(...els: (T | null)[]) =>
    els.find((e) => e && e.getClientRects().length > 0) ?? els[0] ?? null;
  // Resolve while it's there; once resolved (the page re-rendered), the "Resolved" card's heading.
  const shownResolve = (): HTMLElement | null =>
    shown(resolveDesktop.current, resolvePhone.current) ??
    shown(resolvedDesktop.current, resolvedPhone.current);
  const resolved = d.state === 'resolved' || d.state === 'in_review' || d.state === 'closed';
  const stillDown = !d.recoveredAt;
  const { acked, acknowledge } = useAckToast({ ack: acknowledgeIncident, undo: undoAcknowledge });
  const addNoteDesktop = useRef<HTMLButtonElement>(null);
  const ackKind = useRef(v.ack.kind);
  useEffect(() => {
    const before = ackKind.current;
    ackKind.current = v.ack.kind;
    // a hidden button (the phone layout) takes no focus; AckPanel moves it there
    if (before === 'can-ack' && v.ack.kind === 'acked') {
      addNoteDesktop.current?.focus();
    }
  }, [v.ack.kind]);
  // After an Undo of a resolve the page re-renders unresolved: focus Resolve once it is back (WCAG 2.4.3).
  const [focusResolve, setFocusResolve] = useState(false);
  useEffect(() => {
    if (!focusResolve) return;
    const button = shownResolve();
    if (!button) return;
    button.focus();
    const t = setTimeout(() => setFocusResolve(false), 0);
    return () => clearTimeout(t);
  });

  const initialRc: RootCauseValue = {
    category: d.rootCause.category ?? '',
    what: d.rootCause.what ?? '',
    fix: d.rootCause.fix ?? '',
  };
  const dialogIncident: DialogIncident = {
    incidentId: v.incidentId,
    description: [
      incidentLabel,
      d.siteName,
      formatTier(d.tier),
      d.owner ? `owner ${d.owner}` : null,
      stillDown ? 'still down' : `recovered ${formatTime(new Date(d.recoveredAt!))}`,
    ]
      .filter(Boolean)
      .join(' · '),
    stillDown,
  };

  // An email's "Add root cause" (…#resolve, D-033): open the form that fits, once — the hash leaves the
  // URL, so an Undo or a refresh later never reopens it.
  const hashHandled = useRef(false);
  useEffect(() => {
    if (hashHandled.current || window.location.hash !== '#resolve') return;
    hashHandled.current = true;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (!d.canAct || resolved) return;
    const t = setTimeout(() => (d.gate.canOpenDialog ? openResolve() : openRootCause()), 0);
    return () => clearTimeout(t);
  });

  const downRange = d.recoveredAt
    ? `${formatTime(new Date(d.startedAt))}–${formatTime(new Date(d.recoveredAt))}`
    : null;
  const summary = [
    { label: 'Duration', value: formatDuration(d.durationMinutes) },
    ...(downRange
      ? [{ label: 'Window', value: `${formatDay(new Date(d.startedAt), { weekday: true })} ${downRange}` }]
      : []),
    ...(d.recoveredAt ? [{ label: 'OK since', value: formatTime(new Date(d.recoveredAt)) }] : []),
  ];
  const title =
    stillDown && !resolved
      ? v.title
      : `${d.siteName} ${d.severity === 'down' ? 'recovered' : 'is back to normal'}`;

  const resolveCard = (ref: React.RefObject<HTMLButtonElement | null> | null, primary: boolean) => (
    <ResolveCard
      primary={primary}
      detail={d}
      resolved={resolved}
      onResolve={openResolve}
      onRootCause={openRootCause}
      resolveButton={ref}
    />
  );

  const menu: MenuItem[] = [
    ...(v.siteUrl
      ? [{ label: `Visit ${new URL(v.siteUrl).host}`, href: v.siteUrl, icon: <IconExternalLink /> }]
      : []),
    {
      label: copied ? 'Link copied' : 'Copy incident link',
      icon: <IconCopy />,
      onSelect: () => {
        void navigator.clipboard
          ?.writeText(window.location.href.replace(/#.*$/, ''))
          .then(() => setCopied(true))
          .catch(() =>
            toast.error('Couldn’t copy the link', { description: 'Copy it from the address bar.' }),
          );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-6 max-md:min-h-full max-md:gap-3">
      <PageHeader
        breadcrumb={
          <Breadcrumb items={[{ label: 'Incidents', href: '/incidents' }, { label: incidentLabel }]} />
        }
        title={title}
        meta={
          <span className="flex flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={d.severity} recovered={!!d.recoveredAt || resolved} />
              <WorkflowBadge state={d.state} level={d.escalationLevel} />
              <Badge tone="neutral" variant="outline">
                {formatTier(d.tier)}
              </Badge>
              <Badge tone="neutral" variant="outline">{`Trigger: ${d.triggerLabel}`}</Badge>
            </span>
            <span className="text-sm text-fg-secondary">{v.cause}</span>
          </span>
        }
        actions={
          <span className="hidden flex-wrap items-center gap-2 md:flex">
            {d.canAct && (
              <Button
                ref={addNoteDesktop}
                variant="ghost"
                icon={<IconPencil />}
                onClick={() => setNoteOpen(true)}
              >
                Add note
              </Button>
            )}
            <Button variant="secondary" href={`/sites/${d.siteId}`}>
              View site
            </Button>
            {v.ack.kind === 'can-ack' && !acked.has(v.incidentId) && (
              <Button
                variant="primary"
                icon={<IconCheck />}
                onClick={() => acknowledge(v.incidentId, Number(v.id.slice(4)))}
              >
                Acknowledge
              </Button>
            )}
          </span>
        }
      />

      {/* ── desktop and tablets (Incident) ── */}
      <div className="hidden flex-col gap-6 md:flex">
        <FactsStrip detail={d} now={now} />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_calc(var(--spacing)*88)]">
          <div className="flex min-w-0 flex-col gap-6">
            <EvidenceCard detail={d} onOpenShot={() => setShotOpen(true)} />
            <Card
              title="Timeline"
              headingLevel={2}
              description="All times UTC+7 · every event is in the audit log"
            >
              <Timeline items={d.timeline} newestFirst={false} />
            </Card>
          </div>
          <div className="flex flex-col gap-6">
            {d.resolved && (
              <ResolvedCard detail={d} headingRef={resolvedDesktop} onUndone={() => setFocusResolve(true)} />
            )}
            {resolveCard(resolveDesktop, true)}
          </div>
        </div>
      </div>

      {/* ── phones (MIncident, with MobileAck's ack parts) ── */}
      <div className="flex grow flex-col gap-3 md:hidden">
        <span className="text-sm text-fg-secondary">
          {[
            `${stillDown ? (d.severity === 'down' ? 'Down' : 'Problem') : d.severity === 'down' ? 'Was down' : 'Problem lasted'} ${formatDuration(d.durationMinutes)}`,
            downRange,
            `confirmed ${formatTimeWithSeconds(new Date(d.detectedAt))}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="flex items-center gap-2">
          <span className="grow text-sm">
            {[
              d.owner ? `Owner ${d.owner}` : 'No owner set',
              d.backup ? `backup ${d.backup}` : null,
              d.am ? `AM ${d.am}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <DropdownMenu
            label="More actions"
            trigger={<IconButton icon={<IconEllipsis />} label="More actions" />}
            items={menu}
          />
        </span>
        {d.resolved && (
          <ResolvedCard detail={d} headingRef={resolvedPhone} onUndone={() => setFocusResolve(true)} />
        )}
        <LatestRoundCard detail={d} />
        {resolveCard(null, false)}
        {v.ack.kind === 'read-only' && (
          <NoAccess title={v.ack.title} description={v.ack.description} people={v.ack.people} />
        )}
        <AckPanel
          incidentId={v.incidentId}
          ack={v.ack}
          viewerName={viewerName}
          viewerEmail={viewerEmail}
          siteUrl={v.ack.kind === 'can-ack' ? v.siteUrl : null}
          barActions={
            d.canAct && resolved ? (
              <Button variant="secondary" icon={<IconPencil />} fullWidth onClick={() => setNoteOpen(true)}>
                Add note
              </Button>
            ) : d.canAct ? (
              <span className="flex flex-col gap-1.5">
                <span id="phone-resolve-why" className="text-center text-xs text-fg-secondary">
                  {d.gate.lockedReason ??
                    (d.gate.ok
                      ? 'All 3 conditions met · Resolve is a manual step'
                      : 'Write the root cause in Resolve')}
                </span>
                <span className="flex gap-2">
                  <Button
                    variant="secondary"
                    icon={<IconPencil />}
                    fullWidth
                    onClick={() => setNoteOpen(true)}
                  >
                    Add note
                  </Button>
                  <Button
                    ref={resolvePhone}
                    variant="primary"
                    icon={<IconCircleCheck />}
                    fullWidth
                    disabled={!d.gate.canOpenDialog}
                    aria-describedby={d.gate.lockedReason ? 'phone-resolve-why' : undefined}
                    onClick={openResolve}
                  >
                    Resolve
                  </Button>
                </span>
              </span>
            ) : undefined
          }
        >
          <Card title="Timeline" headingLevel={2} description="Newest first · UTC+7">
            <Timeline items={d.timeline} newestFirst />
          </Card>
          <p className="m-0 text-xs text-fg-secondary">
            Every event is also in the audit log. Evidence screenshots open on desktop.
          </p>
        </AckPanel>
      </div>

      {d.canAct && (
        <>
          <AddNoteDialog
            incident={dialogIncident}
            incidentLabel={incidentLabel}
            siteName={d.siteName}
            viewerName={viewerName}
            open={noteOpen}
            onClose={() => setNoteOpen(false)}
          />
          <RootCauseDialog
            key={`rc-${dialogKey}`}
            incident={dialogIncident}
            initial={initialRc}
            open={rcOpen}
            onClose={() => setRcOpen(false)}
          />
          <ResolveDialog
            key={`resolve-${dialogKey}`}
            incident={dialogIncident}
            initial={initialRc}
            conditions={d.gate.conditions}
            summary={summary}
            viewerName={viewerName}
            open={resolveOpen}
            onClose={() => setResolveOpen(false)}
            returnFocus={shownResolve}
            onUndone={() => setFocusResolve(true)}
          />
        </>
      )}
      {d.evidence && (
        <Dialog
          open={shotOpen}
          onClose={() => setShotOpen(false)}
          size="lg"
          title={`Screenshot · BKK · ${formatTimeWithSeconds(new Date(d.evidence.takenAt))}`}
          description={`Browser verifier evidence for ${incidentLabel} · kept for 30 days`}
        >
          {/* A signed link to a private screenshot: a plain img, not next/image (no optimiser for it). */}
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL */}
          <img
            src={d.evidence.url}
            alt={`Browser screenshot of ${d.siteName}`}
            className="w-full rounded-aura-md"
          />
        </Dialog>
      )}
    </div>
  );
}

function FactsStrip({ detail: d, now }: { detail: IncidentDetail; now: Date }) {
  const confirmedAt = new Date(d.detectedAt);
  const facts = [
    { label: 'STARTED', value: formatTimeWithSeconds(new Date(d.startedAt)), caption: 'First failed check' },
    {
      label: d.severity === 'down' ? 'CONFIRMED DOWN' : 'DETECTED',
      value: formatTimeWithSeconds(confirmedAt),
      caption: `MTTD ${formatDurationSeconds(d.detectSeconds)}`,
    },
    {
      label: 'DURATION',
      value: formatDuration(d.durationMinutes),
      caption: d.recoveredAt ? `Recovered ${formatTime(new Date(d.recoveredAt))}` : 'Still down',
      danger: !d.recoveredAt,
    },
    {
      label: 'OWNER',
      value: d.owner ?? 'No owner set',
      caption:
        [d.backup ? `Backup ${d.backup}` : null, d.am ? `AM ${d.am}` : null].filter(Boolean).join(' · ') ||
        ' ',
    },
    {
      label: 'ACKNOWLEDGED',
      value: d.acked ? d.acked.by : '—',
      caption: d.acked
        ? `${formatTimeWithSeconds(new Date(d.acked.at))} · ${formatDuration(
            Math.max(1, Math.round((Date.parse(d.acked.at) - confirmedAt.getTime()) / 60_000)),
          )} after ${d.severity === 'down' ? 'confirmed down' : 'detected'}`
        : d.recoveredAt || d.resolvedAt
          ? 'Not acknowledged'
          : `${formatDuration(Math.max(1, Math.round((now.getTime() - confirmedAt.getTime()) / 60_000)))} since ${
              d.severity === 'down' ? 'confirmed down' : 'detected'
            }`,
    },
  ];
  return (
    <dl className="aura-card m-0 grid grid-cols-2 gap-4 p-aura-5 lg:grid-cols-5">
      {facts.map((f) => (
        <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="font-mono text-xs text-fg-tertiary">{f.label}</dt>
          <dd className={`m-0 text-lg font-semibold tabular-nums ${f.danger ? 'text-fg-danger' : ''}`}>
            {f.value}
          </dd>
          <dd className="m-0 text-xs text-fg-secondary">{f.caption}</dd>
        </div>
      ))}
    </dl>
  );
}

function EvidenceCard({ detail: d, onOpenShot }: { detail: IncidentDetail; onOpenShot: () => void }) {
  const first = new Date(d.startedAt);
  const recheck = new Date(d.detectedAt);
  return (
    <Card title="Evidence by location" headingLevel={2}>
      {d.locations.length === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">No checks found around the start.</p>
      ) : (
        <Table aria-label="Evidence by location">
          <THead>
            <Tr>
              <Th>Location</Th>
              <Th>{`First check · ${formatTimeWithSeconds(first)}`}</Th>
              <Th>{`Recheck · ${formatTimeWithSeconds(recheck)}`}</Th>
              <Th>Latest</Th>
            </Tr>
          </THead>
          <TBody>
            {d.locations.map((l) => (
              <Tr key={l.location}>
                <Td className="font-medium">{l.location}</Td>
                {[l.first, l.recheck, l.latest].map((c, n) => (
                  <Td key={n}>
                    <CheckText cell={c} location={l.location} />
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {d.locations.length > 0 && <GlyphLegend />}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
        {d.evidence ? (
          <>
            <span className="flex grow flex-col text-sm leading-snug">
              <span className="font-medium">Screenshot evidence</span>
              <span className="text-fg-secondary">
                {`Taken by the browser verifier in Bangkok at ${formatTimeWithSeconds(new Date(d.evidence.takenAt))}`}
                {d.evidence.afterRecovery ? ' — after the site recovered.' : ', after DOWN was confirmed.'}{' '}
                Kept for 30 days.
              </span>
            </span>
            <Button variant="ghost" size="sm" icon={<IconImage />} onClick={onOpenShot}>
              Open full size
            </Button>
          </>
        ) : (
          <span className="text-sm text-fg-secondary">
            No screenshot — the browser verifier takes one after a hard-fail DOWN is confirmed.
          </span>
        )}
      </div>
    </Card>
  );
}

/** A check in words beside its §11 glyph (colour never alone), as Sites and Site detail draw them. */
function CheckText({ cell, location }: { cell: CheckCell | null; location: string }) {
  if (!cell) return <span className="text-fg-tertiary">—</span>;
  const g = GLYPHS[cell.glyph];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`flex [&_svg]:size-4 ${g.tone}`} role="img" aria-label={`${location}: ${g.label}`}>
        {g.icon}
      </span>
      <span>{cell.text}</span>
    </span>
  );
}

function GlyphLegend() {
  return (
    <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-fg-secondary">
      {GLYPH_LEGEND.filter((k) => k !== 'slow' && k !== 'none').map((k) => (
        <li key={k} className="flex items-center gap-1">
          <span className={`flex [&_svg]:size-3.5 ${GLYPHS[k].tone}`} aria-hidden>
            {GLYPHS[k].icon}
          </span>
          {GLYPHS[k].label}
        </li>
      ))}
    </ul>
  );
}

function LatestRoundCard({ detail: d }: { detail: IncidentDetail }) {
  const latest = d.locations.filter((l) => l.latest);
  if (!latest.length) return null;
  const fails = latest.filter((l) => l.latest!.glyph !== 'pass').length;
  return (
    <Card
      title="Latest round"
      headingLevel={2}
      description={fails ? `${fails}/${latest.length} failing` : `${latest.length}/${latest.length} pass`}
    >
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {latest.map((l) => (
          <li key={l.location} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">{l.location}</span>
            <CheckText cell={l.latest} location={l.location} />
          </li>
        ))}
      </ul>
      <GlyphLegend />
    </Card>
  );
}

/** Phone: "Resolved 10:33" with the held RESOLVED and its Undo (MIncident). */
function ResolvedCard({
  detail: d,
  onUndone,
  headingRef,
}: {
  detail: IncidentDetail;
  onUndone: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const r = d.resolved!;
  const seconds = useSecondsLeft(r.posted ? null : r.postsAt);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <section className="flex flex-col gap-1.5 rounded-aura-lg border border-l-4 border-border-default border-l-fg-positive bg-bg-surface px-3.5 py-3">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="m-0 rounded-aura-sm text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
      >{`Resolved ${formatTime(new Date(r.at))}`}</h2>
      <span className="text-sm">{`Resolved by ${r.by}.`}</span>
      <p role="status" className="sr-only">
        {seconds > 0
          ? 'Resolved — posting to Chat and email in a few seconds, nothing is sent until then'
          : ''}
      </p>
      <span className="text-xs text-fg-secondary">
        {seconds > 0
          ? `Posting to Chat and email in ${seconds} s — nothing is sent until then`
          : r.posted
            ? `Posted to the Chat thread and email at ${formatTimeWithSeconds(new Date(r.posted))}`
            : 'Posting to the Chat thread and email now'}
      </span>
      {failure && <span className="text-sm text-fg-danger">{failure}</span>}
      {seconds > 0 && r.byViewer && (
        <Button
          variant="secondary"
          icon={<IconRotateCcw />}
          fullWidth
          onClick={async () => {
            const res = await undoResolve(d.view.incidentId);
            if (!res.ok) setFailure(res.message);
            else onUndone();
          }}
        >
          {`Undo · ${seconds} s`}
        </Button>
      )}
    </section>
  );
}

/** The Resolve card (Incident right column, MIncident): the three conditions and the actions. */
function ResolveCard({
  detail: d,
  resolved,
  onResolve,
  onRootCause,
  resolveButton,
  primary,
}: {
  detail: IncidentDetail;
  /** Desktop: the page's primary action; on a phone the sticky bar has it. */
  primary: boolean;
  resolved: boolean;
  onResolve: () => void;
  onRootCause: () => void;
  resolveButton: React.RefObject<HTMLButtonElement | null> | null;
}) {
  const g = d.gate;
  return (
    <Card
      title="Resolve"
      headingLevel={2}
      actions={
        <span className="flex items-center gap-1.5 text-sm text-fg-secondary">
          {resolved ? (
            <IconCircleCheck aria-hidden className="size-4 text-fg-positive" />
          ) : g.ok ? (
            <IconCircleCheck aria-hidden className="size-4 text-fg-positive" />
          ) : g.canOpenDialog ? null : (
            <IconLock aria-hidden className="size-4" />
          )}
          {resolved ? 'Resolved' : `${g.metCount} of 3 met`}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <ConditionList conditions={g.conditions} />
        {resolved ? (
          <p className="m-0 text-sm text-fg-secondary">
            {d.autoResolved
              ? 'Resolved automatically — a short PROBLEM, never acknowledged. No root cause needed.'
              : `Resolved${d.resolved ? ` by ${d.resolved.by}` : ''} at ${d.resolvedAt ? formatTime(new Date(d.resolvedAt)) : '—'}. Resolve is always a manual step; a DOWN never resolves on its own.`}
          </p>
        ) : (
          <p className="m-0 text-sm text-fg-secondary">
            {g.ok
              ? 'All 3 conditions met. Resolve is manual — resolve it when you’re sure.'
              : (g.lockedReason ??
                (g.conditions[2]!.detail === 'Unknown keeps the incident open'
                  ? 'Unknown keeps the incident open. Pick a category once you know what happened.'
                  : 'Needs a root cause before it can be resolved.'))}
          </p>
        )}
        {d.canAct && !resolved && (
          <span className="flex flex-wrap gap-2">
            {primary && (
              <Button
                ref={resolveButton ?? undefined}
                variant={g.canOpenDialog && primary ? 'primary' : 'secondary'}
                size="sm"
                icon={g.canOpenDialog ? <IconCircleCheck /> : <IconLock />}
                disabled={!g.canOpenDialog}
                onClick={onResolve}
              >
                Resolve…
              </Button>
            )}
            <Button
              variant={primary ? 'ghost' : 'secondary'}
              size={primary ? 'sm' : 'md'}
              fullWidth={!primary}
              icon={<IconPencil />}
              onClick={onRootCause}
            >
              {d.rootCause.category ? 'Edit root cause' : 'Write root cause'}
            </Button>
          </span>
        )}
        {!d.canAct && !resolved && (
          <span className="flex items-center gap-1.5 text-xs text-fg-secondary">
            <IconClock aria-hidden className="size-4" />
            The owner, the backup or an Admin resolves it.
          </span>
        )}
      </div>
    </Card>
  );
}
