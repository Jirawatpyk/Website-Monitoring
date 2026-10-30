'use client';

import { formatResponseHours, formatTime } from '@dxt/shared';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  DataTable,
  PageHeader,
  type DataTableColumn,
} from '@jirawatpyk/aura-react';
import {
  IconArrowUpDown,
  IconBell,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconExternalLink,
  IconMinus,
  IconTriangleAlert,
  IconUsers,
} from '@jirawatpyk/aura-react/icons';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useNow } from '@/components/use-now';
import { confirmTest, decideSwap, respondSwap, sendTest, setChecklist, withdrawSwap } from '../actions';
import {
  footOf,
  heroOf,
  mySwappableShift,
  nameOf,
  onePerson,
  ownersOf,
  personAt,
  readinessOf,
  rotationRows,
  SWAP_OFF,
  swapChoices,
  swapViewOf,
  tonightOf,
  weekGrid,
  type OncallData,
  type Readiness,
  type RotationRow,
  type SwapView,
} from '../model';
import {
  DeclineDialog,
  EditRotationDialog,
  HandOverDialog,
  Refusal,
  RequestSwapDialog,
  useSubmit,
  type HandedOver,
} from './dialogs';
import { PeopleList, StateBadge, StatusLine, WeekBox } from './parts';

type Open =
  | { kind: 'swap'; row: RotationRow; phone: boolean }
  | { kind: 'decline'; phone: boolean }
  | { kind: 'edit' }
  | { kind: 'handover'; phone: boolean };

/** What the test link said (§27.8): received here, someone else's, or expired. */
type TestResult = { tone: 'success' | 'warning'; title: string; text: string } | null;

/**
 * `/oncall` — boards OnCall (lg up) and MOnCall (below lg), spec §27, §28, D-048. One page for every
 * role: the person asked answers a swap, the requester withdraws, an Admin approves, edits the rotation
 * and hands over the live shift; everyone sees who is on call and the rotation. No Undo (§27.1).
 */
