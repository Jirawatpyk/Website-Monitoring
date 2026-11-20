// @vitest-environment node
/**
 * S17 PR 3b (D-069) on the LOCAL Supabase stack: the clean-page store as the crawler uses it — the list
 * read from `forbidden_phrases`, a page kept as the matcher reads it, the same text again only moving
 * `checked_at`, and the pages of a monitor no longer read dropped. Run with `pnpm --filter @dxt/web
 * test:int` (CI: the `db` job).
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { FORBIDDEN_PHRASES } from '@dxt/shared';
import type { Database, DbClient } from '@dxt/db';
import { loadForbiddenList } from '../forbidden-list';
import { loadCleanHashes, pruneCleanPages, storeCleanPage } from './clean-pages';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
// The Supabase CLI's well-known local demo key — not a secret, and never sent to a non-local URL.
const SECRET_KEY = process.env.E2E_SUPABASE_SECRET_KEY ?? 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(URL_))
  throw new Error('integration tests run on the local stack only');

const db: DbClient = createClient<Database>(URL_, SECRET_KEY, { auth: { persistSession: false } });

async function twoMonitors(): Promise<[string, string]> {
  const { data, error } = await db.from('monitors').select('id').is('removed_at', null).limit(2);
  if (error || !data || data.length < 2) throw new Error('the local seed needs two monitors');
  return [data[0]!.id, data[1]!.id];
}

afterAll(async () => {
  await db.from('crawler_clean_pages').delete().not('monitor_id', 'is', null);
});

describe('the clean-page store (D-069)', () => {
  it('reads the seeded list', async () => {
    expect(await loadForbiddenList(db)).toEqual(FORBIDDEN_PHRASES);
  });

  it('keeps a page as the matcher reads it, moves only checked_at for the same text, prunes the rest', async () => {
    const [a, b] = await twoMonitors();
    await db.from('crawler_clean_pages').delete().not('monitor_id', 'is', null);
    const hashes = await loadCleanHashes(db);
    const at = (s: string) => new Date(`2026-11-20T03:${s}Z`).toISOString();
    expect(
      await storeCleanPage(db, hashes, {
        monitorId: a,
        view: 'plain',
        checkedAt: at('00:00'),
        text: '<P>Hello  World</P>',
      }),
    ).toBeNull();
    expect(
      await storeCleanPage(db, hashes, {
        monitorId: b,
        view: 'googlebot',
        checkedAt: at('00:00'),
        text: 'b',
      }),
    ).toBeNull();

    const again = await loadCleanHashes(db);
    expect(again.size).toBe(2);
    expect(
      await storeCleanPage(db, again, {
        monitorId: a,
        view: 'plain',
        checkedAt: at('30:00'),
        text: '<p>hello world</p>',
      }),
    ).toBeNull();
    const { data: row } = await db
      .from('crawler_clean_pages')
      .select('body, checked_at')
      .eq('monitor_id', a)
      .single();
    expect(row).toMatchObject({ body: '<p>hello world</p>' });
    expect(Date.parse(row!.checked_at)).toBe(Date.parse(at('30:00')));

    expect(await pruneCleanPages(db, [a])).toBeNull();
    const { data: left } = await db.from('crawler_clean_pages').select('monitor_id');
    expect(left).toEqual([{ monitor_id: a }]);
    expect(await pruneCleanPages(db, [])).toBeNull();
    const { count } = await db.from('crawler_clean_pages').select('*', { count: 'exact', head: true });
    expect(count).toBe(0);
  });
});
