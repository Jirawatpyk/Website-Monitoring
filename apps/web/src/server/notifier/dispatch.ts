import 'server-only';
import type { DbClient } from '@dxt/db';
import { postChatMessage, sendEmail } from '@dxt/notifier';
import type { CronJobResult } from '../cron-job';
import { loadFacts, type Facts, type Notification } from './facts';
import { domainOf, renderChat, renderEmail } from './render';

export interface EmailConfig {
  apiKey: string;
  /** "DxT Monitor <alerts@…>". */
  from: string;
}

export interface DispatchDeps {
  db: DbClient;
  /** Alerts space incoming webhook; without it Chat messages stay queued. */
  webhookUrl: string | undefined;
  /** Resend key + sender; without it emails stay queued. */
  email: EmailConfig | undefined;
  /** Public base URL of this app, for incident links. */
  appUrl: string;
  now?: () => Date;
  post?: typeof postChatMessage;
  send?: typeof sendEmail;
}

type Outcome = { ok: true; providerId: string | null } | { ok: false; error: string; retryable: boolean };

export interface ChannelSummary {
  sent: number;
  retrying: number;
  failed: number;
}

const CLAIM_LIMIT = 20;
/**
 * PRD §9 / §11: a failed message is retried 30 s, 2 min and 8 min after it was first due, then
 * given up — a Chat message then falls back to email (D-016). Four attempts in all.
 */
export const BACKOFF_MS = [30_000, 120_000, 480_000] as const;
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;

/**
 * What a row becomes after an attempt (`n.attempts` already counts it — the claim adds one).
 * Retries are timed from when the message was first due (`hold_until`, else `created_at`), so the
 * schedule doesn't drift with cron timing.
 */
export function afterAttempt(
  n: Pick<Notification, 'attempts' | 'hold_until' | 'created_at'>,
  outcome: Outcome,
  at: Date,
) {
  if (outcome.ok) {
    return {
      status: 'sent' as const,
      sent_at: at.toISOString(),
      provider_message_id: outcome.providerId,
      error: null,
      next_retry_at: null,
    };
  }
  const backoff = BACKOFF_MS[n.attempts - 1];
  if (outcome.retryable && backoff !== undefined) {
    const due = new Date(n.hold_until ?? n.created_at).getTime();
    return {
      status: 'queued' as const,
      error: outcome.error,
      next_retry_at: new Date(due + backoff).toISOString(),
    };
  }
  return { status: 'failed' as const, error: outcome.error, next_retry_at: null };
}

/**
 * One notifier pass: Chat first (a Chat message that fails for good queues its fallback emails),
 * then email. Each claimed message is rendered from its incident and stored context, sent, and its
 * attempt recorded in `notification_attempts`.
 */
export async function dispatchNotifications(deps: DispatchDeps): Promise<CronJobResult> {
  const chat = deps.webhookUrl ? await dispatchChannel(deps, 'google_chat') : null;
  const email = deps.email ? await dispatchChannel(deps, 'email') : null;
  return {
    ok: true,
    chat: chat ?? 'no_webhook',
    email: email ?? 'not_configured',
  };
}

