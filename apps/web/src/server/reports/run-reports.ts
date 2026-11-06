import 'server-only';
import { digestModel, reportChat, weeklyEmail, weeklyModel } from '@dxt/notifier';
import { BANGKOK_OFFSET_MS, bangkokDayStart } from '@dxt/shared';
import type { Json } from '@dxt/db';
import type { CronJobResult } from '../cron-job';
import { dispatchNotifications, type DispatchDeps } from '../notifier/dispatch';
import { loadCeoIds, loadDigestFacts, loadWeeklyFacts } from './facts';

const DAY_MS = 86_400_000;

/** The Bangkok calendar date of `at` as "2026-09-25". */
export const bangkokDate = (at: Date) =>
  new Date(bangkokDayStart(at).getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);

/** Monday in Bangkok. */
export const isBangkokMonday = (at: Date) => new Date(at.getTime() + BANGKOK_OFFSET_MS).getUTCDay() === 1;

/**
 * The reports cron at 09:00 Bangkok (S14, FR-12, D-056): queues the daily digest — and on Monday the
 * weekly summary, emailed to the CEO — rendered now, then sends them. Queuing is once per report and
 * period (`queue_report`), so a cron that fires twice posts once. The reports' Healthchecks check is
 * pinged by the dispatcher when the digest's post really went (not here): a missing ping by 09:05 means
 * the monitor needs checking.
 */
export async function runReports(deps: DispatchDeps, now: Date = new Date()): Promise<CronJobResult> {
  if (!deps.reportsWebhookUrl) return { ok: false, reason: 'no_reports_webhook' };
  const { db } = deps;

  const digest = digestModel(await loadDigestFacts(db, now, deps.appUrl));
  const daily = await db.rpc('queue_report', {
    p_kind: 'daily',
    p_period_start: bangkokDate(now),
    p_chat: reportChat(digest, 'daily-digest') as unknown as Json,
    p_email: null as unknown as Json,
    p_recipients: null as unknown as string[],
  });
  if (daily.error) throw new Error(`queue_report daily: ${daily.error.message}`);

  let weekly: string | null | 'not_monday' = 'not_monday';
  if (isBangkokMonday(now)) {
    const facts = await loadWeeklyFacts(db, now, deps.appUrl);
    const model = weeklyModel(facts);
    const ceos = deps.email ? await loadCeoIds(db) : [];
    const queued = await db.rpc('queue_report', {
      p_kind: 'weekly',
      p_period_start: bangkokDate(new Date(bangkokDayStart(now).getTime() - 7 * DAY_MS)),
      p_chat: reportChat(model, 'weekly-summary') as unknown as Json,
      p_email: (ceos.length ? weeklyEmail(model, facts) : null) as unknown as Json,
      p_recipients: ceos,
    });
    if (queued.error) throw new Error(`queue_report weekly: ${queued.error.message}`);
    weekly = queued.data;
  }

  // Send now rather than on the notifier's next pass; a failure is retried there.
  const sent = await dispatchNotifications(deps, { deadline: Date.now() + 40_000 });
  return {
    ok: true,
    daily: daily.data ? 'queued' : 'already_queued',
    weekly: weekly === 'not_monday' ? weekly : weekly ? 'queued' : 'already_queued',
    sent,
  };
}
