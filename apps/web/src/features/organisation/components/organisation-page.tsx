'use client';

import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Progress,
  Select,
  Textarea,
  type DataTableColumn,
} from '@jirawatpyk/aura-react';
import { IconCheck, IconPlus } from '@jirawatpyk/aura-react/icons';
import { useRouter } from 'next/navigation';
import { FOCUS_TARGET } from '@/components/focus-target';
import { useEffect, useRef, useState, useTransition } from 'react';
import { UnsavedBar } from '@/components/unsaved-bar';
import { SECTION_HEADING, SettingsHeader, ViewOnlyLine } from '@/features/settings';
import { saveResponseHours } from '../actions';
import { HolidaysSection } from './holidays-section';
import {
  BUDGET,
  changedFields,
  clientRows,
  DAY_SET_LABELS,
  DB_INCLUDED_BYTES,
  gigabytes,
  hoursDiff,
  hoursError,
  hoursText,
  RETENTION,
  tierCards,
  TIME_OPTIONS,
  type ClientRow,
  type DaySet,
  type Hours,
  type HoursDiff,
} from '../model';
import type { OrganisationData } from '../queries';

const HEADING = SECTION_HEADING;

const sitesWord = (n: number) => `${n} ${n === 1 ? 'site' : 'sites'}`;

/**
 * Settings › Organisation (board Organisation; spec §7, §14.14, §22.5; S17, D-069). An Admin edits the
 * one response-hours setting from md; below md the page is view only. The tiers, clients, what is kept
 * and the budget are read-only everywhere.
 */
