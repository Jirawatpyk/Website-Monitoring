import 'server-only';
import { createHash } from 'node:crypto';
import type { DbClient } from '@dxt/db';
import { normalizeForMatch } from '@dxt/shared';

/** The most text a stored page keeps: the crawler's 3 MB read, decoded (the table's check). */
export const CLEAN_PAGE_MAX_CHARS = 3_200_000;

export interface CleanPage {
  monitorId: string;
  view: string;
  checkedAt: string;
  /** The decoded page, as read. */
  text: string;
}

const keyOf = (monitorId: string, view: string) => `${monitorId}/${view}`;

/** Each stored page's hash, so a run sends the text only when it changed. */
export async function loadCleanHashes(db: DbClient): Promise<Map<string, string>> {
  const { data, error } = await db.from('crawler_clean_pages').select('monitor_id, view, body_hash');
  if (error) throw new Error(`crawler_clean_pages: ${error.code ?? ''} ${error.message}`.trim());
  return new Map(data.map((r) => [keyOf(r.monitor_id, r.view), r.body_hash]));
}

/**
 * S17 PR 3b (D-069): keep a clean fetch as the site's newest clean page for that view — the text as the
 * matcher reads it, for 3c's "Check phrase". Unchanged text only moves `checked_at`. Returns the error
 * message, or null.
 */
export async function storeCleanPage(
  db: DbClient,
  hashes: Map<string, string>,
  page: CleanPage,
): Promise<string | null> {
  const body = normalizeForMatch(page.text).slice(0, CLEAN_PAGE_MAX_CHARS);
  const hash = createHash('sha256').update(body).digest('hex');
  const key = keyOf(page.monitorId, page.view);
  if (hashes.get(key) === hash) {
    const { error } = await db
      .from('crawler_clean_pages')
      .update({ checked_at: page.checkedAt })
      .eq('monitor_id', page.monitorId)
      .eq('view', page.view);
    return error?.message ?? null;
  }
  const { error } = await db.from('crawler_clean_pages').upsert({
    monitor_id: page.monitorId,
    view: page.view,
    checked_at: page.checkedAt,
    body_hash: hash,
    body,
  });
  if (!error) hashes.set(key, hash);
  return error?.message ?? null;
}
