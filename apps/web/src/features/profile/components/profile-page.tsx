'use client';

import { Alert, Avatar, Badge, Button, Card, PageHeader } from '@jirawatpyk/aura-react';
import {
  IconArrowUpDown,
  IconBell,
  IconChevronRight,
  IconCircleCheck,
  IconClock,
  IconLogOut,
  IconMail,
  IconMonitor,
  IconPhone,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import { formatTime } from '@dxt/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { phoneHeader } from '@/components/phone-header';
import { MutedOverlay, untilText } from '@/components/site-cells';
import { SiteStatusBadge } from '@/components/status-badges';
import { sendChannelTest } from '@/features/channels';
import { sendTest } from '@/features/oncall';
import {
  ChatIdDialog,
  devicesOf,
  previewDevices,
  RoleBadge,
  signOutDevice,
  type Device,
} from '@/features/settings';
import {
  canTest,
  channelRows,
  escalationRows,
  metaLine,
  oncallLine,
  onlyAdmin,
  sameForEveryone,
  shiftCard,
  sitesSummary,
  swapLine,
  type ChannelRow,
  type ProfileData,
} from '../model';

const FAILED = 'Couldn’t reach Monitor. Check your connection and try again.';

/** Devices card words (D-062 item 12, D-011): no number of days. */
const DEVICES_SUB =
  'You stay signed in on this device, so the Ack link opens straight to the incident. Signing out a device takes effect now.';

/** A test alert waits a minute after the last one (`send_oncall_test`), as the On-call page's does. */
const TEST_COOLDOWN_MS = 60_000;

const TEXT_LINK = 'inline-flex min-h-11 items-center text-sm text-fg-link';

/**
 * My profile (boards Profile, MProfile; spec §22.6, §10; S16 PR 3, D-062 items 6, 12). Every role: how
 * alerts reach me (your own Chat id, the phone test for Admins and Responders), the sites I'm responsible
 * for and where I sit in escalation (not for a Viewer, §22.6), my devices, and what's the same for
 * everyone. One tree for every width: two columns from lg (the board is 1440), one below; the phone adds
 * the on-call card and a full-width Sign out.
 */
export function ProfilePageView({
  data,
  now: nowIso,
  signOutAction,
}: {
  data: ProfileData;
  now: string;
  /** The auth feature's Sign out (a Server Action), passed by the route. */
  signOutAction: () => Promise<void>;
}) {
  const now = new Date(nowIso);
  const viewer = data.me.role === 'viewer';
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className={phoneHeader.noActions}
        titleHideBelow="lg"
        eyebrow="ACCOUNT"
        title={
          <span className="flex items-center gap-3">
            {/* The h1's name is the person's name once (the avatar's own label would repeat it). */}
            <span aria-hidden>
              <Avatar name={data.me.name} size="lg" />
            </span>
            {data.me.name}
          </span>
        }
        titleAddon={
          <span className="hidden lg:inline-flex">
            <RoleBadge role={data.me.role} />
          </span>
        }
        // Below lg the identity block under the top bar says it (MProfile).
        meta={<span className="hidden lg:inline">{metaLine(data)}</span>}
        actions={
          <form action={signOutAction} className="hidden lg:block">
            <Button type="submit" variant="secondary" icon={<IconLogOut />}>
              Sign out
            </Button>
          </form>
        }
      />
      {/* The phone shows who you are under the top bar (MProfile), since the bar carries the title. */}
      <div className="flex items-center gap-3 lg:hidden">
        <span aria-hidden>
          <Avatar name={data.me.name} size="lg" />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-display text-2xl font-semibold">{data.me.name}</span>
          <span className="flex flex-wrap items-center gap-2 text-sm text-fg-secondary">
            <RoleBadge role={data.me.role} />
            Google Workspace
          </span>
        </span>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <Channels data={data} />
          <OncallCard data={data} now={now} />
          {!viewer && !data.isCeo && <Sites data={data} now={now} />}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {!viewer && <Escalation data={data} now={now} />}
          <Devices data={data} now={now} />
          <Same data={data} />
        </div>
      </div>

      <form action={signOutAction} className="lg:hidden">
        <Button type="submit" variant="secondary" icon={<IconLogOut />} fullWidth>
          Sign out
        </Button>
      </form>
    </div>
  );
}

