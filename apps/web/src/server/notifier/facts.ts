import 'server-only';
import type { Database, DbClient, Json } from '@dxt/db';

export type Notification = Database['public']['Tables']['notifications']['Row'];

interface Owner {
  id: string;
  display_name: string;
  google_chat_user_id: string | null;
}

/** What a message is rendered from: its incident, the site and owners, and who acknowledged. */
export interface IncidentFacts {
  id: string;
  number: number;
  state: string;
  started_at: string;
  detected_at: string;
  acked_at: string | null;
  recovered_at: string | null;
  acker: { display_name: string } | null;
  sites: { name: string; tier: number; primary: Owner | null; backup: Owner | null };
}

/** An Admin alert that isn't about one incident (D-019). */
export interface SystemAlertFacts {
  id: string;
  kind: string;
  opened_at: string;
  context: Json;
}

export interface Recipient {
  id: string;
  email: string;
  display_name: string;
}

export interface Facts {
  incidents: Map<string, IncidentFacts>;
  systemAlerts: Map<string, SystemAlertFacts>;
  /** Active people only: a deactivated account gets no email. */
  recipients: Map<string, Recipient>;
  /** `incident:user` → the first email that person was really sent (the thread root). */
  firstEmail: Map<string, { id: string }>;
}

/** Loads the incidents, system alerts and email recipients of a batch of claimed messages. */
export async function loadFacts(db: DbClient, rows: readonly Notification[]): Promise<Facts> {
  const incidentIds = [...new Set(rows.flatMap((n) => (n.incident_id ? [n.incident_id] : [])))];
  const alertIds = [...new Set(rows.flatMap((n) => (n.system_alert_id ? [n.system_alert_id] : [])))];
  const userIds = [...new Set(rows.flatMap((n) => (n.user_id ? [n.user_id] : [])))];
  const none = Promise.resolve({ data: [], error: null });
  const [incidents, alerts, people, emails] = await Promise.all([
    db
      .from('incidents')
      .select(
        `id, number, state, started_at, detected_at, acked_at, recovered_at,
         acker:profiles!incidents_acked_by_fkey(display_name),
         sites!inner(name, tier,
           primary:profiles!sites_primary_owner_id_fkey(id, display_name, google_chat_user_id),
           backup:profiles!sites_backup_owner_id_fkey(id, display_name, google_chat_user_id))`,
      )
      .in('id', incidentIds)
      .overrideTypes<IncidentFacts[], { merge: false }>(),
    alertIds.length
      ? db.from('system_alerts').select('id, kind, opened_at, context').in('id', alertIds)
      : none,
    userIds.length
      ? db.from('profiles').select('id, email, display_name').in('id', userIds).eq('is_active', true)
      : none,
    userIds.length && incidentIds.length
      ? db
          .from('notifications')
          .select('id, incident_id, user_id')
          .eq('channel', 'email')
          .eq('status', 'sent')
          .in('incident_id', incidentIds)
          .in('user_id', userIds)
          .order('created_at')
      : none,
  ]);
  if (incidents.error) throw new Error(`incidents: ${incidents.error.message}`);
  if (alerts.error) throw new Error(`system_alerts: ${alerts.error.message}`);
  if (people.error) throw new Error(`profiles: ${people.error.message}`);
  if (emails.error) throw new Error(`notifications: ${emails.error.message}`);

  type Sent = { id: string; incident_id: string; user_id: string | null };
  const firstEmail = new Map<string, { id: string }>();
  for (const e of (emails.data ?? []) as Sent[]) {
    const key = `${e.incident_id}:${e.user_id}`;
    if (!firstEmail.has(key)) firstEmail.set(key, { id: e.id });
  }
  return {
    incidents: new Map(incidents.data.map((i) => [i.id, i])),
    systemAlerts: new Map(((alerts.data ?? []) as SystemAlertFacts[]).map((a) => [a.id, a])),
    recipients: new Map(((people.data ?? []) as Recipient[]).map((p) => [p.id, p])),
    firstEmail,
  };
}

/** The facts the engine or the ack stored with the message (`notifications.context`). */
export function contextOf(context: Json): Record<string, Json | undefined> {
  return context && typeof context === 'object' && !Array.isArray(context) ? context : {};
}
