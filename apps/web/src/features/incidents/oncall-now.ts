import 'server-only';
import type { DbClient } from '@dxt/db';

/**
 * Who holds the on-call shift at `now` (S10, D-048), read as the signed-in person (staff read
 * `oncall_shifts` by column), or null. Feeds the on-call branch of `mayAcknowledge`, which mirrors
 * `private.can_ack`. One row at most: shifts never overlap (exclusion constraint).
 */
export async function loadOnCallNow(db: DbClient, now: Date): Promise<string | null> {
  const at = now.toISOString();
  const { data, error } = await db
    .from('oncall_shifts')
    .select('user_id')
    .lte('starts_at', at)
    .gt('ends_at', at)
    .maybeSingle();
  if (error) throw new Error(`oncall_shifts: ${error.message}`);
  return data?.user_id ?? null;
}
