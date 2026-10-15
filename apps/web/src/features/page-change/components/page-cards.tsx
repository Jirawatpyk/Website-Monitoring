'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, Card } from '@jirawatpyk/aura-react';
import {
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconCircleCheck,
  IconCircleDotDashed,
  IconClock,
  IconEye,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import { formatIncidentId, formatTime } from '@dxt/shared';
import type { ChangeRowView, PageChangeView } from '../model';
import { acceptedWords, compareWords, footerWords, pendingWords, statusWords } from '../words';
import { AcceptBaseline, AdminOnlyHint } from './accept-baseline';
import { ChangeRows, FingerprintRows } from './change-rows';

const STATUS_ICON: Record<PageChangeView['status'], { icon: React.ReactNode; tone: string }> = {
  no_fingerprint: { icon: <IconCircleDotDashed />, tone: 'text-fg-tertiary' },
  no_data: { icon: <IconCircleDotDashed />, tone: 'text-fg-tertiary' },
  recording: { icon: <IconEye />, tone: 'text-fg-secondary' },
  matches: { icon: <IconCircleCheck />, tone: 'text-fg-positive' },
  accepted: { icon: <IconCircleCheck />, tone: 'text-fg-positive' },
  waiting: { icon: <IconClock />, tone: 'text-alert-warning-fg' },
  problem: { icon: <IconTriangleAlert />, tone: 'text-alert-warning-fg' },
};

function StatusLine({ v }: { v: PageChangeView }) {
  const { line, sub } = statusWords(v);
  const s = STATUS_ICON[v.status];
  return (
    <div className="flex items-start gap-2.5">
      <span className={`flex pt-0.5 ${s.tone}`} aria-hidden>
        {s.icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium break-words">{line}</span>
        {sub && <span className="text-sm break-words text-fg-secondary">{sub}</span>}
      </span>
    </div>
  );
}

function Pending({
  until,
  focusRef,
}: {
  until: string;
  focusRef: React.RefObject<HTMLParagraphElement | null>;
}) {
  return (
    <p
      ref={focusRef}
      tabIndex={-1}
      className="m-0 flex items-start gap-2.5 rounded-aura-md border border-border-default bg-bg-canvas p-aura-3 text-sm"
    >
      <span className="flex pt-0.5 text-fg-secondary" aria-hidden>
        <IconClock />
      </span>
      {pendingWords(until)}
    </p>
  );
}

function Footer({ lines }: { lines: [string, string] | null }) {
  if (!lines) return null;
  return (
    <p className="m-0 flex flex-col gap-0.5 text-xs text-fg-secondary md:flex-row md:justify-between">
      <span>{lines[0]}</span>
      <span>{lines[1]}</span>
    </p>
  );
}

/**
 * Focus after an accept and its Undo (WCAG 2.4.3, spec-check 15 Oct): the dialog's button is gone once
 * the refreshed page shows the pending line, so focus goes to that line; after an Undo the page draws
 * Accept again, and focus goes back to it.
 */
function usePendingFocus(pending: string | null) {
  const card = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLParagraphElement>(null);
  const before = useRef(pending);
  useEffect(() => {
    const was = before.current;
    before.current = pending;
    if (!was && pending) line.current?.focus();
    if (was && !pending) card.current?.querySelector<HTMLElement>('[data-accept-baseline]')?.focus();
  }, [pending]);
  return { card, line };
}

interface CardBase {
  view: PageChangeView;
  siteName: string;
  canAccept: boolean;
  viewerName: string;
}

/**
 * Site detail's Page fingerprint card (spec §26.8, SiteDetail / MSite FINGERPRINT states): Recording,
 * Matches (one line, "Show fingerprint"), Change waiting / PROBLEM open (the What changed rows, Accept
 * for Admins), No data, No fingerprint yet.
 */
export function PageFingerprintCard({ view: v, siteName, canAccept, viewerName }: CardBase) {
  const [open, setOpen] = useState(false);
  const { card: cardRef, line: lineRef } = usePendingFocus(v.pending?.until ?? null);
  const differs = v.status === 'waiting' || v.status === 'problem';
  const toggles = v.status === 'matches' || v.status === 'accepted' || v.status === 'no_data';
  const fullShown = v.status === 'recording' || (toggles && open);
  return (
    <Card
      title="Page fingerprint"
      headingLevel={2}
      description="Home page / · read every 30 min · title, description, robots, canonical, first h1, script and link domains"
    >
      <div ref={cardRef} className="flex flex-col gap-3">
        <StatusLine v={v} />
        {v.pending && <Pending until={v.pending.until} focusRef={lineRef} />}
        {differs && (
          <>
            {v.incident && <IncidentRow incident={v.incident} />}
            <ChangeRows rows={v.rows} />
            <Footer lines={footerWords(v, v.status === 'waiting')} />
            {!v.pending && (
              <AcceptRow
                v={v}
                siteName={siteName}
                canAccept={canAccept}
                viewerName={viewerName}
                rows={v.rows}
              />
            )}
          </>
        )}
        {toggles && v.fingerprint.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            touchHeight
            icon={open ? <IconChevronUp /> : <IconChevronDown />}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="self-start max-md:w-full"
          >
            {open ? 'Hide fingerprint' : 'Show fingerprint'}
          </Button>
        )}
        {fullShown && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-fg-tertiary">
              {v.status === 'recording'
                ? 'Current fingerprint'
                : v.status === 'no_data'
                  ? `Last fingerprint read${v.checkedAt ? ` · ${formatTime(new Date(v.checkedAt))}` : ''}`
                  : 'Baseline fingerprint'}
            </span>
            <FingerprintRows rows={v.fingerprint} />
          </div>
        )}
      </div>
    </Card>
  );
}