export function OrganisationPageView({ data }: { data: OrganisationData }) {
  const router = useRouter();
  const [hours, setDraft] = useState<Hours>(data.hours);
  const [open, setOpen] = useState(false);
  // Each opening starts a fresh dialog (an empty note); the Dialog stays mounted so focus returns.
  const [opened, setOpened] = useState(0);
  // The saved line and a counter, so focus moves on every save even when the words repeat.
  const [saved, setSaved] = useState<{ text: string; n: number } | null>(null);
  const setHours = (h: Hours) => {
    setDraft(h);
    setSaved(null);
  };
  const statusRef = useRef<HTMLSpanElement>(null);

  // A save (or another Admin's) refreshes the data: start again from what is stored.
  const [stored, setStored] = useState(data.hours);
  if (stored !== data.hours) {
    setStored(data.hours);
    setDraft(data.hours);
  }
  // After a save the dialog is gone: focus the saved line once React has rendered it.
  useEffect(() => {
    if (saved) statusRef.current?.focus();
  }, [saved]);

  const tiers = tierCards(data.sites);
  // Hours written outside the choices count as a change: saving is how they are replaced.
  const changes = changedFields(hours, data.hours) || (data.storedOther ? 1 : 0);
  const dirty = changes > 0;
  const toError = hoursError(hours);
  const diff = hoursDiff(data.hours, hours, data.sites, data.storedOther);
  const t23 = data.sites.filter((s) => s.tier !== 1).length;
  const t1 = data.sites.filter((s) => s.tier === 1).length;

  return (
    <div className="flex flex-col gap-6">
      <SettingsHeader current="organisation" />
      <ViewOnlyLine />
      <OnThisPage />

      <section id="tiers" className="flex scroll-mt-4 flex-col gap-3" aria-labelledby="tiers-h">
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
          <h2 id="tiers-h" className={HEADING}>
            <span className="md:hidden">TIERS</span>
            <span className="hidden md:inline">Tiers</span>
          </h2>
          <span className="text-sm text-fg-secondary">
            Response hours are set here only — alert channels, escalation and profiles read them. Changes are
            logged.
          </span>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {tiers.map((t) => (
            <Card
              key={t.tier}
              title={`Tier ${t.tier}`}
              headingLevel={3}
              actions={
                <Badge tone="neutral" variant="outline">
                  {sitesWord(t.count)}
                </Badge>
              }
            >
              <div className="flex flex-col gap-3">
                <dl className="m-0 flex flex-col text-sm">
                  {t.facts.map((f) => (
                    <div
                      key={f.k}
                      className="flex justify-between gap-3 border-b border-border-subtle py-1.5"
                    >
                      <dt className="text-fg-secondary">{f.k}</dt>
                      <dd className="m-0 text-right font-medium">{f.v}</dd>
                    </div>
                  ))}
                </dl>
                <span className="text-xs leading-normal text-fg-secondary">{t.names}</span>
              </div>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <HoursPanel
            title="Tier 1 · owner hours"
            badge={sitesWord(t1)}
            text="Covered 24/7: the owner inside the response hours, the person on call outside them. Tier 1 uses the Tier 2–3 hours."
            hours={data.hours}
            stored={data.storedOther}
          />
          <HoursPanel
            title="Tier 2–3 · response hours"
            badge={`One setting for both tiers · ${sitesWord(t23)}`}
            text="Outside these hours DOWN still posts, but escalation timers wait until the start time. PROBLEM is held until then. Tier 2–3 have no on-call. The same hours decide when Tier 1 hands over to on-call."
            hours={hours}
            stored={data.storedOther}
            onChange={setHours}
            error={toError}
          />
        </div>
        <span
          ref={statusRef}
          role="status"
          tabIndex={-1}
          className={`self-start text-sm text-fg-positive empty:hidden ${FOCUS_TARGET}`}
        >
          {saved?.text}
        </span>
      </section>

      <ClientsSection rows={clientRows(data.clients)} />

      <HolidaysSection holidays={data.holidays} hours={data.hoursNow} now={new Date(data.now)} />

      <div id="data-kept" className="grid scroll-mt-4 gap-4 md:grid-cols-2">
        <DataKept bytes={data.storageBytes} />
        <Budget />
      </div>

      {dirty && (
        <div className="hidden md:block">
          <UnsavedBar
            label={changes === 1 ? '1 unsaved change' : `${changes} unsaved changes`}
            hint={
              toError
                ? 'Fix the hours first — “To” must be after “From”'
                : data.storedOther
                  ? 'The stored hours aren’t one of these choices — only saving replaces them'
                  : 'Response hours apply within a minute of saving · the next step shows who is affected'
            }
            onDiscard={() => setHours(data.hours)}
            saveDisabled={!!toError}
            onSave={() => {
              setOpened((n) => n + 1);
              setOpen(true);
            }}
          />
        </div>
      )}

      {opened > 0 && (
        <SaveHoursDialog
          key={opened}
          open={open}
          hours={hours}
          diff={diff}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            setSaved((s) => ({
              text: `Saved — ${hoursText(hours)}, in use within a minute.`,
              n: (s?.n ?? 0) + 1,
            }));
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function HoursPanel({
  title,
  badge,
  text,
  hours,
  stored,
  onChange,
  error,
}: {
  title: string;
  badge: string;
  text: string;
  hours: Hours;
  /** The stored hours when they aren't one of the editor's choices. */
  stored: string | null;
  onChange?: (h: Hours) => void;
  error?: string | null;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-aura-md border border-border-default bg-bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold">{title}</h3>
        <Badge tone="neutral" variant="outline">
          {badge}
        </Badge>
      </div>
      {onChange ? (
        <>
          <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 md:grid">
            <Select
              label="Days"
              options={DAY_SET_LABELS.map((d) => ({ value: d, label: d }))}
              value={hours.days}
              onChange={(e) => onChange({ ...hours, days: e.target.value as DaySet })}
            />
            <Select
              label="From"
              options={TIME_OPTIONS.map((t) => ({ value: t, label: t }))}
              value={hours.from}
              onChange={(e) => onChange({ ...hours, from: e.target.value })}
            />
            <Select
              label="To"
              options={TIME_OPTIONS.map((t) => ({ value: t, label: t }))}
              value={hours.to}
              onChange={(e) => onChange({ ...hours, to: e.target.value })}
              error={error ?? undefined}
            />
          </div>
          <span className="text-base font-semibold md:hidden">{stored ?? hoursText(hours)}</span>
        </>
      ) : (
        <span className="text-base font-semibold">{stored ?? hoursText(hours)}</span>
      )}
      {onChange && stored && (
        <span className="text-xs leading-normal text-fg-warning">
          Saved as {stored}, which isn’t one of these choices — saving replaces it.
        </span>
      )}
      <span className="text-xs leading-normal text-fg-secondary">{text}</span>
    </div>
  );
}

/** "Change response hours?" (board): before → after per row, who it affects, a required note. */
function SaveHoursDialog({
  open,
  hours,
  diff,
  onClose,
  onSaved,
}: {
  open: boolean;
  hours: Hours;
  diff: HoursDiff[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const noteError =
    tried && !note.trim() ? 'Add a short note — it goes in the audit log with the change' : null;

  const save = () => {
    if (!note.trim()) {
      setTried(true);
      return;
    }
    setFailure(null);
    start(async () => {
      const result = await saveResponseHours({ ...hours, note });
      if (result.ok) onSaved();
      else setFailure(result.message);
    });
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!pending) onClose();
      }}
      title="Change response hours?"
      description="New hours apply within a minute, open incidents included. A PROBLEM already held keeps the time it was held until."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Back to editing
          </Button>
          <Button variant="primary" icon={<IconCheck />} loading={pending} onClick={save}>
            Save and log
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <dl className="m-0 flex flex-col rounded-aura-md border border-border-default">
          {diff.map((d, i) => (
            <div
              key={d.where}
              className={`grid grid-cols-[calc(var(--spacing)*37)_minmax(0,1fr)] gap-3 px-3.5 py-3 text-sm ${i ? 'border-t border-border-subtle' : ''}`}
            >
              <dt className="font-mono text-xs text-fg-secondary">{d.where}</dt>
              <dd className="m-0 flex flex-col gap-1">
                <del className="text-fg-danger">
                  <span className="sr-only">Was: </span>
                  {d.before}
                </del>
                <ins className="text-fg-positive no-underline">
                  <span className="sr-only">Now: </span>
                  {d.after}
                </ins>
                <span className="font-medium">{d.affects}</span>
                <span className="text-fg-secondary">{d.covers}</span>
              </dd>
            </div>
          ))}
        </dl>
        <Textarea
          label="Change note"
          required
          rows={2}
          placeholder="Why are you changing the hours?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={noteError ?? undefined}
          hint="Saved with the change in the audit log."
        />
        {failure && (
          <Alert tone="danger" title="Not saved" role="alert">
            {failure}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}

function ClientsSection({ rows }: { rows: ClientRow[] }) {
  const columns: DataTableColumn<ClientRow>[] = [
    {
      key: 'name',
      label: 'Client',
      grow: 1,
      minWidth: 160,
      render: (r) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="font-medium">{r.name}</span>
          <span className="truncate text-xs text-fg-secondary">{r.sitesLine}</span>
        </span>
      ),
    },
    {
      key: 'count',
      label: 'Sites',
      width: 80,
      align: 'end',
      render: (r) => <span className="tabular-nums">{r.count}</span>,
    },
    { key: 'am', label: 'AM', width: 140, render: (r) => r.am },
    {
      key: 'language',
      label: 'Language',
      width: 110,
      render: (r) => <span className="text-fg-secondary">{r.language}</span>,
    },
  ];
  return (
    <section id="clients" className="flex scroll-mt-4 flex-col gap-3" aria-labelledby="clients-h">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-3">
          <h2 id="clients-h" className={HEADING}>
            <span className="md:hidden">CLIENTS · {rows.length}</span>
            <span className="hidden md:inline">Clients</span>
          </h2>
          <span className="text-sm text-fg-secondary">
            Who has sites with us, their account manager and report language.
          </span>
        </div>
        <div className="hidden items-center gap-2.5 md:flex">
          <span className="text-xs text-fg-secondary">New clients are created with their first site</span>
          <Button variant="secondary" size="sm" touchHeight icon={<IconPlus />} href="/sites/new">
            Add client
          </Button>
        </div>
      </div>
      <div className="hidden md:block">
        <DataTable label="Clients" rowKey="name" columns={columns} rows={rows} rowHeight="auto" />
      </div>
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface p-0 md:hidden">
        {rows.map((r) => (
          <li
            key={r.name}
            className="flex min-h-16 items-center justify-between gap-3 border-b border-border-subtle px-3.5 py-2.5 last:border-b-0"
          >
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">{r.name}</span>
              <span className="truncate text-xs text-fg-secondary">
                {r.am === '—' ? r.sitesLine : `${r.sitesLine} · AM ${r.am}`}
              </span>
            </span>
            <span className="shrink-0 text-sm text-fg-secondary">{r.language}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "On this page" (§41 item 1) so the long page stays navigable. It lists the sections that exist:
 * Shared forbidden words joins with PR 3b (D-069).
 */
const ON_THIS_PAGE = [
  { href: '#tiers', label: 'Tiers' },
  { href: '#clients', label: 'Clients' },
  { href: '#holidays', label: 'Company holidays' },
  { href: '#data-kept', label: 'Data kept' },
  { href: '#monthly-cost', label: 'Monthly cost' },
] as const;

function OnThisPage() {
  return (
    <nav aria-label="On this page" className="text-sm text-fg-secondary">
      <span>On this page: </span>
      {ON_THIS_PAGE.map((s, i) => (
        <span key={s.label}>
          {i > 0 && <span aria-hidden> · </span>}
          <a href={s.href} className="inline-flex min-h-11 items-center text-fg-accent">
            {s.label}
          </a>
        </span>
      ))}
    </nav>
  );
}

function DataKept({ bytes }: { bytes: number | null }) {
  return (
    <Card
      title="Data kept"
      headingLevel={2}
      actions={
        <span className="text-xs text-fg-secondary">
          {bytes === null
            ? 'Database size unavailable'
            : `Database ${gigabytes(bytes)} of ${gigabytes(DB_INCLUDED_BYTES)}`}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {bytes !== null && (
          <Progress
            value={Math.min(bytes, DB_INCLUDED_BYTES)}
            max={DB_INCLUDED_BYTES}
            aria-label="Database storage used"
            valueText={`${gigabytes(bytes)} of ${gigabytes(DB_INCLUDED_BYTES)} used`}
            size="sm"
          />
        )}
        <Facts rows={RETENTION} />
        <span className="text-xs leading-normal text-fg-secondary">
          Times are stored in UTC and shown in Thailand time (UTC+7). Raw results older than 90 days are
          deleted.
        </span>
      </div>
    </Card>
  );
}

function Budget() {
  return (
    <Card
      id="monthly-cost"
      className="scroll-mt-4"
      title="Monthly cost"
      headingLevel={2}
      actions={
        <span className="text-xs text-fg-secondary">
          Cap {BUDGET.cap} · approved {BUDGET.approved}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <Facts rows={BUDGET.lines} />
        <span className="text-xs leading-normal text-fg-secondary">
          Estimates; each provider’s bill has the exact amount. Vercel’s usage moves with how often we deploy.
        </span>
      </div>
    </Card>
  );
}

function Facts({ rows }: { rows: readonly { k: string; v: string }[] }) {
  return (
    <dl className="m-0 flex flex-col text-sm">
      {rows.map((r) => (
        <div key={r.k} className="flex justify-between gap-3 border-b border-border-subtle py-1.5">
          <dt className="text-fg-secondary">{r.k}</dt>
          <dd className="m-0 text-right font-medium tabular-nums">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}
