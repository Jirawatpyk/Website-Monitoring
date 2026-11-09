import 'server-only';
import type { DbClient } from '@dxt/db';
import { clientUpdateDueAt, episodesFromTimeline } from '@dxt/engine';
import type { ResponseHours, Severity, Tier } from '@dxt/shared';
import { loadDropEvents } from './drops';

/**
 * The client-update track's tick (S11, FR-20, spec §9), once per engine run after the ladder: every
 * open DOWN incident on a Tier 1–2 client site whose track hasn't fired gets it once its time came
 * (`clientUpdateDueAt` — 15 min from the first failed check, or 60 min inside response hours), acked
 * or not. Recovered incidents are read too: a drop that covered the due time still fires when the
 * recovery was judged in the same minute. `engine_client_update_due` is guarded (once, a live thread,
 * not recovered before it fell due), so overlapping runs queue it once. One incident's failure doesn't
 * hold the others back. Returns how many fired (for inline delivery) and the incidents that failed.
 */
export async function clientUpdateTick(
  db: DbClient,
  now: Date,
  hours: ResponseHours,
): Promise<{ queued: number; failed: string[] }> {
  const { data, error } = await db
    .from('incidents')
    .select(
      'id, started_at, severity, resolved_at, alerted_at, sites!inner(tier, clients!inner(is_internal))',
    )
    .eq('severity', 'down')
    .eq('client_update_required', false)
    // The open-incident index's predicate (incidents_one_open_per_site).
    .not('state', 'in', '(resolved,in_review,closed)');
  if (error) throw new Error(`incidents: ${error.message}`);

  const candidates = data.filter(
    (i) => (i.sites.tier === 1 || i.sites.tier === 2) && !i.sites.clients.is_internal,
  );
  if (candidates.length === 0) return { queued: 0, failed: [] };

  const events = {
    data: await loadDropEvents(
      db,
      candidates.map((i) => i.id),
    ),
  };

  let queued = 0;
  const failed: string[] = [];
  for (const inc of candidates) {
    let due: Date | null;
    try {
      due = clientUpdateDueAt({
        tier: inc.sites.tier as Tier,
        episodes: episodesFromTimeline(
          { started_at: inc.started_at, severity: inc.severity as Severity, resolved_at: inc.resolved_at },
          events.data.filter((e) => e.incident_id === inc.id),
        ),
        hours,
        // A mute held its first alert back: the track counts from that alert (D-052 item 6).
        alertedAt: inc.alerted_at ? new Date(inc.alerted_at) : null,
      });
    } catch (err) {
      // "response hours never open" on one Tier 2 incident mustn't hold the others back (engine review L1).
      failed.push(`${inc.id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!due || due > now) continue;
    const { data: fired, error: rpcError } = await db.rpc('engine_client_update_due', {
      p_incident_id: inc.id,
      p_due_at: due.toISOString(),
    });
    if (rpcError) failed.push(`${inc.id}: ${rpcError.message}`);
    else if (fired) queued += 1;
  }
  return { queued, failed };
}