/** "Problem · INC-0157 · Page change · since 09:30 ›" — the site's open incident (SiteDetail, MSite). */
function IncidentRow({ incident }: { incident: NonNullable<PageChangeView['incident']> }) {
  return (
    <Link
      href={`/incidents/${incident.id}`}
      className="flex min-h-11 items-center gap-2.5 rounded-aura-md border border-border-default px-aura-3 text-sm text-fg-primary no-underline hover:bg-bg-surface-hover"
    >
      <Badge tone="warning" variant="soft" icon={<IconTriangleAlert />}>
        Problem
      </Badge>
      <span className="grow">{`${formatIncidentId(incident.number)} · Page change · since ${formatTime(new Date(incident.since))}`}</span>
      <IconChevronRight aria-hidden />
    </Link>
  );
}

function NewScriptBadge() {
  return (
    <Badge tone="danger" variant="outline" icon={<IconTriangleAlert />}>
      New script domain
    </Badge>
  );
}

function AcceptRow({
  v,
  siteName,
  canAccept,
  viewerName,
  rows,
  incidentLabel,
}: Omit<CardBase, 'view'> & { v: PageChangeView; rows: readonly ChangeRowView[]; incidentLabel?: string }) {
  if (!canAccept) return <AdminOnlyHint />;
  if (!v.checkId) return null;
  const accept = (
    <AcceptBaseline
      checkId={v.checkId}
      monitorId={v.monitorId}
      siteName={siteName}
      description={[incidentLabel, siteName, 'home page /'].filter(Boolean).join(' · ')}
      rows={rows}
      newScript={v.newScript}
      nextFetchAt={v.nextFetchAt}
      viewerName={viewerName}
    />
  );
  // The incident card explains the choice (IncidentPageChange); Site detail's card has the button only.
  if (!incidentLabel) return accept;
  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle pt-3 md:flex-row md:items-center md:gap-3">
      {accept}
      <span className="text-xs text-fg-secondary">
        Intended change (redesign, a new tool)? Accept it. A hack? The client fixes the page and this recovers
        when it matches the baseline again.
      </span>
    </div>
  );
}

/** This incident's accept, for the card's success line (its latest `baseline_accepted`, not undone). */
export interface IncidentAccept {
  at: string;
  by: string;
  withResolve: boolean;
  /** The fetch that matched it (the incident's recovery), once there is one. */
  matchedAt: string | null;
}

/**
 * The Incident page's What changed card (spec §26.4, IncidentPageChange / MIncidentPageChange): the rows
 * the incident opened with, the live state of the page under them (pending accept, accepted, matched),
 * Accept for Admins while the page still differs.
 */
export function WhatChangedCard({
  view: v,
  rows,
  newScript,
  incidentLabel,
  resolved,
  accepted,
  siteName,
  canAccept,
  viewerName,
}: CardBase & {
  /** The rows the incident opened with (its detail), not the live diff. */
  rows: readonly ChangeRowView[];
  newScript: readonly string[];
  incidentLabel: string;
  resolved: boolean;
  accepted: IncidentAccept | null;
}) {
  const { card: cardRef, line: lineRef } = usePendingFocus(v.pending?.until ?? null);
  const live = v.status === 'waiting' || v.status === 'problem';
  return (
    <Card
      title="What changed"
      headingLevel={2}
      description={compareWords(v, rows.length)}
      actions={newScript.length ? <NewScriptBadge /> : undefined}
    >
      <div ref={cardRef} className="flex flex-col gap-3">
        {v.pending && <Pending until={v.pending.until} focusRef={lineRef} />}
        {!v.pending && accepted && (
          <Alert tone="success">
            {acceptedWords({ ...accepted, nextFetchAt: v.nextFetchAt, incidentLabel })}
          </Alert>
        )}
        <ChangeRows rows={rows} />
        {live && <Footer lines={footerWords(v)} />}
        {!resolved && live && !v.pending && !accepted && (
          <AcceptRow
            v={v}
            siteName={siteName}
            canAccept={canAccept}
            viewerName={viewerName}
            rows={v.rows.length ? v.rows : rows}
            incidentLabel={incidentLabel}
          />
        )}
      </div>
    </Card>
  );
}