export function OncallPageView({ data, testToken }: { data: OncallData; testToken: string | null }) {
  const now = useNow(data.nowIso, 60_000);
  const router = useRouter();
  const admin = data.viewer.role === 'admin';
  const rows = rotationRows(data, now);
  const hero = heroOf(data, now);
  const view = swapViewOf(data, now);
  // The requester's and an Admin's side card (the person asked gets the request card above the hero).
  const side = !!view && view.part !== 'asked';
  const empty = rows.length === 0;
  const nobody = rows[0]?.nobody === true;
  // The person the hero names: whoever covers once owners stop responding.
  const tonightPerson = personAt(data, tonightOf(data, now).from);
  const ready = tonightPerson ? readinessOf(data, tonightPerson.userId, now) : null;
  const inRotation = data.rotation.includes(data.viewer.id) && data.eligible.includes(data.viewer.id);
  const mine = inRotation ? readinessOf(data, data.viewer.id, now) : null;
  const foot = footOf(data, now);
  const one = onePerson(data);
  const phoneSwap = mySwappableShift(rows);
  const liveShift = data.shifts.find(
    (s) => Date.parse(s.startsAt) <= now.getTime() && now.getTime() < Date.parse(s.endsAt),
  );

  // The dialog stays mounted while it closes (`shown` false), so focus goes back to its button.
  const [open, setOpen] = useState<(Open & { shown: boolean }) | null>(null);
  const [n, setN] = useState(0);
  const show = (o: Open) => {
    setN((x) => x + 1);
    setOpen({ ...o, shown: true });
  };
  const close = () => setOpen((o) => (o ? { ...o, shown: false } : o));
  const [handed, setHanded] = useState<HandedOver | null>(null);
  // After a swap step or a hand-over the button pressed is gone: focus goes to what replaced it.
  const statusFocus = useRef(false);
  const wantStatusFocus = () => {
    statusFocus.current = true;
  };
  const claimStatusFocus = useCallback((el: HTMLElement) => {
    if (!statusFocus.current) return;
    el.focus();
    if (document.activeElement === el) statusFocus.current = false;
  }, []);
  const handedBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (handed) handedBox.current?.focus();
  }, [handed]);
  const [test, setTest] = useState<TestResult>(null);

  // The test link (§27.8): confirmed by an explicit call once the page is up, never while it renders
  // (a prefetch would use up the receipt), then dropped from the address bar.
  const confirming = useRef(false);
  useEffect(() => {
    if (!testToken || confirming.current) return;
    confirming.current = true;
    // A call that throws (network, a new deploy) still drops the token from the address bar.
    const failed = (): Awaited<ReturnType<typeof confirmTest>> => ({
      ok: false,
      message: 'The test couldn’t be confirmed',
    });
    void confirmTest({ token: testToken })
      .catch(failed)
      .then((r) => {
        if (r.ok && r.at) {
          setTest({
            tone: 'success',
            title: `Test alert received on this phone at ${formatTime(new Date(r.at))}`,
            text: 'Alerts reach this phone. Nothing else to do before tonight.',
          });
        } else if (!r.ok) {
          const who = r.message.match(/^This test was for (.+?) — /)?.[1];
          setTest({
            tone: 'warning',
            title: r.message,
            text:
              r.code === 'test_other_person' && who
                ? `Opening it here doesn’t tick anything on ${who}’s checklist.`
                : 'Send a new test alert from your checklist.',
          });
        }
        router.replace('/oncall', { scroll: false });
        router.refresh();
      });
  }, [testToken, router]);

  const openSwapId = (id: string) => router.replace(`/oncall?swap=${id}`, { scroll: false });
  const editPrimary = nobody;
  const hours = formatResponseHours(data.hours);
  const opening = hours.split(' ').at(-1)?.split('–')[0] ?? '';
  const meta = (
    <span className="max-lg:hidden">
      {`Weekly rotation for Tier 1. ${hours} the owners respond; outside that, Tier 1 goes to the person on call.`}
      <br />
      {`Tier 2–3 have no on-call: they’re covered ${hours} — DOWN still posts at night, timers wait until ${opening}.`}
    </span>
  );

  return (
    <div className="flex flex-col gap-6 max-lg:gap-3">
      <PageHeader
        titleHideBelow="lg"
        eyebrow="OPERATIONS"
        title="On-call"
        meta={meta}
        actions={
          admin && !empty ? (
            <span className="max-lg:hidden">
              <Button
                variant={editPrimary ? 'primary' : 'secondary'}
                icon={<IconUsers />}
                onClick={() => show({ kind: 'edit' })}
              >
                Edit rotation
              </Button>
            </span>
          ) : undefined
        }
      />

      {test && (
        <Alert tone={test.tone} title={test.title} role="status">
          {test.text}
        </Alert>
      )}
      {handed && (
        <div
          ref={handedBox}
          tabIndex={-1}
          className="rounded-aura-md focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          <Alert tone="success" title={handed.title} role="status" onDismiss={() => setHanded(null)}>
            {`${handed.from} and ${handed.to} got a Chat message. Logged in the audit log.`}
          </Alert>
        </div>
      )}

      {/* ── Desktop (OnCall) ── */}
      {view?.part === 'asked' && (
        <div className="max-lg:hidden">
          <RequestCard
            view={view}
            want={wantStatusFocus}
            claim={claimStatusFocus}
            onDecline={() => show({ kind: 'decline', phone: false })}
          />
        </div>
      )}
      <div className="grid grid-cols-3 gap-4 max-lg:hidden">
        <DesktopHero hero={hero} now={now} />
        {ready && !nobody && !empty ? (
          <PhoneCard
            now={now}
            ready={ready}
            mine={ready.personId === data.viewer.id}
            handedFrom={
              tonightPerson?.handedOverFrom
                ? {
                    name: nameOf(data, tonightPerson.handedOverFrom),
                    at: formatTime(new Date(tonightPerson.startsAt)),
                  }
                : null
            }
          />
        ) : (
          <OwnersCard data={data} admin={admin} empty={empty} />
        )}
      </div>
      <WeekCard data={data} now={now} />
      <div className="flex flex-col gap-4 max-lg:hidden">
        <h2 className="m-0 text-2xl font-semibold">Rotation</h2>
        {/* The swap card sits beside the table from xl, as drawn at 1440; below that it goes under the
            table, as Maintenance's fixed columns do (D-036): beside it, the table would scroll at 1024–1400. */}
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
          <section className={`flex min-w-0 flex-col gap-3 ${side ? 'xl:col-span-2' : 'xl:col-span-3'}`}>
            {empty ? (
              <EmptyRotation admin={admin} onEdit={() => show({ kind: 'edit' })} />
            ) : (
              <DataTable
                label="Rotation"
                rowKey="key"
                columns={columns(
                  (row) => show({ kind: 'swap', row, phone: false }),
                  () => show({ kind: 'handover', phone: false }),
                )}
                rows={rows}
                rowHeight="auto"
              />
            )}
            {foot && (
              <span id="oc-foot" className="text-xs leading-normal text-fg-secondary">
                {foot}
              </span>
            )}
          </section>
          {side && view && (
            <SideCard
              view={view}
              want={wantStatusFocus}
              claim={claimStatusFocus}
              onDecline={() => show({ kind: 'decline', phone: false })}
            />
          )}
        </div>
      </div>

      {/* ── Phone (MOnCall) ── */}
      <div className="flex flex-col gap-3 lg:hidden">
        {view && (
          <PhoneSwapCard
            view={view}
            want={wantStatusFocus}
            claim={claimStatusFocus}
            onDecline={() => show({ kind: 'decline', phone: true })}
          />
        )}
        <div className="flex flex-col gap-1.5 rounded-aura-card bg-bg-surface-strong px-4.5 py-3.5 text-fg-inverted">
          <span className="font-mono text-xs opacity-70">{hero.phoneEyebrow}</span>
          <span className="font-display text-2xl leading-tight font-semibold">{hero.phoneTitle}</span>
          <span className="text-sm opacity-80">{hero.phoneText}</span>
        </div>
        {(nobody || empty) && (
          <OwnersCard data={data} admin={admin} empty={empty} phone onEdit={() => show({ kind: 'edit' })} />
        )}
        {mine && !nobody && !empty && <Checklist ready={mine} data={data} now={now} />}
        <PhoneRotation
          rows={rows}
          admin={admin}
          one={one}
          canRequest={inRotation && !nobody && !empty}
          swapRow={phoneSwap}
          onSwap={(row) => show({ kind: 'swap', row, phone: true })}
          onHandover={() => show({ kind: 'handover', phone: true })}
          onEdit={() => show({ kind: 'edit' })}
        />
      </div>

      {open?.kind === 'swap' && (
        <RequestSwapDialog
          key={`s${n}`}
          open={open.shown}
          onClose={close}
          phone={open.phone}
          row={open.row}
          me={data.viewer.name}
          choices={open.row.shiftId ? swapChoices(data, open.row.shiftId, now) : []}
          onSent={openSwapId}
        />
      )}
      {open?.kind === 'decline' && view && (
        <DeclineDialog
          key={`d${n}`}
          open={open.shown}
          onClose={close}
          onDone={wantStatusFocus}
          phone={open.phone}
          view={view}
        />
      )}
      {open?.kind === 'edit' && (
        <EditRotationDialog key={`e${n}`} open={open.shown} onClose={close} data={data} now={now} />
      )}
      {open?.kind === 'handover' && liveShift && (
        <HandOverDialog
          key={`h${n}`}
          open={open.shown}
          onClose={close}
          phone={open.phone}
          data={data}
          shift={liveShift}
          now={now}
          onHanded={setHanded}
        />
      )}
    </div>
  );
}

