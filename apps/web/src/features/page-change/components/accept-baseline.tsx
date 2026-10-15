'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Dialog, TextField, toast } from '@jirawatpyk/aura-react';
import { IconCheck, IconLock } from '@jirawatpyk/aura-react/icons';
import { formatTime, formatTimeWithSeconds } from '@dxt/shared';
import { UndoLine } from '@/components/undo-line';
import { acceptBaseline, undoBaseline } from '../actions';
import type { ChangeRowView } from '../model';

const FAILED = 'Couldn’t reach the server. Check your connection and try again.';

/**
 * "A new script domain usually means injected code. Accept only if you know the client added it." — with
 * the domains themselves, so nobody accepts one they never saw (security review, 15 Oct).
 */
export function NewScriptWarning({ domains = [] }: { domains?: readonly string[] }) {
  return (
    <Alert tone="danger" title="A new script domain usually means injected code.">
      Accept only if you know the client added it.
      {domains.length > 0 && ` New: ${domains.join(', ')}.`}
    </Alert>
  );
}

/** The hint other roles see where the button would be (§26.5, Tao 13 Oct: Admin only). */
export function AdminOnlyHint() {
  return (
    <span className="flex min-h-11 items-center gap-2 text-sm text-fg-secondary">
      <IconLock aria-hidden />
      Only an Admin can accept a new baseline
    </span>
  );
}

/** The dialog's "What changes in the baseline": the after-values (§26.5). */
function afterLines(rows: readonly ChangeRowView[]): { label: string; text: string }[] {
  return rows.map((r) => ({
    label: r.label,
    text:
      r.kind === 'text'
        ? (r.now ?? '(none)')
        : [...r.added.map((d) => `+ ${d}`), ...r.removed.map((d) => `− ${d}`)].join(', '),
  }));
}

/**
 * Accept as new baseline (spec §26.5–§26.6): the secondary button, its dialog (Reason required, focus
 * in it; danger with a new script domain), then the toast with Undo · 10 s — the new baseline applies
 * only when the window closes, so the toast says nothing is sent.
 */
export function AcceptBaseline({
  checkId,
  monitorId,
  siteName,
  description,
  rows,
  newScript,
  nextFetchAt,
  viewerName,
}: {
  checkId: string;
  monitorId: string;
  siteName: string;
  /** "INC-0157 · Bangkok Airways – Taiwan · home page /" */
  description: string;
  rows: readonly ChangeRowView[];
  newScript: readonly string[];
  nextFetchAt: string | null;
  viewerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const danger = newScript.length > 0;

  const confirm = () => {
    if (!reason.trim()) {
      setError('Type a reason — it goes in the audit log with the change');
      return;
    }
    startTransition(async () => {
      const result = await acceptBaseline({ checkId, reason }).catch(() => ({
        ok: false as const,
        message: FAILED,
      }));
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      const toastId = `baseline-${monitorId}`;
      const applies = new Date(result.appliesAt);
      const done = `Applied ${formatTimeWithSeconds(applies)}${nextFetchAt ? ` · next check ${formatTime(new Date(nextFetchAt))}` : ''}`;
      // §26.6: once the window closes the toast says it applied, with its own title.
      // The page redraws too: nothing else tells it the window closed (page_baselines isn't in Realtime).
      const applied = setTimeout(
        () => {
          toast.success(`Baseline updated — ${siteName} is OK on the next check`, {
            id: toastId,
            description: done,
            duration: 4000,
          });
          router.refresh();
        },
        Math.max(applies.getTime() - Date.now(), 0) + 500,
      );
      const onUndo = async () => {
        clearTimeout(applied);
        const undone = await undoBaseline(monitorId).catch(() => ({ ok: false as const, message: FAILED }));
        if (undone.ok) {
          toast({
            id: toastId,
            title: 'Undone — the baseline is unchanged',
            description: 'Nothing was changed or sent.',
          });
        } else {
          toast.error('Couldn’t undo the baseline', { id: toastId, description: undone.message });
        }
        // The card moves focus back to Accept once the refreshed page has it again (WCAG 2.4.3).
        router.refresh();
      };
      toast.success('Accepting as the new baseline', {
        id: toastId,
        description: (
          <UndoLine
            postsAt={result.appliesAt}
            onUndo={onUndo}
            words={{
              pending: (s) => `Applies in ${s} s — nothing changes until then`,
              done,
            }}
          />
        ),
        duration: Math.max(applies.getTime() - Date.now(), 0) + 500,
      });
      router.refresh();
    });
  };

  return (
    <>
      <Button
        data-accept-baseline
        variant="secondary"
        icon={<IconCheck />}
        // full width on phones (§26.5, MIncidentPageChange / MSite)
        className="max-md:w-full"
        loading={busy}
        onClick={() => {
          setReason('');
          setError(null);
          setOpen(true);
        }}
      >
        Accept as new baseline
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        size="md"
        title="Accept the current page as the new baseline?"
        description={description}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={danger ? 'danger' : 'primary'}
              loading={busy}
              disabled={!reason.trim() || busy}
              onClick={confirm}
            >
              {busy ? 'Accepting…' : 'Accept as baseline'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {danger && <NewScriptWarning domains={newScript} />}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">What changes in the baseline</span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
              {afterLines(rows).map((l) => (
                <li key={l.label} className="break-words">
                  <span className="text-fg-secondary">{`${l.label}:`}</span> {l.text}
                </li>
              ))}
            </ul>
            <span className="text-xs text-fg-secondary">{`The other fields stay as they are. Logged in the audit log as ${viewerName}.`}</span>
          </div>
          <TextField
            label="Reason"
            required
            data-autofocus
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            placeholder="e.g. Client redesigned the home page (ticket #…)"
            hint="Required. Shown on the timeline and in the audit log."
            error={error ?? undefined}
          />
        </div>
      </Dialog>
    </>
  );
}
