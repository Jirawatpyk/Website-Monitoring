'use client';

import { Alert, Button, Dialog, Select, TextField, Textarea } from '@jirawatpyk/aura-react';
import {
  IconArrowRight,
  IconBan,
  IconCheck,
  IconCircleCheck,
  IconInfo,
  IconMinus,
  IconPlus,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import { ROLE_LABELS, type Role } from '@dxt/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  changeUserRole,
  deactivateUser,
  inviteUser,
  revokeInvite,
  setChatId,
  setManagement,
} from '../actions';
import type { UsersResult } from '../mutations';
import {
  admins,
  blockedBy,
  EMAIL_SHAPE,
  changeDialogText,
  gainsLoses,
  INVITE_HINTS,
  managementDialog,
  managementRoleBox,
  type ManagementRow,
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
import { RoleBadge } from './role-badge';

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
        : `Added ${address} as ${ROLE_LABELS[role]} · they can sign in now · logged`,
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
      description="They sign in with their DxT Google account. No email or link is sent — tell them yourself."
      footer={
        <Foot>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={<IconPlus />}
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
        <Select
          label="Role"
          options={roleOptions(STAFF_ROLES)}
          value={role}
          onChange={(e) => setRole(e.target.value as StaffRole)}
          hint={INVITE_HINTS[role]}
        />
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
  // Each refused Remove moves focus to the reason, after React has shown its error (staging /verify).
  const [refused, setRefused] = useState(0);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (refused > 0) reasonRef.current?.focus();
  }, [refused]);
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
              if (!reason.trim()) {
                setTried(true);
                setRefused((n) => n + 1);
                return;
              }
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
          ref={reasonRef}
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

