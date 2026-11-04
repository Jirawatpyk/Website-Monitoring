'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert, Badge, Button, Card, Dialog } from '@jirawatpyk/aura-react';
import {
  IconArrowUpRight,
  IconCircleAlert,
  IconCircleCheck,
  IconClock,
  IconMail,
} from '@jirawatpyk/aura-react/icons';
import { escalateNow, sendClientUpdateReminder } from '../hand-actions';
import type { EscalationCardView, LadderRow } from '../escalation-card';

const FAILED = 'Couldn’t reach the server. Check your connection and try again.';

const toneClass: Record<LadderRow['tone'], string> = {
  sent: 'text-fg-positive',
  next: 'font-medium text-alert-warning-fg',
  waits: 'text-fg-secondary',
  cancelled: 'text-fg-tertiary',
};

/** "Nothing escalates on its own …" + Escalate now (§30.6); the phone draws it as its own card. */
export function EscalateNow({
  card,
  incidentId,
  incidentLabel,
  siteName,
  phone,
}: {
  card: EscalationCardView;
  incidentId: string;
  incidentLabel: string;
  siteName: string;
  phone: boolean;
}) {
  if (card.back)
    return (
      <p className="m-0 flex items-start gap-2 rounded-aura-md border border-border-default p-aura-3 text-sm">
        <IconCircleCheck aria-hidden className="mt-0.5 shrink-0 text-fg-positive" />
        {card.back}
      </p>
    );
  if (!card.stopped) return null;
  return (
    <Alert tone="danger" icon={<IconCircleAlert />}>
      <div className="flex flex-col gap-3">
        <p className="m-0">{card.stopped}</p>
        {card.button && (
          <EscalateButton
            button={card.button}
            incidentId={incidentId}
            incidentLabel={incidentLabel}
            siteName={siteName}
            phone={phone}
          />
        )}
      </div>
    </Alert>
  );
}

function EscalateButton({
  button,
  incidentId,
  incidentLabel,
  siteName,
  phone,
}: {
  button: NonNullable<EscalationCardView['button']>;
  incidentId: string;
  incidentLabel: string;
  siteName: string;
  phone: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      setError(null);
      const r = await escalateNow({ incidentId, level: button.level }).catch(() => ({
        ok: false as const,
        message: FAILED,
      }));
      if (!r.ok) {
        setError(r.message);
        router.refresh();
        return;
      }
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button
        variant="secondary"
        size={phone ? 'md' : 'sm'}
        fullWidth={phone}
        icon={<IconArrowUpRight />}
        onClick={() => setOpen(true)}
        className="self-start"
      >
        {button.label}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={button.title}
        description={`${incidentLabel} · ${siteName} · ${phone ? 'goes out only because you send it.' : 'the engine is down, so this goes out only because you send it.'}`}
        people={button.people.map((p) => ({ ...p, channel: 'Chat @mention + email' }))}
        cta={phone ? `Send L${button.level}` : button.cta}
        ctaIcon={<IconArrowUpRight />}
        pending={pending}
        error={error}
        phone={phone}
        onConfirm={send}
      />
    </>
  );
}

/** The Escalation card (§8, §30.6–8): the ladder, Escalate now while the engine is stopped. */
export function EscalationCard({
  card,
  incidentId,
  incidentLabel,
  siteName,
  phone,
}: {
  card: EscalationCardView;
  incidentId: string;
  incidentLabel: string;
  siteName: string;
  phone: boolean;
}) {
  const head = phone ? (card.stopped ? 'Paused — engine down' : card.back ? 'Running again' : null) : null;
  return (
    <Card
      title={card.title}
      headingLevel={2}
      actions={head ? <span className="text-xs text-fg-secondary">{head}</span> : undefined}
      footer={<p className="m-0 text-xs text-fg-secondary">{card.footer}</p>}
    >
      <div className="flex flex-col gap-3">
        <ol className="m-0 flex list-none flex-col p-0">
          {card.rows.map((r) => (
            <li
              key={r.label}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 border-b border-border-subtle py-2 last:border-b-0"
            >
              <span className="font-medium">{r.label}</span>
              <span className="flex min-w-0 flex-col">
                <span className="text-xs text-fg-secondary">{r.when}</span>
                <span className="text-sm">{r.who}</span>
              </span>
              <span className={`text-right text-xs ${toneClass[r.tone]}`}>{r.status}</span>
            </li>
          ))}
        </ol>
        {!phone && (
          <EscalateNow
            card={card}
            incidentId={incidentId}
            incidentLabel={incidentLabel}
            siteName={siteName}
            phone={false}
          />
        )}
      </div>
    </Card>
  );
}

