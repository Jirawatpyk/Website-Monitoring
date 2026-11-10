'use client';

import { Button, Dialog, TextField } from '@jirawatpyk/aura-react';
import { IconCheck } from '@jirawatpyk/aura-react/icons';
import { useState } from 'react';
import { cancelSeries, decideSeries } from '../actions';
import {
  approveSeriesEffects,
  declineSeriesEffects,
  endSeriesEffects,
  seriesDescription,
  seriesToast,
  type SeriesAction,
  type SeriesPageRow,
  type SeriesRow,
} from '../series-model';
import { hintFor, Refusal, useSubmit, usePostPendingOnOpen, type Held } from './window-dialogs';

/**
 * The series dialogs (MaintenancePage STATE › Approve series / Cancel series, MMaintenanceList; spec §32.6–7,
 * 7a): Approve, Decline, Cancel series and Withdraw — each held 10 s with Undo, like one window's actions.
 * Their words are `series-model.ts`'s.
 */

interface SeriesDialogProps {
  s: SeriesPageRow;
  viewer: string;
  now: Date;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
  onUndone?: () => void;
}

function Effects({ lines }: { lines: string[] }) {
  return (
    <ul className="m-0 flex flex-col gap-1.5 pl-4 text-sm">
      {lines.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

/** A series action's toast (§32 7a): series ids, the series RPCs, its own undone and too-late words. */
function held(r: SeriesRow, action: SeriesAction, windows: number): Held {
  const t = seriesToast(r, action, windows);
  return { windowId: r.id, series: true, site: r.siteName, title: t.title, undone: t.undone, late: t.late };
}

/** Approve a waiting series (§32.7): the rule, the first windows, what each does, who hears. */
export function ApproveSeriesDialog({
  s,
  viewer,
  now,
  open,
  onClose,
  onDone = onClose,
  onUndone,
}: SeriesDialogProps) {
  const { error, pending, run } = useSubmit(onDone, onUndone);
  usePostPendingOnOpen(open);
  const r = s.series;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      dismissOnScrim={false}
      title={`Approve the ${r.siteName} series?`}
      description={seriesDescription(r)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
          <Button
            variant="primary"
            icon={<IconCheck />}
            loading={pending}
            onClick={() =>
              run(
                () => decideSeries({ seriesId: r.id, approve: true, reason: '' }),
                // The toast counts the windows the server made (§32 7a).
                (res) => held(r, 'approved', res.windows?.length ?? 0),
              )
            }
          >
            Approve series
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Effects lines={approveSeriesEffects(r, viewer, now)} />
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}

/** Decline a waiting series (§32.7): a reason, which the asker gets. */
export function DeclineSeriesDialog({
  s,
  viewer,
  open,
  onClose,
  onDone = onClose,
  onUndone,
}: SeriesDialogProps) {
  const [reason, setReason] = useState('');
  const { error, pending, run } = useSubmit(onDone, onUndone);
  usePostPendingOnOpen(open);
  const r = s.series;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      dismissOnScrim={false}
      title={r.byName ? `Decline ${r.byName}’s series?` : 'Decline this series?'}
      description={seriesDescription(r)}
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
              run(() => decideSeries({ seriesId: r.id, approve: false, reason }), held(r, 'declined', 0))
            }
          >
            Decline request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Effects lines={declineSeriesEffects(r, viewer)} />
        <TextField
          touchHeight
          label="Reason"
          required
          placeholder="e.g. Make it monthly instead"
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
 * Cancel series (§32.6) — or, on a waiting series, the asker's Withdraw (§32.7): the windows that haven't
 * started, the running one, who hears, a reason.
 */
export function EndSeriesDialog({ s, viewer, open, onClose, onDone = onClose, onUndone }: SeriesDialogProps) {
  const [reason, setReason] = useState('');
  const { error, pending, run } = useSubmit(onDone, onUndone);
  usePostPendingOnOpen(open);
  const r = s.series;
  const withdraw = s.state === 'waiting';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      dismissOnScrim={false}
      title={withdraw ? 'Withdraw your series request?' : `Cancel the ${r.siteName} series?`}
      description={seriesDescription(r)}
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
              run(
                () => cancelSeries({ seriesId: r.id, reason }),
                held(r, withdraw ? 'withdrawn' : 'cancelled', r.upcoming.length),
              )
            }
          >
            {withdraw ? 'Withdraw request' : 'Cancel series'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Effects lines={endSeriesEffects(r, viewer, withdraw)} />
        <TextField
          touchHeight
          label="Reason"
          required
          placeholder={withdraw ? 'e.g. The host does it now' : 'e.g. Plugins now update automatically'}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint={hintFor(reason)}
        />
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}
