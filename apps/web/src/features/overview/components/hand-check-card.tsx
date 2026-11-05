'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Alert, Button, Card, Dialog, Textarea } from '@jirawatpyk/aura-react';
import {
  IconBan,
  IconCheck,
  IconCircle,
  IconCircleCheck,
  IconInfo,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import { formatTime } from '@dxt/shared';
import { SiteStatusBadge } from '@/components/status-badges';
import type { HandCheckCard as Card_, HandCheckLine, HandCheckRow } from '../hand-check';

export type HandCheckResult = { ok: true } | { ok: false; message: string };
/** `stale`: the incident changed before the press (§31.6) — Report down stays disabled. */
export type ManualIncidentResult =
  { ok: true; incidentId: string } | { ok: false; message: string; stale?: boolean };
export interface HandCheckActions {
  record: (siteId: string) => Promise<HandCheckResult>;
  open: (input: { siteId: string; note?: string }) => Promise<ManualIncidentResult>;
  /** Down again on the site's open incident (D-055 item 7). */
  downAgain?: (input: { incidentId: string; note?: string }) => Promise<ManualIncidentResult>;
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
  // After Down / Down again the button that opened the dialog is gone: focus the row's incident link.
  const [landed, setLanded] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Once the dialog is closed (it hands focus back first) and the refresh brought the row's line.
    if (!landed || opening) return;
    const links = [
      ...(list.current?.querySelectorAll<HTMLElement>(
        `[data-site="${landed}"] [data-hand-line="reported"]`,
      ) ?? []),
    ];
    const link = links.find((l) => l.getClientRects().length > 0) ?? links[0];
    if (link) {
      link.focus();
      setLanded(null);
    }
  }, [landed, opening, card]);

  const loadsOk = (row: HandCheckRow) =>
    start(async () => {
      setError(null);
      const r = await actions.record(row.siteId).catch(() => ({ ok: false as const, message: FAILED }));
      if (!r.ok) setError(r.message);
      router.refresh();
    });

  // No action to call: no Down again button (D-055 item 7).
  const shown = actions.downAgain
    ? card.rows
    : card.rows.map((r) =>
        r.openIncident ? { ...r, openIncident: { ...r.openIncident, downAgain: null } } : r,
      );
  const cards = shown.map((row) => (
    <PhoneRow key={row.siteId} row={row} pending={pending} onOk={loadsOk} onDown={setOpening} />
  ));
  const rows = shown.map((row) =>
    phone ? (
      <PhoneRow key={row.siteId} row={row} pending={pending} onOk={loadsOk} onDown={setOpening} />
    ) : (
      <DesktopRow key={row.siteId} row={row} pending={pending} onOk={loadsOk} onDown={setOpening} />
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
      <div ref={list} className="flex flex-col gap-3">
        {error && (
          <Alert tone="danger" title="Not recorded">
            {error}
          </Alert>
        )}
        {phone ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">{rows}</ul>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0 xl:hidden">{cards}</ul>
        )}
        {!phone && (
          <div role="table" aria-label="Hand check · Tier 1" className="flex flex-col max-xl:hidden">
            <div
              role="row"
              className="grid grid-cols-[minmax(0,1fr)_calc(var(--spacing)*28)_calc(var(--spacing)*28)_minmax(max-content,1.2fr)_calc(var(--spacing)*80)] gap-4 border-b border-border-subtle pb-2 text-xs text-fg-secondary"
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
          onDone={setLanded}
          onOpen={actions.open}
          onDownAgain={actions.downAgain}
        />
      )}
    </Card>
  );
}

const LINK = 'inline-flex min-h-11 items-center gap-2 text-sm underline-offset-2 hover:underline';

/** The row's hand-check line (§30.2, §31.1): focus lands on it after Down / Down again (`data-hand-line`). */
function Line({ line }: { line: HandCheckLine }) {
  if (line.kind === 'incident')
    return (
      // "reported": focus waits for this line once the refresh brings it (after Loads OK the row had
      // another line, whose node React replaces).
      <Link
        href={`/incidents/${line.incidentId}`}
        data-hand-line="reported"
        className={`${LINK} text-fg-danger`}
      >
        <IconBan aria-hidden />
        {line.text}
      </Link>
    );
  if (line.kind === 'open')
    return (
      <Link
        href={`/incidents/${line.incidentId}`}
        data-hand-line
        className={`${LINK} ${line.tone === 'danger' ? 'text-fg-danger' : 'text-alert-warning-fg'}`}
      >
        {line.tone === 'danger' ? <IconBan aria-hidden /> : <IconTriangleAlert aria-hidden />}
        {line.text}
      </Link>
    );
  if (line.kind === 'ok')
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 text-sm">
        <span className="inline-flex items-center gap-2 text-fg-positive">
          <IconCircleCheck aria-hidden />
          {line.text}
        </span>
        {line.incident && (
          <Link
            href={`/incidents/${line.incident.id}`}
            data-hand-line
            className="inline-flex min-h-11 items-center text-xs text-fg-secondary underline-offset-2 hover:underline"
          >
            {line.incident.text}
          </Link>
        )}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2 text-sm text-fg-tertiary">
      <IconCircle aria-hidden />
      {line.text}
    </span>
  );
}
const STATUS_WORD: Record<NonNullable<HandCheckRow['status']>, string> = {
  ok: 'OK',
  problem: 'Problem',
  down: 'Down',
  maintenance: 'Maintenance',
};

