'use client';

import { Alert, Badge, Button, Dialog, Select, TextField, Textarea } from '@jirawatpyk/aura-react';
import {
  IconArrowRight,
  IconBan,
  IconCheck,
  IconCircleCheck,
  IconInfo,
  IconMail,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import { ROLE_LABELS } from '@dxt/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { changeUserRole, deactivateUser, inviteUser, revokeInvite, setChatId } from '../actions';
import type { UsersResult } from '../mutations';
import {
  admins,
  blockedBy,
  EMAIL_SHAPE,
  gainsLoses,
  INVITE_HINTS,
  missingPicks,
  reassignPayload,
  STAFF_ROLES,
  usageOf,
  usageSummary,
  type Person,
  type Picks,
  type StaffRole,
  type Target,
  type UsersData,
} from '../model';

const FAILED = 'Couldn’t save. Check your connection and try again.';

/**
 * Runs an action: on success hands its result up and refreshes; a refusal stays in the dialog until
 * `key` changes (the dialog reopens, or opens for someone else) — never carried to the next one.
 */
function useSubmit(onDone: (r: Extract<UsersResult, { ok: true }>) => void, key: string) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setError(null);
  }
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<UsersResult>) =>
    start(async () => {
      setError(null);
      const r = await fn().catch((): UsersResult => ({ ok: false, message: FAILED }));
      if (!r.ok) {
        setError(r.message);
        // The page moved on (a site saved, a person gone): show what's there now.
        if (r.stale) router.refresh();
        return;
      }
      onDone(r);
      router.refresh();
    });
  return { error, pending, run };
}

function Refusal({ error }: { error: string | null }) {
  return error ? (
    <Alert tone="danger" role="alert">
      {error}
    </Alert>
  ) : null;
}

/** "Logged in the audit log" left of the buttons (Users board dialogs). */
function Foot({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <span className="grow text-xs text-fg-secondary">Logged in the audit log</span>
      {children}
    </div>
  );
}

const roleOptions = (roles: readonly StaffRole[]) => roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

// ── Invite ─────────────────────────────────────────────────────────────────────────────────────────

