'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Icon } from '@jirawatpyk/aura-react';
import { formatTimeWithSeconds, UNDO_WINDOW_SEC } from '@dxt/shared';
import { acknowledgeIncident, undoAcknowledge } from '../actions';
import type { AckState } from '../view';

interface AckPanelProps {
  incidentId: string;
  ack: AckState;
  viewerName: string;
  viewerEmail: string;
  siteUrl: string | null;
  /** The LATEST log: it sits between the ack card and the bar, as on the board. */
  children: ReactNode;
}

/**
 * Whole seconds left until `iso`. The clock starts on the client (null on the server and in the
 * first render, so hydration matches: the full window shows until the first tick, right after).
 */
function useSecondsLeft(iso: string | null): number {
  const [now, setNow] = useState<number | null>(null);
  const target = iso ? new Date(iso).getTime() : 0;
  useEffect(() => {
    if (!iso) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [iso]);
  if (!iso) return 0;
  if (now === null) return UNDO_WINDOW_SEC;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

/**
 * The ack card, the Undo countdown and the sticky action bar of MobileAck (spec §14.3, §15.6,
 * §16.8; D-016 copy). The server decides the state; this part only runs the actions and the clock.
 */
export function AckPanel({ incidentId, ack, viewerName, viewerEmail, siteUrl, children }: AckPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const holdingUntil = ack.kind === 'acked' && ack.notifies && !ack.posted ? ack.postsAt : null;
  const seconds = useSecondsLeft(holdingUntil);
  const holding = holdingUntil !== null && seconds > 0;

  // When the window closes the messages leave; refresh to show "Posted …" once they have.
  useEffect(() => {
    if (!holdingUntil || seconds > 0) return;
    const timers = [2_000, 8_000].map((ms) => setTimeout(() => router.refresh(), ms));
    return () => timers.forEach(clearTimeout);
  }, [holdingUntil, seconds, router]);

  const run = (action: () => Promise<{ ok: true } | { ok: false; message: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.message);
      router.refresh();
    });

  return (
    <>
      {ack.kind === 'acked' && (
        <section
          aria-label="Acknowledgement"
          className="flex flex-col gap-1.5 rounded-aura-lg border border-l-4 border-border-default border-l-fg-positive bg-bg-surface px-3.5 py-3"
        >
          <div className="flex items-center gap-2">
            <span className="flex text-fg-positive">
              <Icon name="check" size="sm" />
            </span>
            <span className="grow font-semibold">
              {ack.byViewer ? `Acknowledged as ${viewerName}` : `Acknowledged by ${ack.byName}`}
            </span>
          </div>
          <span className="text-sm">Acknowledged by {ack.byName}.</span>
          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-1.5 text-xs text-fg-secondary"
          >
            <span className="flex pt-px">
              <Icon name={holding || (ack.notifies && !ack.posted) ? 'clock' : 'check'} size="sm" />
            </span>
            <span>
              {holding
                ? `Posting to Chat and email in ${seconds} s — nothing is sent until then`
                : !ack.notifies
                  ? 'Nothing to post — no alert went out for this incident.'
                  : ack.posted
                    ? `Posted to ${ack.posted.to} at ${formatTimeWithSeconds(new Date(ack.posted.at))}`
                    : 'Posting to the Chat thread and email now'}
            </span>
          </div>
          {holding && ack.byViewer && (
            <Button
              variant="secondary"
              icon="rotate-ccw"
              fullWidth
              loading={pending}
              onClick={() => run(() => undoAcknowledge(incidentId))}
            >
              {`Undo · ${seconds} s`}
            </Button>
          )}
        </section>
      )}

      {children}

      <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t border-border-default bg-bg-surface px-4 pt-2.5 pb-6">
        {error && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        {ack.kind === 'can-ack' && (
          <>
            <span className="flex items-center justify-center gap-1.5 text-xs text-fg-secondary">
              <Icon name="user" size="sm" />
              <span>
                Signed in as <b className="font-medium text-fg-primary">{viewerEmail}</b>
              </span>
            </span>
            <Button
              variant="primary"
              icon="check"
              fullWidth
              loading={pending}
              onClick={() => run(() => acknowledgeIncident(incidentId))}
            >
              Acknowledge
            </Button>
          </>
        )}
        {siteUrl && (
          <Button variant="secondary" fullWidth href={siteUrl} target="_blank" rel="noopener noreferrer">
            Visit site ↗
          </Button>
        )}
      </div>
    </>
  );
}
