'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
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
import { UNKNOWN_ROOT_CAUSE } from '@dxt/engine';
import { FOCUS_TARGET } from '@/components/focus-target';
import { SeverityBadge, WorkflowBadge } from '@/components/status-badges';
import { NoAccess } from '@/components/states';
import { useAckToast } from '@/components/use-ack-toast';
import { useLiveRefresh } from '@/components/use-live-refresh';
import { useSecondsLeft } from '@/components/use-seconds-left';
import { acknowledgeIncident, undoAcknowledge, undoResolve } from '../actions';
import type { IncidentDetail } from '../detail-queries';
import { rootCauseLabel } from '../model';
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
import { POST_WAIT_WORDS, usePostWait, type PostOverdue } from './use-post-wait';
import { phoneHeader } from '@/components/phone-header';
import { WhatChangedCard } from '@/features/page-change';

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
      <div className={all ? undefined : '[&>ol>li:nth-child(n+21)]:hidden'}>{children}</div>
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
  // Waits for the refresh: until it lands the page still shows the "Resolved" card, which is about to go.
  useEffect(() => {
    if (!focusResolve) return;
    const button = shown(resolveDesktop.current, resolvePhone.current);
    if (!button) return;
    // A Resolve that came back disabled can't take focus: stop waiting rather than grab it later.
    if (!(button as HTMLButtonElement).disabled) {
      button.focus();
      if (document.activeElement !== button) return;
    }
    const t = setTimeout(() => setFocusResolve(false), 0);
    return () => clearTimeout(t);
  });
  // RESOLVED leaves after the hold (`after()` in the action): refresh until the page shows it sent.
  const resolvedPostsAt = d.resolved && !d.resolved.posted ? d.resolved.postsAt : null;
  const holdLeft = useSecondsLeft(resolvedPostsAt);
  const postOverdue = usePostWait(!!resolvedPostsAt && holdLeft === 0, resolvedPostsAt);

  const initialRc: RootCauseValue = {
    category: d.rootCause.category ?? '',
    what: d.rootCause.what ?? '',
    fix: d.rootCause.fix ?? '',
  };
  const dialogIncident: DialogIncident = {
    incidentId: v.incidentId,
    label: incidentLabel,
    severity: d.severity,
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
    { label: d.severity === 'down' ? 'Down' : 'Problem lasted', value: formatDuration(d.durationMinutes) },
    ...(downRange
      ? [{ label: 'Window', value: `${formatDay(new Date(d.startedAt), { weekday: true })} ${downRange}` }]
      : []),
    ...(d.recoveredAt ? [{ label: 'OK since', value: formatTime(new Date(d.recoveredAt)) }] : []),
  ];
  const title =
    stillDown && !resolved
      ? v.title
      : `${d.siteName} ${d.severity === 'down' ? 'recovered' : 'is back to normal'}`;

  // S09d (§26.4): a Page change incident shows What changed where Evidence / Latest round sit.
  const whatChanged = d.pageChange ? (
    <WhatChangedCard
      view={d.pageChange.view}
      rows={d.pageChange.rows}
      newScript={d.pageChange.newScript}
      incidentLabel={incidentLabel}
      resolved={resolved}
      siteName={d.siteName}
      canAccept={d.canAcceptBaseline}
      viewerName={viewerName}
    />
  ) : null;

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
      <p role="status" className="sr-only">
        {copied ? 'Incident link copied' : ''}
      </p>
      <PageHeader
        className={phoneHeader.crumb}
        breadcrumb={
          <Breadcrumb items={[{ label: 'Incidents', href: '/incidents' }, { label: incidentLabel }]} />
        }
        title={title}
        meta={
          <span className="flex flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={d.severity} recovered={!!d.recoveredAt || resolved} />
              <WorkflowBadge state={d.state} level={d.escalationLevel} />
              {sections.unackedFor && (
                <span className="text-sm font-medium text-fg-danger">{sections.unackedFor}</span>
              )}
              <Badge tone="neutral" variant="outline">
                {formatTier(d.tier)}
              </Badge>
              <Badge tone="neutral" variant="outline">{`Trigger: ${d.triggerLabel}`}</Badge>
            </span>
            <span className="text-sm text-fg-secondary">
              {[
                v.cause,
                stillDown
                  ? `first failed check ${formatTimeWithSeconds(new Date(d.startedAt))}`
                  : d.recoveredAt && !resolved
                    ? `OK since ${formatTime(new Date(d.recoveredAt))}`
                    : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
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
                onClick={() => acknowledge(v.incidentId, Number(v.id.slice(4)), d.severity)}
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
            {whatChanged ?? (
              <EvidenceCard
                detail={d}
                table={sections.evidenceTable}
                summary={sections.evidenceSummary}
                onOpenShot={() => setShotOpen(true)}
              />
            )}
            <Card
              title="Timeline"
              headingLevel={2}
              // the boards put the note on the title's line, at the end
              actions={
                <span className="text-sm text-fg-secondary">
                  All times UTC+7 · every event is in the audit log
                </span>
              }
            >
              {sections.timelineDesktop}
            </Card>
          </div>
          <div className="flex flex-col gap-6">
            {d.resolved && (
              <ResolvedCard
                detail={d}
                overdue={postOverdue}
                headingRef={resolvedDesktop}
                onUndone={() => setFocusResolve(true)}
              />
            )}
            {resolveCard(resolveDesktop, true)}
          </div>
        </div>
      </div>

      {/* ── phones (MIncident, with MobileAck's ack parts) ── */}
      <div className="flex grow flex-col gap-3 md:hidden">
        <span className={`text-sm ${stillDown ? 'font-medium text-fg-danger' : 'text-fg-secondary'}`}>
          {[
            `${stillDown ? (d.severity === 'down' ? 'Down' : 'Problem') : d.severity === 'down' ? 'Was down' : 'Problem lasted'} ${formatDuration(d.durationMinutes)}`,
            downRange ? [sections.startedOn, downRange].filter(Boolean).join(' ') : sections.startedOn,
            `confirmed ${formatTimeWithSeconds(new Date(d.detectedAt))}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="flex items-center gap-2">
          <span className="grow text-sm">
            {[
              d.owner ? `Owner ${d.owner}${d.owner === viewerName ? ' (you)' : ''}` : 'No owner set',
              d.backup ? `backup ${d.backup}` : null,
              d.am ? `AM ${d.am}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <DropdownMenu
            label={`More actions for ${incidentLabel}`}
            trigger={<IconButton icon={<IconEllipsis />} label={`More actions for ${incidentLabel}`} />}
            items={menu}
          />
        </span>
        {d.resolved && (
          <ResolvedCard
            detail={d}
            overdue={postOverdue}
            headingRef={resolvedPhone}
            onUndone={() => setFocusResolve(true)}
          />
        )}
        {whatChanged ?? sections.latestRound}
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
              <span className="flex flex-col gap-1.5">
                {d.resolved && (
                  <span className="text-center text-xs text-fg-secondary">
                    {holdLeft > 0
                      ? `Resolved — posting to Chat and email in ${holdLeft} s. Undo is at the top.`
                      : `Resolved ${formatTime(new Date(d.resolved.at))}`}
                  </span>
                )}
                <Button variant="secondary" icon={<IconPencil />} fullWidth onClick={() => setNoteOpen(true)}>
                  Add note
                </Button>
              </span>
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
          <Card
            title="Timeline"
            headingLevel={2}
            actions={<span className="text-xs text-fg-secondary">Newest first · UTC+7</span>}
          >
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
            viewerEmail={viewerEmail}
            open={noteOpen}
            onClose={() => setNoteOpen(false)}
          />
          <RootCauseDialog
            key={`rc-${dialogKey}`}
            incident={dialogIncident}
            initial={initialRc}
            viewerEmail={viewerEmail}
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
            uptime={d.uptime}
            postedAt={d.resolved?.posted ?? null}
            postOverdue={postOverdue}
            viewerName={viewerName}
            open={resolveOpen}
            onClose={() => setResolveOpen(false)}
            returnFocus={shownResolve}
            onUndone={() => setFocusResolve(true)}
            pageChange={
              d.pageChange
                ? {
                    canAccept: d.canAcceptBaseline,
                    checkId: d.pageChange.view.status === 'problem' ? d.pageChange.view.checkId : null,
                    newScript: d.pageChange.view.newScript.length > 0,
                    changed: d.pageChange.view.rows.length,
                  }
                : undefined
            }
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
  summary,
  onOpenShot,
}: {
  detail: IncidentDetail;
  /** `EvidenceTable`, drawn on the server. */
  table: React.ReactNode;
  /** `evidenceSummary`: how the DOWN was decided. */
  summary: string | null;
  onOpenShot: () => void;
}) {
  return (
    <Card title="Evidence by location" headingLevel={2} description={summary ?? undefined}>
      {table}
      <div className="mt-4 flex flex-wrap items-start gap-4 border-t border-border-subtle pt-4">
        {d.evidence ? (
          <>
            {/* The board's 280 px preview; a click opens it full size. Pointer-only: "Open full size" is the
                keyboard way in, so the preview is no second tab stop. */}
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={onOpenShot}
              className="aspect-video w-70 shrink-0 cursor-zoom-in overflow-hidden rounded-aura-md border border-border-default bg-bg-canvas"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL */}
              <img src={d.evidence.url} alt="" className="size-full object-cover object-top" />
            </button>
            <span className="flex min-w-0 flex-1 basis-64 flex-col items-start gap-1.5 text-sm leading-snug">
              <span className="font-medium">Screenshot evidence</span>
              <span className="text-fg-secondary">
                {`Taken by the browser verifier in Bangkok at ${formatTimeWithSeconds(new Date(d.evidence.takenAt))}`}
                {d.evidence.afterRecovery ? ' — after the site recovered.' : ', after DOWN was confirmed.'}{' '}
                {d.trigger === 'hard_fail' &&
                  'Hard fails don’t wait for the browser verifier — it only takes a screenshot afterwards as evidence. '}
              </span>
              <span className="text-fg-secondary">Kept for 30 days.</span>
              <Button variant="ghost" size="sm" icon={<IconImage />} onClick={onOpenShot}>
                Open full size
              </Button>
            </span>
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
  overdue,
  onUndone,
  headingRef,
}: {
  detail: IncidentDetail;
  overdue: PostOverdue;
  onUndone: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const r = d.resolved!;
  const seconds = useSecondsLeft(r.posted ? null : r.postsAt);
  const [failure, setFailure] = useState<string | null>(null);
  const [undoing, startUndo] = useTransition();
  const cause = rootCauseLabel(d.rootCause.category);
  return (
    <section className="flex flex-col gap-1.5 rounded-aura-lg border border-l-4 border-border-default border-l-fg-positive bg-bg-surface px-3.5 py-3">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className={`m-0 flex items-center gap-2 text-base font-semibold ${FOCUS_TARGET}`}
      >
        <IconCircleCheck aria-hidden className="size-5 text-fg-positive" />
        {`Resolved ${formatTime(new Date(r.at))}`}
      </h2>
      <span className="text-sm">
        {[
          `Resolved by ${r.by}`,
          `${d.siteName} ${d.severity === 'down' ? 'was down' : 'had a problem for'} ${formatDuration(d.durationMinutes)}`,
          cause ? `root cause: ${cause}` : null,
        ]
          .filter(Boolean)
          .join(' · ') + '.'}
      </span>
      {/* the visible line is the live region: each phase is announced once (the count isn't) */}
      <span className="flex items-center gap-1.5 text-xs text-fg-secondary">
        {r.posted ? (
          <IconCheck aria-hidden className="size-3.5 text-fg-positive" />
        ) : (
          <IconClock aria-hidden className="size-3.5" />
        )}
        <span role="status">
          {seconds > 0
            ? 'Posting to Chat and email in a few seconds — nothing is sent until then.'
            : r.posted
              ? `Posted to the Chat thread and email at ${formatTimeWithSeconds(new Date(r.posted))}`
              : POST_WAIT_WORDS[overdue]}
        </span>
        {seconds > 0 && <span aria-hidden className="tabular-nums">{`· ${seconds} s`}</span>}
      </span>
      {failure && <span className="text-sm text-fg-danger">{failure}</span>}
      {seconds > 0 && r.byViewer && (
        <Button
          variant="secondary"
          icon={<IconRotateCcw />}
          fullWidth
          loading={undoing}
          onClick={() =>
            startUndo(async () => {
              const res = await undoResolve(d.view.incidentId).catch(() => ({
                ok: false as const,
                message: 'That didn’t go through — try again.',
              }));
              if (!res.ok) setFailure(res.message);
              else onUndone();
            })
          }
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
          {resolved ? 'Resolved' : `${g.metCount} of ${g.conditions.length} met`}
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
              ? `All ${g.conditions.length} conditions met. Resolve is manual — resolve it when you’re sure.`
              : (g.lockedReason ??
                (d.rootCause.category === UNKNOWN_ROOT_CAUSE
                  ? 'Unknown keeps the incident open. Pick a category once you know what happened.'
                  : 'Needs a root cause before it can be resolved.'))}
          </p>
        )}
        {d.canAct && !resolved && d.pageChange && (
          // IncidentPageChange / MIncidentPageChange: one button — an Admin may accept the page with
          // the resolve before it matches (§26.7); otherwise the root cause until it does.
          <Button
            ref={primary ? (resolveButton ?? undefined) : undefined}
            variant="secondary"
            size={primary ? 'sm' : 'md'}
            fullWidth={!primary}
            icon={<IconPencil />}
            onClick={g.canOpenDialog ? onResolve : onRootCause}
          >
            Root cause &amp; resolve…
          </Button>
        )}
        {d.canAct && !resolved && !d.pageChange && (
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