/** Add a primary Google address to the access list (D-007, D-062 item 2): no link, no expiry. */
export function InviteDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (line: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('responder');
  const [tried, setTried] = useState(false);
  const { error, pending, run } = useSubmit((r) => {
    const address = email.trim().toLowerCase();
    onDone(
      r.outcome === 'reactivated'
        ? `${address} has access again as ${ROLE_LABELS[role]} · logged`
        : `Added ${address} as ${ROLE_LABELS[role]} · shows here once they sign in · logged`,
    );
    setEmail('');
    setTried(false);
  }, String(open));
  const shapeOk = EMAIL_SHAPE.test(email.trim());
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add someone to Monitor"
      description="They sign in with their DxT Google account. Adding them to the access list is the invite — no email or link is sent."
      footer={
        <Foot>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={<IconMail />}
            loading={pending}
            onClick={() => {
              if (!shapeOk) return setTried(true);
              run(() => inviteUser({ email: email.trim(), role }));
            }}
          >
            Add to access list
          </Button>
        </Foot>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="Primary Google address"
          type="email"
          autoComplete="off"
          placeholder="name@company"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint="The person’s primary Google address — not a DxT alias."
          error={tried && !shapeOk ? 'Enter their primary Google address, e.g. name@company' : undefined}
          required
        />
        <div className="flex flex-col gap-1.5">
          <Select
            label="Role"
            options={roleOptions(STAFF_ROLES)}
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
          />
          <span className="text-xs text-fg-secondary">{INVITE_HINTS[role]}</span>
        </div>
        <Alert tone="info" title="Before they sign in">
          Ask them to open their Google account’s 2-Step Verification page and check it says it’s on and
          required by DxT. Google enforces it; Monitor doesn’t check.
        </Alert>
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}

// ── Revoke ─────────────────────────────────────────────────────────────────────────────────────────

export function RevokeDialog({
  email,
  isAdmin,
  onClose,
  onDone,
}: {
  email: string | null;
  isAdmin: boolean;
  onClose: () => void;
  onDone: (line: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const { error, pending, run } = useSubmit(() => {
    onDone(`${email} removed from the access list · logged`);
    setReason('');
    setTried(false);
  }, email ?? '');
  return (
    <Dialog
      open={!!email}
      onClose={onClose}
      title={`Remove ${email ?? ''} from the access list?`}
      description="They can no longer sign in with this address. Nothing else changes."
      footer={
        <Foot>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={() => {
              if (!reason.trim()) return setTried(true);
              run(() => revokeInvite({ email: email ?? '', reason }));
            }}
          >
            Remove
          </Button>
        </Foot>
      }
    >
      <div className="flex flex-col gap-4">
        {isAdmin && (
          <Alert tone="warning">
            They were added as an Admin. Add another Admin afterwards so monitor-fault alerts don’t depend on
            one person.
          </Alert>
        )}
        <Textarea
          label="Reason"
          placeholder="e.g. Wrong address — adding the right person"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={tried && !reason.trim() ? 'Add a short reason — it goes in the audit log' : undefined}
          rows={2}
          required
        />
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}

// ── Change role / Deactivate (one dialog, §14.9) ──────────────────────────────────────────────────

export function RoleDialog({
  data,
  person,
  mode,
  now,
  onClose,
  onDone,
}: {
  data: UsersData;
  person: Person | null;
  mode: 'role' | 'deactivate';
  now: Date;
  onClose: () => void;
  onDone: (line: string) => void;
}) {
  const current = person?.role ?? 'viewer';
  const choices = STAFF_ROLES.filter((r) => r !== current);
  const [newRole, setNewRole] = useState<StaffRole>(choices[choices.length - 1] ?? 'viewer');
  const [picks, setPicks] = useState<Picks>({});
  const [tried, setTried] = useState(false);
  // A different person or mode starts afresh (derive-from-props, S15).
  // Keyed by the role too: reopened after a change, the dialog starts from the role they have now.
  const key = `${person?.id}:${person?.role}:${mode}`;
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    const next = STAFF_ROLES.filter((r) => r !== (person?.role ?? 'viewer'));
    setNewRole(person?.role === 'responder' ? 'viewer' : (next[0] ?? 'viewer'));
    setPicks({});
    setTried(false);
  }
  const deact = mode === 'deactivate';
  const target: Target = deact ? 'deactivated' : newRole;
  const items = person ? usageOf(data, person.id, target, now) : [];
  const missing = missingPicks(items, picks);
  const blocked = blockedBy(items);
  const { gains, loses } = gainsLoses(current, newRole);
  const { error, pending, run } = useSubmit(
    () =>
      onDone(
        deact
          ? `${person?.name} deactivated · reassignments applied · logged`
          : `${person?.name} is now ${ROLE_LABELS[newRole]} · reassignments applied · logged`,
      ),
    key,
  );
  if (!person) return <Dialog open={false} onClose={onClose} title="" />;
  const setPick = (key: string, value: string) => setPicks((p) => ({ ...p, [key]: value }));
  const save = () => {
    if (missing.length || blocked.length) return setTried(true);
    const reassign = reassignPayload(picks);
    run(() =>
      deact
        ? deactivateUser({ userId: person.id, reassign })
        : changeUserRole({ userId: person.id, role: newRole, reassign }),
    );
  };
  const secondAdmin = !deact && newRole === 'admin' && admins(data).length === 1;
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={deact ? `Deactivate ${person.name}?` : `Change ${person.name}’s role`}
      description={
        deact
          ? `${person.name} loses access at once — every device is signed out — and stops getting alerts and digests. Past acknowledgements and notes stay in the audit log; an Admin can give access back by adding them again.`
          : 'Takes effect as soon as you confirm.'
      }
      footer={
        <Foot>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={deact ? 'danger' : 'primary'}
            icon={deact ? <IconBan /> : <IconCheck />}
            loading={pending}
            disabled={blocked.length > 0}
            onClick={save}
          >
            {deact ? `Deactivate ${person.name}` : `Change to ${ROLE_LABELS[newRole]}`}
          </Button>
        </Foot>
      }
    >
      <div className="flex flex-col gap-5">
        {!deact && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-fg-secondary">Current role</span>
                <Badge tone="neutral" variant="outline">
                  {ROLE_LABELS[current]}
                </Badge>
              </div>
              <IconArrowRight aria-hidden className="mb-1 text-fg-tertiary" />
              <div className="min-w-48">
                <Select
                  label="New role"
                  options={roleOptions(choices)}
                  value={newRole}
                  onChange={(e) => {
                    setNewRole(e.target.value as StaffRole);
                    setPicks({});
                    setTried(false);
                  }}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <List title="GAINS" items={gains} empty="Nothing new" />
              <List title="LOSES" items={loses} empty="Nothing" />
            </div>
            {secondAdmin && (
              <Alert tone="info" title="Adds a second active Admin">
                Monitor-fault emails go to {admins(data)[0]?.name} and {person.name} from now on.
              </Alert>
            )}
          </>
        )}
        <section className="flex flex-col gap-3" aria-label="Used in">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="m-0 font-mono text-xs text-fg-tertiary">USED IN</h3>
            <span className="text-xs text-fg-secondary">{usageSummary(items)}</span>
          </div>
          {items.length === 0 && (
            <p className="m-0 text-sm text-fg-secondary">
              Not used in any site, client or on-call shift — nothing to reassign.
            </p>
          )}
          {items.map((i) => (
            <div
              key={i.key}
              className={`flex flex-col gap-3 rounded-aura-md border p-3 ${
                i.need || i.warn ? 'border-alert-warning-border bg-alert-warning-bg' : 'border-border-default'
              }`}
            >
              <div className="flex gap-2">
                <span className={i.need || i.warn ? 'text-alert-warning-fg' : 'text-fg-secondary'}>
                  {i.need || i.warn ? (
                    <IconTriangleAlert size="sm" aria-hidden />
                  ) : i.info ? (
                    <IconInfo size="sm" aria-hidden />
                  ) : (
                    <IconCircleCheck size="sm" aria-hidden />
                  )}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold">{i.label}</span>
                  <span className="text-xs leading-normal text-fg-secondary">{i.detail}</span>
                </div>
              </div>
              {i.sites && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-fg-secondary">
                    Pick per site. Owner and backup must be different people, so each list leaves out the
                    person already on that site.
                  </span>
                  {i.sites.map((s) => (
                    <Select
                      key={s.key}
                      label={s.site}
                      hint={s.hint}
                      placeholder="Pick a person"
                      options={s.options}
                      value={picks[s.key] ?? ''}
                      onChange={(e) => setPick(s.key, e.target.value)}
                      error={tried && !picks[s.key] ? 'Pick a person' : undefined}
                    />
                  ))}
                </div>
              )}
              {i.pick && (
                <Select
                  label={i.pick.label}
                  placeholder="Pick a person"
                  options={i.pick.options}
                  value={picks[i.pick.key] ?? ''}
                  onChange={(e) => setPick(i.pick!.key, e.target.value)}
                  error={tried && !picks[i.pick.key] ? 'Pick who takes this over' : undefined}
                />
              )}
            </div>
          ))}
        </section>
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}

function List({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-xs text-fg-tertiary">{title}</span>
      {items.length ? (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <span className="text-sm text-fg-secondary">{empty}</span>
      )}
    </div>
  );
}

// ── Edit Chat id (D-015, D-062 item 6) ────────────────────────────────────────────────────────────

export function ChatIdDialog({
  person,
  onClose,
  onDone,
}: {
  person: Person | null;
  onClose: () => void;
  onDone: (line: string) => void;
}) {
  const [value, setValue] = useState('');
  const [seen, setSeen] = useState(person?.id);
  if (seen !== person?.id) {
    setSeen(person?.id);
    setValue('');
  }
  const { error, pending, run } = useSubmit(
    () => onDone(`${person?.name}’s Chat id ${value.trim() ? 'saved' : 'cleared'} · logged`),
    person?.id ?? '',
  );
  const digits = /^\d*$/.test(value.trim());
  // Empty clears an id; with none to clear there is nothing to save (and nothing would be logged).
  const nothing = !value.trim() && !person?.chatLinked;
  return (
    <Dialog
      open={!!person}
      onClose={onClose}
      title={`${person?.name ?? ''}’s Google Chat id`}
      description={
        person?.chatLinked
          ? 'They have one. A new id replaces it; leave it empty to clear it.'
          : 'Owners and backups need one: alerts @mention them in Chat by it.'
      }
      footer={
        <Foot>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={!digits || nothing}
            onClick={() => person && run(() => setChatId({ userId: person.id, chatId: value.trim() }))}
          >
            Save
          </Button>
        </Foot>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="Chat user id"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          hint="Digits only. In Google Chat, open the person’s profile in the Alerts Space; the number after users/ in its link is the id."
          error={digits ? undefined : 'A Chat user id is digits only'}
        />
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}
