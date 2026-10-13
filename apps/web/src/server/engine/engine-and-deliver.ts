import 'server-only';
import type { DbClient } from '@dxt/db';
import type { ServerEnv } from '@/lib/env';
import { notifierDeps } from '../notifier/deps';
import { dispatchNotifications } from '../notifier/dispatch';
import { runEngine, type EngineOptions, type EngineSummary } from './run-engine';

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
  engine: (db: DbClient, now: Date, options: EngineOptions) => Promise<EngineSummary> = runEngine,
): Promise<EngineSummary & { delivery?: unknown }> {
  const summary = await engine(db, new Date(), { defacementAlerts: env.DEFACEMENT_ALERTS === 'on' });
  // Any incident change that queued messages (one count from the runner, whatever the kind), or an
  // Admin alert (D-019, D-022, D-024): send them now.
  if ((summary.notified ?? 0) + (summary.alerts ?? 0) === 0) return summary;
  try {
    return { ...summary, delivery: await dispatchNotifications(notifierDeps(db, env), { deadline }) };
  } catch (err) {
    console.error(JSON.stringify({ event: 'inline_delivery_failed', error: String(err) }));
    return { ...summary, delivery: { ok: false, error: 'delivery failed; the notifier cron retries' } };
  }
}

/**
 * After a report from the VPS — a Bangkok batch (Ingest) or a verifier verdict (Job API) — judge
 * the rounds and send at once, after the response. Any Bangkok result, even a pass, can complete a
 * round SIN and TYO already confirmed (S02b review; PRD §9: alert within 30 s). Idempotent like
 * the probe trigger; a failure is logged and the engine cron judges the round on its next run.
 */
export async function engineAfterReport(
  db: DbClient,
  env: ServerEnv,
  deadline: number,
  source: 'ingest' | 'jobs',
  run: typeof engineAndDeliver = engineAndDeliver,
): Promise<void> {
  try {
    const summary = await run(db, env, deadline);
    console.info(JSON.stringify({ event: 'engine_after_report', source, ...summary }));
  } catch (err) {
    console.error(JSON.stringify({ event: 'engine_after_report_failed', source, error: String(err) }));
  }
}
