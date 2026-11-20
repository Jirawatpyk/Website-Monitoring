import 'server-only';
import type { DbClient } from '@dxt/db';
import { FORBIDDEN_PHRASES } from '@dxt/shared';

/**
 * S17 PR 3b (D-069): the shared forbidden list as every check uses it — the `forbidden_phrases` table,
 * in the order it grew. A failed read (a deploy ahead of `migrate-production`, an outage) falls back to
 * the bundled list and logs: no probe ever stops for it. An empty table is a list with nothing in it.
 */
export async function loadForbiddenList(db: DbClient): Promise<readonly string[]> {
  try {
    const { data, error } = await db
      .from('forbidden_phrases')
      .select('phrase')
      .order('created_at')
      .order('id');
    if (error) throw new Error(`${error.code ?? ''} ${error.message}`.trim());
    return data.map((r) => r.phrase);
  } catch (err) {
    console.error(JSON.stringify({ event: 'forbidden_phrases_read_failed', error: String(err) }));
    return FORBIDDEN_PHRASES;
  }
}
