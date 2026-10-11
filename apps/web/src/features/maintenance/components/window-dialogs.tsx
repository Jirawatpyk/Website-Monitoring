'use client';

import { Alert, Button, Dialog, Select, TextField } from '@jirawatpyk/aura-react';
import { IconCheck, IconTrash2 } from '@jirawatpyk/aura-react/icons';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  approveMaintenance,
  cancelWindow,
  declineMaintenance,
  editWindowEnd,
  endWindowEarly,
  withdrawRequest,
} from '../actions';
import {
  approveEffects,
  approveTitle,
  cancelText,
  dialogDescription,
  endChoices,
  endEffects,
  noun,
  WITHDRAW_ONLY,
  type PageRow,
} from '../page-model';

const FAILED = 'Couldn’t save. Check your connection and try again.';
const HINT = 'Shown in the audit log.';
const hintFor = (reason: string) => (reason.trim() ? HINT : `Required — type a reason to continue. ${HINT}`);

type Result = { ok: true } | { ok: false; message: string };

interface DialogProps {
  p: PageRow;
  now: Date;
  open: boolean;
  /** Back / Keep it / Close: to the phone sheet it came from, or closed. */
  onClose: () => void;
  /** After the action went through (the page refreshes). Defaults to onClose. */
  onDone?: () => void;
}

/** Runs an action, refreshes the page and closes; a refusal shows as the dialog's alert (not a field error). */
function useSubmit(onDone: () => void) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      setError(null);
      const r = await fn().catch(() => ({ ok: false as const, message: FAILED }));
      if (!r.ok) {
        setError(r.message);
        return;
      }
      onDone();
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

/** End now (board MaintenancePage): its effects, a required reason, "End mute now" / "End maintenance now". */
export function EndDialog({
  p,
  viewer,
  now,
  open,
  onClose,
  onDone = onClose,
}: DialogProps & { viewer: string }) {
  const [reason, setReason] = useState('');
  const { error, pending, run } = useSubmit(onDone);
  const r = p.row;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      autoFocus={false}
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
            onClick={() => run(() => endWindowEarly({ windowId: r.id, reason }))}
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
  const { error, pending, run } = useSubmit(onDone);
  const running = p.state === 'active';
  const cancelWord = request ? 'Withdraw request' : 'Cancel maintenance';
  const title = running
    ? `Change end · ${r.siteName} ${noun(r.kind)}`
    : request
      ? `Edit or withdraw · ${r.siteName} request`
      : `Edit or cancel · ${r.siteName} maintenance`;
  const submit = () =>
    run(() =>
      cancelling
        ? request
          ? withdrawRequest({ windowId: r.id, reason })
          : cancelWindow({ windowId: r.id, reason })
        : editWindowEnd({ windowId: r.id, endsAt: end, reason }),
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
      autoFocus={false}
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
            {cancelText(p.state, viewer)}
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
}: DialogProps & { viewer: string }) {
  const { error, pending, run } = useSubmit(onDone);
  const r = p.row;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      autoFocus={false}
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
            onClick={() => run(() => approveMaintenance({ windowId: r.id, endsAt: r.endsAt }))}
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
export function DeclineDialog({ p, now, open, onClose, onDone = onClose }: DialogProps) {
  const [reason, setReason] = useState('');
  const { error, pending, run } = useSubmit(onDone);
  const r = p.row;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      autoFocus={false}
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
            onClick={() => run(() => declineMaintenance({ windowId: r.id, reason }))}
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
          hint="Required. The request moves to Recent as Declined."
        />
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}
