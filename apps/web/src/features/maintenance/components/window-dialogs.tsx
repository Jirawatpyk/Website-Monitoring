'use client';

import { Alert, Button, Dialog, Select, TextField, toast } from '@jirawatpyk/aura-react';
import { IconCheck, IconTrash2 } from '@jirawatpyk/aura-react/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { UndoLine } from '@/components/undo-line';
import {
  approveMaintenance,
  cancelWindow,
  declineMaintenance,
  editWindowEnd,
  endWindowEarly,
  postWindowActionNow,
  undoWindowAction,
  withdrawRequest,
} from '../actions';
import {
  approveEffects,
  approveTitle,
  cancelText,
  declineHint,
  dialogDescription,
  endChoices,
  endEffects,
  noun,
  PROBLEM_WORDS_UNCHANGED,
  WITHDRAW_ONLY,
  type PageRow,
} from '../page-model';

const FAILED = 'Couldn’t save. Check your connection and try again.';
const UNDO_FAILED = 'Couldn’t reach the server. Check your connection and try again.';
const HINT = 'Shown in the audit log.';
const hintFor = (reason: string) => (reason.trim() ? HINT : `Required — type a reason to continue. ${HINT}`);

type Result = { ok: true; postsAt?: string } | { ok: false; message: string };

interface Held {
  windowId: string;
  title: string;
  site: string;
  chatOnly?: boolean;
}

/** The one action still inside its 10 s on this page (§24.12). */
let pending: (Held & { postsAt: string }) | null = null;
const channelsOf = (h: Held) => (h.chatOnly ? 'Chat' : 'Chat and email');

/**
 * Starting another action, or opening a row or a dialog, while one is still pending posts the pending
 * one at once (§24.12): it gets its posting time and can no longer be undone.
 */
export async function postPendingNow(): Promise<void> {
  const p = pending;
  pending = null;
  if (!p || Date.parse(p.postsAt) <= Date.now()) return;
  const r = await postWindowActionNow({ windowId: p.windowId }).catch(() => null);
  if (r?.ok) {
    toast.success(p.title, {
      id: `window-${p.windowId}`,
      description: `Posted to ${channelsOf(p)}.`,
      duration: Infinity,
    });
  }
}

/** A dialog that opens posts the pending action first (§24.12). */
function usePostPendingOnOpen(open: boolean) {
  useEffect(() => {
    if (open) void postPendingNow();
  }, [open]);
}

interface DialogProps {
  p: PageRow;
  now: Date;
  open: boolean;
  /** Back / Keep it / Close: to the phone sheet it came from, or closed. */
  onClose: () => void;
  /** After the action went through (the page refreshes). Defaults to onClose. */
  onDone?: () => void;
  /** After its Undo went through: where focus goes once the row is back (spec-check). */
  onUndone?: (p: PageRow) => void;
}

/**
 * Runs an action, refreshes the page and closes; a refusal shows as the dialog's alert (not a field
 * error). A held action (§24.8) then counts down its 10 s in a toast with Undo, like Acknowledge.
 */
function useSubmit(onDone: () => void, onUndone?: () => void) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, held?: Held) =>
    start(async () => {
      setError(null);
      await postPendingNow();
      const r = await fn().catch(() => ({ ok: false as const, message: FAILED }));
      if (!r.ok) {
        setError(r.message);
        return;
      }
      onDone();
      router.refresh();
      if (held && r.postsAt)
        showUndo(held, r.postsAt, () => {
          onUndone?.();
          router.refresh();
        });
    });
  return { error, pending, run };
}

/**
 * The toast of a held maintenance action: "Posting to Chat and email in N s" with Undo (§24.8) — Chat
 * only for a mute (D-037).
 */