// ── Desktop parts ─────────────────────────────────────────────────────────

function DesktopHero({ hero, now }: { hero: ReturnType<typeof heroOf>; now: Date }) {
  return (
    <div className="col-span-2 flex items-center gap-5 rounded-aura-card bg-bg-surface-strong p-6 text-fg-inverted">
      {hero.avatar ? (
        <Avatar name={hero.avatar} size="lg" />
      ) : (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full border border-dashed border-current opacity-70">
          <IconUsers />
        </span>
      )}
      <div className="flex grow flex-col leading-snug">
        <span className="font-mono text-xs opacity-70">{hero.eyebrow}</span>
        <span className="text-2xl font-semibold">{hero.title}</span>
        <span className="text-sm opacity-80">{hero.l1}</span>
        <span className="text-xs opacity-60">{hero.l2}</span>
      </div>
      <div className="flex flex-col items-end text-right leading-snug whitespace-nowrap">
        <span className="font-mono text-xs opacity-70">{`RIGHT NOW · ${formatTime(now)}`}</span>
        <span className="text-base font-semibold">{hero.nowTitle}</span>
        <span className="text-sm opacity-80">{hero.nowLine}</span>
      </div>
    </div>
  );
}

function ReadyIcon({ done, waiting }: { done: boolean; waiting?: boolean }) {
  const word = <span className="sr-only">{done ? 'Done: ' : waiting ? 'Waiting: ' : 'Not done: '}</span>;
  return (
    <>
      {word}
      <ReadyMark done={done} waiting={waiting} />
    </>
  );
}

function ReadyMark({ done, waiting }: { done: boolean; waiting?: boolean }) {
  return done ? (
    <span className="flex pt-0.5 text-fg-positive">
      <IconCircleCheck size="sm" />
    </span>
  ) : waiting ? (
    <span className="flex pt-0.5 text-fg-secondary">
      <IconClock size="sm" />
    </span>
  ) : (
    <span className="flex pt-0.5 text-alert-warning-fg">
      <IconTriangleAlert size="sm" />
    </span>
  );
}

