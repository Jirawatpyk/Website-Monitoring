'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@jirawatpyk/aura-react';
import { IconCheck, IconClock, IconRotateCcw, IconUser } from '@jirawatpyk/aura-react/icons';
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

/** After the window: refresh at these delays, then every POLL_MS, to show "Posted …". */
const REFRESH_AFTER_MS = [2_000, 8_000];
const POLL_MS = 15_000;
/** Retries run up to ~10 min (30 s, 2 min, 8 min); stop polling after that. */
const POLL_FOR_MS = 11 * 60_000;
/** Past this the copy says it's still being tried rather than "now". */
const LATE_AFTER_MS = 30_000;

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
  const [late, setLate] = useState(false);
  const ackButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const cardTitle = useRef<HTMLHeadingElement>(null);
  const previousKind = useRef(ack.kind);

  // Only a window still open when the server rendered counts down: a reload after it closed never
  // shows an Undo that would be refused.
  const holdingUntil =
    ack.kind === 'acked' && ack.windowOpen && ack.notifies && !ack.posted ? ack.postsAt : null;
  const seconds = useSecondsLeft(holdingUntil);
  const holding = holdingUntil !== null && seconds > 0;
  const waitingForPost = ack.kind === 'acked' && ack.notifies && !ack.posted && !holding;
  const postsAt = ack.kind === 'acked' ? ack.postsAt : null;

  // Once the window has closed the messages leave (or are retried): refresh until "Posted …".
  useEffect(() => {
    if (!waitingForPost || !postsAt) return;
    const since = Date.now() - new Date(postsAt).getTime();
    if (since > POLL_FOR_MS) return;
    const timers = REFRESH_AFTER_MS.map((ms) => setTimeout(() => router.refresh(), ms));
    const poll = setInterval(() => router.refresh(), POLL_MS);
    const lateTimer = setTimeout(() => setLate(true), Math.max(0, LATE_AFTER_MS - since));
    const stop = setTimeout(() => clearInterval(poll), POLL_FOR_MS - since);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(poll);
      clearTimeout(lateTimer);
      clearTimeout(stop);
    };
  }, [waitingForPost, postsAt, router]);

  // Keep keyboard and screen-reader users where the action left them (WCAG 2.4.3): after an ack, on
  // Undo (or the card); after an Undo, back on Acknowledge.
  useEffect(() => {
    const before = previousKind.current;
    previousKind.current = ack.kind;
    if (before === 'can-ack' && ack.kind === 'acked') (undoButton.current ?? cardTitle.current)?.focus();
    if (before === 'acked' && ack.kind === 'can-ack') ackButton.current?.focus();
  }, [ack.kind]);

  const run = (action: () => Promise<{ ok: true } | { ok: false; message: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      // A success re-renders through the action's revalidatePath; a refusal means the incident
      // changed under us (someone else acked, the window closed) — show what it is now.
      if (!result.ok) {
        setError(result.message);
        router.refresh();
      }
    });

  const phase =
    ack.kind !== 'acked'
      ? ''
      : holding
        ? 'Posting to Chat and email in a few seconds — nothing is sent until then'
        : !ack.notifies
          ? 'Nothing to post — no alert went out for this incident.'
          : ack.posted
            ? `Posted to ${ack.posted.to} at ${formatTimeWithSeconds(new Date(ack.posted.at))}`
            : late
              ? 'Still sending — retried automatically until it goes through'
              : 'Posting to the Chat thread and email now';

  return (
    <>
      {/* Mounted from the start so its changes are announced; it says each phase once, the visible
          line below counts the seconds. */}
      <p role="status" className="sr-only">
        {phase}
      </p>

      {ack.kind === 'acked' && (
        <section
          aria-labelledby="ack-card-title"
          className="flex flex-col gap-1.5 rounded-aura-lg border border-l-4 border-border-default border-l-fg-positive bg-bg-surface px-3.5 py-3"
        >
          <div className="flex items-center gap-2">
            <span className="flex text-fg-positive">
              <IconCheck aria-hidden className="size-4" />
            </span>
            <h2
              id="ack-card-title"
              ref={cardTitle}
              tabIndex={-1}
              className="m-0 grow text-base font-semibold outline-none"
            >
              {ack.byViewer ? `Acknowledged as ${viewerName}` : `Acknowledged by ${ack.byName}`}
            </h2>
          </div>
          {ack.byViewer && <span className="text-sm">Acknowledged by {ack.byName}.</span>}
          <div className="flex items-start gap-1.5 text-xs text-fg-secondary">
            <span className="flex pt-px">
              {holding || waitingForPost ? (
                <IconClock aria-hidden className="size-4" />
              ) : (
                <IconCheck aria-hidden className="size-4" />
              )}
            </span>
            <span>
              {holding ? `Posting to Chat and email in ${seconds} s — nothing is sent until then` : phase}
            </span>
          </div>
          {holding && ack.byViewer && (
            <Button
              ref={undoButton}
              variant="secondary"
              icon={<IconRotateCcw />}
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
              <IconUser aria-hidden className="size-4" />
              <span>
                Signed in as <b className="font-medium text-fg-primary">{viewerEmail}</b>
              </span>
            </span>
            <Button
              ref={ackButton}
              variant="primary"
              icon={<IconCheck />}
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
