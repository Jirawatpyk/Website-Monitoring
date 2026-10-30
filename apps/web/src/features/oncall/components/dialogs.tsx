'use client';

import { Alert, Avatar, Badge, Button, Dialog, IconButton, Select, Textarea } from '@jirawatpyk/aura-react';
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowUpDown,
  IconBan,
  IconCheck,
  IconCircle,
  IconCircleCheck,
  IconClock,
  IconInfo,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import { formatDay, formatNameList, formatTime, formatWeek } from '@dxt/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { decideSwap, handOver, requestSwap, respondSwap, saveRotation } from '../actions';
import type { OncallResult } from '../mutations';
import {
  handoverSummary,
  handoverTimes,
  nameOf,
  readinessOf,
  rotationPreview,
  rotationText,
  type OncallData,
  type RotationRow,
  type ShiftRow,
  type SwapChoice,
  type SwapView,
} from '../model';

/** A hand-over that went through: the success alert's title and who got a Chat message. */
export interface HandedOver {
  title: string;
  from: string;
  to: string;
}

const FAILED = 'Couldn’t save. Check your connection and try again.';

/**
 * Runs an action; on success closes and refreshes, on a refusal keeps the dialog open with its words.
 * `swapId`: a swap step — the page stays on that request (`?swap=`), so its card shows what happened
 * (OnCall: the closed states) instead of disappearing once it is no longer open.
 */
export function useSubmit(onDone: (r: Extract<OncallResult, { ok: true }>) => void, swapId?: string) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<OncallResult>) =>
    start(async () => {
      setError(null);
      const r = await fn().catch((): OncallResult => ({ ok: false, message: FAILED }));
      if (!r.ok) {
        setError(r.message);
        return;
      }
      onDone(r);
      if (swapId) router.replace(`/oncall?swap=${swapId}`, { scroll: false });
      router.refresh();
    });
  return { error, pending, run };
}

export function Refusal({ error }: { error: string | null }) {
  return error ? (
    <Alert tone="danger" role="alert">
      {error}
    </Alert>
  ) : null;
}

/**
 * "Logged in the audit log" left of the buttons (OnCall dialogs); the phone puts the pair in two columns
 * and shows the line only where MOnCall draws it (`phoneLogged`: the Admin's decline, the hand-over).
 */
function Foot({
  children,
  phone,
  wide,
  phoneLogged = false,
}: {
  children: React.ReactNode;
  phone?: boolean;
  wide?: boolean;
  phoneLogged?: boolean;
}) {
  return phone ? (
    <div className="flex w-full flex-col gap-1.5">
      {/* `wide`: a narrow Cancel and the long "Hand over to Nok" taking the rest (MOnCall sheet). */}
      <div className={`grid gap-2 ${wide ? 'grid-cols-[auto_1fr]' : 'grid-cols-2'}`}>{children}</div>
      {phoneLogged && <span className="text-center text-xs text-fg-secondary">Logged in the audit log</span>}
    </div>
  ) : (
    <div className="flex w-full flex-wrap items-center gap-2">
      <span className="grow text-xs text-fg-secondary">Logged in the audit log</span>
      {children}
    </div>
  );
}

interface Base {
  open: boolean;
  onClose: () => void;
  /** Phone (MOnCall): the buttons as a full-width pair. */
  phone?: boolean;
}

/**
 * Decline a swap (§27.4): the person asked may give a reason ("Optional. Arm sees it."); an Admin must
 * ("Say why — Arm and Nok see this").
 */