/** OnCall phone card: the person on call tonight, their checklist; Send test alert on your own only. */
function PhoneCard({
  ready,
  mine,
  handedFrom,
  now,
}: {
  ready: Readiness;
  mine: boolean;
  now: Date;
  handedFrom: { name: string; at: string } | null;
}) {
  const sub =
    ready.count === 3
      ? handedFrom
        ? `Ready · covering ${handedFrom.name} from ${handedFrom.at}`
        : 'Ready'
      : ready.sent && !ready.received
        ? `Test alert sent ${formatTime(ready.sent)} · waiting for ${ready.who}`
        : !ready.received
          ? 'Test alert not received on current phone'
          : `${3 - ready.count} still to set on ${ready.who}’s phone`;
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col leading-snug">
          <h2 className="m-0 text-base font-semibold">{`${ready.who}’s phone · ${ready.count} of 3 ready`}</h2>
          <span
            className={`text-sm ${ready.count === 3 ? 'text-fg-positive' : ready.sent && !ready.received ? 'text-fg-secondary' : 'text-alert-warning-fg'}`}
          >
            {sub}
          </span>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          {ready.items.map((r) => (
            <div key={r.label} className="flex gap-2.5 leading-normal">
              <ReadyIcon done={r.done} waiting={r.waiting} />
              <span>{r.label}</span>
            </div>
          ))}
        </div>
        {mine && <SendTest size="sm" sentAt={ready.sent} now={now} />}
      </div>
    </Card>
  );
}

/**
 * "Send test alert to me". Off for a minute after a send (the SQL's limit), then on again — a test that
 * reached the wrong phone is sent again from here (§27.8).
 */
function SendTest({
  size,
  full,
  sentAt,
  now,
}: {
  size?: 'sm';
  full?: boolean;
  sentAt: Date | null;
  now: Date;
}) {
  const [sent, setSent] = useState<string | null>(null);
  const { error, pending, run } = useSubmit((r) => setSent(r.at ?? null));
  const last = sent ? new Date(sent) : sentAt;
  const at = last && now.getTime() - last.getTime() < 60_000 ? last : null;
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        size={size}
        icon={<IconBell />}
        fullWidth={full}
        loading={pending}
        disabled={!!at}
        onClick={() => run(() => sendTest())}
      >
        {at ? `Test alert sent · ${formatTime(at)}` : 'Send test alert to me'}
      </Button>
      <Refusal error={error} />
    </div>
  );
}

function OwnersCard({
  data,
  admin,
  empty,
  phone,
  onEdit,
}: {
  data: OncallData;
  admin: boolean;
  empty: boolean;
  phone?: boolean;
  onEdit?: () => void;
}) {
  const owners = ownersOf(data);
  const foot = admin
    ? empty
      ? 'Set up a rotation to give nights and weekends to one person a week.'
      : 'Add a week in Edit rotation to give tonight to one person.'
    : 'An Admin sets up who is on call.';
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col leading-snug">
          <h2 className="m-0 text-base font-semibold">Tonight · site owners</h2>
          <span className="text-sm text-fg-secondary">
            No one is on call, so Tier 1 alerts at night page each site’s owner
          </span>
        </div>
        {owners.length === 0 && <span className="text-sm text-fg-secondary">No Tier 1 sites yet.</span>}
        <div
          className={`flex flex-col rounded-aura-md border border-border-default ${owners.length ? '' : 'hidden'}`}
        >
          {owners.map((o, i) => (
            <div
              key={o.who}
              className={`flex min-h-11 items-center gap-2.5 px-3 py-2 text-sm leading-tight ${i ? 'border-t border-border-subtle' : ''}`}
            >
              <Avatar name={o.who} size="sm" />
              <span className="flex flex-col">
                <span className="font-medium">{o.who}</span>
                <span className="text-xs text-fg-secondary">{o.sites}</span>
              </span>
            </div>
          ))}
        </div>
        <span className="text-xs leading-normal text-fg-secondary">{foot}</span>
        {phone && admin && !empty && onEdit && (
          <Button variant="primary" icon={<IconUsers />} fullWidth onClick={onEdit}>
            Edit rotation
          </Button>
        )}
      </div>
    </Card>
  );
}

