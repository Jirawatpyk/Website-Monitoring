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
  type PageRow,
} from '../page-model';

const FAILED = 'Couldn’t save. Check your connection and try again.';
const HINT = 'Shown in the audit log.';
const hintFor = (reason: string) => (reason.trim() ? HINT : `Required — type a reason to continue. ${HINT}`);

type Result = { ok: true } | { ok: false; message: string };

/** Runs an action, refreshes the page and closes; a refusal stays on the dialog's reason field. */
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

/** End now (board MaintenancePage): its effects, a required reason, "End mute now" / "End maintenance now". */
export function EndDialog({
  p,
  viewer,
  now,
  open,
  onClose,
}: {
  p: PageRow;
  viewer: string;
  now: Date;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const { error, pending, run } = useSubmit(onClose);
  const r = p.row;
  const cta = r.kind === 'mute' ? 'End mute now' : 'End maintenance now';
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
            {cta}
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
          error={error ?? undefined}
        />
      </div>
    </Dialog>
  );
}

/**
 * Edit end (running), Edit / cancel (scheduled), Edit / withdraw (a request) — one dialog: a new end and a
 * reason, or the cancel / withdraw step (§23.5).
 */
export function EditDialog({
  p,
  viewer,
  now,
  open,
  onClose,
}: {
  p: PageRow;
  viewer: string;
  now: Date;
  open: boolean;
  onClose: () => void;
}) {
  const r = p.row;
  const choices = endChoices(r, now);
  const current = choices.find((c) => c.label.endsWith('(current)'))?.value ?? r.endsAt;
  const [end, setEnd] = useState(current);
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const { error, pending, run } = useSubmit(onClose);
  const running = p.state === 'active';
  const request = p.state === 'waiting';
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
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      autoFocus={false}
      title={title}
      description={dialogDescription(r, now)}
      footer={
        <span className="flex w-full flex-wrap items-center gap-3">
          {!cancelling && !running && (
            <Button variant="ghost" icon={<IconTrash2 />} onClick={() => setCancelling(true)}>
              {`${cancelWord}…`}
            </Button>
          )}
          <span className="grow" />
          <Button variant="secondary" onClick={() => (cancelling ? setCancelling(false) : onClose())}>
            {cancelling ? 'Back' : 'Close'}
          </Button>
          <Button
            variant="primary"
            disabled={!reason.trim() || (!cancelling && end === current)}
            loading={pending}
            onClick={submit}
          >
            {cancelling ? cancelWord : 'Save end time'}
          </Button>
        </span>
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
          error={error ?? undefined}
        />
        {cancelling && (
          <Alert tone="warning" role="alert" title={`${cancelWord}?`}>
            {cancelText(p.state, viewer)}
          </Alert>
        )}
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
}: {
  p: PageRow;
  viewer: string;
  now: Date;
  open: boolean;
  onClose: () => void;
}) {
  const { error, pending, run } = useSubmit(onClose);
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
            onClick={() => run(() => approveMaintenance({ windowId: r.id }))}
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
        {error && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}

/** Decline a request with a reason (Admin) → Recent "Declined". */
export function DeclineDialog({
  p,
  now,
  open,
  onClose,
}: {
  p: PageRow;
  now: Date;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const { error, pending, run } = useSubmit(onClose);
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
      <TextField
        touchHeight
        label="Reason"
        required
        placeholder="e.g. Split it into two nights"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="Required. The request moves to Recent as Declined."
        error={error ?? undefined}
      />
    </Dialog>
  );
}
