'use client';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  type DataTableColumn,
} from '@jirawatpyk/aura-react';
import {
  IconBan,
  IconChevronRight,
  IconEye,
  IconFileText,
  IconLock,
  IconLogOut,
  IconMonitor,
  IconUser,
} from '@jirawatpyk/aura-react/icons';
import { ROLE_LABELS } from '@dxt/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { signOutEverywhere, signOutOtherDevices } from '../actions';
import type { UsersResult } from '../mutations';
import {
  devicesOf,
  devicesWord,
  oncallWarning,
  securityRows,
  signinEvents,
  signOutCopy,
  type Device,
  type SecurityData,
  type SecurityRow,
  type SigninEvent,
} from '../security-model';
import { RoleBadge } from './role-badge';
import { SettingsHeader } from './settings-header';
import { ViewOnlyLine } from './view-only-line';
import { PERSON_CARD, SECTION_HEADING } from './heading';
import { FOCUS_TARGET } from '@/components/focus-target';

const HEADING = SECTION_HEADING;

const DOWN_TEXT =
  'There are no local passwords, on purpose. Checks, the Chat thread, emails and escalation keep running without anyone signed in — only Ack and editing wait. Escalation doesn’t stop without an ack, so the next level still gets called.';

const FAILED = 'Couldn’t sign out. Check your connection and try again.';

/** `focusKey` for the section heading (a row key is a uuid or an address, never this). */
const HEADING_TARGET = '<heading>';

/**
 * Settings › Sign-in & security (boards Security, MSecurity; spec §35; S16 PR 3, D-062 items 5, 8, 12).
 * Admin only (the route checks). From md: who can sign in, the people table with its sign-out dialog,
 * recent sign-in events, and what happens if Google sign-in is down; below md the same, view only.
 */