async function dispatchChannel(
  deps: DispatchDeps,
  channel: 'google_chat' | 'email',
): Promise<ChannelSummary> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const summary: ChannelSummary = { sent: 0, retrying: 0, failed: 0 };

  const claimed = await db.rpc('claim_notifications', { p_channel: channel, p_limit: CLAIM_LIMIT });
  if (claimed.error) throw new Error(`claim_notifications: ${claimed.error.message}`);
  if (!claimed.data.length) return summary;
  const facts = await loadFacts(db, claimed.data);

  for (const n of claimed.data) {
    const outcome = await deliver(deps, n, facts, now());
    const at = now();
    const update = afterAttempt(n, outcome, at);
    summary[update.status === 'sent' ? 'sent' : update.status === 'queued' ? 'retrying' : 'failed'] += 1;

    const [saved, logged] = await Promise.all([
      db.from('notifications').update(update).eq('id', n.id),
      db.from('notification_attempts').insert({
        notification_id: n.id,
        attempt: n.attempts,
        ok: outcome.ok,
        error: outcome.ok ? null : outcome.error,
        provider_message_id: outcome.ok ? outcome.providerId : null,
        at: at.toISOString(),
      }),
    ]);
    if (saved.error) throw new Error(`notifications: ${saved.error.message}`);
    if (logged.error) throw new Error(`notification_attempts: ${logged.error.message}`);

    if (outcome.ok) {
      const event = await db.from('incident_events').insert({
        incident_id: n.incident_id,
        type: 'alerted',
        payload: { channel: n.channel, template: n.template, ...(n.user_id ? { user_id: n.user_id } : {}) },
      });
      if (event.error) throw new Error(`incident_events: ${event.error.message}`);
      continue;
    }
    console.warn(
      JSON.stringify({
        event: 'delivery_failed',
        channel,
        notification: n.id,
        attempt: n.attempts,
        error: outcome.error,
      }),
    );
    if (update.status === 'failed' && channel === 'google_chat') {
      const fallback = await db.rpc('queue_fallback_emails', { p_notification_id: n.id });
      if (fallback.error) throw new Error(`queue_fallback_emails: ${fallback.error.message}`);
      console.warn(
        JSON.stringify({ event: 'chat_fallback_email', notification: n.id, queued: fallback.data }),
      );
    }
  }
  return summary;
}

async function deliver(deps: DispatchDeps, n: Notification, facts: Facts, now: Date): Promise<Outcome> {
  const incident = facts.incidents.get(n.incident_id);
  if (!incident) return { ok: false, error: 'Incident not found', retryable: false };

  if (n.channel === 'google_chat') {
    const message = renderChat(n, incident, deps.appUrl, now);
    if (!message) return { ok: false, error: `Can't render template ${n.template}`, retryable: false };
    const post = deps.post ?? postChatMessage;
    // messageId makes a re-send of an already posted message a no-op (Chat answers 409).
    const result = await post(deps.webhookUrl!, message, {
      threadKey: n.thread_key ?? n.incident_id,
      messageId: `client-${n.id}`,
    });
    return result.ok
      ? { ok: true, providerId: result.messageName }
      : { ok: false, error: result.error, retryable: true };
  }

  const to = n.user_id ? facts.recipients.get(n.user_id) : undefined;
  if (!to) return { ok: false, error: 'Recipient not found', retryable: false };
  const { apiKey, from } = deps.email!;
  const message = renderEmail(n, incident, to, deps.appUrl, domainOf(from));
  if (!message) return { ok: false, error: `Can't render template ${n.template}`, retryable: false };
  const send = deps.send ?? sendEmail;
  const result = await send(message, { apiKey, from, to: to.email, idempotencyKey: `notification-${n.id}` });
  return result.ok ? { ok: true, providerId: result.id } : result;
}

/**
 * The notifier cron: two passes 30 s apart, so a retry due 30 s after a failure leaves on time
 * (Vercel Cron fires once a minute). The second pass runs only when enough of the 60 s maxDuration
 * is left after the first (`budgetMs`, with room for a slow pass); otherwise the next run picks it up.
 */
export async function runNotifierSweep(
  deps: DispatchDeps,
  {
    gapMs = 30_000,
    budgetMs = 55_000,
    reserveMs = 20_000,
    clock = Date.now,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  } = {},
): Promise<CronJobResult> {
  const started = clock();
  const first = await dispatchNotifications(deps);
  if (budgetMs - (clock() - started) < gapMs + reserveMs) {
    return { ok: true, passes: [first], skipped: 'no_time_for_second_pass' };
  }
  await sleep(gapMs);
  const second = await dispatchNotifications(deps);
  return { ok: true, passes: [first, second] };
}
