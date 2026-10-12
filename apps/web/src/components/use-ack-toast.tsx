'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@jirawatpyk/aura-react';
import { formatIncidentId } from '@dxt/shared';
import { UndoLine } from '@/components/undo-line';

export type AckAction = (
  incidentId: string,
) => Promise<{ ok: true; postsAt: string } | { ok: false; message: string }>;
export type UndoAction = (incidentId: string) => Promise<{ ok: true } | { ok: false; message: string }>;

const FAILED = 'Couldn’t reach the server. Check your connection and try again.';

/**
 * Acknowledge from a banner, a Live issues row or the incident page (spec §21.1, §14.3): the banner goes at once (the
 * page draws the incident as acked by `viewerName`), a toast counts down the 10 s hold with Undo, and
 * a refusal (someone else acked, the window closed) puts it back and says why. The SQL functions
 * decide (D-016); Realtime and the actions' revalidation bring the page up to date afterwards.
 */
export function useAckToast({ ack, undo }: { ack: AckAction; undo: UndoAction }) {
  const router = useRouter();
  const [acked, setAcked] = useState<ReadonlySet<string>>(new Set());
  const [, startTransition] = useTransition();

  const forget = useCallback((incidentId: string) => {
    setAcked((prev) => {
      const next = new Set(prev);
      next.delete(incidentId);
      return next;
    });
  }, []);

  const acknowledge = useCallback(
    (incidentId: string, number: number, severity?: 'down' | 'problem') => {
      const id = formatIncidentId(number);
      // What the ack stops (D-034): DOWN's escalation, a PROBLEM's reminders; unknown → said nothing.
      const stopped =
        severity === 'down' ? ' · escalation stopped' : severity === 'problem' ? ' · reminders stopped' : '';
      const toastId = `ack-${incidentId}`;
      setAcked((prev) => new Set(prev).add(incidentId));
      startTransition(async () => {
        // A thrown action (network drop, a deploy) is a refusal too: never leave the banner hidden.
        const result = await ack(incidentId).catch(() => ({ ok: false as const, message: FAILED }));
        // Optimistic only while the action runs: its revalidation has brought the page's own data by
        // now, so the server's state shows from here — a later relapse to Unacked brings the banner back.
        forget(incidentId);
        if (!result.ok) {
          toast.error(`Couldn't acknowledge ${id}`, { id: toastId, description: result.message });
          router.refresh();
          return;
        }
        const onUndo = () =>
          startTransition(async () => {
            const undone = await undo(incidentId).catch(() => ({ ok: false as const, message: FAILED }));
            if (undone.ok) {
              toast({ id: toastId, title: `Acknowledgement of ${id} undone`, duration: 4000 });
            } else {
              toast.error(`Couldn't undo ${id}`, { id: toastId, description: undone.message });
            }
            router.refresh();
          });
        const left = new Date(result.postsAt).getTime() - Date.now();
        toast.success(`Acknowledged ${id}${stopped}`, {
          id: toastId,
          description: <UndoLine postsAt={result.postsAt} onUndo={onUndo} />,
          // the window, then a moment to read "Posted"
          duration: Math.max(left, 0) + 2000,
        });
      });
    },
    [ack, undo, forget, router],
  );

  return { acked, acknowledge };
}
