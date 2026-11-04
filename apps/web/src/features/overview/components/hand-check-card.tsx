'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert, Button, Card, Dialog, Textarea } from '@jirawatpyk/aura-react';
import { IconBan, IconCheck, IconCircle, IconCircleCheck, IconInfo } from '@jirawatpyk/aura-react/icons';
import { formatTime } from '@dxt/shared';
import { SiteStatusBadge } from '@/components/status-badges';
import type { HandCheckCard as Card_, HandCheckLine, HandCheckRow } from '../hand-check';

export type HandCheckResult = { ok: true } | { ok: false; message: string };
export type ManualIncidentResult = { ok: true; incidentId: string } | { ok: false; message: string };
export interface HandCheckActions {
  record: (siteId: string) => Promise<HandCheckResult>;
  open: (input: { siteId: string; note?: string }) => Promise<ManualIncidentResult>;
}

const FAILED = 'Couldn’t reach the server. Check your connection and try again.';
const NOTE_MAX = 500;

/**
 * Hand check · Tier 1 (S12b, spec §30.2–4; MainFault, MOverview4 FAULT): under the fault banner while
 * the sweep is stale. Loads OK records at once (no confirm, nothing sent); Down opens the confirm, then
 * a manual incident whose DOWN alert leaves at once (D-053 item 5).
 */
export function HandCheckCard({
  card,
  asOf,
  viewerName,
  actions,
  phone = false,
}: {
  card: Card_;
  /** "02:17": the statuses' time. */
  asOf: string | null;
  viewerName: string;
  actions: HandCheckActions;
  phone?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<HandCheckRow | null>(null);

  const loadsOk = (row: HandCheckRow) =>
    start(async () => {
      setError(null);
      const r = await actions.record(row.siteId).catch(() => ({ ok: false as const, message: FAILED }));
      if (!r.ok) setError(r.message);
      router.refresh();
    });

  const rows = card.rows.map((row) =>
    phone ? (
      <PhoneRow key={row.siteId} row={row} asOf={asOf} pending={pending} onOk={loadsOk} onDown={setOpening} />
    ) : (
      <DesktopRow
        key={row.siteId}
        row={row}
        asOf={asOf}
        pending={pending}
        onOk={loadsOk}
        onDown={setOpening}
      />
    ),
  );

  return (
    <Card
      title="Hand check · Tier 1"
      headingLevel={2}
      description={
        phone
          ? 'Open each site in a browser and record what you see. Again every 30 min until monitoring is back.'
          : 'While monitoring is degraded, open each Tier 1 site in a browser and record what you see. Check again every 30 min until monitoring is back.'
      }
      actions={<span className="text-sm text-fg-secondary">{phone ? card.shortCount : card.count}</span>}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-xs text-fg-secondary">
          {!phone && <span>{card.footer}</span>}
          {card.otherTiers && <span>{card.otherTiers}</span>}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {error && (
          <Alert tone="danger" title="Not recorded">
            {error}
          </Alert>
        )}
        {phone ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">{rows}</ul>
        ) : (
          <div role="table" aria-label="Hand check · Tier 1" className="flex flex-col">
            <div
              role="row"
              className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_calc(var(--spacing)*80)] gap-4 border-b border-border-subtle pb-2 text-xs text-fg-secondary"
            >
              <span role="columnheader">Site</span>
              <span role="columnheader">Owner</span>
              <span role="columnheader">Last status</span>
              <span role="columnheader">Hand check</span>
              <span role="columnheader" className="sr-only">
                Actions
              </span>
            </div>
            {rows}
          </div>
        )}
      </div>
      {opening && (
        <OpenIncidentDialog
          row={opening}
          asOf={asOf}
          viewerName={viewerName}
          phone={phone}
          open={!!opening}
          onClose={() => setOpening(null)}
          onOpen={actions.open}
        />
      )}
    </Card>
  );
}

function Line({ line }: { line: HandCheckLine }) {
  if (line.kind === 'incident')
    return (
      <Link
        href={`/incidents/${line.incidentId}`}
        className="inline-flex min-h-11 items-center gap-2 text-sm text-fg-danger underline-offset-2 hover:underline"
      >
        <IconBan aria-hidden />
        {line.text}
      </Link>
    );
  return (
    <span
      className={`inline-flex items-center gap-2 text-sm ${line.kind === 'ok' ? 'text-fg-positive' : 'text-fg-tertiary'}`}
    >
      {line.kind === 'ok' ? <IconCircleCheck aria-hidden /> : <IconCircle aria-hidden />}
      {line.text}
    </span>
  );
}

type RowProps = {
  row: HandCheckRow;
  asOf: string | null;
  pending: boolean;
  onOk: (row: HandCheckRow) => void;
  onDown: (row: HandCheckRow) => void;
};

