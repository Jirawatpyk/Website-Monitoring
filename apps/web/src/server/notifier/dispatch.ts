import 'server-only';
import type { DbClient, Json } from '@dxt/db';
import {
  buildDownAlert,
  buildRecoveredAlert,
  postChatMessage,
  type ChatMessage,
  type ChatPerson,
  type ChatPostResult,
} from '@dxt/notifier';
import type { CronJobResult } from '../cron-job';

export interface DispatchDeps {
  db: DbClient;
  /** Alerts space incoming webhook; without it nothing is claimed (messages stay queued). */
  webhookUrl: string | undefined;
  /** Public base URL of this app, for the card's incident link. */
  appUrl: string;
  now?: Date;
  post?: typeof postChatMessage;
}

interface IncidentFacts {
  id: string;
  number: number;
  started_at: string;
  detected_at: string;
  recovered_at: string | null;
  sites: {
    name: string;
    tier: number;
    primary: { display_name: string; google_chat_user_id: string | null } | null;
    backup: { display_name: string; google_chat_user_id: string | null } | null;
  };
}

const CLAIM_LIMIT = 20;

/**
 * One notifier run: claim due Google Chat messages, render each from its incident and the context
 * the engine stored, post it in the incident's thread and record the delivery. Retries, email
 * fallback and the 30 s target are S02b; a failed post is recorded as `failed` with its error.
 */
export async function dispatchNotifications({
  db,
  webhookUrl,
  appUrl,
  now = new Date(),
  post = postChatMessage,
}: DispatchDeps): Promise<CronJobResult> {
  if (!webhookUrl) return { ok: false, skipped: 'no_webhook' };

  const claimed = await db.rpc('claim_notifications', { p_limit: CLAIM_LIMIT });
  if (claimed.error) throw new Error(`claim_notifications: ${claimed.error.message}`);
  const rows = claimed.data.filter((n) => n.channel === 'google_chat');
  if (!rows.length) return { ok: true, sent: 0, failed: 0 };

  const incidents = await db
    .from('incidents')
    .select(
      `id, number, started_at, detected_at, recovered_at,
       sites!inner(name, tier,
         primary:profiles!sites_primary_owner_id_fkey(display_name, google_chat_user_id),
         backup:profiles!sites_backup_owner_id_fkey(display_name, google_chat_user_id))`,
    )
    .in('id', [...new Set(rows.map((n) => n.incident_id))])
    .overrideTypes<IncidentFacts[], { merge: false }>();
  if (incidents.error) throw new Error(`incidents: ${incidents.error.message}`);

  let sent = 0;
  let failed = 0;
  for (const n of rows) {
    const incident = incidents.data.find((i) => i.id === n.incident_id);
    const message = incident ? render(n.template, incident, n.context, appUrl, now) : null;
    const result: ChatPostResult = message
      ? await post(webhookUrl, message, { threadKey: n.thread_key ?? n.incident_id })
      : { ok: false, error: `Can't render template ${n.template}` };

    const update = result.ok
      ? {
          status: 'sent' as const,
          sent_at: new Date().toISOString(),
          provider_message_id: result.messageName,
          error: null,
        }
      : { status: 'failed' as const, error: result.error };
    const saved = await db.from('notifications').update(update).eq('id', n.id);
    if (saved.error) throw new Error(`notifications: ${saved.error.message}`);

    if (result.ok) {
      sent += 1;
      const event = await db.from('incident_events').insert({
        incident_id: n.incident_id,
        type: 'alerted',
        payload: { channel: n.channel, template: n.template },
      });
      if (event.error) throw new Error(`incident_events: ${event.error.message}`);
    } else {
      failed += 1;
      console.warn(JSON.stringify({ event: 'chat_post_failed', notification: n.id, error: result.error }));
    }
  }
  return { ok: true, sent, failed };
}

const person = (p: IncidentFacts['sites']['primary']): ChatPerson | null =>
  p ? { name: p.display_name, chatUserId: p.google_chat_user_id } : null;

function render(
  template: string,
  i: IncidentFacts,
  context: Json,
  appUrl: string,
  now: Date,
): ChatMessage | null {
  const ctx = (context && typeof context === 'object' && !Array.isArray(context) ? context : {}) as Record<
    string,
    Json | undefined
  >;
  const owner = person(i.sites.primary);
  if (template === 'down') {
    return buildDownAlert({
      incidentId: i.id,
      incidentNumber: i.number,
      site: i.sites.name,
      tier: i.sites.tier,
      confirmedAt: new Date(i.detected_at),
      now,
      cause: typeof ctx.cause === 'string' ? ctx.cause : 'Hard fail',
      confirmingLocations: typeof ctx.confirmingLocations === 'number' ? ctx.confirmingLocations : 2,
      owner,
      backup: person(i.sites.backup),
      incidentUrl: new URL(`/incidents/${i.id}`, appUrl).toString(),
    });
  }
  if (template === 'recovered' && i.recovered_at) {
    return buildRecoveredAlert({
      incidentId: i.id,
      site: i.sites.name,
      startedAt: new Date(i.started_at),
      recoveredAt: new Date(i.recovered_at),
      okLocations: typeof ctx.okLocations === 'number' ? ctx.okLocations : 2,
      owner,
    });
  }
  return null;
}
