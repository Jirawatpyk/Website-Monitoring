import 'server-only';
import { getAccess } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { incidentIdSchema } from './schemas';
import { buildIncidentView, type EventRow, type IncidentRow, type IncidentView } from './view';

/**
 * The incident as the MobileAck page shows it, read as the signed-in person (RLS: staff read
 * incidents, sites, monitors, profiles and the timeline). Null when the id is malformed or unknown.
 */
export async function getIncidentForAck(incidentId: string, now = new Date()): Promise<IncidentView | null> {
  if (!incidentIdSchema.safeParse(incidentId).success) return null;
  const access = await getAccess();
  if (access.status !== 'active') return null;
  const supabase = await createClient();

  const [incident, events] = await Promise.all([
    supabase
      .from('incidents')
      .select(
        `id, number, state, started_at, detected_at, acked_at, acked_by, recovered_at,
         sites!inner(name, tier, primary_owner_id, backup_owner_id, monitors(url, is_primary))`,
      )
      .eq('id', incidentId)
      .maybeSingle()
      .overrideTypes<IncidentRow, { merge: false }>(),
    supabase
      .from('incident_events')
      .select('type, at, actor_id, payload')
      .eq('incident_id', incidentId)
      .order('at', { ascending: false })
      .limit(20)
      .overrideTypes<EventRow[], { merge: false }>(),
  ]);
  if (incident.error) throw new Error(`incident: ${incident.error.message}`);
  if (events.error) throw new Error(`incident_events: ${events.error.message}`);
  if (!incident.data) return null;

  const i = incident.data;
  const ids = new Set<string>();
  for (const id of [i.acked_by, i.sites.primary_owner_id, i.sites.backup_owner_id]) if (id) ids.add(id);
  for (const e of events.data) {
    if (e.actor_id) ids.add(e.actor_id);
    if (typeof e.payload.user_id === 'string') ids.add(e.payload.user_id);
  }
  const people = ids.size
    ? await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', [...ids])
    : { data: [], error: null };
  if (people.error) throw new Error(`profiles: ${people.error.message}`);

  return buildIncidentView(
    i,
    events.data,
    access.profile,
    new Map(people.data.map((p) => [p.id, p.display_name])),
    now,
  );
}
