import 'server-only';
import type { DbClient } from '@dxt/db';
import { incidentThreadId, postChatMessage, sendEmail } from '@dxt/notifier';
import { UNDO_WINDOW_SEC } from '@dxt/shared';
import type { CronJobResult } from '../cron-job';
import { contextOf, loadFacts, type Facts, type Notification } from './facts';
import { renderChat, renderEmail, renderSystemAlertEmail } from './render';
import { renderWindowChat, renderWindowEmail } from './render-window';
import { loadOncallFacts } from './oncall-facts';
import { renderOncallChat, renderOncallEmail } from './render-oncall';

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

export interface DispatchOptions {
  /** Epoch ms: start no send that could end after it; the rest goes back to the queue. */
  deadline?: number;
  /** Only this incident's messages (the ack's own flush). */
  incidentId?: string;
}

type Outcome = { ok: true; providerId: string | null } | { ok: false; error: string; retryable: boolean };

export interface ChannelSummary {
  sent: number;
  retrying: number;
  failed: number;
  superseded: number;
  released: number;
}

const CLAIM_LIMIT = 20;
/** Longest one send may take (Chat and Resend time out at 10 s), plus writing it down. */
export const ROW_BUDGET_MS = 12_000;
/**
 * PRD §9 / §11: a failed message is retried 30 s, 2 min and 8 min after it was first due, then
 * given up — a Chat message then falls back to email (D-016). Four attempts in all.
 */
export const BACKOFF_MS = [30_000, 120_000, 480_000] as const;
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;

const WAITING_FOR_ACK: readonly string[] = ['unacked', 'escalated'];

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
 * One notifier pass over Chat and email side by side, so a stuck Chat never holds back the email
 * record. Each claimed message is rendered from its incident and stored context, sent, and its
 * attempt recorded in `notification_attempts`. A Chat message that fails for good queues its
 * fallback emails, which the next pass sends.
 */
export async function dispatchNotifications(
  deps: DispatchDeps,
  options: DispatchOptions = {},
): Promise<CronJobResult> {
  if (
    options.deadline !== undefined &&
    (deps.now ?? (() => new Date()))().getTime() + ROW_BUDGET_MS > options.deadline
  ) {
    return { ok: true, chat: 'no_time', email: 'no_time' };
  }
  const claim = async (channel: 'google_chat' | 'email') => {
    const claimed = await deps.db.rpc('claim_notifications', {
      p_channel: channel,
      p_limit: CLAIM_LIMIT,
      ...(options.incidentId ? { p_incident_id: options.incidentId } : {}),
      // On-call rows too (S10 B2b): this notifier renders them.
      p_oncall: true,
    });
    if (claimed.error) throw new Error(`claim_notifications: ${claimed.error.message}`);
    return claimed.data;
  };
  const [chatRows, emailRows] = await settled([
    deps.webhookUrl ? claim('google_chat') : null,
    deps.email ? claim('email') : null,
  ]);
  // One load of incidents, owners and recipients for both channels.
  const all = [...(chatRows ?? []), ...(emailRows ?? [])];
  const facts = all.length ? await loadFacts(deps.db, all) : null;
  // On-call facts (S10): a failed read never holds an outage alert back — those rows retry next pass.
  if (facts && all.some((n) => n.oncall_event_id)) {
    try {
      facts.oncall = await loadOncallFacts(deps.db, all);
    } catch (err) {
      console.error(JSON.stringify({ event: 'oncall_facts_unreadable', error: String(err) }));
    }
  }
  const [chat, email] = await settled([
    chatRows && facts
      ? dispatchChannel(deps, 'google_chat', chatRows, facts, options)
      : chatRows && emptySummary(),
    emailRows && facts
      ? dispatchChannel(deps, 'email', emailRows, facts, options)
      : emailRows && emptySummary(),
  ]);
  return { ok: true, chat: chat ?? 'no_webhook', email: email ?? 'not_configured' };
}

