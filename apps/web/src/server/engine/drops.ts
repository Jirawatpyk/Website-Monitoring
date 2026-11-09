import 'server-only';
import type { DbClient, Json } from '@dxt/db';
import { fetchAllPages } from '@/lib/csv';

/** The timeline rows a drop is read from (`episodesFromTimeline`). */
export const DROP_EVENTS = ['detected', 'relapsed', 'escalated_to_down', 'recovered'];

export interface DropEventRow {
  incident_id: string;
  type: string;
  at: string;
  payload: Json;
}

/**
 * The drop events of these incidents, oldest first — the client-update track's minutes (D-052) and the
 * ladder's paused clock (D-058) are read from them. Paged: PostgREST answers at most 1,000 rows,
 * silently, and a flapping incident's drops could push another incident's `detected` row out (code
 * review, S11).
 */
export async function loadDropEvents(db: DbClient, incidentIds: string[]): Promise<DropEventRow[]> {
  if (incidentIds.length === 0) return [];
  return fetchAllPages(
    (from, to) =>
      db
        .from('incident_events')
        .select('incident_id, type, at, payload')
        .in('incident_id', incidentIds)
        .in('type', DROP_EVENTS)
        .order('at')
        .order('id')
        .range(from, to),
    { max: 50_000 },
  ).catch((err: Error) => {
    throw new Error(`incident_events: ${err.message}`);
  });
}
