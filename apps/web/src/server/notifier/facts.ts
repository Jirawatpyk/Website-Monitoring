import 'server-only';
import type { Database, DbClient, Json } from '@dxt/db';
import type { ResponseHours, Trigger } from '@dxt/shared';
import { loadResponseHours } from '../escalation/response-hours';

export type Notification = Database['public']['Tables']['notifications']['Row'];

export interface Owner {
  id: string;
  display_name: string;
  google_chat_user_id: string | null;
}

/** What a message is rendered from: its incident, the site and owners, and who acknowledged. */
export interface IncidentFacts {
  id: string;
  number: number;
  state: string;
  /** A PROBLEM's messages are worded as one (spec §19, D-022). */
  severity: 'down' | 'problem';
  trigger: Trigger;
  started_at: string;
  detected_at: string;
  acked_at: string | null;
  recovered_at: string | null;
  acker: { display_name: string; google_chat_user_id?: string | null } | null;
  /**
   * The timeline: the `detected` one carries the cause line; `detected` / `relapsed` / `recovered`
   * give the drops (DOWN AGAIN "Down 7 min so far", the flapping summary).
   */
  incident_events?: { type: string; payload: Json; at?: string }[];
  sites: {
    name: string;
    tier: number;
    primary: Owner | null;
    backup: Owner | null;
    client?: { am: Owner | null } | null;
  };
  /** The policy it opened with and the level fired (S08, D-034); null before S08. */
  escalation_plan?: Json | null;
  escalation_level?: number;
  /** Who "Admin" names and the Tier 2–3 hours, for the ladder's words (attached by loadFacts). */
  ladder?: { admins: Owner[]; hours: ResponseHours };
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
export async function loadFacts(
  db: DbClient,
  rows: readonly Notification[],
  now: Date = new Date(),
): Promise<Facts> {
  const incidentIds = [...new Set(rows.flatMap((n) => (n.incident_id ? [n.incident_id] : [])))];
  const alertIds = [...new Set(rows.flatMap((n) => (n.system_alert_id ? [n.system_alert_id] : [])))];
  const userIds = [...new Set(rows.flatMap((n) => (n.user_id ? [n.user_id] : [])))];
  const none = Promise.resolve({ data: [], error: null });
  const [incidents, alerts, people, emails, ladder] = await Promise.all([
    db
      .from('incidents')
      .select(
        `id, number, state, severity, trigger, started_at, detected_at, acked_at, recovered_at,
         escalation_plan, escalation_level,
         acker:profiles!incidents_acked_by_fkey(display_name, google_chat_user_id),
         incident_events(type, payload, at),
         sites!inner(name, tier,
           primary:profiles!sites_primary_owner_id_fkey(id, display_name, google_chat_user_id),
           backup:profiles!sites_backup_owner_id_fkey(id, display_name, google_chat_user_id),
           client:clients(am:profiles!clients_am_user_id_fkey(id, display_name, google_chat_user_id)))`,
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
    incidentIds.length ? loadLadderEnv(db, now) : Promise.resolve(null),
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
    incidents: new Map(incidents.data.map((i) => [i.id, ladder ? { ...i, ladder } : i])),
    systemAlerts: new Map(((alerts.data ?? []) as SystemAlertFacts[]).map((a) => [a.id, a])),
    recipients: new Map(((people.data ?? []) as Recipient[]).map((p) => [p.id, p])),
    firstEmail,
  };
}

/** The facts the engine or the ack stored with the message (`notifications.context`). */
export function contextOf(context: Json): Record<string, Json | undefined> {
  return context && typeof context === 'object' && !Array.isArray(context) ? context : {};
}

/**
 * Every active Admin ("Admin" in a step) and the response hours: the ladder's words (S08, D-034). A
 * failed read renders the messages without the ladder (null) instead of holding every alert back.
 */
async function loadLadderEnv(
  db: DbClient,
  now: Date,
): Promise<{ admins: Owner[]; hours: ResponseHours } | null> {
  const [admins, hours] = await Promise.all([
    db
      .from('profiles')
      .select('id, display_name, google_chat_user_id')
      .eq('role', 'admin')
      .eq('is_active', true),
    loadResponseHours(db, now),
  ]);
  if (admins.error) {
    console.error(JSON.stringify({ event: 'ladder_people_unreadable', error: admins.error.message }));
    return null;
  }
  return { admins: (admins.data ?? []) as Owner[], hours };
}
