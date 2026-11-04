import 'server-only';

import { after } from 'next/server';
import { serverEnv } from '@/lib/env';
import { serviceDb } from '@/server/db';
import { notifierDeps } from '@/server/notifier/deps';
import { dispatchNotifications } from '@/server/notifier/dispatch';

const FLUSH_MARGIN_MS = 2_000;

/**
 * Sends the incident's queued messages from this request once `at` has passed (a held ACKNOWLEDGED /
 * RESOLVED: just after its window; a NOTE, a manual DOWN, Escalate now: now) — the notifier cron sweeps
 * up anything left.
 */
export function flushAfter(incidentId: string, at: string | null, event: string) {
  after(async () => {
    // The claim takes rows whose hold_until <= the database's now: 2 s of margin for clock skew.
    if (at) {
      await new Promise((r) =>
        setTimeout(r, Math.max(0, new Date(at).getTime() - Date.now()) + FLUSH_MARGIN_MS),
      );
    }
    try {
      // Only this incident's messages, and well inside the page's maxDuration.
      await dispatchNotifications(notifierDeps(serviceDb(), serverEnv()), {
        incidentId,
        deadline: Date.now() + 30_000,
      });
    } catch (err) {
      console.error(JSON.stringify({ event, error: String(err) }));
    }
  });
}
