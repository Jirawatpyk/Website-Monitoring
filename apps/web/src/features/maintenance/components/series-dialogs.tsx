'use client';

import { nextOccurrences } from '@dxt/engine';
import { formatDay, formatNameList } from '@dxt/shared';
import { Button, Dialog, TextField } from '@jirawatpyk/aura-react';
import { IconCheck } from '@jirawatpyk/aura-react/icons';
import { useState } from 'react';
import { cancelSeries, decideSeries } from '../actions';
import { ruleOf, seriesWhen, type SeriesPageRow } from '../series-model';
import { hintFor, Refusal, useSubmit, usePostPendingOnOpen, type Held } from './window-dialogs';

/**
 * The series dialogs (MaintenancePage STATE › Approve series / Cancel series, MMaintenanceList; spec §32.6–7,
 * 7a): Approve, Decline, Cancel series and Withdraw — each held 10 s with Undo, like one window's actions.
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

const day = (d: Date | string) => formatDay(new Date(d), { weekday: true });
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Who a series action emails: owner and backup, minus the actor (§32.11). */
function emailed(s: SeriesPageRow, viewer: string): string {
  const to = [
    ...new Set([s.series.ownerName, s.series.backupName].filter((n): n is string => !!n && n !== viewer)),
  ];
  return to.length
    ? `${formatNameList(to)} ${to.length === 1 ? 'gets' : 'get'} an email; the Alerts Space gets one line for the series.`
    : 'The Alerts Space gets one line for the series.';
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

/** Approve a waiting series (§32.7): the rule, the first 4 windows, "You approve the series once". */
export function ApproveSeriesDialog({
  s,
  now,
  open,
  onClose,
  onDone = onClose,
  onUndone,
}: SeriesDialogProps) {
  const { error, pending, run } = useSubmit(onDone, onUndone);
  usePostPendingOnOpen(open);
  const r = s.series;
  const rule = ruleOf(r);
  const first = rule
    ? nextOccurrences({ rule, startTime: r.startTime, startsOn: r.startsOn, untilOn: r.untilOn }, 4, now)
    : [];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      dismissOnScrim={false}
      title={`Approve the ${r.siteName} series?`}
      description={`${seriesWhen(r)} · asked by ${r.byName ?? 'someone'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep waiting
          </Button>
          <Button
            variant="primary"
            icon={<IconCheck />}
            loading={pending}
            onClick={() =>
              run(
                async () => {
                  const res = await decideSeries({ seriesId: r.id, approve: true, reason: '' });
                  return res.ok ? { ok: true as const, postsAt: res.postsAt, windows: res.windows } : res;
                },
                (res) =>
                  held(
                    r.id,
                    r.siteName,
                    `${r.siteName} series approved · ${plural(res.windows?.length ?? 0, 'window')} scheduled`,
                    {
                      title: `${r.siteName} series approval undone`,
                      text: 'Nothing was posted and no windows were scheduled. It’s waiting for approval again.',
                    },
                  ),
              )
            }
          >
            Approve series
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Effects
          lines={[
            first.length
              ? `The first ${first.length} now: ${first.map(day).join(', ')}.`
              : 'No window is due soon.',
            'Each window: no alerts; checks still run; not counted in uptime.',
            'You approve the series once; its windows don’t ask again. They are created 14 days ahead.',
          ]}
        />
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}

/** Decline a waiting series (§32.7): a reason, which the asker gets. */
export function DeclineSeriesDialog({ s, open, onClose, onDone = onClose, onUndone }: SeriesDialogProps) {
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
      title={`Decline ${r.byName ?? 'this'}’s series?`}
      description={`${r.siteName} · ${seriesWhen(r)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep waiting
          </Button>
          <Button
            variant="primary"
            disabled={!reason.trim()}
            loading={pending}
            onClick={() =>
              run(
                () => decideSeries({ seriesId: r.id, approve: false, reason }),
                held(r.id, r.siteName, `${r.siteName} series declined`, {
                  title: `${r.siteName} series declined — undone`,
                  text: 'Nothing was posted. It’s waiting for approval again.',
                }),
              )
            }
          >
            Decline series
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Effects
          lines={['Nothing is scheduled.', `${r.byName ?? 'The asker'} is told in Chat with your reason.`]}
        />
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
  const n = r.upcoming.length;
  const lines = withdraw
    ? [
        'Nothing was scheduled, so nothing is cancelled.',
        'The Admins get an email; the Alerts Space gets one line.',
      ]
    : [
        `${n ? `Cancels the ${plural(n, 'occurrence')} that haven’t started (${r.upcoming.map(day).join(', ')}).` : 'No window is waiting to start.'} ${r.running ? 'One that is running finishes.' : 'Nothing is running now.'}`,
        'No new windows are created. Past ones stay under Recent.',
        emailed(s, viewer),
      ];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      dismissOnScrim={false}
      title={withdraw ? 'Withdraw your series request?' : `Cancel the ${r.siteName} series?`}
      description={`${r.siteName} · ${seriesWhen(r)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="danger"
            disabled={!reason.trim()}
            loading={pending}
            onClick={() =>
              run(
                () => cancelSeries({ seriesId: r.id, reason }),
                withdraw
                  ? held(r.id, r.siteName, `${r.siteName} series request withdrawn`, {
                      title: `${r.siteName} series request withdrawn — undone`,
                      text: 'Nothing was posted. It’s waiting for approval again.',
                    })
                  : held(
                      r.id,
                      r.siteName,
                      `${r.siteName} series cancelled · ${plural(n, 'window')} cancelled`,
                      {
                        title: `${r.siteName} series cancelled — undone`,
                        text: `Nothing was posted. The series and its ${plural(n, 'window')} are back.`,
                      },
                    ),
              )
            }
          >
            {withdraw ? 'Withdraw request' : 'Cancel series'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Effects lines={lines} />
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

/** A series action's toast (§32 7a): series ids, the series RPCs, its own undone words. */
function held(id: string, site: string, title: string, undone: Held['undone']): Held {
  return { windowId: id, series: true, site, title, undone };
}
