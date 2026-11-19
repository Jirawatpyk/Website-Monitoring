'use client';

import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  StatusPill,
  type DataTableColumn,
} from '@jirawatpyk/aura-react';
import {
  IconArrowUpRight,
  IconBan,
  IconBell,
  IconCircleAlert,
  IconCircleCheck,
  IconClock,
  IconLock,
  IconMail,
  IconMinus,
  IconMonitor,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import { formatTime } from '@dxt/shared';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { SECTION_HEADING, SettingsHeader, ViewOnlyLine } from '@/features/settings';
import { sendChannelTest } from '../actions';
import type { TestChannel } from '../mutations';
import {
  FLAPPING,
  hoursLine,
  lastSentLine,
  logRows,
  routingRows,
  type LogRow,
  type RoutingRow,
} from '../model';
import type { ChannelsData } from '../queries';

const ICONS = {
  ban: <IconBan />,
  'triangle-alert': <IconTriangleAlert />,
  'circle-check': <IconCircleCheck />,
  'circle-alert': <IconCircleAlert />,
  lock: <IconLock />,
  monitor: <IconMonitor />,
  clock: <IconClock />,
  minus: <IconMinus />,
} as const;

/**
 * Settings › Alert channels (board AlertChannels; spec §10, §14.8, §15.5, §22; S17, D-069). Read-only
 * routing and cards (D-069 item 3); the two test buttons work at every width (§22.4: a test alert works
 * on a phone); the rest is view only below md.
 */
export function AlertChannelsPageView({ data, now: nowIso }: { data: ChannelsData; now: string }) {
  const now = new Date(nowIso);
  const routing = routingRows(data.ladders, data.admins);
  const log = logRows(data.log, now);
  return (
    <div className="flex flex-col gap-6">
      <SettingsHeader current="channels" />
      <ViewOnlyLine />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ChatCard data={data} now={now} />
        <EmailCard data={data} />
        <Card
          title="Voice call · Twilio"
          headingLevel={2}
          actions={<StatusPill tone="neutral">Off</StatusPill>}
        >
          <ChannelBody
            role="Tier 1 DOWN with no ack at L2"
            facts={[
              ['Status', 'Off until approved'],
              ['Cost', '~$23–26 / month'],
              ['Decision', 'CEO'],
              ['Until then', 'Chat + email only'],
            ]}
          >
            <Button variant="secondary" size="sm" touchHeight fullWidth icon={<IconLock />} disabled>
              Not enabled
            </Button>
            <span className="text-xs leading-normal text-fg-secondary">
              Can’t test yet — voice calls are off until the CEO approves them.
            </span>
          </ChannelBody>
        </Card>
        <Card
          title="Google Chat app"
          headingLevel={2}
          actions={
            <Badge tone="neutral" variant="outline">
              Phase 3
            </Badge>
          }
        >
          <ChannelBody
            role="DM owners · ack inside Chat"
            facts={[
              ['Needs', 'Chat app + service account'],
              ['Until then', 'Ack via link'],
            ]}
          >
            <Button variant="secondary" size="sm" touchHeight fullWidth icon={<IconClock />} disabled>
              Not started
            </Button>
            <span className="text-xs leading-normal text-fg-secondary">
              Phase 3 — nothing to test until the Chat app exists.
            </span>
          </ChannelBody>
        </Card>
      </div>

      <WhoGetsWhat rows={routing} />

      <div className="grid gap-4 md:grid-cols-3">
        <Card
          title="Reminders until ack"
          headingLevel={2}
          actions={<InlineLink href="/escalation">Edit in Escalation</InlineLink>}
        >
          <Facts
            rows={[
              ['DOWN', `every ${data.reminders.downMin} min`],
              ['PROBLEM', `every ${data.reminders.problemMin} min`],
            ]}
          />
          <Note>Read-only here. Reminders reply in the incident’s thread and stop at acknowledge.</Note>
        </Card>
        <Card title="Flapping" headingLevel={2}>
          <Facts
            rows={[
              ['Status changes', `${FLAPPING.changes} within ${FLAPPING.windowMin} min`],
              ['Stable before summary', `${FLAPPING.stableMin} min`],
            ]}
          />
          <Note>
            {FLAPPING.changes} or more status changes within {FLAPPING.windowMin} min → only RECOVERED replies
            are held; one summary once the site is stable for {FLAPPING.stableMin} min. Fixed in v1.
          </Note>
        </Card>
        <Card
          title="Response hours"
          headingLevel={2}
          actions={<InlineLink href="/settings/organisation">Edit in Organisation</InlineLink>}
        >
          <Facts
            rows={[
              ['Tier 1', '24/7'],
              ['Tier 2–3', hoursLine(data.hours)],
            ]}
          />
          <Note>
            Tier 1: owners inside these hours, on-call outside them. Tier 2–3 outside hours: DOWN still posts,
            timers wait until the hours open; PROBLEM is held until then.
          </Note>
        </Card>
      </div>

      <DeliveryLog rows={log} />
    </div>
  );
}

function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  // An inline text link (WCAG 2.5.8): the span keeps the card header from blockifying it.
  return (
    <span className="text-sm">
      <Link href={href}>{children}</Link>
    </span>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="m-0 mt-3 text-xs leading-normal text-fg-secondary">{children}</p>;
}

function Facts({ rows }: { rows: readonly [string, string][] }) {
  return (
    <dl className="m-0 flex flex-col gap-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <dt className="text-fg-secondary">{k}</dt>
          <dd className="m-0 text-right font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ChannelBody({
  role,
  facts,
  children,
}: {
  role: string;
  facts: readonly [string, string][];
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col gap-3">
      <span className="text-xs text-fg-secondary">{role}</span>
      <dl className="m-0 flex flex-col gap-1 text-xs">
        {facts.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-fg-secondary">{k}</dt>
            <dd className="m-0 text-right font-medium break-all">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto flex flex-col gap-1.5 pt-1">{children}</div>
    </div>
  );
}

/** The test button and its result line (board): "Posted 10:08 in “TEST — no action” · mentions only you". */
function TestButton({
  channel,
  label,
  againLabel,
  icon,
  disabledReason,
  doneText,
}: {
  channel: TestChannel;
  label: string;
  againLabel: string;
  icon: React.ReactElement;
  disabledReason: string | null;
  doneText: (at: string) => string;
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        touchHeight
        fullWidth
        icon={icon}
        loading={pending}
        disabled={!!disabledReason}
        onClick={() =>
          start(async () => {
            const r = await sendChannelTest(channel);
            setDone(r.ok ? { ok: true, text: doneText(r.at) } : { ok: false, text: r.message });
          })
        }
      >
        {done?.ok ? againLabel : label}
      </Button>
      <span
        role="status"
        className={`flex gap-1.5 text-xs leading-normal empty:hidden ${done?.ok ? 'text-fg-positive' : done ? 'text-fg-danger' : 'text-fg-secondary'}`}
      >
        {done ? done.text : (disabledReason ?? '')}
      </span>
    </>
  );
}

const hhmm = (iso: string) => formatTime(new Date(iso));

function ChatCard({ data, now }: { data: ChannelsData; now: Date }) {
  const f = data.facts;
  return (
    <Card
      title="Google Chat"
      headingLevel={2}
      actions={
        <StatusPill tone={f.chatConnected ? 'ready' : 'blocked'}>
          {f.chatConnected ? 'Connected' : 'Not set up'}
        </StatusPill>
      }
    >
      <ChannelBody
        role="Primary · Space “DxT Website Alerts”"
        facts={[
          ['Webhook', f.chatConnected ? 'Set' : 'Not set'],
          ['Thread key', 'incident id'],
          ['Last sent', lastSentLine(f.lastChat, now)],
        ]}
      >
        <TestButton
          channel="chat"
          label="Send test card"
          againLabel="Send another test card"
          icon={<IconArrowUpRight />}
          disabledReason={
            !f.chatConnected
              ? 'Can’t test — the Chat webhook isn’t set up.'
              : !data.canTestChat
                ? 'Add your Google Chat id in My profile first — the card @mentions you.'
                : null
          }
          doneText={(at) => `Posted ${hhmm(at)} in “TEST — no action” · mentions only you`}
        />
      </ChannelBody>
    </Card>
  );
}

function EmailCard({ data }: { data: ChannelsData }) {
  const f = data.facts;
  return (
    <Card
      title="Email · Resend"
      headingLevel={2}
      actions={
        <StatusPill tone={f.emailConnected ? 'ready' : 'blocked'}>
          {f.emailConnected ? 'Connected' : 'Not set up'}
        </StatusPill>
      }
    >
      <ChannelBody
        role="Record + fallback when Chat fails"
        facts={[
          ['From', f.emailFrom ?? '—'],
          ['24 h', `${f.email24h.sent} sent · ${f.email24h.failed} failed`],
        ]}
      >
        <TestButton
          channel="email"
          label="Send test email"
          againLabel="Send another test email"
          icon={<IconMail />}
          disabledReason={f.emailConnected ? null : 'Can’t test — email isn’t set up.'}
          doneText={(at) => `Sent to you ${hhmm(at)} · “TEST — no action”`}
        />
      </ChannelBody>
    </Card>
  );
}

function WhoGetsWhat({ rows }: { rows: RoutingRow[] }) {
  const columns: DataTableColumn<RoutingRow>[] = [
    {
      key: 'event',
      label: 'Event',
      grow: 1,
      minWidth: 260,
      render: (r) => (
        <span className="flex items-center gap-2.5 py-2">
          <Badge tone={r.tone} variant={r.variant} icon={ICONS[r.icon]}>
            {r.event}
          </Badge>
          <span className="flex flex-col text-xs leading-snug text-fg-secondary">
            <span>{r.note}</span>
            {r.onlyAdmin && (
              <span className="flex items-center gap-1 text-fg-warning">
                <IconTriangleAlert size="sm" aria-hidden />
                Only {r.onlyAdmin} · no second Admin · <Link href="/settings/users">Users</Link>
              </span>
            )}
          </span>
        </span>
      ),
    },
    {
      key: 'how',
      label: 'Who and how',
      width: 390,
      render: (r) => (
        <span className="flex items-start gap-2 py-2 text-sm leading-snug text-fg-secondary">
          <IconLock size="sm" aria-hidden className="mt-0.5 shrink-0" />
          <span className="flex flex-col">
            <span>
              {r.setIn === 'escalation' ? (
                <>
                  Read-only · <Link href="/escalation">Set per step in Escalation</Link>
                </>
              ) : (
                'Read-only · fixed'
              )}
            </span>
            <span className="text-xs">{r.how}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'ceo',
      label: 'CEO',
      width: 220,
      render: (r) => <span className="text-sm text-fg-secondary">{r.ceo}</span>,
    },
  ];
  return (
    <section className="flex flex-col gap-3" aria-labelledby="who-h">
      <div className="flex flex-col gap-1 lg:flex-row lg:items-baseline lg:justify-between lg:gap-4">
        <h2 id="who-h" className={SECTION_HEADING}>
          <span className="md:hidden">WHO GETS WHAT</span>
          <span className="hidden md:inline">Who gets what</span>
        </h2>
        <span className="text-sm text-fg-secondary">
          One incident = one Chat thread. DOWN, PROBLEM and SSL / domain channels are set per step in
          Escalation; the rest is fixed.
        </span>
      </div>
      <div className="hidden lg:block">
        <DataTable label="Who gets what" rowKey="id" columns={columns} rows={rows} rowHeight="auto" />
      </div>
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface p-0 lg:hidden">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-1.5 border-b border-border-subtle px-3.5 py-3 last:border-b-0"
          >
            <span>
              <Badge tone={r.tone} variant={r.variant} icon={ICONS[r.icon]}>
                {r.event}
              </Badge>
            </span>
            <span className="text-xs leading-normal text-fg-secondary">{r.note}</span>
            <span className="text-xs leading-normal">{r.how}</span>
            <span className="text-xs text-fg-secondary">CEO · {r.ceo}</span>
          </li>
        ))}
      </ul>
      <span className="text-xs leading-normal text-fg-secondary">
        OK with a note (blocked, then verified by the browser) isn’t alerted — it’s listed in the daily digest
        in the “DxT Website Reports” Space.
      </span>
    </section>
  );
}