export function SecurityPageView({ data, now: nowIso }: { data: SecurityData; now: string }) {
  const now = new Date(nowIso);
  const rows = securityRows(data, now);
  const events = signinEvents(data, now);
  const [open, setOpen] = useState<SecurityRow | null>(null);
  const [done, setDone] = useState<{ text: string; ok: boolean } | null>(null);
  // Focus goes back to the row's button once its dialog closes, or to the heading when the button went
  // with the devices (S05 /verify).
  const focusKey = useRef<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open || !focusKey.current) return;
    const button =
      focusKey.current === HEADING_TARGET
        ? null
        : tableRef.current?.querySelector<HTMLElement>(`[data-signout="${CSS.escape(focusKey.current)}"]`);
    (button ?? headingRef.current)?.focus();
    focusKey.current = null;
  }, [open]);

  const columns: DataTableColumn<SecurityRow>[] = [
    {
      key: 'person',
      label: 'Person',
      grow: 1,
      minWidth: 140,
      render: (r) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={r.name} size="sm" />
          <span className="min-w-0 truncate">
            <span className="font-medium">{r.name}</span>
            {r.oncall && (
              <span className={`text-xs ${r.oncall.live ? 'font-semibold' : 'text-fg-secondary'}`}>
                {' '}
                · {r.oncall.text}
              </span>
            )}
          </span>
        </span>
      ),
    },
    { key: 'role', label: 'Role', width: 120, render: (r) => <RoleBadge role={r.role} /> },
    {
      key: 'devices',
      label: 'Devices',
      width: 90,
      align: 'end',
      render: (r) => <span className="tabular-nums">{r.devices}</span>,
    },
    {
      key: 'last',
      label: 'Last sign-in',
      width: 176,
      render: (r) => <span className="whitespace-nowrap">{r.last}</span>,
    },
    {
      key: 'action',
      label: '',
      width: 190,
      actions: true,
      render: (r) =>
        r.action ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<IconLogOut />}
            data-signout={r.key}
            // Whose row it is, with the visible words kept in the name (WCAG 2.5.3).
            aria-label={r.action === 'others' ? undefined : `Sign out all of ${r.name}’s devices`}
            onClick={() => {
              focusKey.current = r.key;
              setOpen(r);
            }}
          >
            {r.action === 'others' ? 'Sign out other devices' : 'Sign out all'}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SettingsHeader current="security" />
      <ViewOnlyLine />

      <WhoCanSignIn domains={data.domains} />

      <section className="flex flex-col gap-3" aria-labelledby="signin-h">
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
          <h2 id="signin-h" ref={headingRef} tabIndex={-1} className={`${HEADING} ${FOCUS_TARGET}`}>
            <span className="md:hidden">PEOPLE AND THEIR SIGN-IN · {rows.length}</span>
            <span className="hidden md:inline">People and their sign-in</span>
          </h2>
          <span
            role="status"
            data-testid="security-status"
            className={`hidden text-sm leading-normal md:block ${done ? (done.ok ? 'text-fg-positive' : 'text-fg-danger') : 'text-fg-secondary'}`}
          >
            {done?.text ?? 'Signing out takes effect now'}
          </span>
        </div>
        <div ref={tableRef} className="hidden md:block">
          <DataTable
            label="People and their sign-in"
            rowKey="key"
            columns={columns}
            rows={rows}
            rowHeight="auto"
          />
        </div>
        <PeopleCards data={data} rows={rows} now={now} />
      </section>

      <div className="grid gap-6 md:grid-cols-2 md:gap-4">
        <EventsCard events={events} />
        <section aria-labelledby="down-h" className="flex flex-col gap-3 md:hidden">
          <h2 id="down-h" className={HEADING}>
            IF GOOGLE SIGN-IN IS DOWN
          </h2>
          <p className="m-0 rounded-aura-lg border border-border-default bg-bg-surface p-3.5 text-sm leading-relaxed text-fg-secondary">
            {DOWN_TEXT}
          </p>
        </section>
        <div className="hidden md:block">
          <Card title="If Google sign-in is down" headingLevel={2}>
            <p className="m-0 text-sm leading-relaxed text-fg-secondary">{DOWN_TEXT}</p>
          </Card>
        </div>
      </div>

      <SignOutDialog
        data={data}
        row={open}
        now={now}
        onClose={() => setOpen(null)}
        onDone={(text, ok) => {
          setDone({ text, ok });
          if (!ok) return;
          // The button leaves with the devices once the page refreshes: focus the heading, not a
          // button about to go (Users /verify, 14 Nov).
          focusKey.current = HEADING_TARGET;
          setOpen(null);
        }}
      />
    </div>
  );
}

/** "Who can sign in" (Security board; MSecurity §35.5): read-only, set at deploy time. */
function WhoCanSignIn({ domains }: { domains: string[] }) {
  const body = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-fg-secondary">
          Google Workspace {domains.length === 1 ? 'domain' : 'domains'}
        </span>
        <span className="font-mono text-sm break-all">{domains.join(' · ')}</span>
        <span className="text-xs text-fg-secondary">
          Set at deploy time.<span className="hidden md:inline"> Changing it signs everyone out.</span>
        </span>
      </div>
      <div className="flex items-start justify-between gap-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Block personal accounts</span>
          <span className="text-xs text-fg-secondary">Clients get a status page, not an account.</span>
        </span>
        <Badge tone="neutral" variant="outline" icon={<IconLock />}>
          Always on
        </Badge>
      </div>
    </div>
  );
  return (
    <>
      <section aria-labelledby="who-h" className="flex flex-col gap-3 md:hidden">
        <h2 id="who-h" className={HEADING}>
          WHO CAN SIGN IN
        </h2>
        <div className="rounded-aura-lg border border-border-default bg-bg-surface p-3.5">{body}</div>
      </section>
      <div className="hidden md:block md:max-w-xl">
        <Card title="Who can sign in" headingLevel={2}>
          {body}
        </Card>
      </div>
    </>
  );
}