/** The board's first pick (Users `openRole`): Responder ↔ Viewer, anyone else → Viewer — never Admin. */
const defaultTarget = (role: Role | undefined): StaffRole => (role === 'viewer' ? 'responder' : 'viewer');

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
  const [newRole, setNewRole] = useState<StaffRole>(defaultTarget(person?.role));
  const [picks, setPicks] = useState<Picks>({});
  const [tried, setTried] = useState(0);
  // A different person or mode starts afresh (derive-from-props, S15). Keyed by the role too:
  // reopened after a change, the dialog starts from the role they have now.
  const key = `${person?.id}:${person?.role}:${mode}`;
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setNewRole(defaultTarget(person?.role));
    setPicks({});
    setTried(0);
  }
  // A save with picks missing moves focus to the first one (apps/web CLAUDE.md, focus moves).
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tried) body.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [tried]);
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
  const setPick = (k: string, value: string) => setPicks((p) => ({ ...p, [k]: value }));
  const save = () => {
    if (missing.length || blocked.length) return setTried((n) => n + 1);
    const reassign = reassignPayload(picks);
    run(() =>
      deact
        ? deactivateUser({ userId: person.id, reassign })
        : changeUserRole({ userId: person.id, role: newRole, reassign }),
    );
  };
  const secondAdmin = !deact && newRole === 'admin' && admins(data).length === 1;
  // D-078 (§43.5): the tag leaves with the role; the last Management person can't go while a step uses it.
  const mgBox = managementRoleBox(data, person, deact, newRole);
  // Owners need a Chat id (D-015): the only pool that can be empty for that reason.
  const nobody = 'Nobody else can own this site — give an active Admin or Responder a Chat id first.';
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={deact ? `Deactivate ${person.name}?` : `Change ${person.name}’s role`}
      description={changeDialogText(person.name, deact, !!data.emailOn)}
      footer={
        <Foot>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={deact ? 'danger' : 'primary'}
            icon={deact ? <IconBan /> : <IconCheck />}
            loading={pending}
            disabled={blocked.length > 0 || !!mgBox?.blocks}
            onClick={save}
          >
            {deact ? `Deactivate ${person.name}` : `Change to ${ROLE_LABELS[newRole]}`}
          </Button>
        </Foot>
      }
    >
      <div ref={body} className="flex flex-col gap-5">
        {!deact && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-fg-secondary">Current role</span>
                <RoleBadge role={current} />
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
                    setTried(0);
                  }}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <List title="GAINS" sign="plus" items={gains} empty="Nothing new" />
              <List title="LOSES" sign="minus" items={loses} empty="Nothing" />
            </div>
            {secondAdmin && (
              <Alert tone="info" title="Adds a second active Admin">
                Monitor-fault emails go to {admins(data)[0]?.name} and {person.name} from now on.
              </Alert>
            )}
            {newRole === 'admin' && (
              // Users board `adminNote`: the tag is set on its own, never by a promotion.
              <p className="m-0 text-xs text-fg-secondary">
                {person.name} isn’t Management — set that separately from the ⋯ menu.
              </p>
            )}
          </>
        )}
        {mgBox && (
          <Alert tone={mgBox.blocks ? 'warning' : 'info'} title={mgBox.title}>
            {mgBox.lines.join(' ')}
          </Alert>
        )}
        <section className="flex flex-col gap-3" aria-labelledby="used-in-h">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="used-in-h" className="m-0 font-mono text-xs font-normal text-fg-tertiary">
              USED IN
            </h3>
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    {i.sites.map((s) => (
                      <Select
                        key={s.key}
                        label={s.site}
                        hint={s.options.length ? s.hint : nobody}
                        placeholder="Pick a person"
                        options={s.options}
                        value={picks[s.key] ?? ''}
                        onChange={(e) => setPick(s.key, e.target.value)}
                        error={tried && !picks[s.key] ? 'Pick a person' : undefined}
                        required
                      />
                    ))}
                  </div>
                </div>
              )}
              {i.pick && (
                <Select
                  label={i.pick.label}
                  placeholder="Pick a person"
                  options={i.pick.options}
                  value={picks[i.pick.key] ?? ''}
                  onChange={(e) => setPick(i.pick!.key, e.target.value)}
                  hint={i.pick.options.length ? undefined : i.pick.empty}
                  error={tried && !picks[i.pick.key] ? 'Pick who takes this over' : undefined}
                  required
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

function List({
  title,
  sign,
  items,
  empty,
}: {
  title: string;
  sign: 'plus' | 'minus';
  items: string[];
  empty: string;
}) {
  const Mark = sign === 'plus' ? IconPlus : IconMinus;
  return (
    <div className="flex flex-col gap-1.5 rounded-aura-md border border-border-default p-3">
      <span className="font-mono text-xs text-fg-tertiary">{title}</span>
      {items.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {items.map((t) => (
            <li key={t} className="flex gap-1.5">
              <Mark
                size="sm"
                aria-hidden
                className={`mt-0.5 shrink-0 ${sign === 'plus' ? 'text-fg-positive' : 'text-fg-danger'}`}
              />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-sm text-fg-secondary">{empty}</span>
      )}
    </div>
  );
}

// ── Edit Chat id (D-015, D-062 item 6) ────────────────────────────────────────────────────────────

/** The dialog's words about someone else (Users) or about you (Profile, D-062 items 6, 12). */
function chatIdWords(name: string, self: boolean, linked: boolean) {
  return self
    ? {
        title: 'Your Google Chat id',
        description: linked
          ? 'You have one. A new id replaces it.'
          : 'Alerts @mention you in Chat by it — owners and backups need one.',
        clearTitle: 'Clear your Chat id?',
        clearBody:
          'You stop getting @mentions in Chat. Sites you own or back up need an id, so this is refused while you own a live site.',
        hint: 'Digits only. In Google Chat, open your own profile in the Alerts Space; the number after users/ in its link is the id. Save unlocks once there is one.',
        done: (cleared: boolean) => `Your Chat id ${cleared ? 'cleared' : 'saved'} · logged`,
      }
    : {
        title: `${name}’s Google Chat id`,
        description: linked
          ? 'They have one. A new id replaces it.'
          : 'Owners and backups need one: alerts @mention them in Chat by it.',
        clearTitle: `Clear ${name}’s Chat id?`,
        clearBody: `${name} stops getting @mentions in Chat. Sites they own or back up need an id, so this is refused while they own a live site.`,
        hint: 'Digits only. In Google Chat, open the person’s profile in the Alerts Space; the number after users/ in its link is the id. Save unlocks once there is one.',
        done: (cleared: boolean) => `${name}’s Chat id ${cleared ? 'cleared' : 'saved'} · logged`,
      };
}

export function ChatIdDialog({
  person,
  self = false,
  onClose,
  onDone,
}: {
  person: Pick<Person, 'id' | 'name' | 'chatLinked'> | null;
  /** Your own id, from Profile: the words say "you". */
  self?: boolean;
  onClose: () => void;
  onDone: (line: string) => void;
}) {
  const w = chatIdWords(person?.name ?? '', self, !!person?.chatLinked);
  const [value, setValue] = useState('');
  // Clearing an id takes a second press that says what it does (§13: a confirm names the effect).
  const [clearing, setClearing] = useState(false);
  // Focus follows the confirm in and out (spec-checker pass 2); not on the dialog's first open.
  const [moved, setMoved] = useState(false);
  const [seen, setSeen] = useState(person?.id);
  if (seen !== person?.id) {
    setSeen(person?.id);
    setValue('');
    setClearing(false);
    setMoved(false);
  }
  const { error, pending, run } = useSubmit(() => onDone(w.done(clearing)), person?.id ?? '');
  const id = value.trim();
  const digits = /^\d*$/.test(id);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!moved) return;
    (clearing ? confirmRef : askRef).current?.focus();
  }, [clearing, moved]);
  return (
    <Dialog
      open={!!person}
      onClose={onClose}
      title={w.title}
      description={w.description}
      footer={
        <Foot>
          {person?.chatLinked && !clearing && (
            <Button
              ref={askRef}
              variant="ghost"
              onClick={() => {
                setMoved(true);
                setClearing(true);
              }}
            >
              Clear Chat id…
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={
              clearing
                ? () => {
                    setMoved(true);
                    setClearing(false);
                  }
                : onClose
            }
          >
            {clearing ? 'Keep it' : 'Cancel'}
          </Button>
          {clearing ? (
            <Button
              ref={confirmRef}
              variant="danger"
              loading={pending}
              onClick={() => person && run(() => setChatId({ userId: person.id, chatId: '' }))}
            >
              Clear Chat id
            </Button>
          ) : (
            <Button
              loading={pending}
              disabled={!id || !digits}
              onClick={() => person && run(() => setChatId({ userId: person.id, chatId: id }))}
            >
              Save
            </Button>
          )}
        </Foot>
      }
    >
      <div className="flex flex-col gap-4">
        {clearing ? (
          <Alert tone="warning" title={w.clearTitle}>
            {w.clearBody}
          </Alert>
        ) : (
          <TextField
            label="Chat user id"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            hint={w.hint}
            error={digits ? undefined : 'A Chat user id is digits only'}
          />
        )}
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}

// ── Management (D-078, spec §43.4) ──────────────────────────────────────────────────────────────────

/** Set as / remove from Management: what it does, a note for the audit log, one email to the person. */
export function ManagementDialog({
  data,
  person,
  onClose,
  onDone,
}: {
  data: UsersData;
  person: Person | null;
  onClose: () => void;
  onDone: (line: string) => void;
}) {
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [refused, setRefused] = useState(0);
  // A fresh note for each person and each set / remove (spec-checker M1); the last person keeps the
  // title while the dialog closes (L13).
  const key = person ? `${person.id}:${!!person.management}` : '';
  const [seen, setSeen] = useState(key);
  const [last, setLast] = useState<Person | null>(person);
  if (seen !== key) {
    setSeen(key);
    if (person) {
      setLast(person);
      setNote('');
      setTried(false);
    }
  }
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (refused > 0) noteRef.current?.focus();
  }, [refused]);
  const shown = person ?? last;
  const w = shown ? managementDialog(data, shown) : null;
  const on = !shown?.management;
  const { error, pending, run } = useSubmit(() => {
    if (w) onDone(w.done);
    setNote('');
    setTried(false);
  }, key);
  return (
    <Dialog
      open={!!person}
      onClose={onClose}
      size="md"
      title={w?.title ?? ''}
      description={w?.description}
      footer={
        w?.refuse ? (
          // §43.5: only the refusal, Open Escalation / Close
          <Foot>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" href="/escalation">
              Open Escalation
            </Button>
          </Foot>
        ) : (
          <Foot>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              // the board: primary + check for both — removing the tag destroys nothing (spec-checker L6)
              variant="primary"
              icon={<IconCheck />}
              loading={pending}
              onClick={() => {
                if (!note.trim()) {
                  setTried(true);
                  setRefused((n) => n + 1);
                  return;
                }
                if (person) run(() => setManagement({ userId: person.id, on, note }));
              }}
            >
              {on ? 'Set as Management' : 'Remove from Management'}
            </Button>
          </Foot>
        )
      }
    >
      {w?.refuse ? (
        <Alert tone="warning" role="alert">
          {w.refuse}
        </Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
            {w?.rows.map((r) => (
              <li key={r.text} className="flex gap-2">
                <span
                  className={`flex pt-0.5 ${r.icon === 'warn' ? 'text-alert-warning-fg' : 'text-fg-secondary'}`}
                >
                  {ROW_ICON[r.icon]}
                </span>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
          <Textarea
            ref={noteRef}
            label="Note"
            placeholder={w?.placeholder}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={tried && !note.trim() ? 'Add a short note — it goes in the audit log' : undefined}
            rows={2}
            required
          />
          <Refusal error={error} />
        </div>
      )}
    </Dialog>
  );
}

const ROW_ICON: Record<ManagementRow['icon'], React.ReactNode> = {
  plus: <IconPlus size="sm" aria-hidden />,
  minus: <IconMinus size="sm" aria-hidden />,
  info: <IconInfo size="sm" aria-hidden />,
  warn: <IconTriangleAlert size="sm" aria-hidden />,
};
