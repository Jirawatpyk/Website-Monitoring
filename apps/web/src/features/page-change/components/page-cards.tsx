'use client';

import { useState } from 'react';
import { Badge, Button, Card } from '@jirawatpyk/aura-react';
import {
  IconChevronDown,
  IconChevronUp,
  IconCircleCheck,
  IconCircleDotDashed,
  IconClock,
  IconEye,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import { formatIncidentId } from '@dxt/shared';
import type { ChangeRowView, PageChangeView } from '../model';
import { compareWords, footerWords, pendingWords, statusWords } from '../words';
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

function Pending({ until }: { until: string }) {
  return (
    <p className="m-0 flex items-start gap-2.5 rounded-aura-md bg-bg-canvas p-aura-3 text-sm">
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
  const differs = v.status === 'waiting' || v.status === 'problem';
  const toggles = v.status === 'matches' || v.status === 'accepted' || v.status === 'no_data';
  const fullShown = v.status === 'recording' || (toggles && open);
  return (
    <Card
      title="Page fingerprint"
      headingLevel={2}
      actions={v.newScript.length ? <NewScriptBadge /> : undefined}
    >
      <div className="flex flex-col gap-3">
        <StatusLine v={v} />
        {v.pending && <Pending until={v.pending.until} />}
        {differs && (
          <>
            <ChangeRows rows={v.rows} />
            <Footer lines={footerWords(v, v.status === 'waiting')} />
            {v.incident && (
              <Button variant="ghost" size="sm" touchHeight href={`/incidents/${v.incident.id}`}>
                {`Open ${formatIncidentId(v.incident.number)}`}
              </Button>
            )}
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
            className="self-start"
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
                  ? 'Last fingerprint read'
                  : 'Baseline fingerprint'}
            </span>
            <FingerprintRows rows={v.fingerprint} />
          </div>
        )}
      </div>
    </Card>
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
  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle pt-3 md:flex-row md:items-center md:gap-3">
      <AcceptBaseline
        checkId={v.checkId}
        monitorId={v.monitorId}
        siteName={siteName}
        description={[incidentLabel, siteName, 'home page /'].filter(Boolean).join(' · ')}
        rows={rows}
        newScript={v.newScript}
        nextFetchAt={v.nextFetchAt}
        viewerName={viewerName}
        fullWidth={false}
      />
      <span className="text-xs text-fg-secondary">
        Intended change (redesign, a new tool)? Accept it. A hack? The client fixes the page and this recovers
        when it matches the baseline again.
      </span>
    </div>
  );
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
  siteName,
  canAccept,
  viewerName,
}: CardBase & {
  /** The rows the incident opened with (its detail), not the live diff. */
  rows: readonly ChangeRowView[];
  newScript: readonly string[];
  incidentLabel: string;
  resolved: boolean;
}) {
  const live = v.status === 'waiting' || v.status === 'problem';
  const accepted = v.status === 'accepted' || (v.status === 'matches' && !!v.baseline?.acceptedBy);
  return (
    <Card
      title="What changed"
      headingLevel={2}
      description={compareWords(v, rows.length)}
      actions={newScript.length ? <NewScriptBadge /> : undefined}
    >
      <div className="flex flex-col gap-3">
        {v.pending && <Pending until={v.pending.until} />}
        {!v.pending && accepted && <StatusLine v={{ ...v, status: 'accepted' }} />}
        <ChangeRows rows={rows} />
        {live && <Footer lines={footerWords(v)} />}
        {!resolved && live && !v.pending && (
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
