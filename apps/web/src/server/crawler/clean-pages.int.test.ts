// @vitest-environment node
/**
 * S17 PR 3b (D-069) on the LOCAL Supabase stack: the clean-page store as the crawler uses it — the list
 * read from `forbidden_phrases`, a page kept as the matcher reads it, the same text again only moving
 * `checked_at`, new text overwriting it, and `crawler_prune_clean_pages` dropping a page of an old URL or
 * of a monitor no longer read. Run with `pnpm --filter @dxt/web test:int` (CI: the `db` job).
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

/** A live site's primary monitor, as the crawler reads it. */
async function livePrimary(): Promise<{ id: string; url: string }> {
  const { data, error } = await db
    .from('monitors')
    .select('id, url, sites!inner(is_active)')
    .eq('sites.is_active', true)
    .eq('is_primary', true)
    .eq('enabled', true)
    .is('removed_at', null)
    .limit(1)
    .single();
  if (error) throw new Error(`the local seed needs a live primary monitor: ${error.message}`);
  return { id: data.id, url: data.url };
}

const clear = () => db.from('crawler_clean_pages').delete().not('monitor_id', 'is', null);
const rows = async () =>
  (await db.from('crawler_clean_pages').select('view, url, body, checked_at').order('view')).data ?? [];
const at = (mmss: string) => new Date(`2026-11-20T03:${mmss}Z`).toISOString();

afterAll(async () => {
  await clear();
});

describe('the clean-page store (D-069)', () => {
  it('reads the seeded list', async () => {
    expect(await loadForbiddenList(db)).toEqual(FORBIDDEN_PHRASES);
  });

  it('keeps, moves, overwrites, and prunes an old URL’s page', async () => {
    const m = await livePrimary();
    await clear();
    const page = (view: string, text: string, url = m.url, checkedAt = at('00:00')) =>
      storeCleanPage(db, hashes, { monitorId: m.id, view, url, checkedAt, text });

    let hashes = await loadCleanHashes(db);
    expect(await page('plain', '<P>Hello  World</P>')).toEqual({ error: null, written: true });
    expect(await page('googlebot', 'old host', 'https://old.example.test/')).toEqual({
      error: null,
      written: true,
    });

    // The same text again only moves checked_at; new text overwrites the row.
    hashes = await loadCleanHashes(db);
    expect(await page('plain', '<p>hello world</p>', m.url, at('30:00'))).toEqual({
      error: null,
      written: false,
    });
    expect((await rows()).find((r) => r.view === 'plain')).toMatchObject({ body: '<p>hello world</p>' });
    expect(await page('plain', '<p>Changed</p>', m.url, at('59:00'))).toEqual({ error: null, written: true });
    const plain = (await rows()).find((r) => r.view === 'plain')!;
    expect(plain.body).toBe('<p>changed</p>');
    expect(Date.parse(plain.checked_at)).toBe(Date.parse(at('59:00')));

    // The old URL's page goes; the live one stays.
    expect(await pruneCleanPages(db)).toBeNull();
    expect((await rows()).map((r) => r.view)).toEqual(['plain']);
  });

  it('drops the page of a monitor no longer read', async () => {
    const { data } = await db
      .from('monitors')
      .select('id, url')
      .eq('is_primary', false)
      .is('removed_at', null)
      .limit(1);
    const key = data?.[0];
    if (!key) return; // the seed has no key page: the old-URL case above covers the rule
    await clear();
    expect(
      await storeCleanPage(db, new Map(), {
        monitorId: key.id,
        view: 'plain',
        url: key.url,
        checkedAt: at('00:00'),
        text: 'key page',
      }),
    ).toEqual({ error: null, written: true });
    expect(await pruneCleanPages(db)).toBeNull();
    expect(await rows()).toEqual([]);
  });
});