function Buttons({ row, pending, onOk, onDown, phone }: Omit<RowProps, 'asOf'> & { phone: boolean }) {
  if (row.readOnly) return <span className="text-xs text-fg-tertiary">{row.readOnly}</span>;
  if (!row.canCheck && !row.canOpen) return null;
  return (
    <div className={phone ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap justify-end gap-2'}>
      {row.canCheck && (
        <Button
          variant="secondary"
          size={phone ? 'md' : 'sm'}
          fullWidth={phone}
          disabled={pending}
          onClick={() => onOk(row)}
          aria-label={`Loads OK · ${row.name}`}
        >
          <IconCheck />
          Loads OK
        </Button>
      )}
      {row.canOpen && (
        <Button
          variant="secondary"
          size={phone ? 'md' : 'sm'}
          fullWidth={phone}
          disabled={pending}
          onClick={() => onDown(row)}
          aria-label={`Down — open incident · ${row.name}`}
        >
          <IconBan />
          {phone ? 'Down…' : 'Down — open incident'}
        </Button>
      )}
    </div>
  );
}

function DesktopRow({ row, asOf, ...rest }: RowProps) {
  return (
    <div
      role="row"
      className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_calc(var(--spacing)*80)] items-center gap-4 border-b border-border-subtle py-3 last:border-b-0"
    >
      <div role="cell" className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{row.name}</span>
        {row.url && <span className="truncate text-xs text-fg-secondary">{row.url}</span>}
      </div>
      <span role="cell" className="truncate text-sm">
        {row.ownerName ?? '—'}
      </span>
      <div role="cell" className="flex flex-col items-start gap-1">
        {row.status ? <SiteStatusBadge status={row.status} /> : <span className="text-fg-tertiary">—</span>}
        {asOf && <span className="text-xs text-fg-secondary">{`as of ${asOf}`}</span>}
      </div>
      <div role="cell">
        <Line line={row.line} />
      </div>
      <div role="cell" className="flex justify-end">
        <Buttons row={row} {...rest} phone={false} />
      </div>
    </div>
  );
}

function PhoneRow({ row, asOf, ...rest }: RowProps) {
  return (
    <li className="flex flex-col gap-2 rounded-aura-md border border-border-subtle p-aura-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="font-medium">{row.name}</span>
          <span className="text-xs text-fg-secondary">
            {`Owner ${row.ownerName ?? '—'}${row.status && asOf ? ` · ${row.status === 'ok' ? 'OK' : 'last status'} as of ${asOf}` : ''}`}
          </span>
        </div>
        {row.status && <SiteStatusBadge status={row.status} />}
      </div>
      <Line line={row.line} />
      <Buttons row={row} {...rest} phone />
    </li>
  );
}

/** "Open an incident for realme.link?" (MainFault Open-incident dialog, §30.2). */
function OpenIncidentDialog({
  row,
  asOf,
  viewerName,
  phone,
  open,
  onClose,
  onOpen,
}: {
  row: HandCheckRow;
  asOf: string | null;
  viewerName: string;
  phone: boolean;
  open: boolean;
  onClose: () => void;
  onOpen: HandCheckActions['open'];
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await onOpen({ siteId: row.siteId, note }).catch(() => ({
        ok: false as const,
        message: FAILED,
      }));
      if (!r.ok) {
        setError(r.message);
        return;
      }
      onClose();
      router.push(`/incidents/${r.incidentId}`);
    });
  const logged = (
    <p className="m-0 text-xs text-fg-secondary">{`Logged in the audit log as ${viewerName}.`}</p>
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={`Open an incident for ${row.name}?`}
      description={`${row.name} · Tier 1 · owner ${row.ownerName ?? '—'}${asOf ? ` · statuses are from ${asOf}` : ''}`}
      footer={
        <div
          className={phone ? 'flex w-full flex-col gap-2' : 'flex w-full items-center justify-between gap-3'}
        >
          {!phone && logged}
          <div className={phone ? 'grid grid-cols-2 gap-2' : 'flex gap-2'}>
            <Button variant="secondary" fullWidth={phone} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" fullWidth={phone} loading={pending} onClick={submit}>
              <IconBan />
              Open incident
            </Button>
          </div>
          {phone && <div className="text-center">{logged}</div>}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Textarea
          label="What did you see?"
          optional
          rows={3}
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            phone
              ? 'e.g. Home page shows a 502 error'
              : 'e.g. Home page shows a 502 error from the hosting provider'
          }
          hint={`${note.length} / ${NOTE_MAX} · optional — shown on the incident timeline`}
          error={error ?? undefined}
        />
        <p className="m-0 flex items-start gap-2 text-sm text-fg-secondary">
          <IconInfo aria-hidden className="mt-0.5 shrink-0" />
          Posts the DOWN alert to the Alerts Space now and starts the client-update clock.
        </p>
      </div>
    </Dialog>
  );
}

/** "02:17" — the statuses' time for the rows, from the fault's "as of". */
export const handCheckAsOf = (asOf: string | null | undefined) => (asOf ? formatTime(new Date(asOf)) : null);