const EVENT_ICON: Record<SigninEvent['icon'], React.ReactNode> = {
  'log-out': <IconLogOut size="sm" aria-hidden />,
  ban: <IconBan size="sm" aria-hidden />,
  user: <IconUser size="sm" aria-hidden />,
};

/** Recent sign-in events: the newest 5 Access rows as sentences (§35.7, D-062 item 12). */
function EventsCard({ events }: { events: SigninEvent[] }) {
  const list = events.length ? (
    <ul className="m-0 flex list-none flex-col p-0">
      {events.map((e) => (
        <li
          key={e.key}
          className="flex items-start gap-2.5 border-b border-border-subtle py-2.5 text-sm leading-snug last:border-b-0"
        >
          <span className={`mt-0.5 ${e.icon === 'ban' ? 'text-fg-danger' : 'text-fg-secondary'}`}>
            {EVENT_ICON[e.icon]}
          </span>
          <span className="line-clamp-2 min-w-0 grow">{e.text}</span>
          <span className="shrink-0 font-mono text-xs whitespace-nowrap text-fg-secondary">{e.time}</span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="m-0 text-sm text-fg-secondary">No sign-in events yet.</p>
  );
  return (
    <>
      <section aria-labelledby="events-h" className="flex flex-col gap-3 md:hidden">
        <h2 id="events-h" className={HEADING}>
          RECENT SIGN-IN EVENTS · NEWEST 5
        </h2>
        <div className="flex flex-col gap-1 rounded-aura-lg border border-border-default bg-bg-surface px-3.5 pb-2">
          {list}
          <Button
            variant="ghost"
            icon={<IconFileText />}
            href="/audit?cat=access"
            fullWidth
            linkComponent={Link}
          >
            All sign-in events in the Audit log
          </Button>
        </div>
      </section>
      <div className="hidden md:block">
        <Card
          title="Recent sign-in events"
          headingLevel={2}
          actions={
            <Link href="/audit?cat=access" className="inline-flex min-h-11 items-center text-sm text-fg-link">
              Audit log
            </Link>
          }
        >
          {list}
        </Card>
      </div>
    </>
  );
}

/** MSecurity's people (§35.6): one card each; a tap opens the person's devices. View only. */
function PeopleCards({ data, rows, now }: { data: SecurityData; rows: SecurityRow[]; now: Date }) {
  const [open, setOpen] = useState<SecurityRow | null>(null);
  const [last, setLast] = useState<SecurityRow | null>(null);
  if (open && open !== last) setLast(open);
  const shown = open ?? last;
  const devices = shown?.personId ? devicesOf(data, shown.personId, now) : [];
  const empty = !shown
    ? ''
    : !shown.personId
      ? 'Not signed in yet — no devices.'
      : shown.last.startsWith('Signed out')
        ? `No devices — signed out everywhere at ${shown.last.replace('Signed out · ', '')}.`
        : 'No devices.';
  return (
    <div className="flex flex-col gap-2 md:hidden">
      <div className="overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface">
        {rows.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setOpen(r)}
            aria-label={`${r.name}, ${ROLE_LABELS[r.role]}${r.oncall?.live ? ', on call now' : ''}, ${devicesWord(r.devices)}${r.last === '—' ? '' : `, last sign-in ${r.last}`}. Show devices`}
            className={PERSON_CARD}
          >
            <span className="flex min-w-0 grow flex-col gap-0.5 leading-snug">
              <span className="flex items-center gap-2">
                <span className="min-w-0 truncate font-semibold">{r.name}</span>
                <span className="shrink-0">
                  <RoleBadge role={r.role} />
                </span>
                {r.oncall?.live && <span className="shrink-0 text-xs font-semibold">· On call now</span>}
              </span>
              <span className="truncate text-xs text-fg-secondary">
                {devicesWord(r.devices)}
                {r.last === '—' ? '' : ` · ${r.last}`}
              </span>
            </span>
            <IconChevronRight size="sm" aria-hidden className="text-fg-tertiary" />
          </button>
        ))}
      </div>
      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        size="sm"
        title={shown ? `${shown.name}${shown.oncall?.live ? ' · On call now' : ''}` : ''}
        description={shown ? `${ROLE_LABELS[shown.role]} · ${shown.last}` : undefined}
      >
        <div className="flex flex-col gap-3">
          {devices.length ? <DeviceList devices={devices} /> : <p className="m-0 text-sm">{empty}</p>}
          <span className="flex gap-1.5 text-xs text-fg-secondary">
            <IconEye size="sm" aria-hidden className="mt-0.5" />
            <span>
              Signing someone out happens on a larger screen. Your own devices:{' '}
              <Link href="/profile" className="text-fg-link">
                My profile
              </Link>
              .
            </span>
          </span>
          <Button variant="secondary" fullWidth onClick={() => setOpen(null)}>
            Close
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function DeviceList({ devices }: { devices: Device[] }) {
  return (
    <ul className="m-0 flex list-none flex-col rounded-aura-md border border-border-default px-3">
      {devices.map((x) => (
        <li
          key={x.id}
          className="flex items-center gap-2.5 border-b border-border-subtle py-2 text-sm leading-snug last:border-b-0"
        >
          <IconMonitor size="sm" aria-hidden className="text-fg-secondary" />
          <span className="flex min-w-0 grow flex-col gap-0.5">
            <span className="font-medium">{x.name}</span>
            <span className="text-xs text-fg-secondary">{x.when}</span>
          </span>
          {x.tag && (
            <Badge tone="neutral" variant="outline">
              {x.tag}
            </Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The Security board's sign-out dialog: your other devices, or someone everywhere. */
function SignOutDialog({
  data,
  row,
  now,
  onClose,
  onDone,
}: {
  data: SecurityData;
  row: SecurityRow | null;
  now: Date;
  onClose: () => void;
  onDone: (text: string, ok: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(row?.key);
  if (seen !== row?.key) {
    setSeen(row?.key);
    setError(null);
  }
  const [last, setLast] = useState<SecurityRow | null>(row);
  if (row && row !== last) setLast(row);
  const shownRow = row ?? last;
  const self = !!shownRow && shownRow.personId === data.viewerId;
  const all = shownRow?.personId ? devicesOf(data, shownRow.personId, now) : [];
  const shown = self ? all.filter((x) => !x.current) : all;
  const copy = shownRow ? signOutCopy(shownRow.name, self, all) : null;
  const warning =
    shownRow?.personId && !self ? oncallWarning(data, shownRow.personId, shownRow.name, now) : null;
  const go = () =>
    start(async () => {
      setError(null);
      const r = await (self ? signOutOtherDevices() : signOutEverywhere({ userId: row!.personId! })).catch(
        (): UsersResult => ({ ok: false, message: FAILED }),
      );
      if (!r.ok) {
        setError(r.message);
        if (r.stale) router.refresh();
        return;
      }
      const n = Number(r.outcome ?? 0);
      // 0: their sessions ended meanwhile (another Admin, or they signed out themselves).
      onDone(
        n === 0
          ? self
            ? 'Your other devices were signed out already'
            : `${row!.name} was signed out already`
          : self
            ? `Signed out ${devicesWord(n).toLowerCase()} of yours · logged`
            : `${row!.name} signed out on ${devicesWord(n).toLowerCase()} · logged`,
        true,
      );
      router.refresh();
    });
  return (
    <Dialog
      open={!!row}
      onClose={onClose}
      size="md"
      title={copy?.title ?? ''}
      description={copy?.description}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="grow text-xs text-fg-secondary">Takes effect now · logged</span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" icon={<IconLogOut />} loading={pending} onClick={go}>
            {copy?.cta ?? ''}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <DeviceList devices={shown} />
        {warning && (
          <Alert tone="warning" title={warning.title}>
            {warning.body}
          </Alert>
        )}
        {error && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