export function DeclineDialog({
  view,
  open,
  onClose,
  onDone,
  phone,
}: Base & { view: SwapView; onDone?: () => void }) {
  const admin = view.part !== 'asked';
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const { error, pending, run } = useSubmit(() => {
    onDone?.();
    onClose();
  }, view.id);
  const missing = admin && !note.trim();
  const submit = () => {
    if (missing) {
      setTried(true);
      return;
    }
    run(() =>
      admin
        ? decideSwap({ swapId: view.id, approve: false, note })
        : respondSwap({ swapId: view.id, accept: false, note }),
    );
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      dismissOnScrim={false}
      title={view.declineTitle}
      description={view.declineText}
      footer={
        <Foot phone={phone} phoneLogged={admin}>
          <Button variant="secondary" fullWidth={phone} onClick={onClose}>
            Back
          </Button>
          <Button variant="danger" icon={<IconBan />} fullWidth={phone} loading={pending} onClick={submit}>
            Decline swap
          </Button>
        </Foot>
      }
    >
      <div className="flex flex-col gap-4">
        <Textarea
          touchHeight
          label="Reason"
          required={admin}
          optional={!admin}
          rows={2}
          placeholder={
            admin ? `e.g. ${view.asked} would be on call two weeks in a row` : 'e.g. I’m away that week'
          }
          value={note}
          onChange={(e) => setNote(e.target.value)}
          hint={admin ? undefined : `Optional. ${view.requester} sees it.`}
          error={tried && missing ? `Say why — ${view.requester} and ${view.asked} see this` : undefined}
        />
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}

/**
 * Request a swap (§27.7): pick who; they give up their next free week. Desktop "Swap Arm’s week · …",
 * phone "Request a swap" (each board's own words). The back-to-back warning doesn't stop the request.
 */
export function RequestSwapDialog({
  row,
  choices,
  me,
  open,
  onClose,
  phone,
  onSent,
}: Base & { row: RotationRow; choices: SwapChoice[]; me: string; onSent: (swapId: string) => void }) {
  const [withId, setWithId] = useState(choices[0]?.userId ?? '');
  const pick = choices.find((c) => c.userId === withId) ?? choices[0];
  const { error, pending, run } = useSubmit((r) => {
    onClose();
    if (r.id) onSent(r.id);
  });
  const effect = pick
    ? `${pick.who} gets a Chat message and an email to accept, then an Admin approves. Nothing changes in the rotation until then${phone ? `; you stay on call for ${row.range}.` : '.'}`
    : '';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size={phone ? 'sm' : 'md'}
      dismissOnScrim={false}
      title={phone ? 'Request a swap' : `Swap ${me}’s week · ${row.range}`}
      description={phone ? `Your shift: ${row.range} (Tier 1 nights and weekends)` : effect}
      footer={
        <Foot phone={phone}>
          <Button variant="secondary" fullWidth={phone} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={phone ? undefined : <IconArrowUpDown />}
            fullWidth={phone}
            loading={pending}
            disabled={!pick || !row.shiftId}
            onClick={() =>
              pick &&
              row.shiftId &&
              run(() => requestSwap({ shiftId: row.shiftId!, withShiftId: pick.shiftId }))
            }
          >
            {phone ? 'Send request' : 'Send swap request'}
          </Button>
        </Foot>
      }
    >
      <div className="flex flex-col gap-4">
        {choices.length === 0 && (
          <Alert tone="info" role="status">
            Nobody has a free week to swap right now — every other week already has a request or was handed
            over.
          </Alert>
        )}
        <Select
          touchHeight
          label="Swap with"
          options={choices.map((c) => ({ value: c.userId, label: c.who }))}
          value={pick?.userId ?? ''}
          onChange={(e) => setWithId(e.target.value)}
        />
        {pick && (
          <>
            {phone ? (
              <span className="text-sm leading-normal text-fg-secondary">{effect}</span>
            ) : (
              <div className="flex flex-col rounded-aura-md border border-border-default">
                {[
                  { who: pick.who, week: row.range },
                  { who: me, week: pick.week },
                ].map((w, i) => (
                  <div
                    key={w.who}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 text-sm ${i ? 'border-t border-border-subtle' : ''}`}
                  >
                    <Avatar name={w.who} size="sm" />
                    <span className="grow">
                      <b className="font-semibold">{w.who}</b> takes {w.week}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {pick.warn && (
              <Alert tone="warning" title={`Back-to-back for ${pick.who}`}>
                {pick.warn}
              </Alert>
            )}
          </>
        )}
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}

/**
 * Edit rotation (OnCall): the order, with up / down; weekly from Monday 09:00 only (v1); the next weeks
 * with this order. Weeks already scheduled keep their person (`oncall_extend_shifts`).
 */
export function EditRotationDialog({ data, now, open, onClose }: Base & { data: OncallData; now: Date }) {
  const [order, setOrder] = useState<string[]>(() =>
    data.rotation.filter((id) => data.eligible.includes(id)),
  );
  const { error, pending, run } = useSubmit(onClose);
  const saved = data.rotation.filter((id) => data.eligible.includes(id));
  const changed = order.join(',') !== saved.join(',');
  const others = data.eligible.filter((id) => !order.includes(id));
  const move = (i: number, by: -1 | 1) =>
    setOrder((o) => {
      const n = [...o];
      [n[i], n[i + by]] = [n[i + by]!, n[i]!];
      return n;
    });
  const told = formatNameList(order.map((id) => nameOf(data, id)));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      dismissOnScrim={false}
      title="Edit rotation"
      description={rotationText(data, now)}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="grow text-xs text-fg-secondary">
            {order.length === 0
              ? 'Add someone to save'
              : changed
                ? `${told} get a Chat message with their new weeks · logged`
                : 'No change yet'}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<IconCheck />}
            loading={pending}
            disabled={!changed || order.length === 0}
            onClick={() => run(() => saveRotation({ userIds: order }))}
          >
            Save rotation
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Order</span>
          {order.length > 0 && (
            <ol className="m-0 flex list-none flex-col rounded-aura-md border border-border-default p-0">
              {order.map((id, i) => {
                const who = nameOf(data, id);
                return (
                  <li
                    key={id}
                    className={`flex items-center gap-2.5 py-1 pr-2 pl-3.5 text-sm ${i ? 'border-t border-border-subtle' : ''}`}
                  >
                    <span className="w-4.5 font-mono text-xs text-fg-tertiary">{i + 1}</span>
                    <Avatar name={who} size="sm" />
                    <span className="grow font-medium">{who}</span>
                    <IconButton
                      icon={<IconArrowUp />}
                      label={`Move ${who} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    />
                    <IconButton
                      icon={<IconArrowDown />}
                      label={`Move ${who} down`}
                      disabled={i === order.length - 1}
                      onClick={() => move(i, 1)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${who}`}
                      onClick={() => setOrder((o) => o.filter((x) => x !== id))}
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ol>
          )}
          {others.length > 0 && (
            <Select
              touchHeight
              // A fresh, empty picker after each add (the list just lost that person).
              key={order.join(',')}
              label="Add someone"
              placeholder="Pick an Admin or Responder"
              options={others.map((id) => ({ value: id, label: nameOf(data, id) }))}
              defaultValue=""
              onChange={(e) => {
                const id = e.target.value;
                if (id) setOrder((o) => (o.includes(id) ? o : [...o, id]));
              }}
            />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select
            touchHeight
            label="Shift length"
            options={[{ value: '1w', label: '1 week' }]}
            value="1w"
            disabled
            hint="Weekly only in v1"
          />
          <Select
            touchHeight
            label="Handover"
            options={[{ value: 'mon9', label: 'Monday 09:00' }]}
            value="mon9"
            disabled
            hint="Matches Tier 1 owner hours"
          />
        </div>
        <div className="flex flex-col gap-1 rounded-aura-md bg-bg-canvas px-3.5 py-2.5 text-sm">
          <span className="font-mono text-xs text-fg-tertiary">NEXT WEEKS WITH THIS ORDER</span>
          <span>{rotationPreview(order, data, now)}</span>
        </div>
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}

/**
 * Hand over the live shift (Users board dialog, opened from On-call — D-048 item 5; MOnCall sheet at
 * 390): who, from when, their phone checklist, a required reason. A test alert goes only to whoever
 * sends it (D-048 item 12), so the dialog shows the new person's checklist without a send button.
 */
export function HandOverDialog({
  data,
  shift,
  now,
  open,
  onClose,
  phone,
  onHanded,
}: Base & { data: OncallData; shift: ShiftRow; now: Date; onHanded: (result: HandedOver) => void }) {
  const holder = nameOf(data, shift.userId);
  const people = data.eligible.filter((id) => id !== shift.userId);
  const nextShift = data.shifts.find((s) => Date.parse(s.startsAt) >= Date.parse(shift.endsAt));
  const times = handoverTimes(data, shift, now);
  const [to, setTo] = useState(people[0] ?? '');
  const [when, setWhen] = useState(times.find((t) => t.value === 'tonight')?.value ?? times[0]!.value);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const at = times.find((t) => t.value === when) ?? times[0]!;
  const toName = nameOf(data, to);
  const ready = readinessOf(data, to, now);
  const onNext = nextShift?.userId === to;
  const { error, pending, run } = useSubmit(() => {
    onClose();
    const from =
      at.value === 'now'
        ? `now (${formatTime(at.at)})`
        : at.value === 'tonight'
          ? `tonight ${formatTime(at.at)}`
          : at.label;
    onHanded({ title: `${holder}’s shift handed to ${toName} from ${from}`, from: holder, to: toName });
  });
  const submit = () => {
    if (!reason.trim()) {
      setTried(true);
      return;
    }
    run(() => handOver({ shiftId: shift.id, to, at: at.at.toISOString(), reason }));
  };
  const until = new Date(shift.endsAt);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      dismissOnScrim={false}
      title={`Hand over ${holder}’s live shift`}
      description={`${holder} is on call now, until ${formatDay(until, { weekday: true })} ${formatTime(until)}. The new person gets Tier 1 alerts at night and on the weekend from the time you pick. ${holder}’s sites, backups and later weeks don’t change.`}
      footer={
        <Foot phone={phone} wide phoneLogged>
          <Button variant="secondary" fullWidth={phone} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<IconArrowUpDown />}
            fullWidth={phone}
            loading={pending}
            disabled={!to}
            onClick={submit}
          >
            {`Hand over to ${toName}`}
          </Button>
        </Foot>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Select
            touchHeight
            label="New on-call person"
            options={people.map((id) => {
              const r = readinessOf(data, id, now);
              const next = nextShift?.userId === id ? ' · on call next' : '';
              return { value: id, label: `${nameOf(data, id)} · phone ${r.count} of 3 ready${next}` };
            })}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <Select
            touchHeight
            label="Takes effect"
            options={times.map((t) => ({ value: t.value, label: t.label }))}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </div>
        {to && (
          <div
            className={`flex flex-col gap-2 rounded-aura-md border px-3.5 py-3 text-sm ${onNext ? 'border-alert-warning-border' : 'border-border-default'}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">{`${toName}’s phone · ${ready.count} of 3 ready`}</span>
              <Badge
                tone={ready.count === 3 ? 'success' : 'neutral'}
                icon={ready.count === 3 ? <IconCircleCheck /> : <IconClock />}
              >
                {ready.count === 3
                  ? 'Phone ready'
                  : ready.sent && !ready.received
                    ? `Test sent ${formatTime(ready.sent)}`
                    : 'Not ready yet'}
              </Badge>
            </div>
            {ready.items.map((it) => (
              <div key={it.label} className="flex gap-2.5">
                <span className="sr-only">{it.done ? 'Done: ' : 'Not done: '}</span>
                <span className={`flex pt-0.5 ${it.done ? 'text-fg-positive' : 'text-fg-tertiary'}`}>
                  {it.done ? <IconCircleCheck size="sm" /> : <IconCircle size="sm" />}
                </span>
                <span>{it.label}</span>
              </div>
            ))}
            {onNext && nextShift && (
              <span className="flex gap-1.5 text-alert-warning-fg">
                <span className="flex pt-0.5">
                  <IconTriangleAlert size="sm" />
                </span>
                <span>{`${toName} is on call next (${formatWeek({ start: new Date(nextShift.startsAt), end: new Date(nextShift.endsAt) })}) — this makes it back-to-back.`}</span>
              </span>
            )}
          </div>
        )}
        <div className="flex gap-2.5 rounded-aura-md bg-bg-canvas px-3.5 py-2.5 text-sm">
          <span className="flex pt-0.5 text-fg-secondary">
            <IconInfo size="sm" />
          </span>
          <span>{handoverSummary(data, shift, toName, at, now)}</span>
        </div>
        <Textarea
          touchHeight
          label="Reason"
          required
          rows={2}
          placeholder={`e.g. ${holder} is ill tonight`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={tried && !reason.trim() ? `Add a short reason — ${holder} and ${toName} see it` : undefined}
        />
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}