function WeekCard({ data, now }: { data: OncallData; now: Date }) {
  const days = weekGrid(data, now);
  return (
    <Card className="max-lg:hidden">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="m-0 text-base font-semibold">This week · who gets Tier 1 alerts</h2>
          <div className="flex items-center gap-4 text-xs text-fg-secondary">
            <span className="flex items-center gap-1.5">
              <span className="size-3.5 rounded-aura-sm border border-fg-secondary bg-status-neutral-bg" />
              On call (nights, weekend)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3.5 rounded-aura-sm border border-dashed border-border-strong bg-bg-surface" />
              {`Owners (${formatResponseHours(data.hours)})`}
            </span>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex w-11 shrink-0 flex-col justify-between pt-7 font-mono text-xs text-fg-tertiary">
            {['00:00', ...formatResponseHours(data.hours).split(' ').at(-1)!.split('–'), '24:00'].map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <div className="grid grow grid-cols-7 gap-2">
            {days.map((d) => (
              <div key={d.label} className="flex flex-col gap-1.5">
                <span className={`h-5.5 text-xs ${d.today ? 'font-bold' : 'font-medium'}`}>{d.label}</span>
                <div className="flex h-42 flex-col gap-0.5">
                  {d.segments.map((g, i) => (
                    <div
                      key={i}
                      style={{ flexGrow: g.hours }}
                      className={`min-h-0 overflow-hidden rounded-aura-sm border px-2 py-1 text-xs leading-tight font-medium ${
                        g.onCall
                          ? 'border-fg-secondary bg-status-neutral-bg text-fg-primary'
                          : 'border-dashed border-border-strong bg-bg-surface text-fg-secondary'
                      }`}
                    >
                      {g.who}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function EmptyRotation({ admin, onEdit }: { admin: boolean; onEdit: () => void }) {
  return (
    <Card>
      <div className="flex flex-col items-start gap-2.5 p-4">
        <span className="flex text-fg-tertiary">
          <IconUsers size="lg" />
        </span>
        <h3 className="m-0 text-lg font-semibold">No rotation yet</h3>
        <span className="max-w-prose text-sm leading-normal text-fg-secondary">
          {admin
            ? 'Add the people who take Tier 1 nights and weekends, one week each. Until there is a rotation, Tier 1 alerts at night page each site’s owner.'
            : 'An Admin sets up the rotation. Until then, Tier 1 alerts at night page each site’s owner.'}
        </span>
        {admin && (
          <Button variant="primary" icon={<IconUsers />} onClick={onEdit}>
            Edit rotation
          </Button>
        )}
      </div>
    </Card>
  );
}

/** The rotation table (OnCall); the head is upper-case as drawn. */
/**
 * The rotation table (OnCall); the head is upper-case as drawn. One column set at every width (D-048
 * 12.28): the alerts column is the one flexible column, so the spare goes there, not to the action
 * column. AURA counts a flexible column as 160 px in the row's minimum whatever its `minWidth` (its
 * FLEX_MIN), so the flexible one is the column whose minimum really is ~160. With it the row needs
 * 180 + 100 + 144 + 160 + 96 + 48 = 728 px: the table beside the swap card at 1440 is 740, or ~730 with a
 * classic (Windows) scrollbar, and the column must stay there. A narrower table (1280 beside the card,
 * 1024 below xl) drops that column instead of scrolling — AURA measures the table box itself, so nothing
 * here depends on the screen (e2e at 1440 / 1280 / 1100 / 1024).
 */
function columns(onSwap: (row: RotationRow) => void, onHandover: () => void): DataTableColumn<RotationRow>[] {
  const cols: DataTableColumn<RotationRow>[] = [
    {
      key: 'shift',
      label: 'Shift',
      // 180 holds "Mon 26 Oct → Mon 2 Nov"; the longest weeks ("Mon 18 May → Mon 25 May") wrap.
      width: 180,
      render: (r) => <span className={`tabular-nums ${r.past ? 'text-fg-secondary' : ''}`}>{r.range}</span>,
    },
    {
      key: 'who',
      label: 'On call',
      // No avatar: at 100 px one cut every name to "Stagi…" (staging /verify). Names wrap; the phone's
      // row cards and the hero keep their avatars.
      width: 100,
      render: (r) => <span className={`break-words ${r.nobody ? 'text-fg-secondary' : ''}`}>{r.who}</span>,
    },
    // 144 holds "Swap requested" (~125 px + padding).
    { key: 'status', label: 'Status', width: 144, render: (r) => <StateBadge b={r.status} /> },
    {
      key: 'alerts',
      label: 'Tier 1 alerts at night',
      minWidth: 160,
      hideBelow: 728,
      render: (r) => <span className="text-fg-secondary">{r.alerts}</span>,
    },
    {
      key: 'action',
      label: '',
      width: 96,
      actions: true,
      render: (r) =>
        r.action?.kind === 'swap' ? (
          <Button variant="ghost" size="sm" onClick={() => onSwap(r)}>
            Swap
          </Button>
        ) : r.action?.kind === 'swap-off' ? (
          // The reason is the sentence under the table (§14.16): a title alone isn't reachable.
          <Button variant="ghost" size="sm" disabled title={r.action.why} aria-describedby="oc-foot">
            Swap
          </Button>
        ) : r.action?.kind === 'handover' ? (
          <Button variant="ghost" size="sm" onClick={onHandover}>
            Hand over…
          </Button>
        ) : r.action?.kind === 'note' ? (
          <span className="text-xs whitespace-nowrap text-fg-tertiary" title={r.action.why}>
            {r.action.text}
          </span>
        ) : null,
    },
  ];
  return cols.map((c) => ({ ...c, label: c.label.toUpperCase() }));
}

// ── Swap cards ────────────────────────────────────────────────────────────

interface CardProps {
  view: SwapView;
  /** After an action here focus moves to the refreshed status line: ask for it, and let the line claim it. */
  want: () => void;
  claim: (el: HTMLElement) => void;
  onDecline: () => void;
}

/** Answer / approve / withdraw, shared by the desktop and phone cards. */
function useSwapActions(view: SwapView, done: () => void) {
  const accept = useSubmit(done, view.id);
  const approve = useSubmit(done, view.id);
  const withdraw = useSubmit(done, view.id);
  return {
    accept: () => accept.run(() => respondSwap({ swapId: view.id, accept: true })),
    approve: () => approve.run(() => decideSwap({ swapId: view.id, approve: true })),
    withdraw: () => withdraw.run(() => withdrawSwap({ swapId: view.id })),
    pending: { accept: accept.pending, approve: approve.pending, withdraw: withdraw.pending },
    error: accept.error ?? approve.error ?? withdraw.error,
  };
}

/** OnCall request card for the person asked (§27.3), above the hero. */
function RequestCard({ view, want, claim, onDecline }: CardProps) {
  const a = useSwapActions(view, want);
  return (
    <Card>
      <section aria-labelledby="oc-request" className="flex flex-col gap-3.5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={view.requester} size="md" />
            <div className="flex flex-col leading-snug">
              <span className="font-mono text-xs text-fg-tertiary">{view.eyebrow}</span>
              <h2 id="oc-request" className="m-0 text-xl font-semibold">
                {view.title}
              </h2>
              <span className="text-sm text-fg-secondary">{view.sub}</span>
            </div>
          </div>
          <StateBadge b={view.badge} />
        </div>
        <div className="flex gap-3">
          <WeekBox w={view.left} />
          <span className="flex self-center text-fg-tertiary">
            <IconArrowUpDown />
          </span>
          <WeekBox w={view.right} />
        </div>
        {view.warn && (
          <Alert tone="warning" title={view.warn.title}>
            {view.warn.text}
          </Alert>
        )}
        {view.canAnswer && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" icon={<IconCheck />} loading={a.pending.accept} onClick={a.accept}>
              Accept
            </Button>
            <Button variant="secondary" onClick={onDecline}>
              Decline
            </Button>
            <span className="text-xs leading-normal text-fg-secondary">{view.hint}</span>
          </div>
        )}
        {/* The only Admin was the person asked: once accepted, they approve here too. */}
        {view.canDecide && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              icon={<IconCheck />}
              disabled={!view.canApprove}
              loading={a.pending.approve}
              onClick={a.approve}
            >
              Approve
            </Button>
            <Button variant="secondary" onClick={onDecline}>
              Decline
            </Button>
          </div>
        )}
        {view.line && <StatusLine line={view.line} claimFocus={claim} />}
        <Refusal error={a.error} />
      </section>
    </Card>
  );
}

/** OnCall side card for the requester (Withdraw) and Admins (Approve / Decline). */
function SideCard({ view, want, claim, onDecline }: CardProps) {
  const a = useSwapActions(view, want);
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 text-base font-semibold">Swap request</h3>
          <StateBadge b={view.badge} />
        </div>
        <span className="-mt-2 text-xs text-fg-secondary">{view.sub}</span>
        <span className="text-sm leading-normal">{view.what}</span>
        <PeopleList people={view.people} />
        {view.warn && (
          <Alert tone="warning" title={view.warn.title}>
            {view.warn.text}
          </Alert>
        )}
        {view.canDecide && (
          <>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={<IconCheck />}
                disabled={!view.canApprove}
                loading={a.pending.approve}
                onClick={a.approve}
              >
                Approve
              </Button>
              <Button variant="secondary" size="sm" onClick={onDecline}>
                Decline
              </Button>
            </div>
            {view.part === 'admin' && (
              <span className="text-xs leading-normal text-fg-secondary">{view.hint}</span>
            )}
          </>
        )}
        {view.canWithdraw && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" loading={a.pending.withdraw} onClick={a.withdraw}>
              Withdraw
            </Button>
            <span className="text-xs leading-normal text-fg-secondary">{view.hint}</span>
          </div>
        )}
        {view.line && <StatusLine line={view.line} claimFocus={claim} />}
        <Refusal error={a.error} />
      </div>
    </Card>
  );
}

/** MOnCall swap card: one shape for the person asked, the requester and an Admin (§27.3, §28.1–2). */
function PhoneSwapCard({ view, want, claim, onDecline }: CardProps) {
  const a = useSwapActions(view, want);
  return (
    <section
      aria-label={view.title}
      className="flex flex-col gap-2.5 rounded-aura-lg border border-border-default bg-bg-surface px-4 py-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-fg-tertiary">{view.eyebrow}</span>
        <StateBadge b={view.badge} />
      </div>
      <div className="flex items-start gap-2.5">
        <Avatar name={view.requester} size="sm" />
        <div className="flex flex-col leading-snug">
          <span className="text-lg font-semibold">{view.title}</span>
          <span className="text-sm text-fg-secondary">{view.sub}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <WeekBox w={view.left} />
        <div className="flex justify-center text-fg-tertiary">
          <IconArrowUpDown size="sm" />
        </div>
        <WeekBox w={view.right} />
      </div>
      {view.part !== 'asked' && <PeopleList people={view.people} />}
      {view.warn && (
        <Alert tone="warning" title={view.warn.title}>
          {view.warn.text}
        </Alert>
      )}
      {view.canAnswer && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" fullWidth onClick={onDecline}>
            Decline
          </Button>
          <Button
            variant="primary"
            icon={<IconCheck />}
            fullWidth
            loading={a.pending.accept}
            onClick={a.accept}
          >
            Accept
          </Button>
        </div>
      )}
      {view.canDecide && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" fullWidth onClick={onDecline}>
            Decline
          </Button>
          <Button
            variant="primary"
            icon={<IconCheck />}
            fullWidth
            disabled={!view.canApprove}
            loading={a.pending.approve}
            onClick={a.approve}
          >
            Approve
          </Button>
        </div>
      )}
      {view.canWithdraw && (
        <Button variant="secondary" fullWidth loading={a.pending.withdraw} onClick={a.withdraw}>
          Withdraw
        </Button>
      )}
      {view.hint && (view.canAnswer || view.canDecide || view.canWithdraw) && (
        <span className="text-xs leading-snug text-fg-secondary">
          {view.canDecide && view.part === 'admin' && view.status === 'waiting'
            ? view.hint.replace(' Logged in the audit log.', '')
            : view.hint}
        </span>
      )}
      {view.line && <StatusLine line={view.line} claimFocus={claim} />}
      <Refusal error={a.error} />
    </section>
  );
}

// ── Phone parts ───────────────────────────────────────────────────────────

/** MOnCall "Before your shift": two ticks the person sets, the test alert that ticks itself (§10, §27.8). */
function Checklist({ ready, data, now }: { ready: Readiness; data: OncallData; now: Date }) {
  const c = data.checklists[data.viewer.id];
  const [mentions, setMentions] = useState(!!c?.mentionsOnly);
  const [dnd, setDnd] = useState(!!c?.dndAllowed);
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (next: { mentionsOnly: boolean; dndAllowed: boolean }) =>
    start(async () => {
      const r = await setChecklist(next);
      setError(r.ok ? null : r.message);
      // Not saved: the boxes go back to what is stored.
      if (!r.ok) {
        setMentions(!!c?.mentionsOnly);
        setDnd(!!c?.dndAllowed);
      }
    });
  const count = [mentions, dnd, !!ready.received].filter(Boolean).length;
  const sent = !!ready.sent && !ready.received;
  return (
    <div className="flex flex-col gap-1 rounded-aura-lg border border-border-default bg-bg-surface px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">Before your shift</span>
        <span className="text-sm font-semibold tabular-nums">{`${count}/3`}</span>
      </div>
      <span
        className={`flex items-center gap-1.5 text-sm leading-snug ${ready.received ? 'text-fg-positive' : 'text-alert-warning-fg'}`}
      >
        {ready.received ? <IconCircleCheck size="sm" /> : <IconTriangleAlert size="sm" />}
        <span>
          {ready.received
            ? `${ready.who}’s phone ${count} of 3 ready · test alert received ${formatTime(ready.received)}`
            : `${ready.who}’s phone ${count} of 3 ready · test alert not received on current phone`}
        </span>
      </span>
      <Checkbox
        checked={mentions}
        onChange={(v) => {
          setMentions(v);
          save({ mentionsOnly: v, dndAllowed: dnd });
        }}
      >
        Alerts Space: notify for @mentions only
      </Checkbox>
      <Checkbox
        checked={dnd}
        onChange={(v) => {
          setDnd(v);
          save({ mentionsOnly: mentions, dndAllowed: v });
        }}
      >
        Space allowed through Do Not Disturb
      </Checkbox>
      <Checkbox
        checked={!!ready.received}
        disabled
        description={
          ready.received
            ? `Received on this phone at ${formatTime(ready.received)}`
            : 'Ticks itself when you open the test link on this phone'
        }
      >
        Test alert received on this phone
      </Checkbox>
      {sent ? (
        <div className="flex flex-col gap-1.5 rounded-aura-md bg-bg-canvas px-3 py-2.5 text-sm leading-snug">
          <span>
            <b className="font-semibold">{`Sent ${formatTime(ready.sent!)}`}</b> to the “TEST — no action”
            thread, mentioning only you.
          </span>
          <span className="flex items-center gap-1.5 text-xs text-fg-secondary">
            <IconExternalLink size="sm" />
            Open the link in that Chat message on this phone.
          </span>
          {/* No dead end (§14.16): a link that expired or reached another phone is sent again here. */}
          <SendTest full sentAt={ready.sent} now={now} />
        </div>
      ) : (
        !ready.received && <SendTest full sentAt={ready.sent} now={now} />
      )}
      <Refusal error={error} />
      <span className="text-xs leading-snug text-fg-secondary">
        Digests post to a separate Space, DxT Website Reports.
      </span>
    </div>
  );
}

/** MOnCall rotation card: row cards, Request swap (own week) or Edit rotation, Hand over… on the live row (Admin). */
function PhoneRotation({
  rows,
  admin,
  one,
  canRequest,
  swapRow,
  onSwap,
  onHandover,
  onEdit,
}: {
  rows: RotationRow[];
  admin: boolean;
  one: boolean;
  canRequest: boolean;
  swapRow: RotationRow | null;
  onSwap: (row: RotationRow) => void;
  onHandover: () => void;
  onEdit: () => void;
}) {
  const empty = rows.length === 0;
  const canEdit = admin && !empty && !rows[0]?.nobody;
  const both = canRequest && canEdit;
  const request = canRequest && (
    <Button
      variant="ghost"
      icon={<IconArrowUpDown />}
      fullWidth={both}
      disabled={one || !swapRow}
      aria-describedby={one || !swapRow ? 'oc-swap-why' : undefined}
      onClick={() => swapRow && onSwap(swapRow)}
    >
      Request swap
    </Button>
  );
  const edit = canEdit && (
    <Button variant="ghost" icon={<IconUsers />} fullWidth={both} onClick={onEdit}>
      Edit rotation
    </Button>
  );
  return (
    // No overflow-hidden: it would clip the buttons' focus rings (layout-consistency).
    <div className="rounded-aura-lg border border-border-default bg-bg-surface">
      {/* Padding all round: the 44 px buttons' hover fill must not touch the card's edge. */}
      <div className="flex min-h-11 items-center justify-between gap-2 border-b border-border-subtle py-1.5 pr-2 pl-4">
        <h2 className="m-0 font-mono text-xs font-normal text-fg-tertiary">ROTATION</h2>
        {!both && (
          <span className="flex">
            {request}
            {edit}
          </span>
        )}
      </div>
      {/* An Admin in the rotation gets both (§28.7), which the board never draws together: they
          don't fit beside the label at 390, so they get a row of their own, half each. */}
      {both && (
        <div className="grid grid-cols-2 gap-1 border-b border-border-subtle p-1.5">
          {request}
          {edit}
        </div>
      )}
      {canRequest && (one || !swapRow) && (
        <div
          id="oc-swap-why"
          className="border-b border-border-subtle px-4 py-2 text-xs leading-snug text-fg-secondary"
        >
          {/* No dead control (§14.16): say why there's nothing to swap. */}
          {one
            ? SWAP_OFF
            : 'None of your weeks can be swapped now — the next one already has a request, or none is made yet'}
        </div>
      )}
      {rows.map((r) => (
        <div key={r.key}>
          <div className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle px-4 py-1.5">
            {r.nobody ? (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-fg-tertiary">
                <IconMinus size="sm" />
              </span>
            ) : (
              <Avatar name={r.who} size="sm" />
            )}
            <div className="flex min-w-0 grow flex-col leading-tight">
              <span className="text-sm font-medium">{r.who}</span>
              <span className="text-xs text-fg-secondary">{r.phoneLine}</span>
            </div>
            <StateBadge b={r.status} />
          </div>
          {r.action?.kind === 'handover' && (
            <div className="border-b border-border-subtle pr-4 pb-2.5 pl-13.5">
              <Button variant="secondary" icon={<IconArrowUpDown />} fullWidth onClick={onHandover}>
                Hand over…
              </Button>
            </div>
          )}
        </div>
      ))}
      {empty && (
        <div className="flex flex-col items-start gap-2 px-4 py-5">
          <span className="text-base font-semibold">No rotation yet</span>
          <span className="text-sm leading-normal text-fg-secondary">
            {admin
              ? 'Add the people who take Tier 1 nights and weekends, one week each.'
              : 'An Admin sets up the rotation.'}
          </span>
          {admin && (
            <Button variant="primary" icon={<IconUsers />} fullWidth onClick={onEdit}>
              Edit rotation
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
