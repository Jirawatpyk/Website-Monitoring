import { buildMonitorFaultLine } from '@dxt/notifier';
import type { DueMonitorsResponse } from '@dxt/shared';

/** Spec §15.3: the engine's heartbeat missed for more than 3 min is a monitor fault. */
export const WATCH_GRACE_MS = 3 * 60_000;

/** What one answer from GET /api/ingest told the watchdog (api.ts `onContact`). */
export interface Contact {
  at: number;
  engineSweepAt?: DueMonitorsResponse['engineSweepAt'];
  onCall?: DueMonitorsResponse['onCall'];
}

export type WatchOutcome = 'ok' | 'fault' | 'posted' | 'post_failed' | 'blocked';

export interface WatchdogDeps {
  /** Posts the line to the Alerts Space; true when it landed. */
  post: (text: string, threadKey: string) => Promise<boolean>;
  /** When the agent started: an app unreachable from the start counts from here. */
  startedAt: number;
  graceMs?: number;
}

/**
 * The VPS watchdog (S12a, D-053): speaks for a stopped engine from outside Vercel. The engine's
 * cron sweep older than 3 min, or the Ingest API unreachable for 3 min, is a fault; the watchdog
 * posts `MONITOR FAULT` once per fault, @mentioning whoever was on call at the last answer, and
 * again only after the sweep came back and stopped again. A failed post is tried on the next tick.
 * A server that didn't send the sweep (an older build, a failed read) leaves it unknown, not missed;
 * a sweep that never ran (`null`, a fresh database) is no fault. "Back" posts nothing (spec §15.3).
 *
 * Refused (25 Nov 2026, D-074): the app answering 403 — Vercel's firewall denying this VPS, or a
 * bad token — means the app is up but won't talk to us. The engine can't be judged from here, so it
 * is `blocked`, not a fault: nobody is paged. The Admins still get Healthchecks' probe-bkk email.
 */
export function createWatchdog({ post, startedAt, graceMs = WATCH_GRACE_MS }: WatchdogDeps) {
  let lastContactAt = startedAt;
  let sweepAt: number | null = null;
  /** The last answer carried the sweep (a string or `null`); absent = unknown this tick. */
  let sweepKnown = true;
  let onCallChatId: string | null = null;
  /** The fault the line was posted for (its `since`), so one fault posts once. */
  let postedFor: number | null = null;
  /** The last 403 from the Ingest API (`refused`); newer than the last contact = blocked now. */
  let refusedAt: number | null = null;

  return {
    refused(at: number) {
      refusedAt = at;
    },

    contact(c: Contact) {
      lastContactAt = c.at;
      sweepKnown = c.engineSweepAt !== undefined;
      // null = never ran (no fault); absent = unknown: no new post, and the latch stays (engine review M2)
      if (sweepKnown) sweepAt = typeof c.engineSweepAt === 'string' ? Date.parse(c.engineSweepAt) : null;
      if (c.onCall !== undefined) onCallChatId = c.onCall?.chatUserId ?? null;
    },

    async tick(now: number): Promise<WatchOutcome> {
      const refusedNow = refusedAt !== null && refusedAt > lastContactAt && now - refusedAt < graceMs;
      const unreachable = now - lastContactAt >= graceMs && !refusedNow;
      if (refusedNow && now - lastContactAt >= graceMs) return postedFor !== null ? 'fault' : 'blocked';
      if (!sweepKnown && !unreachable) return postedFor !== null ? 'fault' : 'ok';
      const sweepMissed = sweepAt !== null && now - sweepAt >= graceMs;
      if (!sweepMissed && !unreachable) {
        postedFor = null;
        return 'ok';
      }
      // Since the last sweep seen; with none known, since the app last answered.
      const since = sweepAt ?? lastContactAt;
      if (postedFor !== null) return 'fault';
      const text = buildMonitorFaultLine({ since: new Date(since), onCallChatId });
      if (!(await post(text, `monitor-fault-${since}`))) return 'post_failed';
      postedFor = since;
      return 'posted';
    },
  };
}
