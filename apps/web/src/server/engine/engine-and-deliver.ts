import 'server-only';
import type { DbClient } from '@dxt/db';
import type { ServerEnv } from '@/lib/env';
import { notifierDeps } from '../notifier/deps';
import { dispatchNotifications } from '../notifier/dispatch';
import { runEngine, type EngineSummary } from './run-engine';

/**
 * Judge the rounds, then send right away what that queued (PRD §9: an alert leaves within 30 s of
 * the confirm), within `deadline`. The engine's work is committed before sending starts, so a
 * delivery failure is reported in the summary, never as an engine failure (its Healthchecks ping
 * stays green); the notifier cron sends anything left.
 */
export async function engineAndDeliver(
  db: DbClient,
  env: ServerEnv,
  deadline: number,
  engine: (db: DbClient) => Promise<EngineSummary> = runEngine,
): Promise<EngineSummary & { delivery?: unknown }> {
  const summary = await engine(db);
  if (summary.opened + summary.recovered === 0) return summary;
  try {
    return { ...summary, delivery: await dispatchNotifications(notifierDeps(db, env), { deadline }) };
  } catch (err) {
    console.error(JSON.stringify({ event: 'inline_delivery_failed', error: String(err) }));
    return { ...summary, delivery: { ok: false, error: 'delivery failed; the notifier cron retries' } };
  }
}