const CHANNEL_ICON: Record<ChannelRow['key'], React.ReactNode> = {
  chat: <IconBell size="sm" aria-hidden />,
  email: <IconMail size="sm" aria-hidden />,
  phone: <IconPhone size="sm" aria-hidden />,
};

function ChannelBadge({ status }: { status: ChannelRow['status'] }) {
  if (status === 'Working')
    return (
      <Badge tone="success" variant="soft" icon={<IconCircleCheck />}>
        Working
      </Badge>
    );
  if (status === 'No Chat id')
    return (
      <Badge tone="warning" variant="soft" icon={<IconTriangleAlert />}>
        No Chat id
      </Badge>
    );
  return (
    <Badge tone="neutral" variant="outline" icon={<IconClock />}>
      {status}
    </Badge>
  );
}

/** "How alerts reach me" with your own Chat id and the phone test (D-062 items 6, 12). */
function Channels({ data }: { data: ProfileData }) {
  const [editing, setEditing] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [cooling, setCooling] = useState(
    () => !!data.testSentAt && Date.now() - Date.parse(data.testSentAt) < TEST_COOLDOWN_MS,
  );
  const lastSent = sent ?? data.testSentAt;
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const editRef = useRef<HTMLButtonElement>(null);
  // Focus goes back to Edit Chat id… once the dialog closes (S05 /verify).
  const returnFocus = useRef(false);
  useEffect(() => {
    if (editing || !returnFocus.current) return;
    editRef.current?.focus();
    returnFocus.current = false;
  }, [editing]);
  // The SQL refuses a second test within a minute: the button says so and waits (§14.16).
  useEffect(() => {
    if (!cooling) return;
    const left = lastSent ? TEST_COOLDOWN_MS - (Date.now() - Date.parse(lastSent)) : 0;
    const t = setTimeout(() => setCooling(false), Math.max(left, 0));
    return () => clearTimeout(t);
  }, [cooling, lastSent]);

  const oncallTest = canTest(data.me.role);
  const test = () =>
    start(async () => {
      setError(null);
      // Admins and Responders get the on-call phone test (D-062 item 12); everyone else a plain Chat
      // test in its own thread (S17), so every role can check alerts reach them.
      const r = await (oncallTest ? sendTest() : sendChannelTest('chat')).catch(() => ({
        ok: false as const,
        message: FAILED,
      }));
      if (!r.ok) return setError(r.message);
      setSent(r.at ?? new Date().toISOString());
      setCooling(true);
    });
  const button = (fullWidth?: boolean) => (
    <TestButton
      linked={data.me.chatLinked}
      sent={lastSent}
      cooling={cooling}
      pending={pending}
      onClick={test}
      fullWidth={fullWidth}
    />
  );
  return (
    <Card
      title="How alerts reach me"
      headingLevel={2}
      description="Owners and backups need a Chat id, so alerts can @mention them."
      actions={<span className="hidden md:inline-flex">{button()}</span>}
    >
      <div className="flex flex-col gap-3">
        <ul className="m-0 flex list-none flex-col p-0">
          {channelRows(data).map((c) => (
            <li
              key={c.key}
              className="flex items-start gap-3 border-b border-border-subtle py-3 last:border-b-0"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-aura-md bg-bg-subtle text-fg-secondary">
                {CHANNEL_ICON[c.key]}
              </span>
              {/* Below lg: name, then the badge and Edit under it; from lg one line (Profile board). */}
              <span className="flex min-w-0 grow flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                <span className="flex min-w-0 grow flex-col gap-0.5 leading-snug">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="text-xs text-fg-secondary">{c.detail}</span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-2">
                  <ChannelBadge status={c.status} />
                  {c.key === 'chat' && (
                    <Button
                      ref={editRef}
                      variant="secondary"
                      size="sm"
                      touchHeight
                      onClick={() => {
                        setLine(null);
                        setEditing(true);
                      }}
                    >
                      Edit Chat id…
                    </Button>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <span className="md:hidden">{button(true)}</span>
        {sent && (
          <Alert tone="success" role="status" title={`Test sent at ${formatTime(new Date(sent))}`}>
            Posted in its own “TEST — no action” thread in the Alerts Space, mentioning only you.
            {oncallTest
              ? ' Open its link on your phone to tick “Test alert received on this phone”. If your phone didn’t buzz, allow the Alerts Space through Do Not Disturb.'
              : ' If your phone didn’t buzz, allow the Alerts Space through Do Not Disturb.'}
          </Alert>
        )}
        {error && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        <span role="status" className="text-sm text-fg-positive empty:hidden">
          {line}
        </span>
      </div>
      <ChatIdDialog
        self
        person={editing ? { id: data.me.id, name: data.me.name, chatLinked: data.me.chatLinked } : null}
        onClose={() => {
          setEditing(false);
          returnFocus.current = true;
        }}
        onDone={(text) => {
          setLine(text);
          setEditing(false);
          returnFocus.current = true;
        }}
      />
    </Card>
  );
}

function TestButton({
  linked,
  sent,
  cooling,
  pending,
  onClick,
  fullWidth,
}: {
  linked: boolean;
  sent: string | null;
  cooling: boolean;
  pending: boolean;
  onClick: () => void;
  fullWidth?: boolean;
}) {
  const label =
    sent && cooling
      ? `Test alert sent · ${formatTime(new Date(sent))}`
      : sent
        ? 'Send again'
        : 'Send me a test alert';
  return (
    <span className="flex flex-col gap-1">
      <Button
        variant="secondary"
        size={fullWidth ? 'md' : 'sm'}
        icon={<IconBell />}
        loading={pending}
        disabled={!linked || cooling}
        fullWidth={fullWidth}
        onClick={onClick}
      >
        {label}
      </Button>
      {/* No dead controls (§14.16): the test is a Chat @mention, so it needs your id first. */}
      {!linked && (
        <span className="text-xs text-fg-secondary">
          Add your Chat id first — the test is a Chat @mention.
        </span>
      )}
    </span>
  );
}

/** MProfile's next on-call shift, for Admins and Responders; the swap's state under it (§15.8). */
function OncallCard({ data, now }: { data: ProfileData; now: Date }) {
  if (!canTest(data.me.role)) return null;
  const card = shiftCard(data, now);
  if (!card) return null;
  const swap = swapLine(data.swap, data, card.shiftId);
  return (
    <section aria-labelledby="shift-h" className="lg:hidden">
      <Card>
        <div className="flex flex-col gap-2">
          <h2 id="shift-h" className="m-0 font-mono text-xs font-normal text-fg-tertiary">
            {card.eyebrow}
          </h2>
          <span className="text-base font-semibold">{card.value}</span>
          <span className="text-sm text-fg-secondary">Tier 1 nights and weekends</span>
          {swap && (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="neutral" variant="outline" icon={<IconArrowUpDown />}>
                {swap.badge}
              </Badge>
              <span className="text-fg-secondary">{swap.line}</span>
            </span>
          )}
          {swap?.note && <span className="text-sm">{swap.note}</span>}
          <Link href="/oncall" className="flex min-h-11 items-center justify-between text-sm text-fg-link">
            Rotation and phone readiness
            <IconChevronRight size="sm" aria-hidden />
          </Link>
        </div>
      </Card>
    </section>
  );
}

/** "Sites I'm responsible for": a row links to the site's open incident, else the site (MProfile). */
function Sites({ data, now }: { data: ProfileData; now: Date }) {
  const amOnly = data.isAm && !data.sites.some((s) => s.role !== 'AM');
  return (
    <Card
      title={amOnly ? 'My clients’ sites' : 'Sites I’m responsible for'}
      headingLevel={2}
      description={sitesSummary(data)}
    >
      {data.sites.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {data.sites.map((s) => (
            <li key={s.id} className="border-b border-border-subtle last:border-b-0">
              <Link
                href={s.incident ? `/incidents/${s.incident}` : `/sites/${s.id}`}
                aria-label={`${s.name}, Tier ${s.tier}, ${s.role === 'AM' ? 'AM' : s.role.toLowerCase()}${s.status ? `, ${s.status}` : ''}${s.mutedUntil && new Date(s.mutedUntil) > now ? `, muted until ${untilText(new Date(s.mutedUntil), now)}` : ''}`}
                className="-mx-2 flex min-h-11 items-center gap-3 rounded-aura-md px-2 py-2 text-sm text-fg-primary no-underline hover:bg-bg-surface-hover active:bg-bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
              >
                <span className="flex min-w-0 grow flex-col gap-0.5 leading-snug">
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="text-xs text-fg-secondary">
                    Tier {s.tier} · {s.role}
                  </span>
                  <span className="flex">
                    <MutedOverlay mutedUntil={s.mutedUntil} now={now} />
                  </span>
                </span>
                {s.status && (
                  <span className="shrink-0">
                    <SiteStatusBadge status={s.status} />
                  </span>
                )}
                <IconChevronRight size="sm" aria-hidden className="text-fg-tertiary" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-fg-secondary">
          {amOnly || data.isAm ? 'Your clients have no live sites.' : 'You don’t own or back up any site.'}
        </p>
      )}
    </Card>
  );
}

/** "Where I sit in escalation", read from the policies (D-062 item 12); its links at the foot (boards). */
function Escalation({ data, now }: { data: ProfileData; now: Date }) {
  const rows = escalationRows(data);
  const oncall = oncallLine(data, now);
  const all = oncall ? [...rows, oncall] : rows;
  const only = onlyAdmin(data);
  const hasShiftCard = canTest(data.me.role) && !!shiftCard(data, now);
  return (
    <Card
      title="Where I sit in escalation"
      headingLevel={2}
      footer={
        <span className="flex w-full flex-wrap items-center gap-x-4">
          <Link href="/escalation" className={TEXT_LINK}>
            <span className="lg:hidden">See every step</span>
            <span className="hidden lg:inline">Escalation policies</span>
          </Link>
          {canTest(data.me.role) && (
            // Below lg the on-call card already links the rotation (MProfile draws one link here).
            <Link href="/oncall" className={`${TEXT_LINK} ${hasShiftCard ? 'max-lg:hidden' : ''}`}>
              See the rotation
            </Link>
          )}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {all.length ? (
          <dl className="m-0 flex flex-col">
            {all.map((r) => (
              <div
                key={r.label}
                className="flex flex-col gap-0.5 border-b border-border-subtle py-2.5 last:border-b-0"
              >
                <dt className="text-xs text-fg-secondary">{r.label}</dt>
                <dd className="m-0 text-sm font-medium">{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="m-0 text-sm text-fg-secondary">No escalation step names you.</p>
        )}
        {only && (
          <span className="flex items-start gap-2 text-sm">
            <IconTriangleAlert size="sm" aria-hidden className="mt-0.5 text-fg-warning" />
            <span>
              {only} is the only active Admin — add a second one in{' '}
              <Link href="/settings/users" className="text-fg-link underline">
                Users
              </Link>
            </span>
          </span>
        )}
      </div>
    </Card>
  );
}

/** "Signed-in devices": yours, Sign out on each but this browser; a signed-out row stays, as the board. */
function Devices({ data, now }: { data: ProfileData; now: Date }) {
  const router = useRouter();
  const devices = devicesOf(data, data.me.id, now);
  const [gone, setGone] = useState<{ device: Device; at: number }[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const moveFocus = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Once the sign-out has finished (the buttons are enabled again), focus the next Sign out, or the list.
  useEffect(() => {
    if (pending || !moveFocus.current) return;
    moveFocus.current = false;
    const next = listRef.current?.querySelector<HTMLElement>('button[data-device-signout]:not([disabled])');
    (next ?? listRef.current)?.focus();
  }, [gone, pending]);
  const out = (x: Device) =>
    start(async () => {
      setError(null);
      const r = await signOutDevice({ sessionId: x.id }).catch(() => ({
        ok: false as const,
        message: FAILED,
      }));
      if (!r.ok) {
        setError(r.message);
        router.refresh();
        return;
      }
      moveFocus.current = true;
      setGone((g) => [...g, { device: x, at: devices.findIndex((d) => d.id === x.id) }]);
      router.refresh();
    });
  const goneIds = new Set(gone.map((g) => g.device.id));
  // The refresh drops a signed-out session from the list: keep it in its place as "Signed out · now".
  const rows = devices.filter((x) => !goneIds.has(x.id));
  for (const g of [...gone].sort((a, b) => a.at - b.at)) rows.splice(Math.max(g.at, 0), 0, g.device);
  // A long list shows its first 10, this browser among them, until "Show all" (verify finding, 14 Nov).
  const [showAll, setShowAll] = useState(false);
  const preview = previewDevices(rows);
  const visible = showAll ? rows : preview.shown;
  return (
    <Card title="Signed-in devices" headingLevel={2} description={DEVICES_SUB}>
      <div className="flex flex-col gap-3">
        <ul
          ref={listRef}
          tabIndex={-1}
          aria-label="Signed-in devices"
          className="m-0 flex list-none flex-col p-0 outline-none"
        >
          {visible.map((x) => (
            <li
              key={x.id}
              className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle py-2 text-sm leading-snug last:border-b-0"
            >
              <IconMonitor size="sm" aria-hidden className="text-fg-secondary" />
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="font-medium">{x.name}</span>
                <span className="text-xs text-fg-secondary">{x.when}</span>
              </span>
              {x.current ? (
                <Badge tone="neutral" variant="outline">
                  This device
                </Badge>
              ) : goneIds.has(x.id) ? (
                <span className="text-xs text-fg-secondary">Signed out · now</span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  touchHeight
                  data-device-signout
                  disabled={pending}
                  // Only the leading "Last" lower-cases mid-sentence; days and months keep their capitals.
                  aria-label={`Sign out ${x.name}, ${x.when.charAt(0).toLowerCase()}${x.when.slice(1)}`}
                  onClick={() => out(x)}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!showAll && preview.hidden > 0 && (
          <Button variant="ghost" size="sm" touchHeight onClick={() => setShowAll(true)}>
            {`Show all ${rows.length} devices`}
          </Button>
        )}
        <span role="status" className="sr-only">
          {gone.length ? `${gone[gone.length - 1]!.device.name} signed out` : ''}
        </span>
        {error && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
      </div>
    </Card>
  );
}

/** "Same for everyone": no personal do-not-disturb. An Admin edits them in Organisation (S17). */
function Same({ data }: { data: ProfileData }) {
  return (
    <Card
      title="Same for everyone"
      headingLevel={2}
      actions={
        data.me.role === 'admin' ? (
          // On its own in the header, so a ghost button with a 44 px target (§14.17).
          <Button variant="ghost" size="sm" touchHeight href="/settings/organisation">
            Edit in Organisation
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <dl className="m-0 flex flex-col">
          {sameForEveryone(data).map((r) => (
            <div
              key={r.label}
              className="flex justify-between gap-3 border-b border-border-subtle py-2 last:border-b-0"
            >
              <dt className="text-sm text-fg-secondary">{r.label}</dt>
              <dd className="m-0 text-right text-sm font-medium">{r.value}</dd>
            </div>
          ))}
        </dl>
        <p className="m-0 text-xs text-fg-secondary">
          There’s no personal do-not-disturb here — DOWN always reaches whoever is expected to act.
        </p>
      </div>
    </Card>
  );
}