type RowProps = {
  row: HandCheckRow;
  pending: boolean;
  onOk: (row: HandCheckRow) => void;
  onDown: (row: HandCheckRow) => void;
};

function Buttons({ row, pending, onOk, onDown, phone }: RowProps & { phone: boolean }) {
  if (row.readOnly) return <span className="text-xs text-fg-tertiary">{row.readOnly}</span>;
  if (!row.canCheck && !row.canOpen && !row.openIncident?.downAgain) return null;
  return (
    <div className={phone ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap items-center justify-end gap-2'}>
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
      {row.openIncident?.downAgain && (
        <Button
          variant="secondary"
          size={phone ? 'md' : 'sm'}
          fullWidth={phone}
          disabled={pending}
          onClick={() => onDown(row)}
          aria-label={`${row.openIncident.downAgain === 'raise' ? 'Report down' : 'Down again'} · ${row.name}`}
        >
          <IconBan />
          {row.openIncident.downAgain === 'raise' ? 'Report down…' : 'Down again…'}
        </Button>
      )}
      {row.paused && <span className="text-xs text-fg-secondary">{row.paused}</span>}
    </div>
  );
}

function DesktopRow({ row, ...rest }: RowProps) {
  return (
    <div
      role="row"
      data-site={row.siteId}
      className="grid grid-cols-[minmax(0,1fr)_calc(var(--spacing)*28)_calc(var(--spacing)*28)_minmax(max-content,1.2fr)_calc(var(--spacing)*80)] items-center gap-4 border-b border-border-subtle py-3 last:border-b-0"
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
        {row.status && row.statusNote && <span className="text-xs text-fg-secondary">{row.statusNote}</span>}
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

function PhoneRow({ row, ...rest }: RowProps) {
  return (
    <li
      data-site={row.siteId}
      className="flex flex-col gap-2 rounded-aura-md border border-border-subtle p-aura-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="font-medium">{row.name}</span>
          <span className="text-xs text-fg-secondary">
            {`Owner ${row.ownerName ?? '—'}${row.status && row.statusNote ? ` · ${STATUS_WORD[row.status]} ${row.statusNote}` : ''}`}
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
  onDownAgain,
  onDone,
}: {
  row: HandCheckRow;
  asOf: string | null;
  viewerName: string;
  phone: boolean;
  open: boolean;
  onClose: () => void;
  onOpen: HandCheckActions['open'];
  onDownAgain?: HandCheckActions['downAgain'];
  /** Done: the row whose button is about to go (focus moves to its incident link). */
  onDone?: (siteId: string) => void;
}) {
  const router = useRouter();
  // On a site whose incident is still open: Down again (D-055 item 7).
  const again = row.openIncident?.downAgain ?? null;
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The incident changed before the press (§31.6): pressing again can't help.
  const [stale, setStale] = useState(false);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      setError(null);
      const call =
        again && onDownAgain
          ? onDownAgain({ incidentId: row.openIncident!.id, note })
          : onOpen({ siteId: row.siteId, note });
      const r = await call.catch(() => ({
        ok: false as const,
        message: FAILED,
      }));
      if (!r.ok) {
        setError(r.message);
        setStale('stale' in r && r.stale === true);
        return;
      }
      onDone?.(row.siteId);
      onClose();
      router.refresh();
    });
  const logged = (
    <p className="m-0 text-xs text-fg-secondary">{`Logged in the audit log as ${viewerName}.`}</p>
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={
        again === 'relapse'
          ? `Report ${row.name} down again?`
          : again === 'raise'
            ? `Report ${row.name} down?`
            : `Open an incident for ${row.name}?`
      }
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
            <Button variant="danger" fullWidth={phone} loading={pending} disabled={stale} onClick={submit}>
              <IconBan />
              {again ? 'Report down' : 'Open incident'}
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
        />
        {error && (
          <Alert tone="danger" title={again ? 'Not reported' : 'Not opened'}>
            {stale ? `${error} Close this and look at the row again.` : error}
          </Alert>
        )}
        <div className="flex items-start gap-2 rounded-aura-md bg-bg-canvas p-aura-3 text-sm">
          <IconInfo aria-hidden className="mt-0.5 shrink-0 text-fg-secondary" />
          <div className="flex flex-col gap-1">
            {(again && row.openIncident?.info.length
              ? row.openIncident.info
              : ['Posts the DOWN alert to the Alerts Space now and starts the client-update clock.']
            ).map((t) => (
              <p key={t} className="m-0">
                {t}
              </p>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** "02:17" — the statuses' time for the rows, from the fault's "as of". */
export const handCheckAsOf = (asOf: string | null | undefined) => (asOf ? formatTime(new Date(asOf)) : null);
