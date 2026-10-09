'use client';

import { useEffect, useRef, useState } from 'react';
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
  type MenuItem,
} from '@jirawatpyk/aura-react';
import {
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconCopy,
  IconEllipsis,
  IconExternalLink,
  IconImage,
  IconLock,
  IconPencil,
  IconRotateCcw,
} from '@jirawatpyk/aura-react/icons';
import {
  formatDay,
  formatDuration,
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
import type { IncidentDetail } from '../detail-queries';
import type { IncidentSections } from './incident-sections';
import { AckPanel } from './ack-panel';
import {
  AddNoteDialog,
  ConditionList,
  ResolveDialog,
  RootCauseDialog,
  type DialogIncident,
  type RootCauseValue,
} from './incident-dialogs';

const LIVE = ['incidents'] as const;
/** Lines a phone shows before "Show all" (a long flapping incident has hundreds); the CSS above hides from 21. */
const PHONE_LINES = 20;

/**
 * The phone's timeline, newest first, shows the latest `PHONE_LINES` until "Show all": the lines come
 * from the server (`TimelineLines`), this part only hides the rest.
 */
function ShowAllLines({ count, children }: { count: number; children: React.ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <div className={all ? undefined : '[&_li:nth-child(n+21)]:hidden'}>{children}</div>
      {!all && count > PHONE_LINES && (
        <Button variant="secondary" fullWidth className="mt-3" onClick={() => setAll(true)}>
          {`Show all ${count}`}
        </Button>
      )}
    </>
  );
}

export interface IncidentDetailViewProps {
  detail: IncidentDetail;
  /** The display-only parts, drawn on the server (`incidentSections`). */
  sections: IncidentSections;
  viewerName: string;
  viewerEmail: string;
}

/**
 * Incident (desktop, from md) and MIncident (phone) — spec §8, §9, §14.3, §15.4, §15.6, §16.1–5,
 * D-033. One page at the incident URL (D-016): the phone keeps MobileAck's acknowledge parts while the
 * viewer can acknowledge. Escalation, client update and review cards join with S08 / S11 / S22.
 */
export function IncidentDetailView({
  detail: d,
  sections,
  viewerName,
  viewerEmail,
}: IncidentDetailViewProps) {
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
        {sections.facts}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_calc(var(--spacing)*88)]">
          <div className="flex min-w-0 flex-col gap-6">
            <EvidenceCard detail={d} table={sections.evidenceTable} onOpenShot={() => setShotOpen(true)} />
            <Card
              title="Timeline"
              headingLevel={2}
              description="All times UTC+7 · every event is in the audit log"
            >
              {sections.timelineDesktop}
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
        {sections.latestRound}
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
            <ShowAllLines count={d.timeline.length}>{sections.timelinePhone}</ShowAllLines>
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
            lasted={`${d.severity === 'down' ? 'Down' : 'Problem lasted'} ${formatDuration(d.durationMinutes)}`}
            postedAt={d.resolved?.posted ?? null}
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

function EvidenceCard({
  detail: d,
  table,
  onOpenShot,
}: {
  detail: IncidentDetail;
  /** `EvidenceTable`, drawn on the server. */
  table: React.ReactNode;
  onOpenShot: () => void;
}) {
  return (
    <Card title="Evidence by location" headingLevel={2}>
      {table}
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