/** Like Promise.all, but waits for every branch before rethrowing: nothing keeps running detached. */
async function settled<T extends readonly unknown[]>(
  work: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results = await Promise.allSettled(work);
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw (failed as PromiseRejectedResult).reason;
  return results.map((r) => (r as PromiseFulfilledResult<unknown>).value) as never;
}

const emptySummary = (): ChannelSummary => ({ sent: 0, retrying: 0, failed: 0, superseded: 0, released: 0 });

async function dispatchChannel(
  deps: DispatchDeps,
  channel: 'google_chat' | 'email',
  rows: readonly Notification[],
  facts: Facts,
  { deadline }: DispatchOptions,
): Promise<ChannelSummary> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const summary = emptySummary();

  for (const [index, n] of rows.entries()) {
    if (deadline !== undefined && now().getTime() + ROW_BUDGET_MS > deadline) {
      summary.released = await release(db, rows.slice(index));
      break;
    }

    // A Chat DOWN that hasn't left yet is old news once the incident moved on (acked, recovered):
    // the thread's latest reply must be the current status (ChatAlert), so it is dropped, not sent
    // late. The email still goes: it is each person's record of the incident (PRD §7).
    const incident = n.incident_id ? facts.incidents.get(n.incident_id) : undefined;
    const undoable =
      incident?.state === 'acknowledged' &&
      !!incident.acked_at &&
      now().getTime() < new Date(incident.acked_at).getTime() + UNDO_WINDOW_SEC * 1000;
    if (
      channel === 'google_chat' &&
      !undoable &&
      (n.template === 'down' || n.template === 'problem') &&
      incident &&
      !WAITING_FOR_ACK.includes(incident.state) &&
      // A PROBLEM raised to DOWN: acknowledging "blocked, not verified" isn't acknowledging an
      // outage, so its DOWN is posted even when the PROBLEM was acked (D-021).
      contextOf(n.context).escalated !== true
    ) {
      const dropped = await db
        .from('notifications')
        .update({
          status: 'cancelled',
          error: 'Superseded: the incident moved on first',
          next_retry_at: null,
          attempts: n.attempts - 1,
        })
        .eq('id', n.id)
        .eq('status', 'queued');
      if (dropped.error) throw new Error(`notifications: ${dropped.error.message}`);
      summary.superseded += 1;
      continue;
    }

    const outcome = await deliver(deps, n, facts, now());
    const at = now();
    const update = afterAttempt(n, outcome, at);

    const [saved, logged] = await Promise.all([
      // Only while the claim is still ours: a run that outlived its lease never overwrites a newer one.
      db
        .from('notifications')
        .update(update)
        .eq('id', n.id)
        .eq('status', 'queued')
        .eq('attempts', n.attempts)
        .select('id'),
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
    if (!saved.data?.length) {
      console.warn(JSON.stringify({ event: 'delivery_lease_lost', channel, notification: n.id }));
      continue;
    }
    summary[update.status === 'sent' ? 'sent' : update.status === 'queued' ? 'retrying' : 'failed'] += 1;

    if (outcome.ok && n.incident_id) {
      const event = await db.from('incident_events').insert({
        incident_id: n.incident_id,
        type: 'alerted',
        payload: { channel: n.channel, template: n.template, ...(n.user_id ? { user_id: n.user_id } : {}) },
      });
      if (event.error) throw new Error(`incident_events: ${event.error.message}`);
      continue;
    }
    if (outcome.ok) continue;
    console.warn(
      JSON.stringify({
        event: 'delivery_failed',
        channel,
        notification: n.id,
        attempt: n.attempts,
        error: outcome.error,
      }),
    );
    // A window's Chat line has no email fallback: the owner and backup already get its email (D-037).
    // Nor does an incident's MUTED line (mutes are Chat only, §24.5).
    if (update.status === 'failed' && channel === 'google_chat' && n.incident_id && n.template !== 'muted') {
      const fallback = await db.rpc('queue_fallback_emails', { p_notification_id: n.id });
      if (fallback.error) throw new Error(`queue_fallback_emails: ${fallback.error.message}`);
      console.warn(
        JSON.stringify({ event: 'chat_fallback_email', notification: n.id, queued: fallback.data }),
      );
    }
  }
  return summary;
}

/** Hands claimed rows back untouched: the claim counted an attempt this run never made. */
async function release(db: DbClient, rows: readonly Notification[]): Promise<number> {
  const results = await Promise.all(
    rows.map((r) =>
      db
        .from('notifications')
        .update({ attempts: r.attempts - 1, next_retry_at: null })
        .eq('id', r.id)
        .eq('status', 'queued')
        .eq('attempts', r.attempts),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`notifications: ${failed.error.message}`);
  return rows.length;
}

async function deliver(deps: DispatchDeps, n: Notification, facts: Facts, now: Date): Promise<Outcome> {
  if (n.system_alert_id) return deliverSystemAlert(deps, n, facts);
  if (n.maintenance_window_id) return deliverWindow(deps, n, facts, now);
  if (n.oncall_event_id) return deliverOncall(deps, n, facts);
  const incident = n.incident_id ? facts.incidents.get(n.incident_id) : undefined;
  if (!n.incident_id || !incident) return { ok: false, error: 'Incident not found', retryable: false };

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

  // Inactive people are not in `recipients`: a deactivated account gets nothing.
  const to = n.user_id ? facts.recipients.get(n.user_id) : undefined;
  if (!to) return { ok: false, error: 'Recipient not found or inactive', retryable: false };
  const { apiKey, from } = deps.email!;
  // One thread per incident; this person's first email starts theirs (Resend/SES set Message-IDs).
  const first = facts.firstEmail.get(`${n.incident_id}:${to.id}`);
  const message = renderEmail(n, incident, to, deps.appUrl, {
    threadId: incidentThreadId(n.incident_id, from),
    startsThread: !first || first.id === n.id,
  });
  if (!message) return { ok: false, error: `Can't render template ${n.template}`, retryable: false };
  const send = deps.send ?? sendEmail;
  const result = await send(message, { apiKey, from, to: to.email, idempotencyKey: `notification-${n.id}` });
  return result.ok ? { ok: true, providerId: result.id } : result;
}

/**
 * A maintenance window's message (S09b, D-037): its line or a mention reply in the window's own Space
 * thread (`mw-<id>`), or an email in its own mail thread.
 */
async function deliverWindow(deps: DispatchDeps, n: Notification, facts: Facts, now: Date): Promise<Outcome> {
  const w = facts.windows.get(n.maintenance_window_id!);
  if (!w) return { ok: false, error: 'Maintenance window not found', retryable: false };
  if (n.channel === 'google_chat') {
    const message = renderWindowChat(n, w, facts, deps.appUrl, now);
    if (!message) return { ok: false, error: `Can't render template ${n.template}`, retryable: false };
    const post = deps.post ?? postChatMessage;
    const result = await post(deps.webhookUrl!, message, {
      threadKey: n.thread_key ?? `mw-${w.id}`,
      messageId: `client-${n.id}`,
    });
    return result.ok
      ? { ok: true, providerId: result.messageName }
      : { ok: false, error: result.error, retryable: true };
  }
  const to = n.user_id ? facts.recipients.get(n.user_id) : undefined;
  if (!to) return { ok: false, error: 'Recipient not found or inactive', retryable: false };
  const { apiKey, from } = deps.email!;
  const first = facts.firstEmail.get(`${w.id}:${to.id}`);
  const message = renderWindowEmail(n, w, facts, deps.appUrl, {
    from,
    startsThread: !first || first.id === n.id,
    now,
  });
  if (!message) return { ok: false, error: `Can't render template ${n.template}`, retryable: false };
  const send = deps.send ?? sendEmail;
  const result = await send(message, { apiKey, from, to: to.email, idempotencyKey: `notification-${n.id}` });
  return result.ok ? { ok: true, providerId: result.id } : result;
}

/**
 * An on-call event's message (S10 B2b, D-048): its line in the subject's Space thread, or an email to
 * one person in the same subject's mail thread.
 */
async function deliverOncall(deps: DispatchDeps, n: Notification, facts: Facts): Promise<Outcome> {
  if (!facts.oncall) return { ok: false, error: 'On-call facts unreadable', retryable: true };
  const e = facts.oncall.get(n.oncall_event_id!);
  if (!e) return { ok: false, error: 'On-call event not found', retryable: false };
  if (n.channel === 'google_chat') {
    if (e.kind === 'test_alert' && !e.test?.token)
      return { ok: false, error: 'Test link no longer valid', retryable: false };
    const message = renderOncallChat(n, e, deps.appUrl);
    if (!message) return { ok: false, error: `Can't render template ${n.template}`, retryable: false };
    const post = deps.post ?? postChatMessage;
    const result = await post(deps.webhookUrl!, message, {
      threadKey: n.thread_key ?? `oncall-${e.id}`,
      messageId: `client-${n.id}`,
    });
    return result.ok
      ? { ok: true, providerId: result.messageName }
      : { ok: false, error: result.error, retryable: true };
  }
  const to = n.user_id ? facts.recipients.get(n.user_id) : undefined;
  if (!to) return { ok: false, error: 'Recipient not found or inactive', retryable: false };
  const { apiKey, from } = deps.email!;
  const startsThread = !e.emailed?.has(`${n.thread_key}:${to.id}`);
  const message = renderOncallEmail(n, e, to, deps.appUrl, { from, startsThread });
  if (!message) return { ok: false, error: `Can't render template ${n.template}`, retryable: false };
  const send = deps.send ?? sendEmail;
  const result = await send(message, { apiKey, from, to: to.email, idempotencyKey: `notification-${n.id}` });
  return result.ok ? { ok: true, providerId: result.id } : result;
}

/** An Admin alert (D-019): email only, its own subject and thread, to an active Admin. */
async function deliverSystemAlert(deps: DispatchDeps, n: Notification, facts: Facts): Promise<Outcome> {
  const alert = facts.systemAlerts.get(n.system_alert_id!);
  if (!alert) return { ok: false, error: 'System alert not found', retryable: false };
  const to = n.channel === 'email' && n.user_id ? facts.recipients.get(n.user_id) : undefined;
  if (!to) return { ok: false, error: 'Recipient not found or inactive', retryable: false };
  const { apiKey, from } = deps.email!;
  const message = renderSystemAlertEmail(n, alert, from);
  if (!message) return { ok: false, error: `Can't render template ${n.template}`, retryable: false };
  const send = deps.send ?? sendEmail;
  const result = await send(message, { apiKey, from, to: to.email, idempotencyKey: `notification-${n.id}` });
  return result.ok ? { ok: true, providerId: result.id } : result;
}

/**
 * The notifier cron: two passes, the second 30 s after the run started, so a retry due 30 s after a
 * failure leaves on time (Vercel Cron fires once a minute). Each pass sends only what fits before
 * its deadline (the second ends inside the 60 s maxDuration); the rest goes back to the queue.
 */
export async function runNotifierSweep(
  deps: DispatchDeps,
  {
    gapMs = 30_000,
    budgetMs = 55_000,
    clock = Date.now,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  } = {},
): Promise<CronJobResult> {
  const started = clock();
  const first = await dispatchNotifications(deps, { deadline: started + gapMs });
  await sleep(Math.max(0, started + gapMs - clock()));
  const second = await dispatchNotifications(deps, { deadline: started + budgetMs });
  return { ok: true, passes: [first, second] };
}
