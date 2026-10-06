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

export interface Recipient {
  id: string;
  email: string;
  display_name: string;
}

export interface Facts {
  incidents: Map<string, IncidentFacts>;
  /** Active people only: a deactivated account gets no email. */
  recipients: Map<string, Recipient>;
  /** `incident:user` → the template of that person's first email of the incident (the thread root). */
  firstEmail: Map<string, string>;
}

/** Loads the incidents and email recipients of a batch of claimed messages, three queries in all. */
export async function loadFacts(db: DbClient, rows: readonly Notification[]): Promise<Facts> {
  const incidentIds = [...new Set(rows.map((n) => n.incident_id))];
  const userIds = [...new Set(rows.flatMap((n) => (n.user_id ? [n.user_id] : [])))];
  const none = Promise.resolve({ data: [], error: null });
  const [incidents, people, emails] = await Promise.all([
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
    userIds.length
      ? db.from('profiles').select('id, email, display_name').in('id', userIds).eq('is_active', true)
      : none,
    userIds.length
      ? db
          .from('notifications')
          .select('incident_id, user_id, template')
          .eq('channel', 'email')
          .neq('status', 'cancelled')
          .in('incident_id', incidentIds)
          .in('user_id', userIds)
          .order('created_at')
      : none,
  ]);
  if (incidents.error) throw new Error(`incidents: ${incidents.error.message}`);
  if (people.error) throw new Error(`profiles: ${people.error.message}`);
  if (emails.error) throw new Error(`notifications: ${emails.error.message}`);

  const firstEmail = new Map<string, string>();
  for (const e of (emails.data ?? []) as {
    incident_id: string;
    user_id: string | null;
    template: string;
  }[]) {
    const key = `${e.incident_id}:${e.user_id}`;
    if (!firstEmail.has(key)) firstEmail.set(key, e.template);
  }
  return {
    incidents: new Map(incidents.data.map((i) => [i.id, i])),
    recipients: new Map(((people.data ?? []) as Recipient[]).map((p) => [p.id, p])),
    firstEmail,
  };
}

/** The facts the engine or the ack stored with the message (`notifications.context`). */
export function contextOf(context: Json): Record<string, Json | undefined> {
  return context && typeof context === 'object' && !Array.isArray(context) ? context : {};
}
