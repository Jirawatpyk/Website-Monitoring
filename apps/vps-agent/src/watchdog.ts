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

export type WatchOutcome = 'ok' | 'fault' | 'posted' | 'post_failed';

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
 */
export function createWatchdog({ post, startedAt, graceMs = WATCH_GRACE_MS }: WatchdogDeps) {
  let lastContactAt = startedAt;
  let sweepAt: number | null = null;
  let onCallChatId: string | null = null;
  /** The fault the line was posted for (its `since`), so one fault posts once. */
  let postedFor: number | null = null;

  return {
    contact(c: Contact) {
      lastContactAt = c.at;
      // Absent (an older build, a failed read) or null (never ran): unknown, so no sweep fault.
      sweepAt = typeof c.engineSweepAt === 'string' ? Date.parse(c.engineSweepAt) : null;
      if (c.onCall !== undefined) onCallChatId = c.onCall?.chatUserId ?? null;
    },

    async tick(now: number): Promise<WatchOutcome> {
      const sweepMissed = sweepAt !== null && now - sweepAt >= graceMs;
      const unreachable = now - lastContactAt >= graceMs;
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