function showUndo(held: Held, postsAt: string, undone: () => void) {
  const { windowId, title, site, chatOnly } = held;
  const id = `window-${windowId}`;
  pending = { ...held, postsAt };
  const onUndo = async () => {
    const r = await undoWindowAction({ windowId }).catch(() => ({
      ok: false as const,
      message: UNDO_FAILED,
    }));
    if (r.ok) {
      if (pending?.windowId === windowId) pending = null;
      toast({ id, title: `${title} — undone`, description: 'Nothing was posted.', duration: 4000 });
      undone();
    } else {
      toast.error(`Couldn’t undo · ${site}`, { id, description: r.message });
    }
  };
  toast.success(title, {
    id,
    description: (
      <UndoLine postsAt={postsAt} onUndo={onUndo} channels={chatOnly ? 'Chat' : 'Chat and email'} />
    ),
    // "Posted to …" stays until dismissed; × only hides the toast — the action still posts (§24.12).
    duration: Infinity,
  });
}

function Refusal({ error }: { error: string | null }) {
  return error ? (
    <Alert tone="danger" role="alert">
      {error}
    </Alert>
  ) : null;
}

/** End now (board MaintenancePage): its effects, a required reason, "End mute now" / "End maintenance now". */
export function EndDialog({
  p,
  viewer,
  now,
  open,
  onClose,
  onDone = onClose,
  onUndone,
}: DialogProps & { viewer: string }) {
  const [reason, setReason] = useState('');
  const { error, pending, run } = useSubmit(onDone, onUndone && (() => onUndone(p)));
  usePostPendingOnOpen(open);
  const r = p.row;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      dismissOnScrim={false}
      title={`End ${r.siteName} ${noun(r.kind)} now?`}
      description={dialogDescription(r, now)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="primary"
            disabled={!reason.trim()}
            loading={pending}
            onClick={() =>
              run(() => endWindowEarly({ windowId: r.id, reason }), {
                windowId: r.id,
                title: `${r.siteName} ${noun(r.kind)} ended`,
                site: r.siteName,
                chatOnly: r.kind === 'mute' && !r.silenced,
              })
            }
          >
            {r.kind === 'mute' ? 'End mute now' : 'End maintenance now'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="m-0 flex flex-col gap-1.5 pl-4 text-sm">
          {endEffects(r, viewer, now).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <TextField
          touchHeight
          label="Reason for ending early"
          required
          placeholder="e.g. Upgrade finished early"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint={hintFor(reason)}
        />
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}

/**
 * Edit end (running), Edit / cancel (scheduled), Edit / withdraw (a request) — one dialog: a new end and a
 * reason, or the cancel / withdraw step (§23.5). On phones the cancel step has its own full-width row.
 */
export function EditDialog({
  p,
  viewer,
  now,
  open,
  onClose,
  onDone = onClose,
  onUndone,
}: DialogProps & { viewer: string }) {
  const r = p.row;
  const choices = endChoices(r, now);
  const current = choices.find((c) => c.label.endsWith('(current)'))?.value ?? r.endsAt;
  const [end, setEnd] = useState(current);
  const [reason, setReason] = useState('');
  const request = p.state === 'waiting';
  // The asker who no longer owns the site: straight to the withdraw step, no end to edit.
  const withdrawOnly = request && p.editLabel === WITHDRAW_ONLY;
  const [cancelling, setCancelling] = useState(withdrawOnly);
  const { error, pending, run } = useSubmit(onDone, onUndone && (() => onUndone(p)));
  usePostPendingOnOpen(open);
  const running = p.state === 'active';
  const cancelWord = request ? 'Withdraw request' : 'Cancel maintenance';
  const title = running
    ? `Change end · ${r.siteName} ${noun(r.kind)}`
    : request
      ? `Edit or withdraw · ${r.siteName} request`
      : `Edit or cancel · ${r.siteName} maintenance`;
  const submit = () =>
    run(
      () =>
        cancelling
          ? request
            ? withdrawRequest({ windowId: r.id, reason })
            : cancelWindow({ windowId: r.id, reason })
          : editWindowEnd({ windowId: r.id, endsAt: end, reason }),
      {
        windowId: r.id,
        site: r.siteName,
        chatOnly: r.kind === 'mute',
        title: cancelling
          ? `${r.siteName} ${request ? 'request withdrawn' : 'maintenance cancelled'}`
          : `${r.siteName} ${noun(r.kind)} end changed`,
      },
    );
  const cancelButton = (fullWidth: boolean) => (
    <Button variant="ghost" icon={<IconTrash2 />} fullWidth={fullWidth} onClick={() => setCancelling(true)}>
      {`${cancelWord}…`}
    </Button>
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      dismissOnScrim={false}
      title={title}
      description={dialogDescription(r, now)}
      footer={
        // Plain footer children, as the other dialogs: AURA stacks them full width on phones.
        <>
          {!cancelling && !running && <span className="mr-auto max-md:hidden">{cancelButton(false)}</span>}
          <Button
            variant="secondary"
            onClick={() => (cancelling && !withdrawOnly ? setCancelling(false) : onClose())}
          >
            {cancelling && !withdrawOnly ? 'Back' : 'Close'}
          </Button>
          <Button
            variant="primary"
            disabled={!reason.trim() || (!cancelling && end === current)}
            loading={pending}
            onClick={submit}
          >
            {cancelling ? cancelWord : 'Save end time'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!cancelling && (
          <Select
            touchHeight
            label="Ends"
            options={choices}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            // Why "Save end time" is off once a reason is typed (§14.16).
            hint={end === current && reason.trim() ? PROBLEM_WORDS_UNCHANGED : undefined}
          />
        )}
        <TextField
          touchHeight
          label="Reason for the change"
          required
          placeholder="e.g. Client moved the launch"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint={hintFor(reason)}
        />
        {!cancelling && !running && <span className="md:hidden">{cancelButton(true)}</span>}
        {cancelling && (
          <Alert tone="warning" role="alert" title={`${cancelWord}?`}>
            {cancelText(r, p.state, viewer)}
          </Alert>
        )}
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}

/** Approve a request (Admin): what approving means, "Not now" / "Approve". */
export function ApproveDialog({
  p,
  viewer,
  now,
  open,
  onClose,
  onDone = onClose,
  onUndone,
}: DialogProps & { viewer: string }) {
  const { error, pending, run } = useSubmit(onDone, onUndone && (() => onUndone(p)));
  usePostPendingOnOpen(open);
  const r = p.row;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      dismissOnScrim={false}
      title={approveTitle(r)}
      description={dialogDescription(r, now)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
          <Button
            variant="primary"
            icon={<IconCheck />}
            loading={pending}
            // The end the Admin is looking at: a request changed meanwhile is refused (security review M2).
            onClick={() =>
              run(() => approveMaintenance({ windowId: r.id, endsAt: r.endsAt }), {
                windowId: r.id,
                title: `${r.siteName} maintenance approved`,
                site: r.siteName,
              })
            }
          >
            Approve
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="m-0 flex flex-col gap-1.5 pl-4 text-sm">
          {approveEffects(r, viewer, now).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}

/** Decline a request with a reason (Admin) → Recent "Declined". */
export function DeclineDialog({
  p,
  viewer,
  now,
  open,
  onClose,
  onDone = onClose,
  onUndone,
}: DialogProps & { viewer: string }) {
  const [reason, setReason] = useState('');
  const { error, pending, run } = useSubmit(onDone, onUndone && (() => onUndone(p)));
  usePostPendingOnOpen(open);
  const r = p.row;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      dismissOnScrim={false}
      title={`Decline ${r.byName ? `${r.byName}’s` : 'this'} request?`}
      description={dialogDescription(r, now)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="primary"
            disabled={!reason.trim()}
            loading={pending}
            onClick={() =>
              run(() => declineMaintenance({ windowId: r.id, reason }), {
                windowId: r.id,
                title: `${r.siteName} request declined`,
                site: r.siteName,
              })
            }
          >
            Decline request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          touchHeight
          label="Reason"
          required
          placeholder="e.g. Split it into two nights"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint={declineHint(r, viewer)}
        />
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}