function DeliveryLog({ rows }: { rows: LogRow[] }) {
  const columns: DataTableColumn<LogRow>[] = [
    {
      key: 'at',
      label: 'Time',
      width: 120,
      render: (r) => <span className="font-mono text-xs text-fg-secondary">{r.at}</span>,
    },
    {
      key: 'inc',
      label: 'Incident',
      width: 100,
      render: (r) => <span className="font-mono text-xs">{r.inc}</span>,
    },
    { key: 'ch', label: 'Channel', width: 120, render: (r) => r.ch },
    {
      key: 'to',
      label: 'To',
      grow: 1,
      minWidth: 160,
      render: (r) => <span className="text-fg-secondary">{r.to}</span>,
    },
    {
      key: 'tries',
      label: 'Tries',
      width: 80,
      align: 'end',
      render: (r) => <span className="tabular-nums">{r.tries}</span>,
    },
    {
      key: 'lat',
      label: 'Latency',
      width: 96,
      align: 'end',
      render: (r) => <span className="tabular-nums">{r.lat}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      width: 170,
      render: (r) => (
        <Badge tone={r.tone} icon={ICONS[r.icon]}>
          {r.status}
        </Badge>
      ),
    },
  ];
  return (
    <section className="flex flex-col gap-3" aria-labelledby="log-h">
      <div className="flex flex-col gap-1 lg:flex-row lg:items-baseline lg:justify-between lg:gap-4">
        <h2 id="log-h" className={SECTION_HEADING}>
          <span className="md:hidden">DELIVERY LOG · TODAY</span>
          <span className="hidden md:inline">Delivery log</span>
        </h2>
        <span className="text-sm text-fg-secondary">
          Filtered: today’s incident messages, reports, tests and retried sends · retry 30 s → 2 min → 8 min,
          then email · target ≤ 30 s after confirm
        </span>
      </div>
      {rows.length === 0 ? (
        <Alert tone="info" role="note" icon={<IconBell />}>
          Nothing sent today yet.
        </Alert>
      ) : (
        <>
          <div className="hidden lg:block">
            <DataTable label="Delivery log" rowKey="id" columns={columns} rows={rows} />
          </div>
          <ul className="m-0 flex list-none flex-col overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface p-0 lg:hidden">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex min-h-16 items-center justify-between gap-3 border-b border-border-subtle px-3.5 py-2.5 last:border-b-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">
                    {r.inc} · {r.ch}
                  </span>
                  <span className="truncate text-xs text-fg-secondary">
                    {r.at} · {r.to} · {r.lat}
                  </span>
                </span>
                <Badge tone={r.tone} icon={ICONS[r.icon]}>
                  {r.status}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