/** What the client-update reminder by hand needs (§30.7, D-055 item 3). */
export interface ReminderView {
  /** The AM (or "the Admins" with none). */
  to: string;
  role: string;
  /** "02:46". */
  dueAt: string;
  /** The track hasn't fired: the card shows "Not notified yet" before it (D-055 item 3). */
  preFire: boolean;
}

/** "Send client-update reminder now" (§30.7): the box, its confirm, the small pre-fire card. */
export function ClientUpdateReminder({
  reminder,
  incidentId,
  incidentLabel,
  siteName,
  phone,
}: {
  reminder: ReminderView;
  incidentId: string;
  incidentLabel: string;
  siteName: string;
  phone: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      setError(null);
      const r = await sendClientUpdateReminder(incidentId).catch(() => ({
        ok: false as const,
        message: FAILED,
      }));
      if (!r.ok) {
        setError(r.message);
        router.refresh();
        return;
      }
      setOpen(false);
      router.refresh();
    });
  const box = (
    <div className="flex flex-col gap-2 rounded-aura-md border border-alert-warning-border p-aura-3">
      <p className="m-0 text-sm">{`The engine is down, so the 15-min reminder to ${reminder.to} won’t go out on its own.`}</p>
      <Button
        variant="secondary"
        size={phone ? 'md' : 'sm'}
        fullWidth={phone}
        icon={<IconMail />}
        onClick={() => setOpen(true)}
        className="self-start"
      >
        Send client-update reminder now
      </Button>
    </div>
  );
  return (
    <>
      {reminder.preFire ? (
        <Card
          title="Client update"
          headingLevel={2}
          actions={
            <Badge tone="warning" variant="outline" icon={<IconClock />}>
              {`Due ${reminder.dueAt}`}
            </Badge>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="m-0 text-sm">
              <span className="font-medium">{reminder.to}</span>
              {` · ${reminder.role === 'Site AM' ? 'Account manager' : reminder.role} · Not notified yet`}
            </p>
            <p className="m-0 text-xs text-fg-secondary">{`Due ${reminder.dueAt} · 15 min after it was opened`}</p>
            {box}
          </div>
        </Card>
      ) : (
        box
      )}
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Send the client-update reminder now?"
        description={`${incidentLabel} · ${siteName} · the same reminder the engine sends after 15 min DOWN.`}
        people={[{ name: reminder.to, role: reminder.role, channel: 'Chat @mention with the draft + email' }]}
        cta="Send reminder"
        ctaIcon={<IconMail />}
        pending={pending}
        error={error}
        phone={phone}
        onConfirm={send}
      />
    </>
  );
}

function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  people,
  cta,
  ctaIcon,
  pending,
  error,
  phone,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  people: { name: string; role: string; channel: string }[];
  cta: string;
  ctaIcon: React.ReactElement;
  pending: boolean;
  error: string | null;
  phone: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <div
          className={phone ? 'flex w-full flex-col gap-2' : 'flex w-full items-center justify-between gap-3'}
        >
          {!phone && <span className="text-xs text-fg-secondary">Sent at once · logged</span>}
          <div className={phone ? 'grid grid-cols-2 gap-2' : 'flex gap-2'}>
            <Button variant="secondary" fullWidth={phone} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" fullWidth={phone} icon={ctaIcon} loading={pending} onClick={onConfirm}>
              {cta}
            </Button>
          </div>
          {phone && (
            <span className="text-center text-xs text-fg-secondary">
              Sent at once · logged in the audit log
            </span>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {people.map((p) => (
            <li key={`${p.name}-${p.role}`} className="text-sm">
              <span className="font-medium">{p.name}</span>
              {` · ${p.role} — ${p.channel}`}
            </li>
          ))}
        </ul>
        {error && (
          <Alert tone="danger" title="Not sent">
            {error}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
